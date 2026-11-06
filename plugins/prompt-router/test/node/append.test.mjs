// node --test plugins/prompt-router/test/node/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { append, TAIL } from '../../scripts/append.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/append.mjs', import.meta.url))
const DAY = 86_400_000
const line = (ts, n) => `${JSON.stringify({ kind: 'turn', ts, n })}\n`

function run(path, mode, stdin, node = []) {
  return new Promise((resolve, reject) => {
    const child = execFile(process.execPath, [...node, SCRIPT, path, mode], (err, _out, stderr) => (err ? reject(new Error(stderr || err.message)) : resolve()))
    child.stdin.end(stdin)
  })
}

test('two sessions flushing at once: both records are in the file', async () => {
  const dir = await mkdtemp(`${tmpdir()}/append-`)
  const path = `${dir}/logs/stats.jsonl`
  const now = Date.now()
  await Promise.all([run(path, 'stats', line(now, 1)), run(path, 'stats', line(now, 2))])
  const lines = (await readFile(path, 'utf8')).trim().split('\n').map(l => JSON.parse(l).n).sort()
  assert.deepEqual(lines, [1, 2])
  assert.deepEqual((await readdir(`${dir}/logs`)).sort(), ['stats.jsonl'])
})

test('many writers at once lose nothing', async () => {
  const dir = await mkdtemp(`${tmpdir()}/append-`)
  const path = `${dir}/stats.jsonl`
  const now = Date.now()
  await Promise.all(Array.from({ length: 30 }, (_, i) => append(path, line(now, i))))
  assert.equal((await readFile(path, 'utf8')).trim().split('\n').length, 30)
})

test('stats: lines older than 90 days go once the oldest is that old, through a temp file', async () => {
  const dir = await mkdtemp(`${tmpdir()}/append-`)
  const path = `${dir}/stats.jsonl`
  const now = Date.now()
  await writeFile(path, line(now - 91 * DAY, 1) + line(now - DAY, 2))
  await append(path, line(now, 3), 'stats', now)
  assert.deepEqual((await readFile(path, 'utf8')).trim().split('\n').map(l => JSON.parse(l).n), [2, 3])
  assert.deepEqual(await readdir(dir), ['stats.jsonl'])
})

test('tail: the error log keeps its last 20 kB', async () => {
  const dir = await mkdtemp(`${tmpdir()}/append-`)
  const path = `${dir}/router.log`
  await writeFile(path, 'x'.repeat(2 * TAIL))
  await append(path, 'last line\n', 'tail')
  const text = await readFile(path, 'utf8')
  assert.equal(text.length, TAIL)
  assert.ok(text.endsWith('last line\n'))
})

test('a Node without import.meta.main still appends', async () => {
  const dir = await mkdtemp(`${tmpdir()}/append-`)
  // Node before 22.18 / 24.2: import.meta.main is undefined.
  const hook = `${dir}/no-main.mjs`
  await writeFile(hook, `import { registerHooks } from 'node:module'
registerHooks({ load(url, ctx, next) {
  const r = next(url, ctx)
  return url.endsWith('/append.mjs') ? { ...r, source: String(r.source).replaceAll('import.meta.main', 'undefined') } : r
} })
`)
  const path = `${dir}/stats.jsonl`
  await run(path, 'stats', line(Date.now(), 1), ['--import', pathToFileURL(hook).href])
  assert.deepEqual((await readFile(path, 'utf8')).trim().split('\n').map(l => JSON.parse(l).n), [1])
})

test('stats: a Node that cannot load the TypeScript core appends nothing and fails, so the caller rewrites (and trims) instead', async () => {
  const dir = await mkdtemp(`${tmpdir()}/append-`)
  const path = `${dir}/stats.jsonl`
  const now = Date.now()
  await writeFile(path, line(now - 91 * DAY, 1))
  await assert.rejects(run(path, 'stats', line(now, 2), ['--no-experimental-strip-types']))
  assert.deepEqual((await readFile(path, 'utf8')).trim().split('\n').map(l => JSON.parse(l).n), [1])
})
