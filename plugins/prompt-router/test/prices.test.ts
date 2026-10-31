import { expect, test } from 'claude-code/testing'
import { MODELS } from '../core/router.ts'
import { PRICES, cost, priceOf, usageOf } from '../core/prices.ts'

// Dollars as floats: equal to 9 decimal places (the runner has no toBeCloseTo).
function close(a: number | null, b: number) {
  expect(Math.round((a ?? NaN) * 1e9)).toBe(Math.round(b * 1e9))
}

test('every router model has a full price', () => {
  for (const m of Object.keys(MODELS) as (keyof typeof MODELS)[]) {
    const p = PRICES[m]
    for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) expect(p[k] > 0).toBe(true)
    expect(p.output > p.input).toBe(true)
    expect(p.cacheRead < p.input).toBe(true)
  }
})

test('priceOf knows short names and model ids, not other providers', () => {
  expect(priceOf('opus')).toEqual(PRICES.opus)
  expect(priceOf('claude-haiku-5-5')).toEqual(PRICES.haiku)
  expect(priceOf('gpt-5')).toBe(null)
  expect(priceOf(undefined)).toBe(null)
})

test('cost adds the four kinds of tokens, each at its own price per 1M', () => {
  const p = PRICES.sonnet
  const usd = cost({ input: 2_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 1_000_000 }, 'sonnet')
  close(usd, 2 * p.input + p.output + p.cacheRead + p.cacheWrite)
  close(cost({ input: 1_000_000 }, 'opus'), PRICES.opus.input)
  expect(cost({ input: 10 }, 'gpt-5')).toBe(null)
})

test('usageOf reads the Claude Code turn usage', () => {
  expect(usageOf({ input_tokens: 5, output_tokens: 6, cache_read_input_tokens: 7, cache_creation_input_tokens: 8, model: 'x' }))
    .toEqual({ input: 5, output: 6, cacheRead: 7, cacheWrite: 8 })
  expect(usageOf(undefined)).toBe(null)
  expect(usageOf({ input_tokens: 1 })).toEqual({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0 })
})
