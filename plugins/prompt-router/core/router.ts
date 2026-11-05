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

const COMPARE_MODELS = ['opus', 'haiku', 'sonnet', 'fable'] as const
const COMPARE_LEVELS = ['medium', 'low', 'high', 'xhigh', 'max'] as const
type CompareValue = `${(typeof COMPARE_MODELS)[number]}-${(typeof COMPARE_LEVELS)[number]}` | 'first' | 'history'
// opus-medium first (the default): Anthropic's pick for everyday work.
const COMPARE_VALUES = [...COMPARE_MODELS.flatMap(m => COMPARE_LEVELS.map(l => `${m}-${l}` as CompareValue)), 'first' as const, 'history' as const] as readonly CompareValue[]

// compareWith as a model and effort; null for `first` and `history` (history: core/stats.ts historyCompare).
export function compareTarget(v: string): { model: Model; effort: Level } | null {
  const [m, l] = v.split('-')
  const model = knownModel(m)
  const effort = asLevel(l)
  return model && effort ? { model, effort } : null
}

// One switch per feature; the first value of each is the default.
export const SWITCHES = {
  effortDetection: ['ask', 'auto', 'off'],
  firstChatDetection: ['ask', 'auto', 'off'],
  midChatModelDetection: ['ask', 'auto', 'off'],
  // auto: the suggested subagent runs right away, with no "Where should this go?" (one line tells the user).
  subagentSuggestions: ['ask', 'auto', 'off'],
  sessionSuggestions: ['ask', 'off'],
  // In a chat past this share of its model's context window, any prompt that would stay here is
  // offered as a new session (every reply here re-reads the whole context).
  newSessionAt: ['50%', 'off', '40%', '60%', '70%'],
  notifications: ['on', 'off'],
  stats: ['on', 'off'],
  // Claude Code: open the Prompt Router pane by itself when a session starts.
  openPane: ['off', 'on'],
  // Share of prompts the router would move lower that keep their setting, as a control group for the
  // savings stats. 0 turns it off.
  holdoutPct: ['10', '0', '5', '20'],
  // What the savings are measured against: a model at an effort for every chat, or `first`, the
  // chat's first model (the main chat's for a subagent). Read from the tokens, so it reprices old data.
  compareWith: COMPARE_VALUES,
} as const

export type Switch = keyof typeof SWITCHES

// The classifier models; the first is the default.
export const CLASSIFIERS = ['sonnet', 'haiku', 'opus'] as const

type Switches = { [K in Switch]: (typeof SWITCHES)[K][number] }

export type Config = { project: string; rules: string; language: string; classifier: (typeof CLASSIFIERS)[number] } & Switches

export type Model = keyof typeof MODELS

// first: the first prompt of a chat, whose model may still change. other: a later prompt that stays
// here but fits another model than the chat's, which is not switched (that would break the cache).
// work: whether the prompt starts new work or goes on with this chat's (a missing field is continue).
// note: in a long chat, the words "chat at X% of context" in the user's language, for preferSession.
// follows: how the prompt relates to the chat's last answer (a missing field is unknown).
export type Follows = 'continues' | 'corrects' | 'new'
export type Pick = { where: Where; model: Model; effort: Level; why: string; work?: 'new' | 'continue'; note?: string; follows?: Follows; first?: { now: Model | '' }; other?: { now: Model } }

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

// Whether effort level or model `a` is above `b` (low … max, haiku … fable); false when either is unknown.
export function above(a: unknown, b: unknown): boolean {
  const la = asLevel(a)
  const lb = asLevel(b)
  if (la && lb) return LEVELS.indexOf(la) > LEVELS.indexOf(lb)
  const ma = knownModel(a)
  const mb = knownModel(b)
  return !!ma && !!mb && ALL_MODELS.indexOf(ma) > ALL_MODELS.indexOf(mb)
}

// Whether a prompt falls in the control group: the same seed always lands the same way, and about pct %
// of seeds land in it (FNV-1a hash).
export function inHoldout(seed: string, pct: number): boolean {
  if (!(pct > 0)) return false
  let h = 0x811c9dc5
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 0x01000193)
  return (h >>> 0) % 10_000 < pct * 100
}

// Whether the prompt itself asks for a model or an effort; the router then never holds it back.
// The names take Czech case endings too (s opusem, na sonnetu, víc effortu).
export function namesSetting(text: string): boolean {
  return /\b(haik(u|em)|sonnet(u|em|y|a)?|opus(u|em|y|a)?|fabl(e|u|em)|effort(s|u|em|y)?|ultrathink|think (hard|harder|deeply))\b/i.test(text)
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
// hereModel: the platform offers a subagent when a prompt that stays here fits another model.
export type Chat = { first: string; recent: string[]; reply: string; model: string; now: Level | ''; tokens: number | undefined; window?: number; conf: Config; isFirst?: boolean; hereModel?: boolean; models: readonly Model[] }

// The classifier prompt. {{name}} slots are filled per prompt; the test tool can swap the whole
// template for a file, so the rules can be tuned without reloading the mod.
export const TEMPLATE = `You route one prompt in a Claude Code chat about {{project}}. Decide where it should run, on which model and at which effort. Prompts can be in any language.

WHERE
- keep: the prompt only approves, answers a question or says to go on (yes, ok, go on, do it, option 2, or the same in another language). Answer keep for all three fields.
- here: it builds on what this chat already read, found, decided or changed (a follow-up, a fix of what was just found, the next iteration, a question about it). Also here when the chat is still small (under 30k tokens) and the right model is the current one.
- Also here for anything trivial that takes one short answer (a greeting, a quick fact, a one-line question) when it relates to this chat or the chat is under 60k tokens: starting a subagent or a session costs more than answering it. In a bigger chat every reply re-reads the whole context, so an unrelated task, even a trivial one, goes to session. A greeting or small talk is not a task and stays here.
- subagent: a self-contained lookup, search, read of something big, build or run whose short answer is needed here, and that needs none of this chat's context. If it builds on this chat, it is here, not subagent.
- session: unrelated to this chat (a new topic, another feature, a task that ends in its own branch or PR, or anything unrelated at all once the chat is over 60k tokens), or long mechanical work better done with a fresh context on a cheaper model. Pick session only when you are fairly sure; if unsure, here.

{{model_head}}
Judge the work needed to answer, not the length of the prompt or of the answer, and not whether code changes. Go down the list and take the first that fits. If torn between two of opus, sonnet and haiku, take the higher one.{{fable}}
- opus: new logic, architecture, debugging or finding why something in this project misbehaves or does not happen, code review, judging a design choice or trade-off, anything risky (money, user data, security, auth, rewriting git history, force pushes, deleting data or anything else hard to undo). Also opus when the work is open-ended or its size is unclear.
- sonnet: explaining how something in this project's code works or what it checks (reading several files and connecting them), even when short and with no code changes; mechanical edits by an existing pattern (strings, renames, porting finished code to another platform); clicking through an app; writing summaries.
- haiku: only work with no reasoning about this project's code: a general fact or definition, a translation, a short message or email, a regex or one command; running builds, lint or tests and reporting the result; finding where something is defined or used (a search, not an explanation); reading one given file or log and reporting what it says, also the error that broke a build; changing one given text or value. Not haiku: "how does X work in our code" (sonnet), "why does X happen" needing a look into the code (opus), "should we do A or B" (opus).

EFFORT
- low: simple, mechanical or rule-following work, a greeting, a short message or a quick answer, or work the person will iterate on with Claude.
- medium: everyday work with a clear definition of done, including writing tests. The default. If unsure, medium.
- high: a hidden mistake would cost money, data or trust: hunting bugs, reviewing, checking work, payment, data or security logic, architecture decisions.
- xhigh: only a long, hard, critical job the person hands off and walks away from.
- max: only when the person explicitly asks for the maximum effort or thinking, or for a one-off irreversible step with a very high cost of a mistake (production data, a live security incident) where time does not matter. Never for everyday work, a feature or a review, however important. "Do it properly" or "be careful" is not max.
A task being long does not make it high. Words like important, critical, carefully, properly or take your time do not raise the effort beyond high on their own; only handing off a long job (xhigh) or the max cases above do.
Examples: reviewing payment code = opus, high (not xhigh, not max). A big feature on iOS and Android with a known design = opus, medium or high. A database migration done the usual way = medium or high. A one-off script that rewrites production data and cannot be undone, checked with all the care possible = max.{{rules}}

WORK
- new: the prompt starts a new task with its own definition of done (another feature, screen, bug or topic), even in the same project or area as this chat.
- continue: the next step of this chat's task, a fix or check of what was just done, a question about it, small talk, or an approval.

FOLLOWS
- corrects: the prompt says the last answer or change was wrong, did not work or is not enough, or asks to redo or fix it (not working, still broken, wrong, no, not like that, try again).
- continues: the next step of this chat's task, a question about the last answer, small talk, or an approval.
- new: the prompt starts another task or topic.

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

Reply with JSON only: {"where": "keep|here|subagent|session", "model": "{{models}}", "effort": "low|medium|high|xhigh|max", "work": "new|continue", "why": "the reason in under 12 plain words, in {{lang}}", "follows": "continues|corrects|new"{{note}}}`

// midChatModelDetection auto: the agent picks the subagent or here itself, with no question.
export const DECIDE_OTHER = `Do not ask the user; decide yourself: use the subagent only when it is worth it: a larger self-contained piece of work that needs the other model (for example hard design or debugging on a weaker chat model, or long mechanical work on a strong one); a quick question, a short answer or a short message stays here.`
// subagentSuggestions auto: the suggested subagent runs with no question; the user is told in one line.
export const RUN_SUBAGENT = 'Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why.'
export const TOLD_OTHER = 'Afterwards, tell the user in one sentence what you chose (the subagent or here) and why.'

export const MODEL_HEAD_FIRST = 'MODEL (this is the FIRST prompt of a new chat: pick the model the whole chat should run on, by the rules below; for a greeting or an opener with no task yet, answer the current model)'

export const MODEL_HEAD = 'MODEL (for subagent or session; for here use the current one)'

export const MODEL_HEAD_HERE = 'MODEL (the model the task needs, also for here: a here prompt on another model than the current one is offered to a subagent on that model. For here, a greeting, small talk, writing a short message or email, or a question answered from what this chat already read or said keeps the current one, even where the haiku rule below says haiku. A question that needs new reading of code or a judgement follows the rules below)'

export const FABLE_RULE = `
- fable: rare, 2.5 times the price of opus; only where opus at high effort is likely not enough: a new architecture across several layers (shared code plus iOS and Android, or backend plus clients) with no clear solution yet; a hard concurrency or race problem, or a security hole whose reach across several services is still unknown; a bug that two or more fixes already failed to solve; a deep analysis of a whole large system (many services) where a wrong conclusion costs a lot of money or data. Not fable (opus instead): an everyday feature, however big or important; a code review of a given module, also of payments or security code; payments, auth or a migration with a known approach or an official guide; anything mechanical; a question about architecture. A single failed fix is not two.`

export function pickPrompt(text: string, c: Chat, template = TEMPLATE) {
  const conf = c.conf
  const lang = conf.language && conf.language.toLowerCase() !== 'auto' ? conf.language : 'the language of the new prompt'
  const share = longShare(c, conf)
  const slots: Record<string, string> = {
    project: conf.project.trim() || 'a software project',
    model_head: c.isFirst
      ? conf.firstChatDetection === 'off' ? MODEL_HEAD : MODEL_HEAD_FIRST
      : c.hereModel && conf.midChatModelDetection !== 'off' ? MODEL_HEAD_HERE : MODEL_HEAD,
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
    lang,
    // Asked only when preferSession may use it, so a short chat's prompt stays as it was.
    note: share ? `, "note": "the words chat at ${share}% of context, in ${lang}"` : '',
  }
  // One pass, so a slot's value that holds {{...}} (a prompt about templates) stays as written.
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => slots[k] ?? m)
}

// Reads each field on its own, so a reply with stray characters after the JSON still counts.
export function field(text: string, name: string) {
  return new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1] ?? ''
}

// How the prompt relates to the last answer; read from any reply, also a keep one.
export function parseFollows(text: string): Follows | undefined {
  const f = field(text, 'follows')
  return f === 'continues' || f === 'corrects' || f === 'new' ? f : undefined
}

export function parsePick(text: string, models: readonly Model[] = ALL_MODELS): Pick | null {
  const w = field(text, 'where')
  const where = w === 'here' || w === 'subagent' || w === 'session' ? w : null
  const effort = asLevel(field(text, 'effort'))
  if (!where || !effort) return null
  const why = clip(field(text, 'why').replace(/\s*[—–]\s*/g, ', '), 90)
  const work = field(text, 'work') === 'new' ? 'new' : 'continue'
  const note = clip(field(text, 'note'), 40)
  const follows = parseFollows(text)
  return { where, model: asModel(field(text, 'model'), models), effort, work, why, ...(note ? { note } : {}), ...(follows ? { follows } : {}) }
}

export function str(v: unknown, fallback: string) {
  return typeof v === 'string' ? v : fallback
}

export const OPTIONS = ['project', 'rules', 'language', 'classifier', ...(Object.keys(SWITCHES) as Switch[])] as const

export type Option = (typeof OPTIONS)[number]

// Where an option's value came from: its own key, the 0.7 key it replaced, or the default.
export type Source = { value: string; from: 'new' | 'old' | 'default'; key: string }

function choice(v: unknown, values: readonly string[]) {
  return typeof v === 'string' && values.includes(v) ? v : ''
}

// The 0.7 keys still count when the new key is missing: effortMode (ask, auto) for effortDetection,
// modelMode (ask, auto, off) for firstChatDetection, and modelMode off also for midChatModelDetection.
function oldValue(k: Switch, o: Record<string, unknown>): { value: string; key: string } | null {
  if (k === 'effortDetection' && choice(o.effortMode, ['ask', 'auto'])) return { value: o.effortMode as string, key: 'effortMode' }
  if (k === 'firstChatDetection' && choice(o.modelMode, ['ask', 'auto', 'off'])) return { value: o.modelMode as string, key: 'modelMode' }
  if (k === 'midChatModelDetection' && o.modelMode === 'off') return { value: 'off', key: 'modelMode' }
  return null
}

export function switchSource(k: Switch, o: Record<string, unknown>): Source {
  const v = choice(o[k], SWITCHES[k])
  if (v) return { value: v, from: 'new', key: k }
  const old = oldValue(k, o)
  return old ? { ...old, from: 'old' } : { value: SWITCHES[k][0], from: 'default', key: k }
}

// defaults: a platform's own defaults (the Codex classifier is haiku).
export function optionSources(o: Record<string, unknown>, defaults: Record<string, string> = {}): Record<Option, Source> {
  const d: Record<string, string> = { project: '', rules: '', language: 'auto', classifier: 'sonnet', ...defaults }
  const cfg = toConfig({ ...defaults, ...o })
  const out = {} as Record<Option, Source>
  for (const k of OPTIONS) {
    out[k] = k in SWITCHES
      ? switchSource(k as Switch, o)
      : { value: cfg[k as 'project'], from: typeof o[k] === 'string' && o[k] !== d[k] ? 'new' : 'default', key: k }
  }
  return out
}

export function toConfig(options: Record<string, unknown>): Config {
  const sw = Object.fromEntries((Object.keys(SWITCHES) as Switch[]).map(k => [k, switchSource(k, options).value])) as Switches
  return {
    project: str(options.project, ''),
    rules: str(options.rules, ''),
    language: str(options.language, 'auto').trim() || 'auto',
    classifier: CLASSIFIERS.find(c => c === options.classifier) ?? CLASSIFIERS[0],
    ...sw,
  }
}

// What the classifier's pick turns into when its feature is off: a subagent or session pick stays here.
export function allowed(p: Pick, cfg: Config): Pick {
  if (p.where === 'subagent' && cfg.subagentSuggestions === 'off') return { ...p, where: 'here' }
  if (p.where === 'session' && cfg.sessionSuggestions === 'off') return { ...p, where: 'here' }
  return p
}

// The context window when the platform does not tell it.
export const DEFAULT_WINDOW = 200_000

// The window the chat really has: Claude Code compacts it against CLAUDE_CODE_AUTO_COMPACT_WINDOW
// (when smaller) at CLAUDE_AUTOCOMPACT_PCT_OVERRIDE of it, so it never grows past that point.
// Either unset (or not a number) leaves the model's own window.
export function compactWindow(window: number | undefined, env: { pct?: unknown; window?: unknown }): number | undefined {
  if (!window || window <= 0) return window
  const cap = Number(env.window)
  const w = cap > 0 ? Math.min(window, cap) : window
  const pct = Number(env.pct)
  return pct > 0 && pct <= 100 ? Math.round((w * pct) / 100) : w
}

// Any prompt that would stay here goes to a new session once the chat holds newSessionAt of its
// model's context window: every reply here re-reads all of it, whatever the prompt is.
// The note is the classifier's words in the user's language (pickPrompt asks for it); English without them.
export function preferSession(p: Pick, c: { tokens: number | undefined; window?: number }, cfg: Config): Pick {
  const share = longShare(c, cfg)
  if (p.where !== 'here' || !share) return p
  const note = p.note || `chat at ${share}% of context`
  return { ...p, where: 'session', why: p.why ? `${p.why}, ${note}` : note }
}

// The chat's share of its model's context window in whole percent once it reaches newSessionAt, else 0.
export function longShare(c: { tokens: number | undefined; window?: number }, cfg: Config): number {
  const at = Number.parseInt(cfg.newSessionAt, 10)
  if (!at || cfg.sessionSuggestions === 'off' || !c.tokens) return 0
  const share = Math.floor((c.tokens / (c.window && c.window > 0 ? c.window : DEFAULT_WINDOW)) * 100)
  return share >= at ? share : 0
}

// One line per option for /router and the log: value and where it came from.
export function describeOptions(o: Record<string, unknown>, defaults: Record<string, string> = {}) {
  return Object.entries(optionSources(o, defaults)).map(([k, s]) => {
    const v = k === 'project' || k === 'rules' ? (s.value ? JSON.stringify(clip(s.value, 60)) : '(empty)') : s.value
    const from = s.from === 'old' ? `old key ${s.key}; rename it to ${k}` : s.from === 'new' ? 'set' : 'default'
    return `${k}: ${v} (${from})`
  })
}

// The same on one line, for the log: what this copy of the router really goes by.
export function optionsLine(o: Record<string, unknown>, defaults: Record<string, string> = {}) {
  const s = optionSources(o, defaults)
  return OPTIONS.map(k => `${k}=${k === 'project' || k === 'rules' ? JSON.stringify(clip(s[k].value, 40)) : s[k].value}${s[k].from === 'old' ? `(old ${s[k].key})` : ''}`).join(' ')
}

// The language the agent writes its questions in.
export function userLang(cfg: Config) {
  return cfg.language && cfg.language.toLowerCase() !== 'auto' ? cfg.language : "the user's language (the language of this prompt)"
}
