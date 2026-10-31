import type { Level } from '../types'

// The router logic every platform shares: the classifier prompt, reading its answer, the options.
// Platform code (Claude Code mod, Codex hook, OpenCode plugin) imports it and adds only its own I/O.

export const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']

export const NAMES: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }

export const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' } as const

export const MODEL_NAMES = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' } as const

// Always offered; Fable only when the model setting lists it (or the chat runs on it).
export const BASE_MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']

export const ALL_MODELS = Object.keys(MODELS) as Model[]

export type Where = 'here' | 'subagent' | 'session'

export type Config = { project: string; rules: string; language: string; classifier: 'sonnet' | 'haiku' | 'opus'; effortMode: 'auto' | 'ask'; modelMode: 'auto' | 'ask' | 'off' }

export type Model = keyof typeof MODELS

export type Pick = { where: Where; model: Model; effort: Level; why: string; first?: { now: Model | '' } }

export function norm(s: string) {
  const t = s.toLowerCase().replace(/[^a-z]/g, '')
  return t === 'extrahigh' ? 'xhigh' : t
}

export function asLevel(v: unknown): Level | '' {
  if (typeof v !== 'string') return ''
  const t = norm(v)
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : ''
}

// A model id or alias the router knows, or '' (e.g. a custom or non-Claude model).
export function knownModel(v: unknown): Model | '' {
  const t = typeof v === 'string' ? v.toLowerCase() : ''
  return ALL_MODELS.find(m => t.includes(m)) ?? ''
}

// A model the router may offer: an unknown or unavailable one falls back to Opus.
export function asModel(v: unknown, models: readonly Model[] = ALL_MODELS): Model {
  const m = knownModel(v)
  return m && models.includes(m) ? m : 'opus'
}

// What the person typed: the app puts its own blocks (<system-reminder>…) before it, at times
// tens of thousands of characters, which would push the prompt out of what the classifier reads.
export function typed(text: string) {
  return text.replace(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g, '').trim()
}

export function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// What the classifier sees of the chat. The test tool fills it by hand.
export type Chat = { first: string; recent: string[]; reply: string; model: string; now: Level | ''; tokens: number | undefined; conf: Config; isFirst?: boolean; models: readonly Model[] }

// The classifier prompt. {{name}} slots are filled per prompt; the test tool can swap the whole
// template for a file, so the rules can be tuned without reloading the mod.
export const TEMPLATE = `You route one prompt in a Claude Code chat about {{project}}. Decide where it should run, on which model and at which effort. Prompts can be in any language.

WHERE
- keep: the prompt only approves, answers a question or says to go on (yes, ok, go on, do it, option 2, or the same in another language). Answer keep for all three fields.
- here: it builds on what this chat already read, found, decided or changed (a follow-up, a fix of what was just found, the next iteration, a question about it). Also here when the chat is still small (under 30k tokens) and the right model is the current one.
- Also here for anything trivial that takes one short answer (a greeting, a quick fact, a one-line question) when it relates to this chat or the chat is under 60k tokens: starting a subagent or a session costs more than answering it. In a bigger chat every reply re-reads the whole context, so an unrelated task, even a trivial one, goes to session. A greeting or small talk is not a task and stays here.
- subagent: a self-contained lookup, search, read of something big, build or run whose short answer is needed here, and that needs none of this chat's context.
- session: unrelated to this chat (a new topic, another feature, a task that ends in its own branch or PR, or anything unrelated at all once the chat is over 60k tokens), or long mechanical work better done with a fresh context on a cheaper model. Pick session only when you are fairly sure; if unsure, here.

{{model_head}}
- haiku: anything that takes one short answer and no code changes, except a greeting or opener with no task yet, which keeps the current model (a short message or email, a translation, a quick fact, a regex or one command); running builds, lint or tests; reading and summarizing; searching the codebase.
- sonnet: mechanical edits by an existing pattern (strings, renames, porting finished code to another platform), clicking through an app, writing summaries.
- opus: new logic, architecture, debugging, code review, anything risky (money, user data, security, auth, rewriting git history, force pushes, deleting data or anything else hard to undo). Also opus when the work is open-ended or its size is unclear.{{fable}}

EFFORT
- low: simple, mechanical or rule-following work, a greeting, a short message or a quick answer, or work the person will iterate on with Claude.
- medium: everyday work with a clear definition of done, including writing tests. The default. If unsure, medium.
- high: a hidden mistake would cost money, data or trust: hunting bugs, reviewing, checking work, payment, data or security logic, architecture decisions.
- xhigh: only a long, hard, critical job the person hands off and walks away from.
- max: only when the person explicitly asks for the maximum effort or thinking, or for a one-off irreversible step with a very high cost of a mistake (production data, a live security incident) where time does not matter. Never for everyday work, a feature or a review, however important. "Do it properly" or "be careful" is not max.
A task being long does not make it high. Words like important, critical, carefully, properly or take your time do not raise the effort beyond high on their own; only handing off a long job (xhigh) or the max cases above do.
Examples: reviewing payment code = opus, high (not xhigh, not max). A big feature on iOS and Android with a known design = opus, medium or high. A database migration done the usual way = medium or high. A one-off script that rewrites production data and cannot be undone, checked with all the care possible = max.{{rules}}

The chat now: model {{model}}, effort {{effort}}, context {{tokens}}.

First prompt of this chat (its topic):
<first>{{first}}</first>

Recent prompts:
<recent>
{{recent}}
</recent>

Claude's last reply (start):
<reply>{{reply}}</reply>

The new prompt:
<prompt>
{{prompt}}
</prompt>

Reply with JSON only: {"where": "keep|here|subagent|session", "model": "{{models}}", "effort": "low|medium|high|xhigh|max", "why": "the reason in under 12 plain words, in {{lang}}"}`

export const MODEL_HEAD_FIRST = 'MODEL (this is the FIRST prompt of a new chat: pick the model the whole chat should run on, by the rules below; for a greeting or an opener with no task yet, answer the current model)'

export const MODEL_HEAD = 'MODEL (for subagent or session; for here use the current one)'

export const FABLE_RULE = `
- fable: rare, 2.5 times the price of opus; only where opus at high effort is likely not enough: a new architecture across several layers (shared code plus iOS and Android, or backend plus clients) with no clear solution yet; a hard concurrency or race problem, or a security hole whose reach across several services is still unknown; a bug that two or more fixes already failed to solve; a deep analysis of a whole large system (many services) where a wrong conclusion costs a lot of money or data. Not fable (opus instead): an everyday feature, however big or important; a code review of a given module, also of payments or security code; payments, auth or a migration with a known approach or an official guide; anything mechanical; a question about architecture. A single failed fix is not two.`

export function pickPrompt(text: string, c: Chat, template = TEMPLATE) {
  const conf = c.conf
  const slots: Record<string, string> = {
    project: conf.project.trim() || 'a software project',
    model_head: c.isFirst && conf.modelMode !== 'off' ? MODEL_HEAD_FIRST : MODEL_HEAD,
    models: c.models.join('|'),
    fable: c.models.includes('fable') ? FABLE_RULE : '',
    rules: conf.rules.trim() ? `\n\nPROJECT RULES (they take precedence over the rules above)\n${conf.rules.trim()}` : '',
    model: c.model || 'unknown',
    effort: c.now || 'unknown',
    tokens: c.tokens ? `${Math.round(c.tokens / 1000)}k tokens` : 'unknown',
    first: clip(c.first, 400) || '(none)',
    recent: c.recent.map(t => `- ${clip(t, 200)}`).join('\n') || '(none)',
    reply: clip(c.reply, 600) || '(none)',
    prompt: text.slice(0, 4000),
    lang: conf.language && conf.language.toLowerCase() !== 'auto' ? conf.language : 'the language of the new prompt',
  }
  // One pass, so a slot's value that holds {{...}} (a prompt about templates) stays as written.
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => slots[k] ?? m)
}

// Reads each field on its own, so a reply with stray characters after the JSON still counts.
export function field(text: string, name: string) {
  return new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1] ?? ''
}

export function parsePick(text: string, models: readonly Model[] = ALL_MODELS): Pick | null {
  const w = field(text, 'where')
  const where = w === 'here' || w === 'subagent' || w === 'session' ? w : null
  const effort = asLevel(field(text, 'effort'))
  if (!where || !effort) return null
  const why = clip(field(text, 'why').replace(/\s*[—–]\s*/g, ', '), 90)
  return { where, model: asModel(field(text, 'model'), models), effort, why }
}

export function str(v: unknown, fallback: string) {
  return typeof v === 'string' ? v : fallback
}

export function toConfig(options: Record<string, unknown>): Config {
  return {
    project: str(options.project, ''),
    rules: str(options.rules, ''),
    language: str(options.language, 'auto').trim() || 'auto',
    classifier: options.classifier === 'haiku' || options.classifier === 'opus' ? options.classifier : 'sonnet',
    effortMode: options.effortMode === 'auto' ? 'auto' : 'ask',
    modelMode: options.modelMode === 'auto' ? 'auto' : options.modelMode === 'off' ? 'off' : 'ask',
  }
}

// The language the agent writes its questions in.
export function userLang(cfg: Config) {
  return cfg.language && cfg.language.toLowerCase() !== 'auto' ? cfg.language : "the user's language (the language of this prompt)"
}
