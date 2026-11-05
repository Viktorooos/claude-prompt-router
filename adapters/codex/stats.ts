// Prompt Router statistics for Codex: the JSONL log the hook writes (a decision per routed prompt,
// a turn per Stop / SubagentStop) and the text table `/router stats` shows. The sums come from
// core/stats.ts and the prices only from core/prices.ts; Codex's own models are not in that price
// list, so their turns and classifier calls are counted, never priced.
//
// Codex 0.166 (not a stable API):
//   - the rollout JSONL has `event_msg` `token_count` with `info.total_token_usage` (running totals
//     for the chat); a turn's usage is how much they grew since the turn before;
//   - `codex exec --json` ends with `{"type":"turn.completed","usage":{...}}` (the classifier call).
// OpenAI counts cached tokens inside input_tokens, so they come off the input.
import { existsSync, readFileSync } from 'node:fs'
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { cost } from '../../plugins/prompt-router/core/prices.ts'
import type { Usage } from '../../plugins/prompt-router/core/prices.ts'
import { parseLog, summarize } from '../../plugins/prompt-router/core/stats.ts'
import type { Compare, Entry, Summary } from '../../plugins/prompt-router/core/stats.ts'
import { TIER_OF } from '../shared/tiers.ts'
import type { Model } from '../../plugins/prompt-router/core/router.ts'

const DAY = 86_400_000
export const KEEP_MS = 90 * DAY
export const MAX_BYTES = 5_000_000

export function statsPath(home: string) {
  return join(home, 'log', 'prompt-router-stats.jsonl')
}

type CodexUsage = { input_tokens?: number; cached_input_tokens?: number; cache_write_input_tokens?: number; output_tokens?: number }

export function codexUsage(u: CodexUsage | null | undefined): Usage | null {
  if (!u || typeof u !== 'object') return null
  const cacheRead = u.cached_input_tokens ?? 0
  return { input: Math.max(0, (u.input_tokens ?? 0) - cacheRead), output: u.output_tokens ?? 0, cacheRead, cacheWrite: u.cache_write_input_tokens ?? 0 }
}

function events(text: string): { type?: string; payload?: Record<string, any>; usage?: CodexUsage }[] {
  const out = []
  for (const l of text.split('\n')) {
    try {
      const e = JSON.parse(l)
      if (e && typeof e === 'object') out.push(e)
    } catch {
      // Not an event.
    }
  }
  return out
}

// The classifier call's usage from the `codex exec --json` stdout; null when it has none.
export function classifierUsage(stdout: string): Usage | null {
  const done = events(stdout).filter(e => e.type === 'turn.completed').at(-1)
  return codexUsage(done?.usage)
}

// The last turn of a rollout: its model, the model the chat started on, and its tokens (none when
// no token count came after the turn started).
export function turnUsage(text: string): { model: string; baseline: string; usage?: Usage } {
  let baseline = ''
  let model = ''
  let before: CodexUsage | undefined
  let last: CodexUsage | undefined
  let inTurn: CodexUsage | undefined
  for (const e of events(text)) {
    const p = e.payload ?? {}
    if (e.type === 'turn_context' && typeof p.model === 'string' && p.model) {
      baseline ||= p.model
      model = p.model
    } else if (e.type === 'event_msg' && p.type === 'task_started') {
      before = last
      inTurn = undefined
    } else if (e.type === 'event_msg' && p.type === 'token_count' && p.info?.total_token_usage) {
      last = inTurn = p.info.total_token_usage
    }
  }
  if (!inTurn) return { model, baseline }
  const a = codexUsage(before ?? {})!
  const b = codexUsage(inTurn)!
  const usage = { input: b.input - a.input, output: b.output - a.output, cacheRead: b.cacheRead - a.cacheRead, cacheWrite: b.cacheWrite - a.cacheWrite }
  for (const k of Object.keys(usage) as (keyof Usage)[]) usage[k] = Math.max(0, usage[k])
  return { model, baseline, usage }
}

// Older than 90 days, or past 5 MB: the oldest records go.
async function rotate(path: string, now: number) {
  let size = 0
  try {
    size = (await stat(path)).size
  } catch {
    return
  }
  const text = await readFile(path, 'utf8')
  const first = text.slice(0, text.indexOf('\n') + 1 || undefined)
  const firstTs = parseLog(first)[0]?.ts ?? now
  if (size <= MAX_BYTES && firstTs >= now - KEEP_MS) return
  let lines = text.split('\n').filter(l => {
    const r = parseLog(l)[0]
    return r && r.ts >= now - KEEP_MS
  })
  // Down to 80 % of the limit, so it does not rotate on every write.
  let bytes = lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0)
  let drop = 0
  while (bytes > MAX_BYTES * 0.8 && drop < lines.length) bytes -= Buffer.byteLength(lines[drop++]) + 1
  lines = lines.slice(drop)
  await writeFile(path, lines.length ? `${lines.join('\n')}\n` : '')
}

export async function appendStats(home: string, entry: Entry, now = Date.now()) {
  const path = statsPath(home)
  await mkdir(join(home, 'log'), { recursive: true })
  await rotate(path, now)
  await appendFile(path, `${JSON.stringify(entry)}\n`)
}

export function readStats(home: string): Entry[] {
  const path = statsPath(home)
  return existsSync(path) ? parseLog(readFileSync(path, 'utf8')) : []
}

const usd = (n: number) => `$${n.toFixed(2)}`

function startOfDay(ts: number) {
  const d = new Date(ts)
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

// Classifier calls on a model with no price: summarize() counts them as $0, so they are named here.
function unpricedClassifier(records: readonly Entry[], from: number) {
  return records.filter(r => r.kind === 'decision' && r.ts >= from && r.classifier && r.classifier.usd === undefined && cost(r.classifier.usage, r.classifier.model) === null).length
}

function fmtTokens(n: number) {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n)
}

// The text table for `/router stats`: Today / 7 days / Total.
// `c`: option compareWith (a tier at an effort, priced at that tier's Claude list price), or null
// for the model the chat started on.
export function statsReport(records: readonly Entry[], now: number, c: Compare = null): string {
  if (!records.length) return 'Prompt Router statistics: No statistics yet. They start with the next routed prompt.'
  const r = summarize(records, now, c)
  const cols = [r.today, r.week, r.total]
  const noPrice = [startOfDay(now), now - 7 * DAY, -Infinity].map(from => String(unpricedClassifier(records, from)))
  const rows: [string, string[]][] = [
    ['Prompts', cols.map(s => String(s.prompts))],
    ['Model changes', cols.map(s => String(s.modelChanges))],
    ['Effort lower / higher', cols.map(s => `${s.effortDown} / ${s.effortUp}`)],
    ['Subagents / sessions', cols.map(s => `${s.subagents} / ${s.sessions}`)],
    ['Asked', cols.map(s => String(s.asked))],
    ['Without router', cols.map(s => usd(s.withoutUsd))],
    ['Actual', cols.map(s => usd(s.actualUsd))],
    ['Saved (cheaper model)', cols.map(s => usd(s.savedUsd))],
    ['Classifier cost', cols.map(s => usd(s.classifierUsd))],
    ['Net saving', cols.map((s: Summary) => `${usd(s.netUsd)}${s.withoutUsd > 0 ? ` (${s.netPct.toFixed(0)} %)` : ''}`)],
    ['Extra cost (stronger model)', cols.map(s => usd(s.extraUsd))],
    ['Turns without a price', cols.map(s => String(s.unpricedTurns))],
    ['Classifier calls without a price', noPrice],
    ['Turns with unknown tokens', cols.map(s => String(s.unknownTurns))],
  ]
  // Net saving with a percent is wider; keep the plain rows aligned on the right.
  const w0 = Math.max(...rows.map(([n]) => n.length))
  const w = [0, 1, 2].map(i => Math.max(['Today', '7 days', 'Total'][i].length, ...rows.map(([, v]) => v[i].length)))
  const fmt = (name: string, v: string[]) => `${name.padEnd(w0)}  ${v.map((x, i) => x.padStart(w[i])).join('  ')}`
  const out = ['Prompt Router statistics (estimate)', fmt('', ['Today', '7 days', 'Total']), ...rows.map(([n, v]) => fmt(n, v))]
  const models = Object.entries(r.total.tokens)
  if (models.length) {
    out.push('', 'Tokens (total):')
    for (const [m, u] of models) out.push(`  ${m}: input ${fmtTokens(u.input)}, output ${fmtTokens(u.output)}, cache read ${fmtTokens(u.cacheRead)}, cache write ${fmtTokens(u.cacheWrite)}`)
  }
  out.push(
    '',
    c
      ? `An estimate from the list prices in core/prices.ts: the same tokens priced on the ${TIER_OF[c.model as Model] ?? c.model} tier at ${c.effort} effort (option compareWith, its Claude list price; the effort weights the output, a guess).`
      : 'An estimate from the list prices in core/prices.ts: the same tokens priced on the model the chat started on (the main chat model for a subagent; option compareWith: first).',
    'Net saving = saved minus the classifier cost. Extra cost (a stronger model) is shown apart, not in the net. Effort changes are only counted.',
    'Models missing from the price list (Codex models) are counted, not priced.',
  )
  return out.join('\n')
}
