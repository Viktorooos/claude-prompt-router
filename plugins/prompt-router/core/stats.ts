// Savings summary from the stats log. Pure functions: the platforms write the records, this reads them.
// Every dollar is an estimate from core/prices.ts. Honest by design: the classifier's cost comes off
// the saving, a stronger model is shown as extra cost, an effort change is priced apart as a guess, and
// the balance takes all of them in.
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
  /** The prompt's normalized text (promptKey): the same key again means the same question came back. */
  key?: string
  /** What the classifier read of the prompt: a fix of the last answer, the next step, or new work. */
  follows?: 'continues' | 'corrects' | 'new'
  outcome: 'applied' | 'asked' | 'declined'
  classifier?: { model: string; usage: Usage; usd?: number; ms?: number }
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
  /** Routed prompts that came again soon after (see reworkedSet). */
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

// How much more output the turn would have made at the person's own effort; 1 when it did not change.
function effortScale(t: Turn) {
  return t.effort && t.baseEffort && t.effort !== t.baseEffort ? EFFORT_OUTPUT[t.baseEffort] / EFFORT_OUTPUT[t.effort] : 1
}

// The fixed yardstick: the balance above depends on the chat's own first pick (a Haiku-low chat
// always looks like a loss when the router escalates), this one is the same for every chat. Opus at
// medium effort is the default setup, so the number says whether routing beats leaving it alone.
export const REFERENCE: { model: string; effort: Level } = { model: 'opus', effort: 'medium' }

// The output the turn would have made at REFERENCE's effort; 1 when the turn's effort is unknown.
function referenceScale(t: Turn) {
  return t.effort ? EFFORT_OUTPUT[REFERENCE.effort] / EFFORT_OUTPUT[t.effort] : 1
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

// Re-work: a routed prompt whose same text (`key`) comes again within the next few prompts of the chat.
// The person had to ask twice, so the cheaper answer did not do the job. A guess: a repeat can also be
// a second try at the same question on purpose.
const REWORK_WINDOW = 3

function reworkedSet(records: readonly Entry[]) {
  const byChat = new Map<string, Decision[]>()
  for (const r of records) if (r.kind === 'decision') byChat.set(r.chat, [...(byChat.get(r.chat) ?? []), r])
  const out = new Set<string>()
  for (const list of byChat.values()) {
    list.sort((a, b) => a.ts - b.ts)
    list.forEach((d, i) => {
      if (!routedDecision(d) || !d.key) return
      if (list.slice(i + 1, i + 1 + REWORK_WINDOW).some(n => n.key === d.key)) out.add(takenKey(d.chat, d.ts))
    })
  }
  return out
}

function add(s: Summary, r: Entry, taken: Set<string>, reworked: Set<string>) {
  if (r.kind === 'turn') addTurn(s, r)
  else if (r.kind === 'decision') {
    addDecision(s, r, taken.has(takenKey(r.chat, r.ts)))
    s.classifierUsd += classifierUsd(r)
    if (routedDecision(r)) {
      s.routed++
      if (reworked.has(takenKey(r.chat, r.ts))) s.rework++
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
export function summarize(records: readonly Entry[], now: number): Report {
  const today = empty()
  const week = empty()
  const total = empty()
  const dayStart = startOfDay(now)
  const taken = takenSet(records)
  const reworked = reworkedSet(records)
  for (const r of records) {
    add(total, r, taken, reworked)
    if (r.ts >= now - 7 * DAY) add(week, r, taken, reworked)
    if (r.ts >= dayStart) add(today, r, taken, reworked)
  }
  return { today: finish(today), week: finish(week), total: finish(total) }
}

// The last `days` local days, oldest first, each with its own summary (for the graph).
export function byDay(records: readonly Entry[], now: number, days: number): ({ day: string } & Summary)[] {
  const keys: string[] = []
  for (let i = days - 1; i >= 0; i--) keys.push(dayKey(startOfDay(now) - i * DAY + 12 * 3_600_000))
  const map = new Map(keys.map(k => [k, empty()]))
  const taken = takenSet(records)
  const reworked = reworkedSet(records)
  for (const r of records) {
    const s = map.get(dayKey(r.ts))
    if (s) add(s, r, taken, reworked)
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

// The rows of /router stats, shared by the text table and the pane.
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

const NOTE =
  "An estimate: tokens × list prices in core/prices.ts. Cost without router prices each turn on the model and effort it would have run at without the router; a routed subagent also counts the main chat's context its requests did not read; a turn after the router switched models counts the cache it rewrote. Balance = cost without router − cost with router (the work plus the classifier). Vs. always Opus medium prices the same work on Opus at medium effort for every chat, whatever its own pick, minus the cost with router; cost per turn is the cost with router over the priced turns. Effort is a guess (output tokens weighted per level); work moved to a new session is not priced."

export const STATS_COLUMNS = ['Today', '7 days', 'Total'] as const

// Each row's label and its three cells (today, 7 days, total).
export function statsRows(r: Report): { label: string; cells: string[] }[] {
  return STATS_ROWS.map(([label, f]) => ({ label, cells: [r.today, r.week, r.total].map(f) }))
}

// A plain text table of the three periods (for /router stats and the Codex and OpenCode adapters).
export function statsText(r: Report): string {
  const rows = statsRows(r)
  const w = Math.max(...rows.map(x => x.label.length)) + 2
  const line = (n: string, cells: readonly string[]) => `${n.padEnd(w)}${cells.map((t, i) => (i < 2 ? t.padEnd(16) : t)).join('')}`
  return [
    line('', STATS_COLUMNS),
    ...rows.map(x => line(x.label, x.cells)),
    '',
    NOTE,
  ].join('\n')
}

// The footer's short line for a day: the balance, or what the router cost; '' with nothing to show.
export function savingLabel(s: Summary): string {
  if (Math.abs(s.balanceUsd) < 0.005) return ''
  return s.balanceUsd > 0 ? `saved ${usd(s.balanceUsd)} today` : `router cost ${usd(-s.balanceUsd)} today`
}

// A self-contained page for /router stats: the three periods and the balance per day as bars.
export function statsHtml(r: Report, days: readonly ({ day: string } & Summary)[]): string {
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
  const table = STATS_ROWS.map(([n, f]) => `<tr><th>${n}</th>${[r.today, r.week, r.total].map(s => `<td>${f(s)}</td>`).join('')}</tr>`).join('')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Prompt Router stats</title>
<style>
:root { --bg: #faf9f5; --fg: #1f1e1d; --muted: #6b6a65; --line: #e3e1da; --pos: #2f7d4f; --neg: #c0533a; }
@media (prefers-color-scheme: dark) { :root { --bg: #1f1e1d; --fg: #f0eee6; --muted: #a3a199; --line: #3a3936; --pos: #5dbb84; --neg: #e27a60; } }
body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 15px/1.45 system-ui, sans-serif; }
main { max-width: 760px; margin: 0 auto; }
h1 { font-size: 20px; margin: 0 0 4px; }
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
<p>${NOTE}</p>
<div class="big">${usd(r.week.balanceUsd)} <span style="font-size:15px;font-weight:400;color:var(--muted)">balance, last 7 days</span></div>
<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance per day"><line class="axis" x1="${pad}" x2="${W - pad}" y1="${zero}" y2="${zero}"/>${bars}</svg>
<div class="days"><span>${first}</span><span>balance per day</span><span>${last}</span></div>
<div class="wrap"><table><thead><tr><th></th><th>Today</th><th>7 days</th><th>Total</th></tr></thead><tbody>${table}</tbody></table></div>
</main></body></html>
`
}

// A dollar amount with its sign always shown: +$0.42 saved, −$0.14 lost.
export const signed = (n: number) => `${n < 0 ? '−' : '+'}$${Math.abs(n).toFixed(2)}`
