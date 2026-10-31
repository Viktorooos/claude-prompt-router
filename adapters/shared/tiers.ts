// Tier names the Codex and OpenCode options use: those agents run any provider's models, so the
// options name a tier, not a Claude model. The router core keeps its own names (haiku…fable);
// the old names still work in the options as aliases.
import { knownModel } from '../../plugins/prompt-router/core/router.ts'
import type { Model } from '../../plugins/prompt-router/core/router.ts'

export const TIERS = { light: 'haiku', standard: 'sonnet', strong: 'opus', top: 'fable' } as const satisfies Record<string, Model>

export type Tier = keyof typeof TIERS

export const TIER_KEY = '(Tiers: light = haiku, standard = sonnet, strong = opus, top = fable.)'

export const TIER_NAMES = Object.keys(TIERS) as Tier[]

export const TIER_OF = Object.fromEntries(Object.entries(TIERS).map(([t, m]) => [m, t])) as Record<Model, Tier>

// A tier name, an old name or a model id the router knows, as the core's model; else ''.
export function tierModel(v: unknown): Model | '' {
  const t = typeof v === 'string' ? v.trim().toLowerCase() : ''
  return (TIERS as Record<string, Model>)[t] ?? knownModel(t)
}

// Options with tier keys turned into the core's names: `models` keys and `classifier`.
// A tier key wins over its old alias when both are set.
export function fromTiers(raw: Record<string, unknown>): Record<string, unknown> {
  const out = { ...raw }
  const m = raw.models
  if (m && typeof m === 'object' && !Array.isArray(m)) {
    const models: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(m)) if (!(k in TIERS)) models[k] = v
    for (const [k, v] of Object.entries(m)) if (k in TIERS) models[TIERS[k as Tier]] = v
    out.models = models
  }
  if (typeof raw.classifier === 'string' && raw.classifier in TIERS) out.classifier = TIERS[raw.classifier as Tier]
  // Rules are free text for the classifier, which knows the core's names: it gets the key too.
  if (typeof raw.rules === 'string' && raw.rules.trim()) out.rules = `${raw.rules.trim()} ${TIER_KEY}`
  return out
}

// Options for writing back: the core's names as tier keys.
export function toTiers(models: Record<Model, string>): Record<Tier, string> {
  return Object.fromEntries(Object.entries(models).map(([m, v]) => [TIER_OF[m as Model], v])) as Record<Tier, string>
}
