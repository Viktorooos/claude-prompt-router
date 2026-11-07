// Prompt Router, /router stats: the tokens of every API request in the transcripts of the given
// sessions (main chat and its subagents), so stats can price turns the log has no usage for (an
// interrupted turn). Plain Node, no model calls.
// Usage: node usage-scan.mjs <projects dir> <out json> <session id>...
import { createReadStream } from 'node:fs'
import { readdir, rename, stat, writeFile } from 'node:fs/promises'
import { createInterface } from 'node:readline'

// One API request from a transcript line: the reply's message id, the time the line was written,
// the model, its raw usage and whether a subagent's chain wrote it; null for any other line.
export function parseRequest(line) {
  if (!line.includes('"type":"assistant"')) return null
  let d
  try { d = JSON.parse(line) } catch { return null }
  const m = d.message
  if (d.type !== 'assistant' || !m?.usage || !m.model || m.model === '<synthetic>') return null
  const ts = Date.parse(d.timestamp)
  if (!Number.isFinite(ts)) return null
  return { id: m.id ?? d.requestId ?? null, ts, model: m.model, usage: m.usage, sidechain: !!d.isSidechain }
}

// One request per message id: a streamed reply repeats its message once per content block, the last
// copy has the final output count.
export async function scanFile(file, agent) {
  const byId = new Map()
  const lines = createInterface({ input: createReadStream(file), crlfDelay: Infinity })
  for await (const line of lines) {
    const r = parseRequest(line)
    if (!r) continue
    const u = r.usage
    const req = {
      ts: r.ts, model: r.model, ...(agent ? { agent } : {}),
      usage: { input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 },
    }
    const id = r.id ?? `${r.ts}:${byId.size}`
    const first = byId.get(id)
    // Keep the first copy's time (when the request started answering).
    byId.set(id, first ? { ...req, ts: first.ts } : req)
  }
  return [...byId.values()]
}

// Claude Code's folder name for a project: its path with every other character a dash.
export const projectFolder = cwd => String(cwd ?? '').replace(/[^a-zA-Z0-9]/g, '-')

// The session's main transcript: in its project's folder when cwd is given and matches, else in
// whichever project folder holds it (a long path's folder name is shortened); null when none does.
export async function findTranscript(projects, id, cwd) {
  const isFile = async p => (await stat(p).catch(() => null))?.isFile() ?? false
  const own = cwd ? `${projects}/${projectFolder(cwd)}/${id}.jsonl` : ''
  if (own && await isFile(own)) return own
  for (const dir of await readdir(projects).catch(() => [])) {
    if (await isFile(`${projects}/${dir}/${id}.jsonl`)) return `${projects}/${dir}/${id}.jsonl`
  }
  return null
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
