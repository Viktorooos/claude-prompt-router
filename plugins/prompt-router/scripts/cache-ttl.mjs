// Prompt Router, the pane's Cache card: how long the chat's prompt cache lives and when its last
// request was, from the tail of the session's transcript. Claude Code writes each request's cache
// entries as 5-minute or 1-hour ones (usage.cache_creation); the engine's turn usage does not say.
// Plain Node, reads at most the last 512 KB.
// Usage: node cache-ttl.mjs <transcript file>
//        node cache-ttl.mjs <projects dir> <session id> <session cwd>
// Prints {"ttl":"1h","ts":1762505040000,"file":"…"}; a field it could not find is left out. The
// mod passes the file back on later turns, so only the first one looks for it.
import { open } from 'node:fs/promises'
import { findTranscript, parseRequest } from './usage-scan.mjs'

const TAIL = 512 * 1024

// The main chat's last reply in the transcript: when its request was sent (the main-chat line just
// before it, the prompt or tool result it answers; else its first copy, written once the first block
// arrived, which can be a long thinking block later) and the lifetime of the newest cache write.
export async function lastReply(file, bytes = TAIL) {
  const fh = await open(file, 'r')
  try {
    const { size } = await fh.stat()
    const start = Math.max(0, size - bytes)
    const buf = Buffer.alloc(size - start)
    await fh.read(buf, 0, buf.length, start)
    const lines = buf.toString('utf8').split('\n')
    if (start > 0) lines.shift()
    let id
    let ts = null
    let sent = null
    let ttl = null
    for (let i = lines.length - 1; i >= 0; i--) {
      if (ts !== null && sent === null && lines[i].includes('"type":"user"')) {
        try {
          const d = JSON.parse(lines[i])
          const t = Date.parse(d.timestamp)
          if (d.type === 'user' && !d.isSidechain && Number.isFinite(t) && t <= ts) sent = t
        } catch {}
        continue
      }
      const r = parseRequest(lines[i])
      if (!r || r.sidechain) continue
      if (ts === null) {
        id = r.id
        ts = r.ts
      } else if (r.id !== null && r.id === id) {
        ts = Math.min(ts, r.ts)
      }
      const c = r.usage.cache_creation
      if (!ttl && c) {
        const hour = c.ephemeral_1h_input_tokens ?? 0
        const five = c.ephemeral_5m_input_tokens ?? 0
        if (hour || five) ttl = hour >= five ? '1h' : '5m'
      }
      if (ttl && r.id !== id) break
    }
    const at = sent ?? ts
    return { ...(ttl ? { ttl } : {}), ...(at !== null ? { ts: at } : {}) }
  } finally {
    await fh.close()
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const [projects, id, cwd] = args
  const file = args.length === 1 ? args[0] : projects && id && /^[\w-]+$/.test(id) ? await findTranscript(projects, id, cwd) : null
  const out = file ? { ...(await lastReply(file).catch(() => ({}))), file } : {}
  process.stdout.write(JSON.stringify(out))
}
