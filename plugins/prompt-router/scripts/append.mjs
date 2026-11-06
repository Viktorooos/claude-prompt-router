// Prompt Router: appends lines to a log shared by parallel sessions, without losing any.
// The mod's $.fs can only rewrite a whole file, so two sessions writing at once dropped each other's
// records. Here every write is an append under a lock (a directory, created atomically), and the
// rare trim (stats: 90 days / 5 MB; tail: the last 20 kB) goes through a temp file and a rename.
// Usage: node append.mjs <file> <stats|tail>, the lines on stdin. Exit 0 once the lines are in.
import { realpathSync } from 'node:fs'
import { open, appendFile, mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const WAIT_MS = 5000
const STALE_MS = 30_000
export const TAIL = 20_000

async function lock(path) {
  const dir = `${path}.lock`
  const until = Date.now() + WAIT_MS
  for (;;) {
    try {
      await mkdir(dir)
      return () => rmdir(dir).catch(() => {})
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err
    }
    // A lock left by a killed writer.
    try {
      if (Date.now() - (await stat(dir)).mtimeMs > STALE_MS) await rmdir(dir)
    } catch {}
    if (Date.now() > until) throw new Error(`${dir} is held`)
    await new Promise(r => setTimeout(r, 10 + Math.random() * 40))
  }
}

async function replace(path, text) {
  const tmp = `${path}.${process.pid}.tmp`
  await writeFile(tmp, text)
  await rename(tmp, path)
}

async function firstLine(path) {
  const f = await open(path, 'r')
  try {
    const { buffer, bytesRead } = await f.read(Buffer.alloc(64 * 1024), 0, 64 * 1024, 0)
    const head = buffer.subarray(0, bytesRead).toString('utf8')
    return head.slice(0, head.indexOf('\n') + 1 || undefined).trim()
  } finally {
    await f.close()
  }
}

async function trim(path, mode, now, core) {
  const size = (await stat(path)).size
  if (mode === 'tail') {
    if (size > 2 * TAIL) await replace(path, (await readFile(path, 'utf8')).slice(-TAIL))
    return
  }
  const { needsRotate, rotate, MAX_BYTES } = core
  if (!needsRotate(await firstLine(path), size, now)) return
  // Down to 80 % of the limit, so it does not rotate on every write.
  await replace(path, rotate(await readFile(path, 'utf8'), now, MAX_BYTES * 0.8))
}

export async function append(path, text, mode = 'stats', now = Date.now()) {
  // Loaded before anything is written: a Node that cannot load the TypeScript core (no type
  // stripping) fails here, and the caller's whole-file rewrite still trims the log.
  const core = mode === 'tail' ? null : await import('../core/stats.ts')
  await mkdir(dirname(path), { recursive: true })
  const unlock = await lock(path)
  try {
    await appendFile(path, text)
    try {
      await trim(path, mode, now, core)
    } catch (err) {
      // The lines are in; the next write trims again.
      process.stderr.write(`trim: ${err?.message ?? err}\n`)
    }
  } finally {
    await unlock()
  }
}

// The script run as `node append.mjs` (import.meta.main is newer than some Nodes that run this).
const main = (() => {
  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)
  } catch {
    return false
  }
})()

if (main) {
  const [path, mode] = process.argv.slice(2)
  let text = ''
  for await (const chunk of process.stdin) text += chunk
  try {
    if (path && text) await append(path, text, mode)
  } catch (err) {
    process.stderr.write(`${err?.message ?? err}\n`)
    process.exitCode = 2
  }
}
