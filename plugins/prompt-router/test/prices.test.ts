import { expect, test } from 'claude-code/testing'
import { MODELS } from '../core/router.ts'
import { HAIKU_LONG, PRICES, cacheCosts, cost, priceOf, usageOf } from '../core/prices.ts'

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

test('cacheCosts: the context read from a warm cache, or written again (1-hour entries at 2 × input, 5-minute at 1.25 ×)', () => {
  const five = cacheCosts(100_000, 'claude-opus-5-5', '5m')
  close(five?.warm ?? null, 0.02)
  close(five?.cold ?? null, 0.5)
  close(cacheCosts(100_000, 'opus', '1h')?.cold ?? null, 0.8)
  expect(cacheCosts(null, 'opus', '5m')).toBe(null)
  expect(cacheCosts(0, 'opus', '5m')).toBe(null)
  expect(cacheCosts(100_000, 'gpt-5', '5m')).toBe(null)
})

test('Haiku prompts over 100K tokens use the long rate card, per request', () => {
  const short = { input: 10_000, output: 0, cacheRead: 90_000, cacheWrite: 0 }
  close(cost(short, 'haiku'), (10_000 * PRICES.haiku.input + 90_000 * PRICES.haiku.cacheRead) / 1e6)
  const long = { ...short, cacheRead: 90_001 }
  close(cost(long, 'haiku'), (10_000 * HAIKU_LONG.input + 90_001 * HAIKU_LONG.cacheRead) / 1e6)
  // Two requests of half the prompt each stay on the short card; other models have one card.
  close(cost(long, 'haiku', 2), (10_000 * PRICES.haiku.input + 90_001 * PRICES.haiku.cacheRead) / 1e6)
  close(cost({ input: 1_000_000 }, 'sonnet'), PRICES.sonnet.input)
})
