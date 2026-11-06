// Prompt Router, /router stats: the tokens of every API request in the transcripts of the given
// sessions (main chat and its subagents), so stats can price turns the log has no usage for (an
// interrupted turn). Plain Node, no model calls.
// Usage: node usage-scan.mjs <projects dir> <out json> <session id>...
import { createReadStream } from 'node:fs'
import { readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

// One request per message id: a streamed reply repeats its message once per content block, the last
// copy has the final output count.
export async function scanFile(file, agent) {
  const byId = new Map()
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!line.includes('"type":"assistant"')) continue
    let d
    try { d = JSON.parse(line) } catch { continue }
    const m = d.message
    if (d.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') continue
    const ts = Date.parse(d.timestamp)
    if (!Number.isFinite(ts)) continue
    const u = m.usage
    const req = {
      ts, model: m.model, ...(agent ? { agent } : {}),
      usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
    }
    const id = m.id ?? d.requestId ?? `${ts}:${byId.size}`
    const first = byId.get(id)
    // Keep the first copy's time (when the request started answering).
    byId.set(id, first ? { ...req, ts: first.ts } : req)
  }
  return [...byId.values()]
}

// The session's transcript and its subagents', wherever the project folder is.
export async function scanSession(projects, id) {
  const out = []
  for (const dir of await readdir(projects).catch(() => [])) {
    const base = `${projects}/${dir}/${id}`
    const main = await stat(`${base}.jsonl`).catch(() => null)
    if (!main?.isFile()) continue
    out.push(...await scanFile(`${base}.jsonl`).catch(() => []))
    for (const name of await readdir(`${base}/subagents`).catch(() => [])) {
      if (name.endsWith('.jsonl')) out.push(...await scanFile(`${base}/subagents/${name}`, name.replace(/\.jsonl$/, '')).catch(() => []))
    }
  }
  return out.sort((a, b) => a.ts - b.ts)
}

if (import.meta.main) {
  const [projects, out, ...ids] = process.argv.slice(2)
  const started = Date.now()
  const scans = []
  for (const id of new Set(ids)) {
    if (!/^[\w-]+$/.test(id)) continue
    scans.push({ session: id, requests: await scanSession(projects, id) })
  }
  const result = { version: 1, computedAt: Date.now(), ms: Date.now() - started, scans }
  await writeFile(`${out}.tmp`, JSON.stringify(result))
  await rename(`${out}.tmp`, out)
  process.stdout.write(`${result.ms} ms, ${scans.length} sessions\n`)
}
