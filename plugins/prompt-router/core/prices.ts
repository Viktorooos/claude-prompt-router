// The only place with model prices. List prices in USD per 1M tokens, from the Claude API docs
// (2026-10-06). Cache write is the 5-minute one (1.25 × input). Haiku's higher price above 100K
// prompt tokens is left out: the router uses Haiku for short work. Savings built on these are estimates.
import { knownModel } from './router.ts'
import type { Model } from './router.ts'

export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number }

export type Usage = Price

export const PRICES: Record<Model, Price> = {
  haiku: { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  sonnet: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  opus: { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  fable: { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
}

// The price of a short name or a model id the router knows; null for any other model.
export function priceOf(model: unknown): Price | null {
  const m = knownModel(model)
  return m ? PRICES[m] : null
}

// USD for the tokens on that model; null when its price is unknown. Missing counts are 0.
export function cost(usage: Partial<Usage>, model: unknown): number | null {
  const p = priceOf(model)
  if (!p) return null
  const n = (k: keyof Usage) => usage[k] ?? 0
  return (n('input') * p.input + n('output') * p.output + n('cacheRead') * p.cacheRead + n('cacheWrite') * p.cacheWrite) / 1_000_000
}

type TurnUsage = { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

// Claude Code's `turn.complete` usage as Usage; null when the turn has none (interrupted).
export function usageOf(u: TurnUsage | undefined | null): Usage | null {
  if (!u) return null
  return { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }
}
