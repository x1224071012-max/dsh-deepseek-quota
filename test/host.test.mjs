/**
 * Host-half tests for dsh-deepseek-quota.
 *
 * Runs on plain Node with no dependencies:
 *
 *   node test/host.test.mjs
 *
 * Every check drives the plugin's real HTTP route handler with a fake Cordis
 * context, a fake `fetch`, and synthetic session logs. The optional live pass
 * only runs when a key is supplied:
 *
 *   DSH_QUOTA_TEST_KEY=sk-... node test/host.test.mjs
 *
 * @module dsh-deepseek-quota/test/host
 */

import assert from 'node:assert/strict'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const mod = await import(new URL('../lib/index.js', import.meta.url).href)

/** Captured before any stub replaces it, so the live pass uses the real network. */
const REAL_FETCH = globalThis.fetch.bind(globalThis)

let failures = 0
function check(label, fn) {
  try {
    fn()
    console.log(`  ok   ${label}`)
  } catch (error) {
    failures += 1
    console.log(`  FAIL ${label}\n       ${error.message}`)
  }
}

/** A minimal Cordis context exposing only what the host half reads. */
function makeCtx({ sessions = [], logs = {}, credentials = {} }) {
  const routes = []
  const effects = []
  return {
    routes,
    effects,
    get(serviceName) {
      if (serviceName === 'credentials') {
        return {
          async resolve(ref) {
            const found = credentials[ref]
            return found === undefined ? undefined : { value: found, source: 'test' }
          },
        }
      }
      if (serviceName === 'sessionQuery') {
        return {
          async listSessions() {
            return sessions
          },
          async readSession(id) {
            if (logs[id] === undefined) throw new Error('no such session')
            return logs[id]
          },
        }
      }
      return undefined
    },
    effect(callback, label) {
      effects.push(label)
      const disposer = callback()
      return typeof disposer === 'function' ? disposer : () => {}
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const at = routes.indexOf(route)
          if (at >= 0) routes.splice(at, 1)
        }
      },
    },
  }
}

/** Drive one route handler and resolve its buffered response. */
function invoke(route, { url = mod.ROUTE, method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = { url, method, headers }
    const res = {
      statusCode: 0,
      writeHead(status, extra) {
        this.statusCode = status
        this.headers = extra
      },
      end(chunk) {
        try {
          resolve({ status: this.statusCode, json: chunk ? JSON.parse(chunk) : null })
        } catch (error) {
          reject(error)
        }
      },
    }
    Promise.resolve(route.handler(req, res)).catch(reject)
  })
}

/** Replace global fetch with a canned balance response. */
function stubFetch(total, { available = true, status = 200 } = {}) {
  globalThis.fetch = async () => ({
    ok: status >= 200 && status < 300,
    status,
    async text() {
      return JSON.stringify({
        is_available: available,
        balance_infos: [{ currency: 'CNY', total_balance: total, granted_balance: '0.00', topped_up_balance: total }],
      })
    },
  })
}

function localDayKey(ms) {
  const d = new Date(ms)
  const p = (n) => (n < 10 ? `0${n}` : String(n))
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/* =========================== deterministic pass =========================== */

const home = await mkdtemp(join(tmpdir(), 'dsq-'))
process.env.DSH_HOME = home

console.log('\n[1] plugin shape')
check('exports name / inject / apply / ROUTE', () => {
  assert.equal(mod.name, 'deepseek-quota')
  assert.deepEqual(mod.inject, ['webServer'])
  assert.equal(typeof mod.apply, 'function')
  assert.equal(mod.ROUTE, '/api/dsh/deepseek-quota')
})
check('state file resolves under DSH_HOME', () => {
  assert.equal(mod.statePath({ DSH_HOME: home }), join(home, 'dsh-deepseek-quota.json'))
})

const now = Date.now()
const FLASH = { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-flash' }
const PRO = { kind: 'model', provider: 'deepseek-official', model: 'deepseek-v4-pro' }

// Realistic usage objects: the harness counts are DISJOINT, so
// totalTokens = inputTokens (cache miss) + cacheReadTokens (cache hit) + outputTokens.
const usageFlashA = { inputTokens: 1000, outputTokens: 200, cacheReadTokens: 800, reasoningTokens: 30, totalTokens: 2000 }
const usageFlashB = { inputTokens: 500, outputTokens: 100, totalTokens: 600 }
const usageFlashInherited = { inputTokens: 99_999, outputTokens: 99_999, totalTokens: 199_998 }
const usageFlashOwn = { inputTokens: 10, outputTokens: 5, totalTokens: 15 }
const usagePro = { inputTokens: 2000, outputTokens: 400, cacheReadTokens: 1000, totalTokens: 3400 }

const times = {
  flashA: now - 1000,
  flashB: now - 2000,
  flashOwn: now - 6000,
  flashInherited: now - 5000,
  pro: now - 7000,
}

const sessions = [
  { live: true, header: { id: 's-live', createdAt: now - 3_600_000 } },
  { live: false, header: { id: 's-fork', createdAt: now - 7_200_000 } },
  { live: false, header: { id: 's-pro', createdAt: now - 8_000_000 } },
  { live: false, header: { id: 's-old', createdAt: now - 90 * 86_400_000 } },
]
const logs = {
  's-live': {
    inheritedEventCount: 0,
    events: [
      { type: 'assistant/message', time: times.flashA, data: { message: { source: FLASH }, usage: usageFlashA } },
      { type: 'assistant/message', time: times.flashB, data: { message: { source: FLASH }, usage: usageFlashB } },
      { type: 'user/message', time: now - 3000, data: {} },
      { type: 'assistant/message', time: now - 4000, data: { message: { source: FLASH }, interrupted: true } },
    ],
  },
  's-fork': {
    // The inherited prefix must NOT be counted: a fork shares its parent's history.
    inheritedEventCount: 1,
    events: [
      { type: 'assistant/message', time: times.flashInherited, data: { message: { source: FLASH }, usage: usageFlashInherited } },
      { type: 'assistant/message', time: times.flashOwn, data: { message: { source: FLASH }, usage: usageFlashOwn } },
    ],
  },
  's-pro': {
    inheritedEventCount: 0,
    events: [
      { type: 'assistant/message', time: times.pro, data: { message: { source: PRO }, usage: usagePro } },
    ],
  },
}

const ctx = makeCtx({ sessions, logs, credentials: { DEEPSEEK_API_KEY: 'sk-test-key' } })
mod.apply(ctx)

console.log('\n[2] route registration')
check('one exact route at the documented path', () => {
  assert.equal(ctx.routes.length, 1)
  assert.equal(ctx.routes[0].kind, 'exact')
  assert.equal(ctx.routes[0].path, mod.ROUTE)
})
check('effect label recorded', () => {
  assert.deepEqual(ctx.effects, ['deepseek-quota: quota route'])
})

console.log('\n[3] guards')
check('a cross-site Origin is rejected', async () => {
  const result = await invoke(ctx.routes[0], { headers: { origin: 'https://evil.test', host: '127.0.0.1:7340' } })
  assert.equal(result.status, 403)
  assert.equal(result.json.ok, false)
})
check('a same-origin Origin is accepted', async () => {
  stubFetch('9.26')
  const result = await invoke(ctx.routes[0], { headers: { origin: 'http://127.0.0.1:7340', host: '127.0.0.1:7340' } })
  assert.equal(result.status, 200)
})
check('a declared cross-site fetch is rejected', async () => {
  const result = await invoke(ctx.routes[0], { headers: { 'sec-fetch-site': 'cross-site' } })
  assert.equal(result.status, 403)
})
check('a non-GET method is rejected', async () => {
  const result = await invoke(ctx.routes[0], { method: 'POST' })
  assert.equal(result.status, 405)
})

console.log('\n[4] balance + first-run spend baseline')
stubFetch('9.26')
const first = await invoke(ctx.routes[0])
check('http 200 with ok:true', () => {
  assert.equal(first.status, 200)
  assert.equal(first.json.ok, true)
})
check('balance normalized to scalars', () => {
  assert.equal(first.json.balance.isAvailable, true)
  assert.deepEqual(first.json.balance.balances[0], { currency: 'CNY', total: '9.26', granted: '0.00', toppedUp: '9.26' })
})
check('the first read anchors the baseline at 0.00', () => {
  assert.equal(first.json.spend.available, true)
  assert.equal(first.json.spend.amount, '0.00')
  assert.equal(first.json.spend.baselineTotal, '9.26')
  assert.equal(first.json.spend.rebalanced, false)
})
check('the baseline is persisted under the local day key', async () => {
  const raw = JSON.parse(await readFile(join(home, 'dsh-deepseek-quota.json'), 'utf8'))
  assert.equal(raw.day, localDayKey(now))
  assert.equal(raw.baselineTotal, '9.26')
  assert.equal(raw.version, 1)
})

console.log('\n[5] today usage aggregation')
const today = first.json.usage.today
check('usage ok with 7 day buckets, today last', () => {
  assert.equal(first.json.usage.ok, true)
  assert.equal(first.json.usage.days.length, 7)
  assert.equal(today.key, localDayKey(now))
})
check('requests and distinct sessions counted', () => {
  assert.equal(today.requests, 4)
  assert.equal(today.sessions, 3)
})
check('token sums exact, inherited prefix skipped', () => {
  assert.equal(today.inputTokens, 1000 + 500 + 10 + 2000)
  assert.equal(today.outputTokens, 200 + 100 + 5 + 400)
  assert.equal(today.cacheReadTokens, 800 + 1000)
  assert.equal(today.cacheWriteTokens, 0)
  assert.equal(today.reasoningTokens, 30)
  assert.equal(today.totalTokens, 2000 + 600 + 15 + 3400)
})
check('a session older than the window is not scanned', () => {
  assert.equal(first.json.usage.totalSessions, 3)
  assert.equal(first.json.usage.truncated, false)
})

console.log('\n[6] spend delta')
stubFetch('9.01')
const second = await invoke(ctx.routes[0])
check('spend is baseline minus current', () => {
  assert.equal(second.json.spend.amount, '0.25')
  assert.equal(second.json.spend.baselineTotal, '9.26')
})
stubFetch('10.00')
const toppedUp = await invoke(ctx.routes[0])
check('a top-up re-anchors instead of going negative', () => {
  assert.equal(toppedUp.json.spend.amount, '0.00')
  assert.equal(toppedUp.json.spend.rebalanced, true)
  assert.equal(toppedUp.json.spend.baselineTotal, '10.00')
})

console.log('\n[7] scope=balance skips the log scan')
const balanceOnly = await invoke(ctx.routes[0], { url: `${mod.ROUTE}?scope=balance` })
check('usage omitted, balance and spend present', () => {
  assert.equal(balanceOnly.json.ok, true)
  assert.equal(balanceOnly.json.usage, undefined)
  assert.equal(balanceOnly.json.balance.balances[0].currency, 'CNY')
  assert.equal(balanceOnly.json.spend.available, true)
})

console.log('\n[8] domain failures stay descriptive')
const noKey = makeCtx({ credentials: {} })
mod.apply(noKey)
const missing = await invoke(noKey.routes[0])
check('a missing credential is a 200 with ok:false', () => {
  assert.equal(missing.status, 200)
  assert.equal(missing.json.ok, false)
  assert.match(missing.json.error, /DEEPSEEK_API_KEY/)
})
const unhealthy = makeCtx({ credentials: { DEEPSEEK_API_KEY: 'sk-test-key' } })
mod.apply(unhealthy)
globalThis.fetch = async () => ({ ok: false, status: 500, async text() { return 'boom' } })
const upstream = await invoke(unhealthy.routes[0])
check('an upstream error surfaces the HTTP status', () => {
  assert.equal(upstream.status, 200)
  assert.equal(upstream.json.ok, false)
  assert.match(upstream.json.error, /HTTP 500/)
})

/* ==================== model classification + pricing ==================== */

console.log('\n[10] peak-window classification (read in Beijing time)')
/** Build the instant for one Beijing wall-clock time, whatever the host timezone is. */
const beijing = (y, m, d, h, min = 0) => Date.UTC(y, m - 1, d, h - 8, min)
check('Monday 09:00 Beijing is peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 9)), true))
check('Monday 11:59 Beijing is peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 11, 59)), true))
check('Monday 12:00 Beijing is off-peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 12)), false))
check('Monday 13:59 Beijing is off-peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 13, 59)), false))
check('Monday 14:00 Beijing is peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 14)), true))
check('Monday 17:59 Beijing is peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 17, 59)), true))
check('Monday 18:00 Beijing is off-peak', () => assert.equal(mod.isPeak(beijing(2026, 9, 14, 18)), false))
check('Saturday 10:00 Beijing is off-peak (weekend)', () => assert.equal(mod.isPeak(beijing(2026, 9, 12, 10)), false))
check('Sunday 10:00 Beijing is off-peak (weekend)', () => assert.equal(mod.isPeak(beijing(2026, 9, 13, 10)), false))
check('the weekday is read in Beijing, not in the host timezone', () => {
  // Sunday 23:00 UTC is Monday 07:00 in Beijing: a weekday, but outside both windows.
  assert.equal(mod.isPeak(Date.UTC(2026, 8, 13, 23)), false)
  // Friday 22:00 UTC is Saturday 06:00 Beijing: a weekend, so off-peak despite the UTC weekday.
  assert.equal(mod.isPeak(Date.UTC(2026, 8, 11, 22)), false)
  // Sanity anchor: Monday 01:00 UTC is Monday 09:00 Beijing.
  assert.equal(mod.isPeak(Date.UTC(2026, 8, 14, 1)), true)
})

console.log('\n[11] per-request pricing (CNY per 1M tokens)')
const millionMiss = { inputTokens: 1_000_000, outputTokens: 0, cacheReadTokens: 0 }
const millionHit = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 1_000_000 }
const millionOut = { inputTokens: 0, outputTokens: 1_000_000, cacheReadTokens: 0 }
check('flash cache-miss input: ¥1 off-peak, ¥2 peak', () => {
  assert.equal(mod.priceRequest('deepseek-v4-flash', millionMiss, false), 1)
  assert.equal(mod.priceRequest('deepseek-v4-flash', millionMiss, true), 2)
})
check('flash cache-hit input: ¥0.02 off-peak, ¥0.04 peak', () => {
  assert.equal(mod.priceRequest('deepseek-v4-flash', millionHit, false), 0.02)
  assert.equal(mod.priceRequest('deepseek-v4-flash', millionHit, true), 0.04)
})
check('flash output: ¥4 off-peak, ¥8 peak', () => {
  assert.equal(mod.priceRequest('deepseek-v4-flash', millionOut, false), 4)
  assert.equal(mod.priceRequest('deepseek-v4-flash', millionOut, true), 8)
})
check('pro cache-miss input: ¥4.5 off-peak, ¥9 peak', () => {
  assert.equal(mod.priceRequest('deepseek-v4-pro', millionMiss, false), 4.5)
  assert.equal(mod.priceRequest('deepseek-v4-pro', millionMiss, true), 9)
})
check('pro output: ¥13.5 off-peak, ¥27 peak', () => {
  assert.equal(mod.priceRequest('deepseek-v4-pro', millionOut, false), 13.5)
  assert.equal(mod.priceRequest('deepseek-v4-pro', millionOut, true), 27)
})
check('the legacy model name deepseek-v4-flash bills at the flash tier', () => {
  assert.equal(
    mod.priceRequest('deepseek-v4-flash', millionMiss, false),
    mod.priceRequest('deepseek-flash', millionMiss, false),
  )
})
check('an unknown model has no price', () => {
  assert.equal(mod.priceRequest('mystery-1', millionMiss, false), undefined)
  assert.equal(mod.priceRequest('', millionMiss, false), undefined)
})
check('reasoning tokens are never billed twice (they are part of output)', () => {
  const base = { inputTokens: 0, outputTokens: 1000, cacheReadTokens: 0 }
  assert.equal(
    mod.priceRequest('deepseek-v4-flash', { ...base, reasoningTokens: 900 }, false),
    mod.priceRequest('deepseek-v4-flash', base, false),
  )
})

console.log('\n[12] usage is classified by model through the route')
check('two models reported, each with its own totals', () => {
  assert.equal(today.models.length, 2)
  const flash = today.models.find((entry) => entry.model === 'deepseek-v4-flash')
  const pro = today.models.find((entry) => entry.model === 'deepseek-v4-pro')
  assert.ok(flash !== undefined && pro !== undefined)
  assert.equal(flash.provider, 'deepseek-official')
  assert.equal(flash.requests, 3)
  assert.equal(flash.inputTokens, 1000 + 500 + 10)
  assert.equal(flash.outputTokens, 200 + 100 + 5)
  assert.equal(flash.cacheReadTokens, 800)
  assert.equal(flash.totalTokens, 2000 + 600 + 15)
  assert.equal(pro.requests, 1)
  assert.equal(pro.inputTokens, 2000)
  assert.equal(pro.outputTokens, 400)
  assert.equal(pro.cacheReadTokens, 1000)
  assert.equal(pro.totalTokens, 3400)
})
check('each model cost equals the documented per-request formula', () => {
  const expectFlash =
    mod.priceRequest('deepseek-v4-flash', usageFlashA, mod.isPeak(times.flashA)) +
    mod.priceRequest('deepseek-v4-flash', usageFlashB, mod.isPeak(times.flashB)) +
    mod.priceRequest('deepseek-v4-flash', usageFlashOwn, mod.isPeak(times.flashOwn))
  const expectPro = mod.priceRequest('deepseek-v4-pro', usagePro, mod.isPeak(times.pro))
  const flash = today.models.find((entry) => entry.model === 'deepseek-v4-flash')
  const pro = today.models.find((entry) => entry.model === 'deepseek-v4-pro')
  assert.ok(Math.abs(flash.cost - expectFlash) < 1e-6, `${flash.cost} vs ${expectFlash}`)
  assert.ok(Math.abs(pro.cost - expectPro) < 1e-6, `${pro.cost} vs ${expectPro}`)
})
check('the calendar-day total is the sum of its models', () => {
  const sum = today.models.reduce((acc, entry) => acc + entry.cost, 0)
  assert.ok(Math.abs(today.cost - sum) < 1e-5, `${today.cost} vs ${sum}`)
  assert.equal(today.pricedRequests, 4)
  assert.equal(today.unpricedRequests, 0)
})
check('models are ordered most expensive first', () => {
  assert.equal(today.models[0].cost >= today.models[1].cost, true)
})
check('pricing metadata is published for the UI', () => {
  const pricing = first.json.usage.pricing
  assert.equal(pricing.currency, 'CNY')
  assert.equal(pricing.updated, '2026-09-15')
  assert.match(pricing.source, /api-docs\.deepseek\.com/)
})

console.log('\n[13] an unknown model still reports tokens, but no cost')
const unknownCtx = makeCtx({
  sessions: [{ live: true, header: { id: 's-u', createdAt: now - 1000 } }],
  logs: {
    's-u': {
      inheritedEventCount: 0,
      events: [
        {
          type: 'assistant/message',
          time: now - 500,
          data: {
            message: { source: { kind: 'model', provider: 'other', model: 'mystery-1' } },
            usage: { inputTokens: 1_000_000, outputTokens: 0, totalTokens: 1_000_000 },
          },
        },
      ],
    },
  },
  credentials: { DEEPSEEK_API_KEY: 'sk-test-key' },
})
mod.apply(unknownCtx)
stubFetch('9.26') // section [8] deliberately left a failing stub installed
const unknown = await invoke(unknownCtx.routes[0])
check('tokens counted, cost zero, unpriced flagged, model still named', () => {
  const day = unknown.json.usage.today
  assert.equal(day.requests, 1)
  assert.equal(day.totalTokens, 1_000_000)
  assert.equal(day.cost, 0)
  assert.equal(day.unpricedRequests, 1)
  assert.equal(day.models[0].model, 'mystery-1')
  assert.equal(day.models[0].provider, 'other')
  assert.equal(day.models[0].pricedRequests, 0)
})

/* ============================== live pass ============================== */

const liveKey = process.env.DSH_QUOTA_TEST_KEY
console.log('\n[9] live balance call')
if (liveKey === undefined || liveKey === '') {
  console.log('  skip  (set DSH_QUOTA_TEST_KEY to run against api.deepseek.com)')
} else {
  const liveHome = await mkdtemp(join(tmpdir(), 'dsq-live-'))
  process.env.DSH_HOME = liveHome
  globalThis.fetch = REAL_FETCH
  const live = makeCtx({ credentials: { DEEPSEEK_API_KEY: liveKey } })
  mod.apply(live)
  const result = await invoke(live.routes[0], { url: `${mod.ROUTE}?scope=balance` })
  check('live balance ok', () => {
    assert.equal(result.json.ok, true, JSON.stringify(result.json).slice(0, 400))
    assert.equal(result.json.balance.balances.length > 0, true)
  })
  if (result.json.ok === true) {
    console.log('       balance:', JSON.stringify(result.json.balance.balances))
    console.log('       spend  :', JSON.stringify(result.json.spend))
  }
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
