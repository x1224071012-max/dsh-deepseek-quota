/**
 * dsh-deepseek-quota — host half.
 *
 * Publishes one same-origin GET route and nothing else:
 *
 *   GET /api/dsh/deepseek-quota                 balance + spend + usage by model
 *   GET /api/dsh/deepseek-quota?scope=balance   balance + spend only
 *
 * The browser half is a separate bundle (`./client`); the route is the whole
 * host/browser seam, so no Remote service, no generated schema, and no build
 * step is involved.
 *
 * Data sources, each resolved at request time so a changed credential or a new
 * session log reaches the next request without a restart:
 *
 * - account balance   `api.deepseek.com/user/balance`, key from `ctx.credentials`
 * - token usage       `ctx.sessionQuery` over local session logs, grouped by the
 *                     provider/model that actually answered each request
 * - today's spend     that usage priced with DeepSeek's published table, so it
 *                     covers the whole local calendar day (00:00 → now)
 * - balance delta     the account's own deduction, kept as an independent
 *                     cross-check over the window it can actually observe
 *
 * @module @dsh-external/dsh-deepseek-quota
 */

import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Cordis plugin name, also used as the `cordis.patch.yml` row id. */
export const name = 'deepseek-quota'

/** The route needs the HTTP carrier; every other capability is read optionally. */
export const inject = ['webServer']

/** Exact route served to the browser bundle. */
export const ROUTE = '/api/dsh/deepseek-quota'

const BALANCE_URL = 'https://api.deepseek.com/user/balance'
const KEY_REFS = ['DEEPSEEK_API_KEY']
const STATE_FILE = 'dsh-deepseek-quota.json'
const USAGE_DAYS = 7
const USAGE_SESSION_CAP = 30
const REQUEST_TIMEOUT_MS = 20000

/**
 * How many persisted session logs to read at once.
 *
 * Reading a log is I/O plus replay validation, so a handful in flight hides
 * most of the latency; the cap keeps a machine with many sessions from opening
 * dozens of reads simultaneously.
 */
const USAGE_READ_CONCURRENCY = 8

/**
 * Freshness windows for the two expensive lookups.
 *
 * Opening the view repeatedly — switching tabs, reloading the page — should not
 * re-hit the network or re-scan the logs for a number that cannot have moved
 * meaningfully. A manual refresh sends `?fresh=1` and bypasses both.
 */
const BALANCE_TTL_MS = 10000
const USAGE_TTL_MS = 15000

/* ------------------------------------------------------------------ *
 * Pricing
 * ------------------------------------------------------------------ */

/**
 * Official DeepSeek pricing, CNY per 1M tokens, from the Chinese pricing page —
 * the one that matches a CNY-billed account, so no exchange rate is invented.
 *
 * Source : https://api-docs.deepseek.com/zh-cn/quick_start/pricing
 * Read   : 2026-09-15
 *
 * Off-peak is half of peak. Peak hours are Beijing time (UTC+8) 09:00–12:00
 * and 14:00–18:00, Monday to Friday; every other hour is off-peak. Prices are
 * applied per REQUEST from that request's own timestamp, so a day spanning both
 * windows is priced correctly instead of at one blended rate.
 *
 * To follow a price change, edit this table — nothing else depends on the
 * numbers.
 */
export const PRICING = {
  currency: 'CNY',
  unit: 'per 1M tokens',
  source: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  updated: '2026-09-15',
  peakRule: '北京时间周一至周五 09:00–12:00、14:00–18:00 为高峰，其余为空闲时段（空闲价为高峰价的一半）',
  tiers: [
    {
      id: 'flash',
      matches: ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp', 'deepseek-v4.1-flash'],
      cacheHit: { offPeak: 0.02, peak: 0.04 },
      cacheMiss: { offPeak: 1, peak: 2 },
      output: { offPeak: 4, peak: 8 },
    },
    {
      id: 'pro',
      matches: ['deepseek-v4-pro', 'deepseek-v4-pro-0813', 'deepseek-pro'],
      cacheHit: { offPeak: 0.15, peak: 0.3 },
      cacheMiss: { offPeak: 4.5, peak: 9 },
      output: { offPeak: 13.5, peak: 27 },
    },
  ],
}

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

/**
 * Whether one instant falls in a DeepSeek peak window.
 *
 * The schedule is defined in Beijing time, so the timestamp is shifted by the
 * fixed UTC+8 offset and read with UTC getters. That is correct whatever
 * timezone the machine is in, and sidesteps local-time DST rules entirely.
 */
export function isPeak(ms) {
  const shifted = new Date(ms + BEIJING_OFFSET_MS)
  const weekday = shifted.getUTCDay()
  if (weekday === 0 || weekday === 6) return false
  const hour = shifted.getUTCHours()
  return (hour >= 9 && hour < 12) || (hour >= 14 && hour < 18)
}

/** @returns the pricing tier for one model id, or `undefined` when unknown. */
export function tierFor(model) {
  const id = String(model ?? '').toLowerCase()
  if (id === '') return undefined
  for (const tier of PRICING.tiers) {
    if (tier.matches.includes(id)) return tier
  }
  // Alias-tolerant fallback for versioned ids this table has not seen yet.
  if (id.includes('flash')) return PRICING.tiers.find((tier) => tier.id === 'flash')
  if (id.includes('pro')) return PRICING.tiers.find((tier) => tier.id === 'pro')
  return undefined
}

/**
 * Price one request in CNY.
 *
 * The harness `TokenUsage` contract carries DISJOINT counts: the DeepSeek
 * adapter subtracts cache hits out of `inputTokens`, so `inputTokens` is
 * exactly the cache-miss portion and `cacheReadTokens` the cache-hit portion
 * (verified in `dsh-llm-deepseek`'s `mapUsage`). `reasoningTokens` is a subset
 * of `outputTokens` and is never billed twice; `cacheWriteTokens` is never
 * produced by this provider, so it is reported but not billed.
 *
 * @returns the cost in CNY, or `undefined` when the model has no price.
 */
export function priceRequest(model, usage, peak) {
  const tier = tierFor(model)
  if (tier === undefined) return undefined
  const window = peak ? 'peak' : 'offPeak'
  const input = numberOrZero(usage.inputTokens)
  const cacheRead = numberOrZero(usage.cacheReadTokens)
  const output = numberOrZero(usage.outputTokens)
  return (input * tier.cacheMiss[window] + cacheRead * tier.cacheHit[window] + output * tier.output[window]) / 1e6
}

/* ------------------------------------------------------------------ *
 * Small helpers
 * ------------------------------------------------------------------ */

/** @returns a human-readable message for any thrown value. */
function messageOf(error) {
  if (error === null || error === undefined) return '未知错误'
  if (typeof error === 'string') return error
  if (typeof error.message === 'string' && error.message.length > 0) return error.message
  return String(error)
}

/** @returns `value` as a two-digit string. */
function pad2(value) {
  return value < 10 ? `0${value}` : String(value)
}

/** @returns the local calendar day key (`YYYY-MM-DD`) of one epoch millisecond. */
function localDayKey(ms) {
  const date = new Date(ms)
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** @returns the numeric amount, or `null` when the value is not parseable. */
function amountOf(value) {
  const parsed = Number.parseFloat(value === null || value === undefined ? '' : String(value))
  return Number.isFinite(parsed) ? parsed : null
}

/** @returns a finite number, else 0. */
function numberOrZero(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Round money to sub-cent precision so the JSON stays readable. */
function round6(value) {
  return Math.round(value * 1e6) / 1e6
}

/** Write one JSON response. */
function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

/**
 * Reject cross-site callers. A same-origin `fetch` may omit `Origin`, so an
 * absent or `null` origin is accepted; only an origin that contradicts `Host`,
 * or a browser-declared cross-site request, is refused.
 */
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = req.headers.origin
  if (typeof origin !== 'string' || origin === '' || origin === 'null') return true
  const host = req.headers.host
  if (typeof host !== 'string' || host === '') return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

/* ------------------------------------------------------------------ *
 * Account balance
 * ------------------------------------------------------------------ */

/**
 * Resolve the DeepSeek API key through the credentials service, which layers
 * the process environment, the provider-managed store, and `.env` files.
 * @returns the key, or `undefined` while unconfigured.
 */
async function resolveApiKey(ctx) {
  const credentials = ctx.get('credentials')
  if (credentials === undefined) return undefined
  for (const ref of KEY_REFS) {
    try {
      const found = await credentials.resolve(ref)
      if (found !== undefined && found !== null && typeof found.value === 'string' && found.value.length > 0) {
        return found.value
      }
    } catch {
      // an unconfigured reference is not an error; try the next one
    }
  }
  return undefined
}

/**
 * Read the account balance. Never throws: every failure comes back as
 * `{ ok: false, error }` so the route can hand it straight to the browser.
 */
async function fetchBalance(ctx) {
  const apiKey = await resolveApiKey(ctx)
  if (apiKey === undefined) {
    return { ok: false, error: '未配置 DeepSeek API Key（凭据 DEEPSEEK_API_KEY）' }
  }

  let response
  try {
    response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, error: `请求余额接口失败：${messageOf(error)}` }
  }

  const text = await response.text().catch(() => '')
  if (response.ok !== true) {
    return { ok: false, error: `HTTP ${response.status}：${text.slice(0, 300)}` }
  }

  let raw
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '余额接口返回了无法解析的内容' }
  }
  if (raw === null || typeof raw !== 'object') {
    return { ok: false, error: '余额接口返回了无法解析的内容' }
  }

  const listed = Array.isArray(raw.balance_infos)
    ? raw.balance_infos
    : raw.balance_infos === null || raw.balance_infos === undefined ? [] : [raw.balance_infos]
  const balances = []
  for (const info of listed) {
    if (info === null || typeof info !== 'object') continue
    balances.push({
      currency: String(info.currency ?? ''),
      total: String(info.total_balance ?? ''),
      granted: String(info.granted_balance ?? ''),
      toppedUp: String(info.topped_up_balance ?? ''),
    })
  }

  return { ok: true, isAvailable: raw.is_available === true, balances, endpoint: BALANCE_URL }
}

/* ------------------------------------------------------------------ *
 * Balance delta — the independent cross-check of the priced estimate
 * ------------------------------------------------------------------ */

/**
 * The baseline file lives in the harness home next to `settings.yaml`, so it
 * survives restarts and is shared by every session and workspace.
 */
export function statePath(env = process.env) {
  const configured = typeof env.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  const home = configured !== '' ? configured : join(homedir(), '.dsh')
  return join(home, STATE_FILE)
}

async function loadState(path) {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

async function saveState(path, value) {
  try {
    await writeFile(path, JSON.stringify(value), 'utf8')
    return true
  } catch {
    return false
  }
}

/**
 * The account's real deduction over the window this plugin could observe.
 *
 * This is deliberately NOT the headline "today" figure: it can only start when
 * the process first read the balance, so it under-counts any part of the day
 * that ran before the harness was up. It is reported beside the priced
 * estimate as ground truth — when the two disagree badly, either the local log
 * is missing calls (another machine, the web playground) or the price table
 * has drifted.
 */
async function computeSpend(ctx, balances) {
  const primary = balances.length > 0 ? balances[0] : null
  if (primary === null) return { available: false, reason: '接口未返回余额条目' }
  const current = amountOf(primary.total)
  if (current === null) return { available: false, reason: '余额数值无法解析' }

  const path = statePath()
  const now = Date.now()
  const today = localDayKey(now)
  const state = await loadState(path)
  const sameDay = state !== null && state.day === today && state.currency === primary.currency
  const baseline = sameDay ? amountOf(state.baselineTotal) : null

  if (sameDay && baseline !== null && current <= baseline) {
    return {
      available: true,
      amount: (baseline - current).toFixed(2),
      currency: primary.currency,
      since: numberOrZero(state.recordedAt),
      baselineTotal: baseline.toFixed(2),
      rebalanced: false,
    }
  }

  // First read today, currency change, or a top-up: re-anchor the baseline.
  const written = await saveState(path, {
    version: 1,
    day: today,
    currency: primary.currency,
    baselineTotal: String(current),
    recordedAt: now,
  })
  if (!written) {
    return { available: false, reason: `状态文件不可写（${path}）` }
  }
  return {
    available: true,
    amount: '0.00',
    currency: primary.currency,
    since: now,
    baselineTotal: current.toFixed(2),
    rebalanced: sameDay,
  }
}

/* ------------------------------------------------------------------ *
 * Caching and bounded-concurrency helpers
 * ------------------------------------------------------------------ */

/**
 * A tiny TTL cache with single-flight.
 *
 * Single-flight matters as much as the TTL: the view and the composer chip can
 * ask for the balance at the same moment, and without it both would open their
 * own upstream request. While one call is in flight every later caller awaits
 * that same promise.
 *
 * Failures are never cached — `discard()` lets a caller drop a bad result so a
 * transient error cannot stick for the whole TTL.
 */
function createCache(ttlMs) {
  let at = 0
  let value = null
  let inflight = null

  return {
    async read(fresh, produce) {
      if (fresh !== true && value !== null && Date.now() - at < ttlMs) return value
      if (inflight !== null) return inflight

      inflight = produce().then(
        (produced) => {
          inflight = null
          at = Date.now()
          value = produced
          return produced
        },
        (error) => {
          inflight = null
          at = 0
          value = null
          throw error
        },
      )
      return inflight
    },
    discard() {
      at = 0
      value = null
    },
  }
}

/**
 * Read several session logs with a fixed number of workers.
 *
 * Every id maps to a snapshot or to `null`; one unreadable log never voids the
 * whole report.
 */
async function readSessionsConcurrently(sessionQuery, ids, limit) {
  const snapshots = new Map()
  let cursor = 0

  const worker = async () => {
    while (cursor < ids.length) {
      const id = ids[cursor]
      cursor += 1
      try {
        snapshots.set(id, await sessionQuery.readSession(id))
      } catch {
        snapshots.set(id, null)
      }
    }
  }

  const workers = []
  const width = Math.max(1, Math.min(limit, ids.length))
  for (let index = 0; index < width; index += 1) workers.push(worker())
  await Promise.all(workers)

  return snapshots
}

/* ------------------------------------------------------------------ *
 * Token usage, grouped by model
 * ------------------------------------------------------------------ */

/** One local-day bucket per calendar day, oldest first, today last. */
function buildBuckets(now, count) {
  const base = new Date(now)
  const buckets = []
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    // Date-component arithmetic, so month/year rollover and DST stay correct.
    const start = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset).getTime()
    const end = new Date(base.getFullYear(), base.getMonth(), base.getDate() - offset + 1).getTime()
    const stamp = new Date(start)
    buckets.push({
      start,
      end,
      key: `${stamp.getFullYear()}-${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())}`,
      label: `${pad2(stamp.getMonth() + 1)}-${pad2(stamp.getDate())}`,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      requests: 0,
      models: new Map(),
      seen: new Set(),
    })
  }
  return buckets
}

function bucketAt(buckets, time) {
  for (const bucket of buckets) {
    if (time >= bucket.start && time < bucket.end) return bucket
  }
  return null
}

/** One model's running total inside one day bucket. */
function modelEntryFor(bucket, provider, model) {
  const key = `${provider}/${model}`
  let entry = bucket.models.get(key)
  if (entry === undefined) {
    entry = {
      provider,
      model,
      requests: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
      cost: 0,
      pricedRequests: 0,
      unpricedRequests: 0,
      peakRequests: 0,
    }
    bucket.models.set(key, entry)
  }
  return entry
}

function publicBucket(bucket) {
  const models = [...bucket.models.values()].map((entry) => ({
    provider: entry.provider,
    model: entry.model,
    requests: entry.requests,
    inputTokens: entry.inputTokens,
    outputTokens: entry.outputTokens,
    cacheReadTokens: entry.cacheReadTokens,
    cacheWriteTokens: entry.cacheWriteTokens,
    reasoningTokens: entry.reasoningTokens,
    totalTokens: entry.totalTokens,
    cost: round6(entry.cost),
    pricedRequests: entry.pricedRequests,
    unpricedRequests: entry.unpricedRequests,
    peakRequests: entry.peakRequests,
  }))
  // Most expensive first, then busiest — the order a reader wants.
  models.sort(
    (left, right) =>
      right.cost - left.cost ||
      right.totalTokens - left.totalTokens ||
      (left.model < right.model ? -1 : left.model > right.model ? 1 : 0),
  )

  let cost = 0
  let pricedRequests = 0
  let unpricedRequests = 0
  for (const entry of models) {
    cost += entry.cost
    pricedRequests += entry.pricedRequests
    unpricedRequests += entry.unpricedRequests
  }

  return {
    key: bucket.key,
    label: bucket.label,
    start: bucket.start,
    end: bucket.end,
    inputTokens: bucket.inputTokens,
    outputTokens: bucket.outputTokens,
    cacheReadTokens: bucket.cacheReadTokens,
    cacheWriteTokens: bucket.cacheWriteTokens,
    reasoningTokens: bucket.reasoningTokens,
    totalTokens: bucket.totalTokens,
    requests: bucket.requests,
    sessions: bucket.seen.size,
    models,
    cost: round6(cost),
    pricedRequests,
    unpricedRequests,
  }
}

/**
 * Fold one session's events into the day buckets.
 *
 * Only `assistant/message` events carry usage. Attribution comes from
 * `event.data.message.source` (`{ kind: 'model', provider, model }`) — the
 * record's own provenance, never inferred from settings.
 *
 * @returns whether any event was counted.
 */
function aggregateEvents(buckets, events, sessionKey) {
  let touched = false

  for (const event of events) {
    if (event === null || event === undefined || event.type !== 'assistant/message') continue
    const data = event.data
    const usage = data === null || data === undefined ? undefined : data.usage
    if (usage === null || usage === undefined || typeof usage !== 'object') continue
    const time = numberOrZero(event.time)
    const bucket = bucketAt(buckets, time)
    if (bucket === null) continue

    const source = data.message === null || data.message === undefined ? undefined : data.message.source
    const provider = source !== null && source !== undefined && typeof source.provider === 'string' ? source.provider : ''
    const model = source !== null && source !== undefined && typeof source.model === 'string' ? source.model : ''
    const entry = modelEntryFor(bucket, provider, model)

    const input = numberOrZero(usage.inputTokens)
    const output = numberOrZero(usage.outputTokens)
    const cacheRead = numberOrZero(usage.cacheReadTokens)
    const cacheWrite = numberOrZero(usage.cacheWriteTokens)
    const reasoning = numberOrZero(usage.reasoningTokens)
    // The harness counts are disjoint, so the total is miss + hit + output.
    const total = typeof usage.totalTokens === 'number' && Number.isFinite(usage.totalTokens)
      ? usage.totalTokens
      : input + cacheRead + output

    const peak = isPeak(time)
    const cost = priceRequest(model, usage, peak)
    if (cost === undefined) entry.unpricedRequests += 1
    else {
      entry.cost += cost
      entry.pricedRequests += 1
    }
    if (peak) entry.peakRequests += 1

    entry.requests += 1
    entry.inputTokens += input
    entry.outputTokens += output
    entry.cacheReadTokens += cacheRead
    entry.cacheWriteTokens += cacheWrite
    entry.reasoningTokens += reasoning
    entry.totalTokens += total

    bucket.requests += 1
    bucket.inputTokens += input
    bucket.outputTokens += output
    bucket.cacheReadTokens += cacheRead
    bucket.cacheWriteTokens += cacheWrite
    bucket.reasoningTokens += reasoning
    bucket.totalTokens += total
    bucket.seen.add(sessionKey)
    touched = true
  }

  return touched
}

/**
 * Sum provider-reported token usage for the last `USAGE_DAYS` local days, split
 * by the model that answered each request.
 *
 * Live sessions plus sessions created inside the window are scanned, up to
 * `USAGE_SESSION_CAP`; the response reports how many logs came from each source
 * and `truncated` reports when the cap bit.
 */
async function readUsage(ctx) {
  const sessionQuery = ctx.get('sessionQuery')
  if (sessionQuery === undefined) {
    return { ok: false, error: 'sessionQuery 服务不可用，无法统计用量' }
  }

  const now = Date.now()
  const buckets = buildBuckets(now, USAGE_DAYS)
  const windowStart = buckets[0].start

  let records
  try {
    records = await sessionQuery.listSessions()
  } catch (error) {
    return { ok: false, error: `读取会话列表失败：${messageOf(error)}` }
  }

  const live = []
  const recent = []
  for (const record of Array.isArray(records) ? records : []) {
    if (record === null || record === undefined || record.header === null || record.header === undefined) continue
    if (record.live === true) {
      live.push(record)
      continue
    }
    if (numberOrZero(record.header.createdAt) >= windowStart) recent.push(record)
  }

  const candidates = live.concat(recent)
  const queue = candidates.slice(0, USAGE_SESSION_CAP)

  /*
   * A live session's log is already in memory, so read it from there.
   *
   * Going through `sessionQuery.readSession` instead re-reads the log from
   * persistence and replay-validates every event before handing it back — work
   * that is repeated identically on every request. On a long session that one
   * read dominated the whole response: a 299k-event session measured 4.8s of a
   * 5.7s scan. `ownEvents()` returns the in-memory array, and because it
   * already excludes any inherited prefix, the fork double-count guard needs no
   * slicing here.
   */
  const sessions = ctx.get('sessions')
  const inMemory = []
  const fromDisk = []

  for (const record of queue) {
    const id = record.header.id
    const session = sessions === undefined ? undefined : sessions.get(id)
    if (session !== undefined && session !== null && typeof session.ownEvents === 'function') {
      inMemory.push({ key: String(id), events: session.ownEvents() })
      continue
    }
    fromDisk.push(String(id))
  }

  // Persisted logs are independent, so overlap their reads instead of awaiting
  // one after another.
  const snapshots = await readSessionsConcurrently(sessionQuery, fromDisk, USAGE_READ_CONCURRENCY)

  let counted = 0
  let scannedEvents = 0

  for (const item of inMemory) {
    scannedEvents += item.events.length
    if (aggregateEvents(buckets, item.events, item.key)) counted += 1
  }

  for (const id of fromDisk) {
    const snapshot = snapshots.get(id)
    if (snapshot === null || snapshot === undefined || !Array.isArray(snapshot.events)) continue
    const inherited = numberOrZero(snapshot.inheritedEventCount)
    const events = inherited > 0 ? snapshot.events.slice(inherited) : snapshot.events
    scannedEvents += events.length
    if (aggregateEvents(buckets, events, id)) counted += 1
  }

  const days = buckets.map(publicBucket)

  return {
    ok: true,
    days,
    today: days[days.length - 1],
    windowDays: USAGE_DAYS,
    scannedSessions: queue.length,
    countedSessions: counted,
    totalSessions: candidates.length,
    truncated: candidates.length > queue.length,
    readFromMemory: inMemory.length,
    readFromDisk: fromDisk.length,
    scannedEvents,
    generatedAt: now,
    pricing: {
      currency: PRICING.currency,
      unit: PRICING.unit,
      source: PRICING.source,
      updated: PRICING.updated,
      peakRule: PRICING.peakRule,
      tiers: PRICING.tiers.map((tier) => ({ id: tier.id, matches: tier.matches })),
    },
  }
}

/* ------------------------------------------------------------------ *
 * Route
 * ------------------------------------------------------------------ */

/** Build the route descriptor registered on the web server. */
export function makeRoute(ctx) {
  const balanceCache = createCache(BALANCE_TTL_MS)
  const usageCache = createCache(USAGE_TTL_MS)

  return {
    kind: 'exact',
    path: ROUTE,
    async handler(req, res) {
      if (!sameOrigin(req)) {
        json(res, 403, { ok: false, error: 'cross-site-request-rejected' })
        return
      }
      if (req.method !== 'GET') {
        json(res, 405, { ok: false, error: 'method-not-allowed' })
        return
      }

      let scope = 'all'
      let fresh = false
      try {
        const params = new URL(req.url ?? ROUTE, 'http://localhost').searchParams
        scope = params.get('scope') === 'balance' ? 'balance' : 'all'
        fresh = params.get('fresh') === '1'
      } catch {
        // an unparseable URL still serves the full report
      }

      // The account lookup and the log scan are independent, so overlap them:
      // the response then costs the slower of the two instead of their sum.
      const pendingUsage = scope === 'all'
        ? usageCache.read(fresh, () => readUsage(ctx)).then(
          (value) => value,
          (error) => ({ ok: false, error: messageOf(error) }),
        )
        : null

      const balance = await balanceCache.read(fresh, () => fetchBalance(ctx))
      if (balance.ok !== true) {
        // A transient upstream failure must not stick for the whole TTL.
        balanceCache.discard()
        json(res, 200, balance)
        return
      }

      const spend = await computeSpend(ctx, balance.balances)
      if (pendingUsage === null) {
        json(res, 200, { ok: true, balance, spend })
        return
      }

      const usage = await pendingUsage
      if (usage.ok !== true) usageCache.discard()

      json(res, 200, { ok: true, balance, spend, usage })
    },
  }
}

/** Register the route with lifecycle-owned cleanup. */
export function apply(ctx) {
  ctx.effect(() => ctx.webServer.register(makeRoute(ctx)), 'deepseek-quota: quota route')
}
