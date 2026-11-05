// The savings log for OpenCode: JSONL records (core/stats.ts formats), kept to 90 days and 5 MB,
// and the text table the router_stats tool and /router stats show.
import { appendFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises'

import { parseLog, summarize } from '../../plugins/prompt-router/core/stats.ts'
import type { Compare, Entry, Summary } from '../../plugins/prompt-router/core/stats.ts'

const DAY = 86_400_000
const KEEP_MS = 90 * DAY
const MAX_BYTES = 5_000_000
// After a trim the log keeps this much, so it is not rewritten on every record.
const TRIM_BYTES = 4_000_000

export function statsLog(path: string, dir: string) {
  let queue: Promise<unknown> = Promise.resolve()
  let checked = false

  // Drops records older than 90 days; when still over 5 MB, the oldest ones until it fits.
  async function prune(now: number) {
    let text: string
    try {
      text = await readFile(path, 'utf8')
    } catch {
      return
    }
    const lines = text.split('\n').filter(l => {
      if (!l.trim()) return false
      const ts = /"ts":(\d+)/.exec(l)
      return !ts || Number(ts[1]) >= now - KEEP_MS
    })
    let size = lines.reduce((n, l) => n + Buffer.byteLength(l) + 1, 0)
    let from = 0
    if (size > MAX_BYTES) while (from < lines.length && size > TRIM_BYTES) size -= Buffer.byteLength(lines[from++]) + 1
    const kept = lines.slice(from)
    if (kept.length !== text.split('\n').filter(l => l.trim()).length) await writeFile(path, kept.length ? `${kept.join('\n')}\n` : '')
  }

  async function write(r: Entry) {
    await mkdir(dir, { recursive: true })
    // The age check once per load; the size check on every record (a stat is cheap).
    let size = 0
    try {
      size = (await stat(path)).size
    } catch {
      // A new log.
    }
    if (!checked || size > MAX_BYTES) await prune(r.ts)
    checked = true
    await appendFile(path, `${JSON.stringify(r)}\n`)
  }

  return {
    // One at a time, so records never interleave with a trim.
    add(r: Entry): Promise<void> {
      const next = queue.then(() => write(r))
      queue = next.catch(() => {})
      return next
    },
    async read(): Promise<Entry[]> {
      await queue
      try {
        return parseLog(await readFile(path, 'utf8'))
      } catch {
        return []
      }
    },
  }
}

function usd(n: number) {
  const sign = n < 0 ? '-' : ''
  const a = Math.abs(n)
  return `${sign}$${a > 0 && a < 0.01 ? a.toFixed(4) : a.toFixed(2)}`
}

// Today / 7 days / Total as a plain text table.
export function statsTable(records: readonly Entry[], now: number, compare: Compare = null): string {
  const r = summarize(records, now, compare)
  const cols = [r.today, r.week, r.total]
  const rows: [string, (s: Summary) => string][] = [
    ['Prompts routed', s => String(s.prompts)],
    ['Model changes', s => String(s.modelChanges)],
    ['Effort lowered', s => String(s.effortDown)],
    ['Effort raised', s => String(s.effortUp)],
    ['Subagents', s => String(s.subagents)],
    ['New sessions', s => String(s.sessions)],
    ['Suggestions asked', s => String(s.asked)],
    ['Cost', s => usd(s.actualUsd)],
    ['Without router', s => usd(s.withoutUsd)],
    ['Saved (cheaper model)', s => usd(s.savedUsd)],
    ['Classifier', s => usd(s.classifierUsd)],
    ['Net saving', s => `${usd(s.netUsd)} (${s.netPct.toFixed(0)} %)`],
    ['Stronger model (extra)', s => usd(s.extraUsd)],
    ['Unknown turns', s => String(s.unknownTurns)],
    ['Unpriced turns', s => String(s.unpricedTurns)],
  ]
  const head = ['', 'Today', '7 days', 'Total']
  const table = [head, ...rows.map(([name, f]) => [name, ...cols.map(f)])]
  const w = head.map((_, i) => Math.max(...table.map(row => row[i].length)))
  const lines = table.map(row => row.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('   ').trimEnd())
  return [
    'Prompt Router savings',
    '',
    ...lines,
    '',
    'An estimate from the price list in core/prices.ts (OpenCode-reported cost where it has one).',
    'Net saving = saved minus what the classifier cost. A stronger model is extra cost, shown apart, not in the net.',
    'Effort changes are counts only: what the model would have used at another effort is unknown.',
    'Unpriced turns ran on a model without a list price: no saving is claimed for them.',
  ].join('\n')
}
