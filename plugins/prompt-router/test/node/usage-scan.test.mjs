// node --test plugins/prompt-router/test/node/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { scanSession } from '../../scripts/usage-scan.mjs'

const line = (o) => JSON.stringify(o)
const reply = (id, ts, out, model = 'claude-opus-4-1') => line({
  type: 'assistant', timestamp: new Date(ts).toISOString(),
  message: { id, model, usage: { input_tokens: 10, output_tokens: out, cache_read_input_tokens: 100, cache_creation_input_tokens: 5 } },
})

test('one request per message id (the last copy counts, at the first copy\'s time), subagents apart, other lines skipped', async () => {
  const projects = await mkdtemp(`${tmpdir()}/usage-scan-`)
  await mkdir(`${projects}/proj/s1/subagents`, { recursive: true })
  await writeFile(`${projects}/proj/s1.jsonl`, [
    line({ type: 'user', timestamp: new Date(1000).toISOString(), message: { content: 'hi' } }),
    reply('m1', 2000, 3), reply('m1', 2100, 40),
    reply('m2', 3000, 7),
    line({ type: 'assistant', timestamp: new Date(3500).toISOString(), message: { id: 'x', model: '<synthetic>', usage: { output_tokens: 1 } } }),
    'not json "type":"assistant"',
  ].join('\n'))
  await writeFile(`${projects}/proj/s1/subagents/agent-a1.jsonl`, reply('m3', 2500, 9, 'claude-haiku-4-5'))
  await writeFile(`${projects}/proj/other.jsonl`, reply('m9', 2000, 1))
  const reqs = await scanSession(projects, 's1')
  assert.deepEqual(reqs.map(r => [r.ts, r.model, r.agent, r.usage.output]), [
    [2000, 'claude-opus-4-1', undefined, 40],
    [2500, 'claude-haiku-4-5', 'agent-a1', 9],
    [3000, 'claude-opus-4-1', undefined, 7],
  ])
  assert.deepEqual(reqs[0].usage, { input: 10, output: 40, cacheRead: 100, cacheWrite: 5 })
  assert.deepEqual(await scanSession(projects, 'missing'), [])
})
