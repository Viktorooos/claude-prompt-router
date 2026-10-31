// Savings summary from the stats log. Pure functions: the platforms write the records, this reads them.
// Every dollar is an estimate from core/prices.ts. Honest by design: the classifier's cost comes off
// the saving, a stronger model is shown as extra cost (never hidden in the net), effort only as counts.
import { LEVELS } from './router.ts'
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
  outcome: 'applied' | 'asked' | 'declined'
  classifier?: { model: string; usage: Usage; usd?: number }
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
  classifierUsd: number
  /** savedUsd minus classifierUsd. */
  netUsd: number
  /** netUsd as a percent of withoutUsd; 0 when nothing was priced. */
  netPct: number
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
    actualUsd: 0, withoutUsd: 0, savedUsd: 0, extraUsd: 0, classifierUsd: 0, netUsd: 0, netPct: 0,
    unknownTurns: 0, unpricedTurns: 0, tokens: {},
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

function addTurn(s: Summary, t: Turn) {
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
  if (t.model === t.baseline) {
    s.withoutUsd += actual
    return
  }
  // The saving compares list prices on both sides; without one of them, no saving is claimed.
  const listWithout = cost(t.usage, t.baseline)
  if (listActual === null || listWithout === null) {
    s.unpricedTurns++
    s.withoutUsd += actual
    return
  }
  const diff = listWithout - listActual
  s.withoutUsd += actual + diff
  if (diff > 0) s.savedUsd += diff
  else s.extraUsd -= diff
}

function finish(s: Summary): Summary {
  s.netUsd = s.savedUsd - s.classifierUsd
  s.netPct = s.withoutUsd > 0 ? (s.netUsd / s.withoutUsd) * 100 : 0
  return s
}

const takenKey = (chat: string, ts: number) => `${chat}\n${ts}`

function takenSet(records: readonly Entry[]) {
  return new Set(records.filter((r): r is Accept => r.kind === 'accept').map(r => takenKey(r.chat, r.decision)))
}

function add(s: Summary, r: Entry, taken: Set<string>) {
  if (r.kind === 'turn') addTurn(s, r)
  else if (r.kind === 'decision') {
    addDecision(s, r, taken.has(takenKey(r.chat, r.ts)))
    s.classifierUsd += classifierUsd(r)
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
export function summarize(records: readonly Entry[], now: number): Report {
  const today = empty()
  const week = empty()
  const total = empty()
  const dayStart = startOfDay(now)
  const taken = takenSet(records)
  for (const r of records) {
    add(total, r, taken)
    if (r.ts >= now - 7 * DAY) add(week, r, taken)
    if (r.ts >= dayStart) add(today, r, taken)
  }
  return { today: finish(today), week: finish(week), total: finish(total) }
}

// The last `days` local days, oldest first, each with its own summary (for the graph).
export function byDay(records: readonly Entry[], now: number, days: number): ({ day: string } & Summary)[] {
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(startOfDay(now) - i * DAY + 12 * 3_600_000))
  const map = new Map(keys.map(k => [k, empty()]))
  const taken = takenSet(records)
  for (const r of records) {
    const s = map.get(dayKey(r.ts))
    if (s) add(s, r, taken)
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

// A plain text table of the three periods (for /router stats and the Codex and OpenCode adapters).
export function statsText(r: Report): string {
  const cols = [r.today, r.week, r.total]
  const rows: [string, (s: Summary) => string][] = [
    ['Prompts routed', s => String(s.prompts)],
    ['Model changes', s => String(s.modelChanges)],
    ['Effort lower / higher', s => `${s.effortDown} / ${s.effortUp}`],
    ['Subagents', s => String(s.subagents)],
    ['New sessions', s => String(s.sessions)],
    ['Asked / declined', s => `${s.asked} / ${s.declined}`],
    ['Cost', s => usd(s.actualUsd)],
    ['Cost without router', s => usd(s.withoutUsd)],
    ['Saved (cheaper model)', s => usd(s.savedUsd)],
    ['Classifier', s => usd(-s.classifierUsd)],
    ['Net saving', s => `${usd(s.netUsd)} (${Math.round(s.netPct)} %)`],
    ['Extra cost (stronger model)', s => usd(s.extraUsd)],
    ['Turns unknown / unpriced', s => `${s.unknownTurns} / ${s.unpricedTurns}`],
  ]
  const w = Math.max(...rows.map(([n]) => n.length)) + 2
  const cell = (t: string) => t.padEnd(16)
  return [
    `${''.padEnd(w)}${cell('Today')}${cell('7 days')}Total`,
    ...rows.map(([n, f]) => `${n.padEnd(w)}${cols.map((s, i) => (i < 2 ? cell(f(s)) : f(s))).join('')}`),
    '',
    'An estimate: tokens × list prices in core/prices.ts. The saving compares each turn with the model it would have run on without the router; the classifier is taken off; a stronger model is extra cost, not in the net; effort changes are counts only.',
  ].join('\n')
}

// The footer's short line for a day: the net saving, or what the router cost; '' with nothing to show.
export function savingLabel(s: Summary): string {
  if (Math.abs(s.netUsd) < 0.005) return ''
  return s.netUsd > 0 ? `saved ${usd(s.netUsd)} today` : `router cost ${usd(-s.netUsd)} today`
}
