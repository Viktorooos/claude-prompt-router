// node --test plugins/prompt-router/test/node/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { lastReply } from '../../scripts/cache-ttl.mjs'
import { findTranscript } from '../../scripts/usage-scan.mjs'

const line = (o) => JSON.stringify(o)
const reply = (id, ts, creation, extra = {}) => line({
  type: 'assistant', timestamp: new Date(ts).toISOString(), ...extra,
  message: { id, model: 'claude-opus-5-5', usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 100, cache_creation_input_tokens: 5, ...(creation ? { cache_creation: creation } : {}) } },
})

test('the last main reply: its first copy\'s time and the newest cache write\'s lifetime; subagent lines skipped', async () => {
  const dir = await mkdtemp(`${tmpdir()}/cache-ttl-`)
  const file = `${dir}/s1.jsonl`
  await writeFile(file, [
    reply('m1', 1000, { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 }),
    reply('m2', 2000, { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40 }),
    reply('m2', 2600, { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 40 }),
    reply('sub', 3000, { ephemeral_5m_input_tokens: 70, ephemeral_1h_input_tokens: 0 }, { isSidechain: true }),
    line({ type: 'user', timestamp: new Date(3100).toISOString(), message: { content: 'next' } }),
  ].join('\n'))
  assert.deepEqual(await lastReply(file), { ttl: '1h', ts: 2000 })
})

test('a reply with no cache write takes the lifetime of the write before it; overage writes read as 5 minutes', async () => {
  const dir = await mkdtemp(`${tmpdir()}/cache-ttl-`)
  const file = `${dir}/s1.jsonl`
  await writeFile(file, [
    reply('m1', 1000, { ephemeral_5m_input_tokens: 300, ephemeral_1h_input_tokens: 0 }),
    reply('m2', 5000, { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 0 }),
  ].join('\n'))
  assert.deepEqual(await lastReply(file), { ttl: '5m', ts: 5000 })
})

test('only the tail is read: a cut first line is dropped, an empty file says nothing', async () => {
  const dir = await mkdtemp(`${tmpdir()}/cache-ttl-`)
  const file = `${dir}/s1.jsonl`
  const old = reply('m0', 500, { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 9 })
  const last = reply('m1', 1000, null)
  await writeFile(file, `${old}\n${last}`)
  assert.deepEqual(await lastReply(file, last.length + 5), { ts: 1000 })
  await writeFile(`${dir}/empty.jsonl`, '')
  assert.deepEqual(await lastReply(`${dir}/empty.jsonl`), {})
})

test('the transcript is found in its project\'s folder, or in any folder when that name does not match', async () => {
  const projects = await mkdtemp(`${tmpdir()}/cache-ttl-`)
  await mkdir(`${projects}/-Users-me-my-app`, { recursive: true })
  await writeFile(`${projects}/-Users-me-my-app/s1.jsonl`, '')
  assert.equal(await findTranscript(projects, 's1', '/Users/me/my app'), `${projects}/-Users-me-my-app/s1.jsonl`)
  assert.equal(await findTranscript(projects, 's1', '/Users/me/other'), `${projects}/-Users-me-my-app/s1.jsonl`)
  assert.equal(await findTranscript(projects, 's1'), `${projects}/-Users-me-my-app/s1.jsonl`)
  assert.equal(await findTranscript(projects, 's2', '/Users/me/my app'), null)
})

test('the request is dated by the main-chat line it answers, not by the reply\'s first block', async () => {
  const dir = await mkdtemp(`${tmpdir()}/cache-ttl-`)
  const file = `${dir}/s1.jsonl`
  const user = (ts, extra = {}) => line({ type: 'user', timestamp: new Date(ts).toISOString(), ...extra, message: { content: 'x' } })
  await writeFile(file, [
    reply('m1', 1000, { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 }),
    user(2000),
    user(2500, { isSidechain: true }),
    reply('m2', 60_000, { ephemeral_5m_input_tokens: 9, ephemeral_1h_input_tokens: 0 }),
  ].join('\n'))
  assert.deepEqual(await lastReply(file), { ttl: '5m', ts: 2000 })
})
