// Prompt Router, compareWith: history. Sums the tokens of every assistant reply in the Claude Code
// transcripts from before the router's first stats record, per model and effort, and writes them once.
// Plain Node, no model calls. Usage: node history-scan.mjs <projects dir> <stats log> <out json>
import { createReadStream } from 'node:fs'
import { open, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

const [projects, statsLog, out] = process.argv.slice(2)
const started = Date.now()

async function boundary() {
  const fh = await open(statsLog, 'r').catch(() => null)
  if (!fh) return Date.now()
  try {
    const { bytesRead, buffer } = await fh.read(Buffer.alloc(4096), 0, 4096, 0)
    const ts = JSON.parse(buffer.subarray(0, bytesRead).toString().split('\n')[0]).ts
    return typeof ts === 'number' ? ts : Date.now()
  } catch { return Date.now() } finally { await fh.close() }
}

async function scan(file, before, tokens) {
  const seen = new Set()
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.includes('"type":"assistant"')) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    const m = d.message
    if (d.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') continue
    if (Date.parse(d.timestamp) >= before) continue
    // A streamed reply repeats its message (and its usage) once per content block.
    const id = m.id ?? d.requestId
    if (id) { if (seen.has(id)) continue; seen.add(id) }
    const u = m.usage
    const n = (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
    const key = `${m.model}|${typeof d.effort === 'string' ? d.effort : ''}`
    tokens[key] = (tokens[key] ?? 0) + n
  }
}

const before = await boundary()
const tokens = {}
let files = 0
for (const dir of await readdir(projects).catch(() => [])) {
  const names = await readdir(`${projects}/${dir}`).catch(() => [])
  for (const name of names) {
    if (!name.endsWith('.jsonl')) continue
    const file = `${projects}/${dir}/${name}`
    const st = await stat(file).catch(() => null)
    if (!st?.isFile() || st.mtimeMs >= before) continue
    files++
    await scan(file, before, tokens).catch(() => {})
  }
}
const result = { version: 1, before, computedAt: Date.now(), ms: Date.now() - started, files, tokens }
await writeFile(`${out}.tmp`, JSON.stringify(result))
await rename(`${out}.tmp`, out)
process.stdout.write(`${result.ms} ms, ${files} files\n`)
