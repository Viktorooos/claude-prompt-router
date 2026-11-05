// Savings summary from the stats log. Pure functions: the platforms write the records, this reads them.
// Every dollar is an estimate from core/prices.ts. Honest by design: the classifier's cost comes off
// the saving, a stronger model is shown as extra cost, an effort change is priced apart as a guess, and
// the balance takes all of them in.
import { LEVELS, MODEL_NAMES, NAMES, above, knownModel } from './router.ts'
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
  /** The prompt's normalized text (promptKey): the same key again means the same question came back. */
  key?: string
  /** What the classifier read of the prompt: a fix of the last answer, the next step, or new work. */
  follows?: 'continues' | 'corrects' | 'new'
  outcome: 'applied' | 'asked' | 'declined'
  classifier?: { model: string; usage: Usage; usd?: number; ms?: number }
  /** A control-group prompt: the router would have moved it to `wanted` but kept the setting (`where: 'keep'`). */
  holdout?: true
  wanted?: Side
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
}

// The user took an asked decision (switched, or ran the suggested subagent). `decision` is its `ts`.
export type Accept = { kind: 'accept'; ts: number; platform: string; chat: string; decision: number }

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
  /** What the effort changes saved (+) or cost (−): an estimate from EFFORT_OUTPUT. */
  effortUsd: number
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
  tokens: { [model: string]: Usage }
}

export type Report = { today: Summary; week: Summary; total: Summary }

const DAY = 86_400_000

function empty(): Summary {
  return {
    prompts: 0, modelChanges: 0, effortDown: 0, effortUp: 0, subagents: 0, sessions: 0, asked: 0, declined: 0,
    actualUsd: 0, withoutUsd: 0, savedUsd: 0, extraUsd: 0, effortUsd: 0, classifierUsd: 0, netUsd: 0, netPct: 0, balanceUsd: 0, balancePct: 0,
    referenceUsd: 0, vsReferenceUsd: 0, vsReferencePct: 0, pricedTurns: 0, perTurnUsd: 0,
    unknownTurns: 0, unpricedTurns: 0, routed: 0, rework: 0, accuracyPct: null, tokens: {},
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

// Rough weight of output tokens per effort level: more effort thinks longer, and thinking is billed as
// output. A guess, not a measurement, so what it prices is shown apart as an estimate.
export const EFFORT_OUTPUT: Record<Level, number> = { low: 0.5, medium: 0.75, high: 1, xhigh: 1.4, max: 2 }

// A level EFFORT_OUTPUT knows; anything else (a hand-edited log) counts as no effort info.
const knownEffort = (e: unknown): e is Level => (LEVELS as readonly unknown[]).includes(e)

// How much more output the turn would have made at the person's own effort; 1 when it did not change or is unknown.
function effortScale(t: Turn) {
  return knownEffort(t.effort) && knownEffort(t.baseEffort) && t.effort !== t.baseEffort ? EFFORT_OUTPUT[t.baseEffort] / EFFORT_OUTPUT[t.effort] : 1
}

// The fixed yardstick: the balance above depends on the chat's own first pick (a Haiku-low chat
// always looks like a loss when the router escalates), this one is the same for every chat. Opus at
// medium effort is the default setup, so the number says whether routing beats leaving it alone.
export const REFERENCE: { model: string; effort: Level } = { model: 'opus', effort: 'medium' }

// The output the turn would have made at REFERENCE's effort; 1 when the turn's effort is unknown.
function referenceScale(t: Turn) {
  return knownEffort(t.effort) ? EFFORT_OUTPUT[REFERENCE.effort] / EFFORT_OUTPUT[t.effort] : 1
}

// The tokens the same work would have taken without the router (`scale`: the effort's share of the
// output); the turn's own when nothing differs.
function withoutUsage(t: Turn, u: Usage, scale = 1): Usage {
  const carried = (t.mainContext ?? 0) * (t.requests ?? 0)
  if (!carried && !t.switched && scale === 1) return u
  return {
    input: u.input ?? 0,
    output: (u.output ?? 0) * scale,
    cacheRead: (u.cacheRead ?? 0) + carried + (t.switched ? (u.cacheWrite ?? 0) : 0),
    cacheWrite: t.switched ? 0 : (u.cacheWrite ?? 0),
  }
}

// What the savings are measured against (option compareWith): a model at an effort for every turn,
// or null for each turn's own `baseline` (the chat's first model). Applied when the log is read, so a
// new choice reprices the old turns too.
export type Compare = { model: string; effort: Level } | null

// The turn as if it would have run on `c` without the router. A turn with no known effort (a
// subagent) keeps its output: only the model is repriced.
function against(t: Turn, c: Compare): Turn {
  return c ? { ...t, baseline: c.model, baseEffort: c.effort } : t
}

function addTurn(s: Summary, turn: Turn, c: Compare) {
  const t = against(turn, c)
  if (!t.usage) {
    s.unknownTurns++
    return
  }
  const sum = (s.tokens[t.model] ??= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  for (const k of ['input', 'output', 'cacheRead', 'cacheWrite'] as const) sum[k] += t.usage[k] ?? 0
  const listActual = cost(t.usage, t.model)
  const actual = t.usd ?? listActual
  if (actual === null) {
    s.unpricedTurns++
    return
  }
  s.actualUsd += actual
  s.pricedTurns++
  s.referenceUsd += cost(withoutUsage(t, t.usage, referenceScale(t)), REFERENCE.model) ?? actual
  const scale = effortScale(t)
  const sameEffort = withoutUsage(t, t.usage)
  if (t.model === t.baseline && sameEffort === t.usage && scale === 1) {
    s.withoutUsd += actual
    return
  }
  // The saving compares list prices on both sides; without one of them, no saving is claimed.
  const listModel = cost(sameEffort, t.baseline)
  const listWithout = scale === 1 ? listModel : cost(withoutUsage(t, t.usage, scale), t.baseline)
  if (listActual === null || listModel === null || listWithout === null) {
    s.unpricedTurns++
    s.withoutUsd += actual
    return
  }
  // The model's part and the effort's part apart: the effort's is the guess.
  const diff = listModel - listActual
  const effortDiff = listWithout - listModel
  s.withoutUsd += actual + diff + effortDiff
  if (diff > 0) s.savedUsd += diff
  else s.extraUsd -= diff
  s.effortUsd += effortDiff
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
  return new Set(records.filter((r): r is Accept => r.kind === 'accept').map(r => takenKey(r.chat, r.decision)))
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

// Re-work: a routed prompt whose same text (`key`) comes again within the next few prompts of the chat,
// whose next prompt corrects it, whose next prompt ran after a switch up by hand, or whose answer was
// cut off. A guess: a repeat can also be a second try at the same question on purpose.
const REWORK_WINDOW = 3

function reworkedSet(records: readonly Entry[]) {
  const byChat = new Map<string, { decisions: Decision[]; turns: Turn[] }>()
  for (const r of records) {
    if (r.kind === 'accept' || (r.kind === 'turn' && !main(r))) continue
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
      if (next[0]?.follows === 'corrects') reasons.push('corrected')
      if (next[0] && turns.some(t => t.manual && t.ts >= next[0]!.ts && t.ts < until(1))) reasons.push('switched')
      if (answer && !answer.usage) reasons.push('interrupted')
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
function startsEpisode(d: Decision, cur: Episode) {
  if (d.ts - cur.end > EPISODE_GAP) return true
  if (d.key && cur.decisions.some(x => x.key === d.key)) return false
  return d.follows === undefined || d.follows === 'new'
}

// The records grouped into tasks, per chat, oldest first by where each task started.
export function episodes(records: readonly Entry[]): Episode[] {
  const byChat = new Map<string, (Decision | Turn)[]>()
  for (const r of records) {
    if (r.kind === 'accept') continue
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
  if (e.decisions.slice(1).some(d => d.follows === 'corrects')) reasons.push('corrected')
  const answers = e.turns.filter(main)
  if (answers.slice(1).some(t => t.manual)) reasons.push('switched')
  if (answers.some(t => !t.usage)) reasons.push('interrupted')
  return failure(reasons)
}

// A class of tasks: where the router sent it and the model it picked (for a control task, the model
// it would have picked). Control tasks exist only for `here`, so other classes always fall back.
const classOf = (where: string, model: string) => `${where}:${model}`

// Control tasks a class needs before its medians replace the token re-pricing.
export const MIN_CONTROL = 5

const turnUsd = (t: Turn) => (t.usage ? (t.usd ?? cost(t.usage, t.model) ?? 0) : 0)
const turnsUsd = (ts: readonly Turn[]) => ts.reduce((n, t) => n + turnUsd(t), 0)
const turnsMs = (ts: readonly Turn[]) => ts.filter(main).reduce((n, t) => n + (t.durationMs ?? 0), 0)
const classifierMs = (ds: readonly Decision[]) => ds.reduce((n, d) => n + (d.classifier?.ms ?? 0), 0)
// Whether the task's main turns carry their times (older records and some platforms do not).
const timed = (ts: readonly Turn[]) => ts.some(t => main(t) && t.durationMs !== undefined)

// The q-quantile of sorted values, linear between neighbours.
function quantile(sorted: readonly number[], q: number) {
  const i = (sorted.length - 1) * q
  const lo = Math.floor(i)
  return sorted[lo]! + (sorted[Math.min(lo + 1, sorted.length - 1)]! - sorted[lo]!) * (i - lo)
}

type Spread = { q1: number; median: number; q3: number }

function spread(values: number[]): Spread {
  const s = [...values].sort((a, b) => a - b)
  return { q1: quantile(s, 0.25), median: quantile(s, 0.5), q3: quantile(s, 0.75) }
}

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

// A range with its point: low and high from the control quartiles (equal to the point where the
// re-pricing stood in).
export type Range = { value: number; low: number; high: number }

export type ModelRow = { model: string; tasks: number; control: number; usdPerTask: number; reworkPct: number; minutesPerTask: number | null }

export type Balance = {
  /** Tasks the router changed (model, effort, subagent, session), and control tasks. */
  routed: number
  control: number
  /** Routed tasks priced against control medians, and those priced by the token re-pricing. */
  measured: number
  estimated: number
  /** Routed tasks whose time was compared with control times (0 = the time is not measured yet). */
  timed: number
  /** Money and minutes the router saved (+) or cost (−) against no router, classifier included. */
  usd: Range
  minutes: Range
  /** usd split: cheaper picks, higher picks (escalation), re-work after a failed answer, classifier. */
  parts: { cheaper: number; escalation: number; rework: number; classifier: number }
  /** Share of routed tasks that did the job (weighted failures), with its Wilson interval. */
  accuracy: { pct: number; low: number; high: number } | null
  byModel: ModelRow[]
}

// The router's balance per task. A routed task is compared with the median control task of its class
// (what the same kind of task cost and took with the person's own setting); with fewer than
// MIN_CONTROL control tasks, with today's token re-pricing and no saving of time, counted in
// `estimated`. A task's later prompts after a failure count as re-work, by the failure's weight.
// `since`: only tasks that started then or later count; the control medians always use every record.
export function balance(records: readonly Entry[], since = -Infinity): Balance {
  const taken = takenSet(records)
  const changed = (d: Decision) => routedDecision(d) || (d.outcome === 'asked' && taken.has(takenKey(d.chat, d.ts)))
  const eps = episodes(records).filter(e => e.decisions.length)
  const control = new Map<string, { usd: number[]; ms: number[] }>()
  for (const e of eps) {
    const d = e.decisions[0]!
    if (!d.holdout || !d.wanted) continue
    const k = classOf('here', d.wanted.model)
    const c = control.get(k) ?? { usd: [], ms: [] }
    control.set(k, c)
    // Without the router there is no classifier: only the turns count.
    c.usd.push(turnsUsd(e.turns))
    if (timed(e.turns)) c.ms.push(turnsMs(e.turns))
  }
  const usdSpread = new Map([...control].filter(([, c]) => c.usd.length >= MIN_CONTROL).map(([k, c]) => [k, spread(c.usd)]))
  const msSpread = new Map([...control].filter(([, c]) => c.ms.length >= MIN_CONTROL).map(([k, c]) => [k, spread(c.ms)]))

  const out: Balance = {
    routed: 0, control: 0, measured: 0, estimated: 0, timed: 0,
    usd: { value: 0, low: 0, high: 0 }, minutes: { value: 0, low: 0, high: 0 },
    parts: { cheaper: 0, escalation: 0, rework: 0, classifier: 0 }, accuracy: null, byModel: [],
  }
  const rows = new Map<string, { tasks: number; control: number; usd: number; rework: number; ms: number; timed: number }>()
  const row = (m: string) => rows.get(m) ?? (rows.set(m, { tasks: 0, control: 0, usd: 0, rework: 0, ms: 0, timed: 0 }), rows.get(m)!)
  let fails = 0
  let msLow = 0
  let msHigh = 0
  let msSaved = 0
  let usdLow = 0
  let usdHigh = 0
  for (const e of eps) {
    if (e.start < since) continue
    const d = e.decisions[0]!
    const clsUsd = e.decisions.reduce((n, x) => n + classifierUsd(x), 0)
    const clsMs = classifierMs(e.decisions)
    out.parts.classifier -= clsUsd
    msSaved -= clsMs
    msLow -= clsMs
    msHigh -= clsMs
    if (d.holdout && d.wanted) {
      out.control++
      row(d.wanted.model).control++
      continue
    }
    if (!changed(d)) continue
    out.routed++
    const f = failureOf(e).weight
    fails += f
    const actual = turnsUsd(e.turns)
    const later = e.decisions[1] ? turnsUsd(e.turns.filter(t => t.ts >= e.decisions[1]!.ts)) : 0
    const rework = f * later
    const k = classOf(d.where, d.to.model)
    // A subagent or session on the same model is cheaper (a fresh context); on a stronger one it is an escalation.
    const down = above(d.from.model, d.to.model) || (d.from.model === d.to.model && (d.where !== 'here' || above(d.from.effort, d.to.effort)))
    // Control tasks are only held back from a move down (neither the model nor the effort higher), so
    // an escalation, even a partial one, is never measured against them.
    const lower = down && !above(d.to.model, d.from.model) && !above(d.to.effort, d.from.effort)
    const cu = lower ? usdSpread.get(k) : undefined
    let without: Spread
    if (cu) {
      out.measured++
      without = cu
    } else {
      out.estimated++
      const s = empty()
      for (const t of e.turns) addTurn(s, t, null)
      without = { q1: s.withoutUsd, median: s.withoutUsd, q3: s.withoutUsd }
    }
    const firstGain = without.median - (actual - rework)
    if (down) out.parts.cheaper += firstGain
    else out.parts.escalation += firstGain
    out.parts.rework -= rework
    usdLow += without.q1 - actual
    usdHigh += without.q3 - actual
    const ms = turnsMs(e.turns)
    const cm = lower && timed(e.turns) ? msSpread.get(k) : undefined
    if (cm) {
      out.timed++
      msSaved += cm.median - ms
      msLow += cm.q1 - ms
      msHigh += cm.q3 - ms
    }
    const r = row(d.to.model)
    r.tasks++
    r.usd += actual + clsUsd
    r.rework += f
    if (timed(e.turns)) {
      r.ms += ms + clsMs
      r.timed++
    }
  }
  const p = out.parts
  out.usd.value = p.cheaper + p.escalation + p.rework + p.classifier
  out.usd.low = usdLow + p.classifier
  out.usd.high = usdHigh + p.classifier
  out.minutes = { value: msSaved / 60_000, low: msLow / 60_000, high: msHigh / 60_000 }
  if (out.routed) {
    const w = wilson(out.routed - fails, out.routed)
    out.accuracy = { pct: (1 - fails / out.routed) * 100, low: w.low * 100, high: w.high * 100 }
  }
  out.byModel = [...rows].map(([model, r]) => ({
    model, tasks: r.tasks, control: r.control,
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

function add(s: Summary, r: Entry, taken: Set<string>, reworked: Map<string, Failure>, c: Compare) {
  if (r.kind === 'turn') addTurn(s, r, c)
  else if (r.kind === 'decision') {
    addDecision(s, r, taken.has(takenKey(r.chat, r.ts)))
    s.classifierUsd += classifierUsd(r)
    if (routedDecision(r)) {
      s.routed++
      s.rework += reworked.get(takenKey(r.chat, r.ts))?.weight ?? 0
    }
  }
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

// The JSONL log as records; broken lines and unknown kinds are skipped.
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

export const usd = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toFixed(2)}`

// "Opus medium" for a compare target, "the chat's first model" for null.
export function compareLabel(c: Compare): string {
  if (!c) return "the chat's first model"
  const m = knownModel(c.model)
  return `${m ? MODEL_NAMES[m] : c.model} ${NAMES[c.effort].toLowerCase()}`
}

export const isReference = (c: Compare) => !!c && knownModel(c.model) === REFERENCE.model && c.effort === REFERENCE.effort

// The rows of /router stats, shared by the text table and the pane. With a compare target the cost
// without router is that model's, and the reference row goes when it is the same yardstick.
export function statsRowList(c: Compare = null): readonly [string, (s: Summary) => string][] {
  const rows = STATS_ROWS.filter(([n]) => !(isReference(c) && n.startsWith('Vs. always')))
  return c ? rows.map(([n, f]) => [n === 'Cost without router' ? `Cost on ${compareLabel(c)}` : n, f] as const) : rows
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
  ['Effort (estimate)', s => usd(s.effortUsd)],
  ['Classifier', s => usd(-s.classifierUsd)],
  ['Balance', s => `${usd(s.balanceUsd)} (${Math.round(s.balancePct)} %)`],
  [`Vs. always ${REFERENCE.model} ${REFERENCE.effort}`, s => `${usd(s.vsReferenceUsd)} (${Math.round(s.vsReferencePct)} %)`],
  ['Cost per turn', s => usd(s.perTurnUsd)],
  ['Turns unknown / unpriced', s => `${s.unknownTurns} / ${s.unpricedTurns}`],
]

const NOTE_COMPARE = (c: Compare) => c
  ? `Compared with ${compareLabel(c)} for every turn (option compareWith; first = the chat's first model): the same tokens priced on it, the output weighted to its effort (a guess); a turn with no known effort is priced at its own output.`
  : "Compared with the chat's first model (option compareWith: first)."

const NOTE =
  "An estimate: tokens × list prices in core/prices.ts. Cost without router prices each turn on the model and effort it would have run at without the router; a routed subagent also counts the main chat's context its requests did not read; a turn after the router switched models counts the cache it rewrote. Balance = cost without router − cost with router (the work plus the classifier). Vs. always Opus medium prices the same work on Opus at medium effort for every chat, whatever its own pick, minus the cost with router; cost per turn is the cost with router over the priced turns. Effort is a guess (output tokens weighted per level); work moved to a new session is not priced."

export const STATS_COLUMNS = ['Today', '7 days', 'Total'] as const

// Each row's label and its three cells (today, 7 days, total).
export function statsRows(r: Report, c: Compare = null): { label: string; cells: string[] }[] {
  return statsRowList(c).map(([label, f]) => ({ label, cells: [r.today, r.week, r.total].map(f) }))
}

// A plain text table of the three periods (for /router stats and the Codex and OpenCode adapters).
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
export const signed = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`

// Minutes as "45 min" or "2 h 10 min".
export function minutes(m: number) {
  const t = Math.round(Math.abs(m))
  return t < 60 ? `${t} min` : `${Math.floor(t / 60)} h${t % 60 ? ` ${t % 60} min` : ''}`
}

// Time the router saved or lost, in words (a sign on time reads both ways).
export const timeText = (m: number) => (Math.round(Math.abs(m)) === 0 ? 'no time' : `${minutes(m)} ${m > 0 ? 'saved' : 'lost'}`)

// Below this many routed tasks the balance is a rough figure even when every task met its control.
export const ROUGH_BELOW = 12

// A rough balance: few tasks, or some priced by the token re-pricing instead of the control group.
export const isRough = (b: Balance) => b.estimated > 0 || b.routed < ROUGH_BELOW

// The short line for the footer: money, then time once it is measured; "~" marks a rough
// figure. '' with nothing to show.
export function balanceLabel(b: Balance): string {
  if (!b.routed && Math.abs(b.usd.value) < 0.005) return ''
  return `${isRough(b) ? '~' : ''}${signed(b.usd.value)}${b.timed ? ` · ${timeText(b.minutes.value)}` : ''}`
}

// How many tasks the balance stands on, for a tooltip or a dim line.
export function sampleNote(b: Balance): string {
  const how = b.routed ? ` (${b.measured} against the control group${b.estimated ? `, ${b.estimated} estimated from tokens` : ''})` : ''
  return `${b.routed} routed tasks${how} · ${b.control} control tasks${isRough(b) ? ' · rough estimate' : ''}`
}

const range = (r: Range, f: (n: number) => string) => (r.low === r.high ? '' : ` (${f(r.low)} to ${f(r.high)})`)

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
    ['Model', 'Tasks', 'Control', '$/task', 'Re-work', 'Min/task'],
    ...b.byModel.map(r => [r.model, String(r.tasks), String(r.control), usd(r.usdPerTask), `${Math.round(r.reworkPct)} %`, r.minutesPerTask === null ? '–' : r.minutesPerTask.toFixed(1)]),
  ]
}

const BALANCE_NOTE =
  'Per task: a routed task (its prompt, the prompts that fixed or went on with it, the classifier) against the median control task of its class, a prompt the router would have moved the same way but left alone (option holdoutPct). The range comes from the control quartiles. With fewer than 5 control tasks in a class the task is priced by the token re-pricing above instead, and its time counts as unchanged. Re-work: the later prompts of a task whose answer failed, by the failure weight.'

// /router stats: the balance per task, under the token table.
export function balanceText(b: Balance): string {
  const lines = [
    'Per task, against the control group (total)',
    `Money      ${signed(b.usd.value)}${range(b.usd, signed)}`,
    `Time       ${b.timed ? `${timeText(b.minutes.value)}${range(b.minutes, timeText)}` : 'not measured yet'}`,
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
  return `<h2>Per task, against the control group</h2>
<div class="big">${isRough(b) ? '~' : ''}${signed(b.usd.value)} <span style="font-size:15px;font-weight:400;color:var(--muted)">${b.timed ? timeText(b.minutes.value) : 'time not measured yet'} · total</span></div>
<p>${sampleNote(b)}${range(b.usd, signed) ? ` · range${range(b.usd, signed)}` : ''}</p>
<div class="wrap"><table><tbody>${parts}<tr><th>Accuracy</th><td>${accuracyText(b)}</td></tr></tbody></table></div>
${table}
<p>${BALANCE_NOTE}</p>`
}
