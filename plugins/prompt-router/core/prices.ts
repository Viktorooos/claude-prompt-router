// The only place with model prices. List prices in USD per 1M tokens from the Claude API docs
// (2026-10-06). The cache write is the 5-minute one (1.25 × input). Haiku has a second rate card for
// prompts over 100K tokens (HAIKU_LONG). Savings built on these are estimates.
import { knownModel } from './router.ts'
import type { Model } from './router.ts'
import type { CacheTtl } from './panel.ts'

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Usage = Price

export const PRICES: Record<Model, Price> = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  fable: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
}

// Haiku 5.5 above 100K prompt tokens (input + cache read + cache write), Claude API docs 2026-11-03:
// $0.50 / $2.50, cache read 0.1 × input, 5-minute cache write 1.25 ×.
export const LONG_PROMPT = 100_000
export const HAIKU_LONG: Price = { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }

// The price of a short name or a Claude model id the router knows; null for any other model.
export function priceOf(model: unknown): Price | null {
  const m = knownModel(model)
  return m ? PRICES[m] : null
}

// USD for the tokens on that model; null when its price is unknown. Missing counts are 0. `requests`:
// how many API requests the usage sums, so Haiku's rate card follows one request's prompt.
// shortcut: a turn that does not say its requests is priced as one, which overprices a Haiku main-chat
// turn of many short requests; upgrade by logging the largest request's prompt per turn.
export function cost(usage: Partial<Usage>, model: unknown, requests = 1): number | null {
  const n = (k: keyof Usage) => usage[k] ?? 0
  const m = knownModel(model)
  const long = m === 'haiku' && (n('input') + n('cacheRead') + n('cacheWrite')) / Math.max(1, requests) > LONG_PROMPT
  const p = long ? HAIKU_LONG : priceOf(model)
  if (!p) return null
  return (n('input') * p.input + n('output') * p.output + n('cacheRead') * p.cacheRead + n('cacheWrite') * p.cacheWrite) / 1_000_000
}

// What the next message pays for the chat's context: read from the cache while it is warm, or
// written to it again once it lapsed (a 1-hour entry costs 2 × input, a 5-minute one 1.25 ×).
// null when the model's price or the context is unknown.
export function cacheCosts(tokens: number | null, model: unknown, ttl: CacheTtl): { warm: number; cold: number } | null {
  if (!tokens || !(tokens > 0)) return null
  const warm = cost({ cacheRead: tokens }, model)
  const cold = cost(ttl === '1h' ? { input: 2 * tokens } : { cacheWrite: tokens }, model)
  return warm === null || cold === null ? null : { warm, cold }
}

type TurnUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

// Claude Code's `turn.complete` usage as Usage; null when the turn has none (interrupted).
export function usageOf(u: TurnUsage | undefined | null): Usage | null {
  if (!u) return null
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }
}
