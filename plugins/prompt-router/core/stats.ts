// Savings summary from the stats log. Pure functions: the platforms write the records, this reads them.
// Every dollar is an estimate from core/prices.ts. Honest by design: the classifier's cost comes off
// the saving, a stronger model is shown as extra cost, an effort change is not priced, and the
// balance takes all of them in.
import { LEVELS, MODEL_NAMES, NAMES, above, asLevel, knownModel } from './router.ts'
import type { Level } from './router.ts'
import { cost } from './prices.ts'
import type { Usage } from './prices.ts'

type Side = { model: string; effort: Level | '' }

// One router decision. `classifier` is what the classifier call itself cost; `usd`, when the
// platform reports a price (OpenCode), wins over the price list.
export type Decision = {
  kind: 'decision'
  ts: number
  platform: string
  chat: string
  where: 'here' | 'subagent' | 'session' | 'keep'
  from: Side
  to: Side
  /** promptKey: a short hash of the normalized prompt (older records: its first 200 characters); the same key again means the same question came back. */
  key?: string
  /** What the classifier read of the prompt: a fix of the last answer, the next step, or new work. */
  follows?: 'continues' | 'corrects' | 'new'
  outcome: 'applied' | 'asked' | 'declined'
  classifier?: { model: string; usage: Usage; usd?: number; ms?: number }
  /** The transcript the decision belongs to (Claude Code: the session id, the name of its .jsonl). */
  session?: string
  /** The prompt's own words say the last answer did not do the job (isRedo). */
  redo?: true
}

// One finished turn (main chat, or a subagent with `agentId`). `baseline` is the model it would
// have run on without the router: the chat's first model, or the main chat's model for a subagent.
// No `usage` = the turn was cut off and its tokens are unknown.
export type Turn = {
  kind: 'turn'
  ts: number
  platform: string
  chat: string
  agentId?: string
  model: string
  baseline: string
  usage?: Usage
  usd?: number
  /** The log had no tokens (the turn was cut off); these come from the chat's transcript (withTranscripts). */
  transcript?: true
  /** A routed subagent: the main chat's context when it started and the requests it made. Without
   *  the router each of those requests would have read that context from the main chat's cache. */
  mainContext?: number
  requests?: number
  /** The router switched the chat's model since the last turn: without it, what this turn wrote to
   *  the cache would have been read from it. */
  switched?: true
  /** A main-chat turn: the effort it ran at and the person's own pick (what it would have run at). */
  effort?: Level
  baseEffort?: Level
  /** Wall-clock ms of the turn as the platform reports it (the classifier's wait is not in it).
   *  Missing in older records and on platforms that do not time it. */
  durationMs?: number
  /** A main-chat turn that ran after the person moved the model or effort picker above what the
   *  router had set: a sign its pick was too low. */
  manual?: true
  /** A main-chat turn: the weekly limit's fill after it, as the platform reports it (subscriptions only). */
  week?: { pct: number; resets?: string }
}

// The user took an asked decision (switched, or ran the suggested subagent). `decision` is its `ts`.
// `outcome: 'declined'`: the person was asked and kept their setting instead.
export type Accept = { kind: 'accept'; ts: number; platform: string; chat: string; decision: number; outcome?: 'declined' }

export type Entry = Decision | Turn | Accept

export type Summary = {
  prompts: number
  modelChanges: number
  effortDown: number
  effortUp: number
  subagents: number
  sessions: number
  asked: number
  declined: number
  /** What the turns cost. */
  actualUsd: number
  /** What the same tokens would have cost on the baseline model. */
  withoutUsd: number
  /** Turns on a cheaper model: baseline minus real price. */
  savedUsd: number
  /** Turns on a stronger model: real price minus baseline. Shown apart, not in the net. */
  extraUsd: number
  classifierUsd: number
  /** savedUsd minus classifierUsd. */
  netUsd: number
  /** netUsd as a percent of withoutUsd; 0 when nothing was priced. */
  netPct: number
  /** All in: withoutUsd minus actualUsd and classifierUsd (= saved − extra + effort − classifier). */
  balanceUsd: number
  /** balanceUsd as a percent of withoutUsd; 0 when nothing was priced. */
  balancePct: number
  /** What the same work would have cost on REFERENCE (one fixed model and effort for everyone). */
  referenceUsd: number
  /** referenceUsd minus actualUsd and classifierUsd: does routing beat always using REFERENCE. */
  vsReferenceUsd: number
  /** vsReferenceUsd as a percent of referenceUsd; 0 when nothing was priced. */
  vsReferencePct: number
  /** Turns with a known price (the divisor of the cost per turn). */
  pricedTurns: number
  /** (actualUsd + classifierUsd) / pricedTurns: escalation shows up here as its own number. */
  perTurnUsd: number
  /** Prompts the router sent to a cheaper model or effort. */
  routed: number
  /** Routed prompts whose answer did not do the job, each by its FAILURE_WEIGHTS (see reworkedSet). */
  rework: number
  /** (1 − rework / routed) as a percent; null when nothing was routed. An estimate. */
  accuracyPct: number | null
  /** Turns with no usage (cut off). */
  unknownTurns: number
  /** Turns whose saving could not be priced (a model not in the price list). */
  unpricedTurns: number
  /** New tokens subagents took in (input and cache writes): work that stayed out of the main chat. */
  offloadTokens: number
  tokens: { [model: string]: Usage }
}

export type Report = { today: Summary; week: Summary; total: Summary }

const DAY = 86_400_000

function empty(): Summary {
  return {
    prompts: 0, modelChanges: 0, effortDown: 0, effortUp: 0, subagents: 0, sessions: 0, asked: 0, declined: 0,
    actualUsd: 0, withoutUsd: 0, savedUsd: 0, extraUsd: 0, classifierUsd: 0, netUsd: 0, netPct: 0, balanceUsd: 0, balancePct: 0,
    referenceUsd: 0, vsReferenceUsd: 0, vsReferencePct: 0, pricedTurns: 0, perTurnUsd: 0,
    unknownTurns: 0, unpricedTurns: 0, offloadTokens: 0, routed: 0, rework: 0, accuracyPct: null, tokens: {},
  }
}

function addDecision(s: Summary, d: Decision, taken: boolean) {
  s.prompts++
  if (d.outcome === 'asked') s.asked++
  if (d.outcome === 'declined') s.declined++
  if (d.outcome !== 'applied' && !(d.outcome === 'asked' && taken)) return
  if (d.where === 'subagent') s.subagents++
  if (d.where === 'session') s.sessions++
  if (d.where !== 'here') return
  if (d.to.model !== d.from.model) s.modelChanges++
  const a = d.from.effort ? LEVELS.indexOf(d.from.effort) : -1
  const b = d.to.effort ? LEVELS.indexOf(d.to.effort) : -1
  if (a >= 0 && b >= 0 && b < a) s.effortDown++
  if (a >= 0 && b >= 0 && b > a) s.effortUp++
}

function classifierUsd(d: Decision) {
  const c = d.classifier
  return c ? (c.usd ?? cost(c.usage, c.model) ?? 0) : 0
}

// The fixed yardstick: the balance above depends on the chat's own first pick (a Haiku-low chat
// always looks like a loss when the router escalates), this one is the same for every chat. Opus at
// medium effort is the default setup, so the number says whether routing beats leaving it alone.
export const REFERENCE: { model: string; effort: Level } = { model: 'opus', effort: 'medium' }

// The tokens the same work would have taken without the router; the turn's own when nothing differs.
// Effort is not re-priced: how many tokens another effort would have taken is not known.
function withoutUsage(t: Turn, u: Usage): Usage {
  const carried = (t.mainContext ?? 0) * (t.requests ?? 0)
  if (!carried && !t.switched) return u
  return {
    input: u.input ?? 0,
    output: u.output ?? 0,
    cacheRead: (u.cacheRead ?? 0) + carried + (t.switched ? (u.cacheWrite ?? 0) : 0),
    cacheWrite: t.switched ? 0 : (u.cacheWrite ?? 0),
  }
}

// What the savings are measured against (option compareWith): a model at an effort for every turn,
// a mix of them (history: what the user ran before the router, each part's share of the tokens), or
// null for each turn's own `baseline` (the chat's first model). Applied when the log is read, so a
// new choice reprices the old turns too. `fallback` says why a target stands in for history.
export type Target = { model: string; effort: Level; fallback?: 'pending' | 'none' }
export type MixPart = { model: string; effort: Level; share: number }
export type Compare = Target | { mix: MixPart[] } | null

// The turn as if it would have run on `c` without the router. A turn with no known effort (a
// subagent) keeps its output: only the model is repriced.
function against(t: Turn, c: Target | MixPart | null): Turn {
  return c ? { ...t, baseline: c.model, baseEffort: c.effort } : t
}

type Priced = { without: number; saved: number; extra: number; unpriced: boolean }

// What one turn would have cost on its baseline model.
function priceWithout(t: Turn, usage: Usage, actual: number, listActual: number | null): Priced {
  const same = withoutUsage(t, usage)
  if (t.model === t.baseline && same === usage) return { without: actual, saved: 0, extra: 0, unpriced: false }
  // The saving compares list prices on both sides; without one of them, no saving is claimed.
  const listWithout = cost(same, t.baseline)
  if (listActual === null || listWithout === null) return { without: actual, saved: 0, extra: 0, unpriced: true }
  const diff = listWithout - listActual
  return { without: actual + diff, saved: Math.max(diff, 0), extra: Math.max(-diff, 0), unpriced: false }
}

function addTurn(s: Summary, turn: Turn, c: Compare) {
  if (turn.agentId && turn.usage) s.offloadTokens += (turn.usage.input ?? 0) + (turn.usage.cacheWrite ?? 0)
  if (!turn.usage) {
    s.unknownTurns++
    return
  }
  const sum = (s.tokens[turn.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) sum[k] += turn.usage[k] ?? 0
  const listActual = cost(turn.usage, turn.model)
  const actual = turn.usd ?? listActual
  if (actual === null) {
    s.unpricedTurns++
    return
  }
  s.actualUsd += actual
  s.pricedTurns++
  s.referenceUsd += cost(withoutUsage(turn, turn.usage), REFERENCE.model) ?? actual
  // A mix prices the turn on each part and weights the results by the parts' shares.
  const parts: [Turn, number][] = c && 'mix' in c ? c.mix.map(p => [against(turn, p), p.share]) : [[against(turn, c), 1]]
  const priced = parts.map(([t, w]) => [priceWithout(t, turn.usage!, actual, listActual), w] as const)
  if (priced.some(([p]) => p.unpriced)) {
    s.unpricedTurns++
    s.withoutUsd += actual
    return
  }
  for (const [p, w] of priced) {
    s.withoutUsd += p.without * w
    s.savedUsd += p.saved * w
    s.extraUsd += p.extra * w
  }
}

// What history-scan.mjs writes: the tokens before the router per "<model id>|<effort>".
export type History = { version: number; before: number; computedAt: number; ms?: number; files?: number; tokens: { [key: string]: number } }

// The history as a mix: tokens per known model and effort (medium when the transcript had none),
// each part's share of the whole, biggest first; parts under 0.5 % fold into the others. Null with
// no priced tokens.
export function historyMix(h: History | null | undefined): MixPart[] | null {
  const by = new Map<string, number>()
  for (const [key, n] of Object.entries(h?.tokens ?? {})) {
    const [id = '', e = ''] = key.split('|')
    const model = knownModel(id)
    if (!model || !(n > 0) || cost({ input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }, model) === null) continue
    const k = `${model}|${asLevel(e) || 'medium'}`
    by.set(k, (by.get(k) ?? 0) + n)
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0)
  if (!total) return null
  const kept = [...by].filter(([, n]) => n / total >= 0.005)
  const keptTotal = kept.reduce((a, [, n]) => a + n, 0)
  return kept
    .map(([k, n]) => {
      const [model = '', effort = 'medium'] = k.split('|')
      return { model, effort: effort as Level, share: n / keptTotal }
    })
    .sort((a, b) => b.share - a.share)
}

// compareWith history: the mix once computed, else Opus medium with why (still computing, or no
// sessions from before the router).
export function historyCompare(h: History | null | undefined, computing: boolean): Compare {
  const mix = historyMix(h)
  if (mix) return { mix }
  return { ...REFERENCE, fallback: h || !computing ? 'none' : 'pending' }
}

function finish(s: Summary): Summary {
  s.netUsd = s.savedUsd - s.classifierUsd
  s.netPct = s.withoutUsd > 0 ? (s.netUsd / s.withoutUsd) * 100 : 0
  s.balanceUsd = s.withoutUsd - s.actualUsd - s.classifierUsd
  s.balancePct = s.withoutUsd > 0 ? (s.balanceUsd / s.withoutUsd) * 100 : 0
  s.vsReferenceUsd = s.referenceUsd - s.actualUsd - s.classifierUsd
  s.vsReferencePct = s.referenceUsd > 0 ? (s.vsReferenceUsd / s.referenceUsd) * 100 : 0
  s.perTurnUsd = s.pricedTurns > 0 ? (s.actualUsd + s.classifierUsd) / s.pricedTurns : 0
  s.accuracyPct = s.routed > 0 ? (1 - s.rework / s.routed) * 100 : null
  return s
}

const takenKey = (chat: string, ts: number) => `${chat}\n${ts}`

function takenSet(records: readonly Entry[]) {
  return new Set(records.filter((r): r is Accept => r.kind === 'accept' && r.outcome !== 'declined').map(r => takenKey(r.chat, r.decision)))
}

// A prompt the router sent to a cheaper model or effort than the person's pick.
const routedDecision = (d: Decision) => d.outcome === 'applied' && d.where !== 'keep' && (d.to.model !== d.from.model || d.to.effort !== d.from.effort)

// How surely each sign says a cheaper answer did not do the job (1 = surely). Guesses, to tune:
// switched = the person moved the picker up and went on, repeated = the same text again, corrected =
// the classifier read the next prompt as a fix of the answer, interrupted = the answer was cut off.
export const FAILURE_WEIGHTS = { switched: 1, repeated: 1, corrected: 0.7, interrupted: 0.4 } as const

export type FailureReason = keyof typeof FAILURE_WEIGHTS
export type Failure = { weight: number; reasons: FailureReason[] }

// The strongest sign counts; the reasons are all listed.
function failure(reasons: FailureReason[]): Failure {
  return { weight: Math.max(0, ...reasons.map(r => FAILURE_WEIGHTS[r])), reasons }
}

const main = (t: Turn) => !t.agentId
// A turn that did not finish: no tokens in the log, or only those its transcript had.
const cutOff = (t: Turn) => !t.usage || !!t.transcript

// Re-work: a routed prompt whose same text (`key`) comes again within the next few prompts of the chat,
// whose next prompt corrects it, whose next prompt ran after a switch up by hand, or whose answer was
// cut off. A guess: a repeat can also be a second try at the same question on purpose.
const REWORK_WINDOW = 3

function reworkedSet(records: readonly Entry[]) {
  const byChat = new Map<string, { decisions: Decision[]; turns: Turn[] }>()
  for (const r of records) {
    if ((r.kind !== 'decision' && r.kind !== 'turn') || (r.kind === 'turn' && !main(r))) continue
    let c = byChat.get(r.chat)
    if (!c) byChat.set(r.chat, (c = { decisions: [], turns: [] }))
    if (r.kind === 'decision') c.decisions.push(r)
    else c.turns.push(r)
  }
  const out = new Map<string, Failure>()
  for (const { decisions, turns } of byChat.values()) {
    decisions.sort((a, b) => a.ts - b.ts)
    turns.sort((a, b) => a.ts - b.ts)
    decisions.forEach((d, i) => {
      if (!routedDecision(d)) return
      const next = decisions.slice(i + 1, i + 1 + REWORK_WINDOW)
      const until = (k: number) => next[k]?.ts ?? Infinity
      const answer = turns.find(t => t.ts >= d.ts && t.ts < until(0))
      const reasons: FailureReason[] = []
      if (d.key && next.some(n => n.key === d.key)) reasons.push('repeated')
      if (next[0]?.follows === 'corrects' || next[0]?.redo) reasons.push('corrected')
      if (next[0] && turns.some(t => t.manual && t.ts >= next[0]!.ts && t.ts < until(1))) reasons.push('switched')
      if (answer && cutOff(answer)) reasons.push('interrupted')
      if (reasons.length) out.set(takenKey(d.chat, d.ts), failure(reasons))
    })
  }
  return out
}

// One task: a prompt, the prompts that went on with it or fixed it, and the turns that answered them.
// No decisions = turns before the first prompt the router saw.
export type Episode = { chat: string; start: number; end: number; decisions: Decision[]; turns: Turn[] }

// Quiet after which the next prompt starts a new task, whatever the classifier read.
export const EPISODE_GAP = 30 * 60_000

// The same text again goes on with the task (a repeat, even after a switch); otherwise the classifier's
// `follows` decides, and an older record without it starts a new task.
export function startsTask(d: Pick<Decision, 'ts' | 'key' | 'follows'>, cur: { end: number; keys: readonly (string | undefined)[] } | null) {
  if (!cur || d.ts - cur.end > EPISODE_GAP) return true
  if (d.key && cur.keys.includes(d.key)) return false
  return d.follows === undefined || d.follows === 'new'
}

const startsEpisode = (d: Decision, cur: Episode) => startsTask(d, { end: cur.end, keys: cur.decisions.map(x => x.key) })

// The records grouped into tasks, per chat, oldest first by where each task started.
export function episodes(records: readonly Entry[]): Episode[] {
  const byChat = new Map<string, (Decision | Turn)[]>()
  for (const r of records) {
    if (r.kind !== 'decision' && r.kind !== 'turn') continue
    const list = byChat.get(r.chat)
    if (list) list.push(r)
    else byChat.set(r.chat, [r])
  }
  const out: Episode[] = []
  for (const list of byChat.values()) {
    list.sort((a, b) => a.ts - b.ts)
    let cur: Episode | null = null
    for (const r of list) {
      if (!cur || (r.kind === 'decision' && startsEpisode(r, cur))) {
        cur = { chat: r.chat, start: r.ts, end: r.ts, decisions: [], turns: [] }
        out.push(cur)
      }
      if (r.kind === 'decision') cur.decisions.push(r)
      else cur.turns.push(r)
      cur.end = Math.max(cur.end, r.ts)
    }
  }
  return out.sort((a, b) => a.start - b.start)
}

// Whether a task's answers did the job, from the signs anywhere in it: a repeat of an earlier prompt,
// a correction, a switch up by hand after its first answer, a main-chat answer cut off.
export function failureOf(e: Episode): Failure {
  const reasons: FailureReason[] = []
  if (!e.decisions.length) return failure(reasons)
  if (e.decisions.some((d, i) => d.key && e.decisions.slice(0, i).some(x => x.key === d.key))) reasons.push('repeated')
  if (e.decisions.slice(1).some(d => d.follows === 'corrects' || d.redo)) reasons.push('corrected')
  const answers = e.turns.filter(main)
  if (answers.slice(1).some(t => t.manual)) reasons.push('switched')
  if (answers.some(cutOff)) reasons.push('interrupted')
  return failure(reasons)
}

// A move down: a cheaper model, or a subagent or session on the same model (a fresh context), or a
// lower effort here. Anything else is a higher pick (an escalation).
const movesDown = (where: string, from: Decision['from'], to: Decision['to']) =>
  above(from.model, to.model) || (from.model === to.model && (where !== 'here' || above(from.effort, to.effort)))

const turnUsd = (t: Turn) => (t.usage ? (t.usd ?? cost(t.usage, t.model) ?? 0) : 0)
const turnsUsd = (ts: readonly Turn[]) => ts.reduce((n, t) => n + turnUsd(t), 0)
const turnsMs = (ts: readonly Turn[]) => ts.filter(main).reduce((n, t) => n + (t.durationMs ?? 0), 0)
const classifierMs = (ds: readonly Decision[]) => ds.reduce((n, d) => n + (d.classifier?.ms ?? 0), 0)
// Whether the task's main turns carry their times (older records and some platforms do not).
const timed = (ts: readonly Turn[]) => ts.some(t => main(t) && t.durationMs !== undefined)

// The Wilson 95 % interval of a share (successes may be fractional: failures are weighted).
export function wilson(successes: number, n: number): { low: number; high: number } {
  if (n <= 0) return { low: 0, high: 1 }
  const z = 1.96
  const p = successes / n
  const d = 1 + (z * z) / n
  const c = (p + (z * z) / (2 * n)) / d
  const h = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d
  return { low: Math.max(0, c - h), high: Math.min(1, c + h) }
}

export type ModelRow = { model: string; tasks: number; usdPerTask: number; reworkPct: number; minutesPerTask: number | null }

export type Balance = {
  /** Tasks the router changed (model, effort, subagent, session). */
  routed: number
  /** Money the router saved (+) or cost (−) against no router, classifier included. An estimate. */
  usd: number
  /** usd split: cheaper picks, higher picks (escalation), re-work after a failed answer, classifier. */
  parts: { cheaper: number; escalation: number; rework: number; classifier: number }
  /** Share of routed tasks that did the job (weighted failures), with its Wilson interval. */
  accuracy: { pct: number; low: number; high: number } | null
  byModel: ModelRow[]
}

// The router's balance per task: each routed task's turns priced on the model they would have run on
// without the router (the token re-pricing above), minus what they cost and the classifier. A task's
// later prompts after a failure count as re-work, by the failure's weight.
// `since`: only tasks that started then or later count.
export function balance(records: readonly Entry[], since = -Infinity): Balance {
  const taken = takenSet(records)
  const changed = (d: Decision) => routedDecision(d) || (d.outcome === 'asked' && taken.has(takenKey(d.chat, d.ts)))
  const out: Balance = { routed: 0, usd: 0, parts: { cheaper: 0, escalation: 0, rework: 0, classifier: 0 }, accuracy: null, byModel: [] }
  const rows = new Map<string, { tasks: number; usd: number; rework: number; ms: number; timed: number }>()
  const row = (m: string) => rows.get(m) ?? (rows.set(m, { tasks: 0, usd: 0, rework: 0, ms: 0, timed: 0 }), rows.get(m)!)
  let fails = 0
  for (const e of episodes(records)) {
    if (!e.decisions.length || e.start < since) continue
    const d = e.decisions[0]!
    const clsUsd = e.decisions.reduce((n, x) => n + classifierUsd(x), 0)
    out.parts.classifier -= clsUsd
    if (!changed(d)) continue
    out.routed++
    const f = failureOf(e).weight
    fails += f
    const actual = turnsUsd(e.turns)
    const later = e.decisions[1] ? turnsUsd(e.turns.filter(t => t.ts >= e.decisions[1]!.ts)) : 0
    const rework = f * later
    const s = empty()
    for (const t of e.turns) addTurn(s, t, null)
    const gain = s.withoutUsd - (actual - rework)
    // A subagent or session on a stronger model is an escalation, not a cheaper pick.
    if (movesDown(d.where, d.from, d.to)) out.parts.cheaper += gain
    else out.parts.escalation += gain
    out.parts.rework -= rework
    const r = row(d.to.model)
    r.tasks++
    r.usd += actual + clsUsd
    r.rework += f
    if (timed(e.turns)) {
      r.ms += turnsMs(e.turns) + classifierMs(e.decisions)
      r.timed++
    }
  }
  const p = out.parts
  out.usd = p.cheaper + p.escalation + p.rework + p.classifier
  if (out.routed) {
    const w = wilson(out.routed - fails, out.routed)
    out.accuracy = { pct: (1 - fails / out.routed) * 100, low: w.low * 100, high: w.high * 100 }
  }
  out.byModel = [...rows].map(([model, r]) => ({
    model, tasks: r.tasks,
    usdPerTask: r.tasks ? r.usd / r.tasks : 0,
    reworkPct: r.tasks ? (r.rework / r.tasks) * 100 : 0,
    minutesPerTask: r.timed ? r.ms / r.timed / 60_000 : null,
  }))
  return out
}

export type Balances = { today: Balance; week: Balance; total: Balance }

// The balance of today (local calendar day), the last 7 days and everything, as summarize() splits them.
export function balances(records: readonly Entry[], now: number): Balances {
  return { today: balance(records, startOfDay(now)), week: balance(records, now - 7 * DAY), total: balance(records) }
}

// What scripts/usage-scan.mjs writes: every API request of a session's transcript (subagents with `agent`).
export type Request = { ts: number; model: string; agent?: string; usage: Usage }
export type UsageScan = { session: string; requests: Request[] }

// The log with the transcripts' tokens filled in where it has none: a main-chat turn that was cut off
// gets the main-chat requests since the chat's turn before it. Read only for /router stats (never when
// a prompt comes or the pane draws). The records passed in are not changed.
export function withTranscripts(records: readonly Entry[], scans: readonly UsageScan[]): Entry[] {
  const bySession = new Map(scans.map(s => [s.session, s.requests]))
  const sessionOf = new Map<string, string>()
  for (const r of records) if (r.kind === 'decision' && r.session && !sessionOf.has(r.chat)) sessionOf.set(r.chat, r.session)
  const prev = new Map<string, number>()
  const filled = new Map<Turn, Turn>()
  for (const t of records.filter((r): r is Turn => r.kind === 'turn' && main(r)).sort((a, b) => a.ts - b.ts)) {
    const since = prev.get(t.chat) ?? -Infinity
    prev.set(t.chat, t.ts)
    const reqs = t.usage ? undefined : bySession.get(sessionOf.get(t.chat) ?? '')
    const mine = reqs?.filter(q => !q.agent && q.ts > since && q.ts <= t.ts) ?? []
    if (!mine.length) continue
    const usage: Usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    for (const q of mine) for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) usage[k] = (usage[k] ?? 0) + (q.usage[k] ?? 0)
    filled.set(t, { ...t, model: knownModel(mine.at(-1)!.model) || t.model, usage, transcript: true })
  }
  return filled.size ? records.map(r => (r.kind === 'turn' && filled.get(r)) || r) : [...records]
}

function add(s: Summary, r: Entry, taken: Set<string>, reworked: Map<string, Failure>, c: Compare) {
  if (r.kind === 'turn') addTurn(s, r, c)
  else if (r.kind === 'decision') {
    addDecision(s, r, taken.has(takenKey(r.chat, r.ts)))
    s.classifierUsd += classifierUsd(r)
    if (routedDecision(r)) {
      s.routed++
      s.rework += reworked.get(takenKey(r.chat, r.ts))?.weight ?? 0
    }
  } else if (r.kind === 'accept' && r.outcome === 'declined') s.declined++
}

function startOfDay(ts: number) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

function dayKey(ts: number) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Today (local calendar day), the last 7 days and everything, as of `now`.
export function summarize(records: readonly Entry[], now: number, c: Compare = null): Report {
  const today = empty()
  const week = empty()
  const total = empty()
  const dayStart = startOfDay(now)
  const taken = takenSet(records)
  const reworked = reworkedSet(records)
  for (const r of records) {
    add(total, r, taken, reworked, c)
    if (r.ts >= now - 7 * DAY) add(week, r, taken, reworked, c)
    if (r.ts >= dayStart) add(today, r, taken, reworked, c)
  }
  return { today: finish(today), week: finish(week), total: finish(total) }
}

// The last `days` local days, oldest first, each with its own summary (for the graph).
export function byDay(records: readonly Entry[], now: number, days: number, c: Compare = null): ({ day: string } & Summary)[] {
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(startOfDay(now) - i * DAY + 12 * 3_600_000))
  const map = new Map(keys.map(k => [k, empty()]))
  const taken = takenSet(records)
  const reworked = reworkedSet(records)
  for (const r of records) {
    const s = map.get(dayKey(r.ts))
    if (s) add(s, r, taken, reworked, c)
  }
  return keys.map(day => ({ day, ...finish(map.get(day)!) }))
}

// The JSONL log as records; broken lines and unknown kinds are skipped. Fields of older versions
// (holdout, wanted, wantedWhere, trial; spawn records) are ignored: a held-back prompt was a keep.
export function parseLog(text: string): Entry[] {
  const out: Entry[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line)
      if (r && (r.kind === 'turn' || r.kind === 'decision' || r.kind === 'accept') && typeof r.ts === 'number') out.push(r)
    } catch {}
  }
  return out
}

export const KEEP_DAYS = 90
export const MAX_BYTES = 5_000_000

// The log trimmed for writing: no lines older than KEEP_DAYS, none broken, the oldest dropped over maxBytes.
export function rotate(text: string, now: number, maxBytes = MAX_BYTES): string {
  const lines = text.split('\n').filter(l => {
    try {
      const ts = JSON.parse(l)?.ts
      return typeof ts === 'number' && ts >= now - KEEP_DAYS * DAY
    } catch {
      return false
    }
  })
  let size = lines.reduce((n, l) => n + l.length + 1, 0)
  while (lines.length && size > maxBytes) size -= lines.shift()!.length + 1
  return lines.length ? `${lines.join('\n')}\n` : ''
}

// The log needs rotating: past maxBytes, or its first (oldest) line older than KEEP_DAYS.
export function needsRotate(firstLine: string, size: number, now: number, maxBytes = MAX_BYTES): boolean {
  if (size > maxBytes) return true
  try {
    const ts = JSON.parse(firstLine)?.ts
    return typeof ts !== 'number' || ts < now - KEEP_DAYS * DAY
  } catch {
    return firstLine.trim() !== ''
  }
}

// Records not written yet: one write at a time, in order, and a record leaves only once a write that
// carried it succeeded (a failed write keeps it for the next flush). Past max the oldest go.
export class Pending<T> {
  items: T[] = []
  private chain: Promise<void> = Promise.resolve()
  private max: number
  constructor(max = 5000) {
    this.max = max
  }

  push(r: T) {
    this.items.push(r)
    if (this.items.length > this.max) this.items = this.items.slice(-this.max)
  }

  flush(write: (batch: T[]) => Promise<void>): Promise<void> {
    const run = this.chain.then(async () => {
      const batch = this.items.slice()
      if (!batch.length) return
      await write(batch)
      const done = new Set(batch)
      this.items = this.items.filter(r => !done.has(r))
    })
    this.chain = run.catch(() => {})
    return run
  }
}

export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`

// "Opus medium" for a compare target, "the chat's first model" for null.
export function compareLabel(c: Compare): string {
  if (!c) return "the chat's first model"
  if ('mix' in c) return `your history (${mixLabel(c.mix)})`
  return targetLabel(c)
}

function targetLabel(c: { model: string; effort: Level }) {
  const m = knownModel(c.model)
  return `${m ? MODEL_NAMES[m] : c.model} ${NAMES[c.effort].toLowerCase()}`
}

// "70 % Opus high, 25 % Sonnet medium, 5 % Haiku medium"
export const mixLabel = (mix: readonly MixPart[]) => mix.map(p => `${Math.round(p.share * 100)} % ${targetLabel(p)}`).join(', ')

export const isReference = (c: Compare) => !!c && !('mix' in c) && knownModel(c.model) === REFERENCE.model && c.effort === REFERENCE.effort

// The rows of /router stats, shared by the text table and the pane. With a compare target the cost
// without router is that model's, and the reference row goes when it is the same yardstick.
export function statsRowList(c: Compare = null): readonly [string, (s: Summary) => string][] {
  const rows = STATS_ROWS.filter(([n]) => !(isReference(c) && n.startsWith('Vs. always')))
  return c ? rows.map(([n, f]) => [n === 'Cost without router' ? `Cost on ${'mix' in c ? 'your history' : compareLabel(c)}` : n, f] as const) : rows
}

export const STATS_ROWS: readonly [string, (s: Summary) => string][] = [
  ['Prompts routed', s => String(s.prompts)],
  ['Model changes', s => String(s.modelChanges)],
  ['Effort lower / higher', s => `${s.effortDown} / ${s.effortUp}`],
  ['Subagents', s => String(s.subagents)],
  ['New sessions', s => String(s.sessions)],
  ['Asked / declined', s => `${s.asked} / ${s.declined}`],
  ['Cost without router', s => usd(s.withoutUsd)],
  ['Cost with router', s => usd(s.actualUsd + s.classifierUsd)],
  ['Saved (cheaper model)', s => usd(s.savedUsd)],
  ['Extra cost (stronger model)', s => usd(-s.extraUsd)],
  ['Classifier', s => usd(-s.classifierUsd)],
  ['Balance', s => `${usd(s.balanceUsd)} (${Math.round(s.balancePct)} %)`],
  [`Vs. always ${REFERENCE.model} ${REFERENCE.effort}`, s => `${usd(s.vsReferenceUsd)} (${Math.round(s.vsReferencePct)} %)`],
  ['Cost per turn', s => usd(s.perTurnUsd)],
  ['Turns unknown / unpriced', s => `${s.unknownTurns} / ${s.unpricedTurns}`],
]

const FALLBACK = {
  pending: 'compareWith is history, but the sessions from before the router are still being counted: compared with Opus medium until then.',
  none: 'compareWith is history, but there are no sessions from before the router to count: compared with Opus medium.',
}

const NOTE_COMPARE = (c: Compare) => c && 'mix' in c
  ? `Compared with ${compareLabel(c)}: the models and efforts you ran before the router, weighted by their tokens (option compareWith: history). Each turn is priced on every part's model and the results weighted by its share; effort is not re-priced.`
  : c?.fallback
  ? FALLBACK[c.fallback]
  : c
  ? `Compared with ${compareLabel(c)} for every turn (option compareWith; first = the chat's first model): the same tokens priced on its model; effort is not re-priced.`
  : "Compared with the chat's first model (option compareWith: first)."

const NOTE =
  "An estimate: tokens × list prices in core/prices.ts. Cost without router prices each turn on the model it would have run on without the router; a routed subagent also counts the main chat's context its requests did not read; a turn after the router switched models counts the cache it rewrote. Balance = cost without router − cost with router (the work plus the classifier). Vs. always Opus medium prices the same tokens on Opus for every chat, whatever its own pick, minus the cost with router; cost per turn is the cost with router over the priced turns. Effort is not re-priced: how many tokens another effort would have taken is not known."

export const STATS_COLUMNS = ['Today', '7 days', 'Total'] as const

// Each row's label and its three cells (today, 7 days, total).
export function statsRows(r: Report, c: Compare = null): { label: string; cells: string[] }[] {
  return statsRowList(c).map(([label, f]) => ({ label, cells: [r.today, r.week, r.total].map(f) }))
}

// A plain text table of the three periods (for /router stats).
export function statsText(r: Report, c: Compare = null, b?: Balance): string {
  const rows = statsRows(r, c)
  const w = Math.max(...rows.map(x => x.label.length)) + 2
  const line = (n: string, cells: readonly string[]) => `${n.padEnd(w)}${cells.map((t, i) => (i < 2 ? t.padEnd(16) : t)).join('')}`
  return [
    line('', STATS_COLUMNS),
    ...rows.map(x => line(x.label, x.cells)),
    '',
    NOTE,
    NOTE_COMPARE(c),
    ...(b ? ['', balanceText(b)] : []),
  ].join('\n')
}

// The footer's short line for a day: the balance, or what the router cost; '' with nothing to show.
export function savingLabel(s: Summary): string {
  if (Math.abs(s.balanceUsd) < 0.005) return ''
  return s.balanceUsd > 0 ? `saved ${usd(s.balanceUsd)} today` : `router cost ${usd(-s.balanceUsd)} today`
}

// A self-contained page for /router stats: the three periods and the balance per day as bars.
export function statsHtml(r: Report, days: readonly ({ day: string } & Summary)[], c: Compare = null, b?: Balance): string {
  const W = 720
  const H = 200
  const pad = 24
  const max = Math.max(0.01, ...days.map(d => Math.abs(d.balanceUsd)))
  const hasNeg = days.some(d => d.balanceUsd < 0)
  const zero = hasNeg ? H / 2 : H - pad
  const scale = (hasNeg ? H / 2 - pad : H - 2 * pad) / max
  const bw = (W - 2 * pad) / Math.max(1, days.length)
  const bars = days
    .map((d, i) => {
      const h = Math.abs(d.balanceUsd) * scale
      const y = d.balanceUsd >= 0 ? zero - h : zero
      return `<rect class="bar ${d.balanceUsd >= 0 ? 'pos' : 'neg'}" x="${(pad + i * bw + 1).toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${h.toFixed(1)}"><title>${d.day}: ${usd(d.balanceUsd)}</title></rect>`
    })
    .join('')
  const first = days[0]?.day ?? ''
  const last = days.at(-1)?.day ?? ''
  const table = statsRowList(c).map(([n, f]) => `<tr><th>${n}</th>${[r.today, r.week, r.total].map(s => `<td>${f(s)}</td>`).join('')}</tr>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prompt Router stats</title>
<style>
:root { --bg: #faf9f5; --fg: #1f1e1d; --muted: #6b6a65; --line: #e3e1da; --pos: #2f7d4f; --neg: #c0533a; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --fg: #f0eee6; --muted: #a3a199; --line: #3a3936; --pos: #5dbb84; --neg: #e27a60; } }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
h2 { font-size: 17px; margin: 28px 0 4px; }
p { color: var(--muted); margin: 0 0 16px; }
.big { font-size: 32px; font-weight: 600; margin: 8px 0 16px; }
svg { width: 100%; height: auto; display: block; margin-bottom: 4px; }
.bar.pos { fill: var(--pos); } .bar.neg { fill: var(--neg); }
.axis { stroke: var(--line); }
.days { display: flex; justify-content: space-between; color: var(--muted); font-size: 12px; margin-bottom: 20px; }
.wrap { overflow-x: auto; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: right; padding: 6px 8px; border-bottom: 1px solid var(--line); white-space: nowrap; font-variant-numeric: tabular-nums; }
th:first-child { text-align: left; font-weight: 500; }
thead th { color: var(--muted); font-weight: 500; }
</style></head>
<body><main>
<h1>Prompt Router stats</h1>
<p>${NOTE} ${NOTE_COMPARE(c)}</p>
<div class="big">${usd(r.week.balanceUsd)} <span style="font-size:15px;font-weight:400;color:var(--muted)">balance, last 7 days</span></div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance per day"><line class="axis" x1="${pad}" x2="${W - pad}" y1="${zero}" y2="${zero}"/>${bars}</svg>
<div class="days"><span>${first}</span><span>balance per day</span><span>${last}</span></div>
<div class="wrap"><table><thead><tr><th></th><th>Today</th><th>7 days</th><th>Total</th></tr></thead><tbody>${table}</tbody></table></div>
${b ? balanceHtml(b) : ''}
</main></body></html>
`
}

// A dollar amount with its sign always shown: +$0.42 saved, −$0.14 lost.
// Tokens in words that fit a tile: 950, 48 k, 7.1 M.
const tokensWord = (t: number) => (t >= 1e6 ? `${(t / 1e6).toFixed(1)} M` : t >= 1e3 ? `${Math.round(t / 1e3)} k` : String(Math.round(t)))

// What 1 % of the weekly limit costs at list price, read off the person's own plan: between two readings
// of the weekly fill in the same window, the list price of everything logged in between (turns and the
// classifier) against how far the fill moved. Pairs across a reset or going down are left out. Use the
// plan has outside the log (claude.ai, other apps) moves the fill too, so the figure leans low.
// null until the fill moved at least MIN_PCT points.
export const MIN_PCT = 2
export function limitRate(records: readonly Entry[]): number | null {
  const sorted = [...records].sort((a, b) => a.ts - b.ts)
  let usdSum = 0
  let pctSum = 0
  let last: { pct: number; resets?: string } | null = null
  let between = 0
  for (const r of sorted) {
    if (r.kind === 'turn') between += turnUsd(r)
    else if (r.kind === 'decision') between += classifierUsd(r)
    if (r.kind !== 'turn' || !r.week) continue
    if (last && last.resets === r.week.resets && r.week.pct >= last.pct) {
      usdSum += between
      pctSum += r.week.pct - last.pct
    }
    last = r.week
    between = 0
  }
  return pctSum >= MIN_PCT && usdSum > 0 ? usdSum / pctSum : null
}

const pctWord = (p: number) => (p < 10 ? p.toFixed(1) : String(Math.round(p)))

// The pane's "What you got" card: what the router gave the person in the period, each a figure and one
// line on it; only figures with data show. With `perPct` (limitRate) money also reads as a share of the
// person's weekly limit; without it, as a share of what the work would have cost without the router.
export function glance(s: Summary, window = 200_000, perPct: number | null = null): { key: string; label: string; value: string; sub: string }[] {
  const out: { key: string; label: string; value: string; sub: string }[] = []
  const pctOf = (v: number) => (s.withoutUsd > 0 ? Math.round((Math.abs(v) / s.withoutUsd) * 100) : 0)
  const week = (v: number) => `≈ ${pctWord(Math.abs(v) / perPct!)} % of your weekly limit`
  if (s.offloadTokens >= 1000) {
    const full = Math.floor(s.offloadTokens / window)
    out.push({ key: 'offload', label: 'Kept out of your chat', value: `${tokensWord(s.offloadTokens)} tokens`, sub: `read by subagents instead${full >= 1 ? `, ≈ ${full} full ${full === 1 ? 'context' : 'contexts'}` : ''}` })
  }
  if (s.savedUsd >= 0.005) {
    const extra = s.extraUsd >= 0.005 ? `; stronger picks used ${usd(s.extraUsd)}` : ''
    out.push({ key: 'cheaper', label: 'Cheaper picks saved', value: usd(s.savedUsd), sub: `${perPct ? week(s.savedUsd) : 'at list price'}${extra}` })
  }
  if (s.withoutUsd >= 0.01) {
    const more = s.balanceUsd < 0
    out.push(perPct
      ? { key: 'limit', label: `Weekly limit, all in`, value: `≈ ${pctWord(Math.abs(s.balanceUsd) / perPct)} % ${more ? 'more' : 'less'}`, sub: `${signed(s.balanceUsd)}; 1 % of your limit ≈ ${usd(perPct)}, measured` }
      : { key: 'limit', label: 'Cost, all in', value: `${pctOf(s.balanceUsd)} % ${more ? 'more' : 'less'}`, sub: `${signed(s.balanceUsd)} than without the router; your weekly limit shows once it has moved ${MIN_PCT} %` })
  }
  return out
}

export const signed = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`

// Below this many routed tasks the balance is a rough figure (a few tasks can swing it either way).
export const ROUGH_BELOW = 12

export const isRough = (b: Balance | null) => !!b && b.routed < ROUGH_BELOW

// The short line for the footer: the money, with "~" while it stands on few tasks. '' with nothing to show.
export function balanceLabel(b: Balance): string {
  if (!b.routed && Math.abs(b.usd) < 0.005) return ''
  return `${isRough(b) ? '~' : ''}${signed(b.usd)}`
}

// How many tasks the balance stands on, for a tooltip or a dim line.
export const sampleNote = (b: Balance) => `${b.routed} routed ${b.routed === 1 ? 'task' : 'tasks'}${isRough(b) ? ' · few tasks, rough' : ''}`

// The balance's parts with their labels, in the order they add up.
export const balanceParts = (b: Balance) => [
  ['cheaper', 'Cheaper picks', b.parts.cheaper],
  ['escalation', 'Higher picks', b.parts.escalation],
  ['rework', 'Re-work', b.parts.rework],
  ['classifier', 'Classifier', b.parts.classifier],
] as const

export const accuracyText = (b: Balance) => (b.accuracy ? `${Math.round(b.accuracy.pct)} % (95 %: ${Math.round(b.accuracy.low)}–${Math.round(b.accuracy.high)} %)` : '–')

// The per-model table as rows of cells, header first.
export function modelTable(b: Balance): string[][] {
  return [
    ['Model', 'Tasks', '$/task', 'Re-work', 'Min/task'],
    ...b.byModel.map(r => [r.model, String(r.tasks), usd(r.usdPerTask), `${Math.round(r.reworkPct)} %`, r.minutesPerTask === null ? '–' : r.minutesPerTask.toFixed(1)]),
  ]
}

const BALANCE_NOTE =
  'Per task: a routed task (its prompt, the prompts that fixed or went on with it, its subagents, the classifier), its turns priced on the model they would have run on without the router, as in the table above. Re-work: the later prompts of a task whose answer failed, by the failure weight. Accuracy: the share of routed tasks with no sign of failure.'

// /router stats: the balance per task, under the token table.
export function balanceText(b: Balance): string {
  const lines = [
    'Per task (total, estimated)',
    `Money      ${signed(b.usd)}`,
    ...balanceParts(b).map(([, label, v]) => `  ${label.padEnd(15)}${signed(v)}`),
    `Accuracy   ${accuracyText(b)}`,
    sampleNote(b),
  ]
  const t = modelTable(b)
  if (t.length > 1) {
    const w = t[0]!.map((_, i) => Math.max(...t.map(r => r[i]!.length)) + 2)
    lines.push('', ...t.map(r => r.map((c, i) => c.padEnd(w[i]!)).join('').trimEnd()))
  }
  return [...lines, '', BALANCE_NOTE].join('\n')
}

function balanceHtml(b: Balance): string {
  const t = modelTable(b)
  const table = t.length > 1 ? `<div class="wrap"><table><thead><tr>${t[0]!.map(c => `<th>${c}</th>`).join('')}</tr></thead><tbody>${t.slice(1).map(r => `<tr>${r.map((c, i) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</tbody></table></div>` : ''
  const parts = balanceParts(b).map(([, label, v]) => `<tr><th>${label}</th><td>${signed(v)}</td></tr>`).join('')
  return `<h2>Per task</h2>
<div class="big">${isRough(b) ? '~' : ''}${signed(b.usd)} <span style="font-size:15px;font-weight:400;color:var(--muted)">total, estimated</span></div>
<p>${sampleNote(b)}</p>
<div class="wrap"><table><tbody>${parts}<tr><th>Accuracy</th><td>${accuracyText(b)}</td></tr></tbody></table></div>
${table}
<p>${BALANCE_NOTE}</p>`
}
