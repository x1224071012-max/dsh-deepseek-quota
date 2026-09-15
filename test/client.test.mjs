/**
 * Browser-bundle tests for dsh-deepseek-quota.
 *
 * Runs on plain Node with no dependencies:
 *
 *   node test/client.test.mjs
 *
 * The bundle is loaded through a fake `window.__ModuleLoader__`, its factory is
 * materialized with a stub `require`, and both components are server-rendered.
 * React is loaded from an installed DSH app so the render is real; point
 * `DSH_APP_DIR` at the app directory to override the default, or omit it and
 * the render checks skip while the structural checks still run.
 *
 * @module dsh-deepseek-quota/test/client
 */

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = process.env.DSH_APP_DIR ?? 'E:/dsh/DSH Desktop/resources/app'
const BUNDLE_PATH = fileURLToPath(new URL('../lib/client.js', import.meta.url))

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

/* --------------------------- fake browser shell --------------------------- */

const styleTags = []
globalThis.document = {
  querySelector: (selector) =>
    styleTags.find((tag) => `style[data-plugin-css="${tag.dataset.pluginCss}"]` === selector) ?? null,
  createElement: () => ({ dataset: {}, textContent: '' }),
  head: { appendChild: (tag) => styleTags.push(tag) },
}

let registered = null
globalThis.window = {
  __ModuleLoader__: {
    load(entry) {
      registered = entry
    },
  },
}

/* ------------------------------ load bundle ------------------------------- */

const code = await readFile(BUNDLE_PATH, 'utf8')
new Function(code)()

console.log('\n[1] bundle registration')
check('one module registered under the package id', () => {
  assert.equal(registered.id, '@dsh-external/dsh-deepseek-quota')
  assert.equal(typeof registered.factory, 'function')
})

let react
try {
  react = createRequire(join(APP_DIR, 'noop.js'))('react')
} catch (error) {
  console.log(`  note  react unavailable (${error.message}) — render checks will skip`)
}

const plugin = registered.factory((specifier) => {
  if (specifier === 'react') {
    if (react === undefined) throw new Error('react is not installed in this environment')
    return react
  }
  throw new Error(`unexpected require(${JSON.stringify(specifier)}) — the bundle must not depend on other modules`)
})

console.log('\n[2] plugin exports')
check('apply / inject / name', () => {
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['slots'])
  assert.equal(plugin.name, 'deepseek-quota')
})

/* ----------------------------- fake client ctx ---------------------------- */

const seats = []
const effects = []
const ctx = {
  effect(callback, label) {
    effects.push(label)
    return callback()
  },
  slots: {
    inject(key, callback) {
      seats.push({ key, register: callback() })
      return () => {}
    },
    register(options, component) {
      return { options, component }
    },
  },
}

console.log('\n[3] seat registration')
plugin.apply(ctx)
check('the stylesheet is inserted exactly once', () => {
  assert.equal(styleTags.length, 1)
  assert.equal(styleTags[0].dataset.plugin, '@dsh-external/dsh-deepseek-quota')
})
check('two seats registered with owned effects', () => {
  assert.deepEqual(seats.map((seat) => seat.key), ['conversation.view', 'conversation.composer.dock'])
  assert.deepEqual(effects, [
    'dsh-deepseek-quota: stylesheet',
    'dsh-deepseek-quota: quota view',
    'dsh-deepseek-quota: composer chip',
  ])
})
check('the view tab sorts LAST (priority 10 beats the shipped 0)', () => {
  const options = seats[0].register.options
  assert.equal(options.id, 'quota')
  assert.equal(options.priority, 10)
  assert.ok(options.priority > 0, 'shipped views leave priority unspecified (0), so a higher value renders after them')
  assert.equal(options.label(), '额度')
})
check('the chip claims its own dock id', () => {
  const options = seats[1].register.options
  assert.equal(options.id, 'dsh-deepseek-quota')
  assert.equal(options.order, 30)
})

/* ------------------------------ server render ----------------------------- */

if (react !== undefined) {
  console.log('\n[4] server render (loading state; effects do not run)')
  const { renderToString } = createRequire(join(APP_DIR, 'noop.js'))('react-dom/server')

  const quotaView = renderToString(react.createElement(seats[0].register.component))
  const chip = renderToString(react.createElement(seats[1].register.component))

  check('QuotaView renders its shell', () => {
    assert.match(quotaView, /额度/)
    assert.match(quotaView, /今日消费/)
    assert.match(quotaView, /dsq-view/)
  })
  check('Chip renders its label', () => {
    assert.match(chip, /剩余额度/)
    assert.match(chip, /dsq-chip/)
  })
  console.log(`       QuotaView: ${quotaView.replace(/\s+/g, ' ').slice(0, 120)}…`)
  console.log(`       Chip     : ${chip.replace(/\s+/g, ' ').slice(0, 120)}…`)
}

console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`)
process.exitCode = failures === 0 ? 0 : 1
