import assert from 'node:assert/strict'
import { mkdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { findTranscript, route, serve } from '../mcp.ts'
import { readStats } from '../stats.ts'
import { PICK, home } from './helpers.ts'
import { REUSE_MS, handle } from '../hook.ts'

// A rollout of a chat whose current turn (t9) is still open, the prompt already in it.
function rollout(dir: string, name: string, prompt: string, o: { model?: string; replied?: boolean } = {}) {
  const lines = [
    { type: 'session_meta', payload: { id: name } },
    ...(o.replied
      ? [
          { type: 'event_msg', payload: { type: 'task_started', turn_id: 't1' } },
          { type: 'event_msg', payload: { type: 'user_message', message: 'opravit login' } },
          { type: 'event_msg', payload: { type: 'agent_message', message: 'Hotovo.' } },
          { type: 'event_msg', payload: { type: 'task_complete', turn_id: 't1' } },
        ]
      : []),
    { type: 'event_msg', payload: { type: 'task_started', turn_id: 't9' } },
    { type: 'turn_context', payload: { model: o.model ?? 'gpt-6-astra', effort: 'high' } },
    { type: 'event_msg', payload: { type: 'user_message', message: prompt } },
  ]
  const f = join(dir, `rollout-${name}.jsonl`)
  writeFileSync(f, lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  return f
}

function sessions(h: string) {
  const d = new Date()
  const dir = join(h, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
  mkdirSync(dir, { recursive: true })
  return dir
}

test('finds the chat whose last prompt is the one routed', async () => {
  const h = home()
  const dir = sessions(h)
  const mine = rollout(dir, 'a', 'napiš zprávu pro kolegu')
  const other = rollout(dir, 'b', 'něco jiného')
  utimesSync(mine, new Date(Date.now() - 5000), new Date(Date.now() - 5000))
  assert.equal(await findTranscript(h, 'napiš zprávu pro kolegu'), mine)
  assert.equal(await findTranscript(h, 'něco jiného'), other)
})

test('no matching chat gives no transcript', async () => {
  const h = home()
  rollout(sessions(h), 'a', 'něco jiného')
  assert.equal(await findTranscript(h, 'úplně jiný prompt'), null)
})

test('route reads the model from the chat and suggests the switch', async () => {
  const h = home({ effortMode: 'auto', modelMode: 'auto' })
  rollout(sessions(h), 'a', 'napiš zprávu pro kolegu')
  const seen: string[] = []
  const r = await route({ prompt: 'napiš zprávu pro kolegu' }, { codexHome: h, runner: async (_p, x) => (seen.push(x.model), PICK.subagent.replace('subagent', 'here')) })
  assert.match(r, /Prompt Router: for this, switch with `\/model gpt-6-luna low`/)
  assert.deepEqual(seen, ['gpt-6-luna'])
})

test('the open turn of the routed prompt does not count as a running turn', async () => {
  const h = home({ effortMode: 'auto', modelMode: 'auto' })
  rollout(sessions(h), 'a', 'drobnost', { replied: true })
  const r = await route({ prompt: 'drobnost' }, { codexHome: h, runner: async () => PICK.here })
  assert.match(r, /switch with `\/model/)
})

// The desktop app has no spawn_agent: a here prompt on another model only judges the effort.
test('the desktop skips the subagent offer for here on another model', async () => {
  const h = home({ effortMode: 'auto', modelMode: 'auto' })
  rollout(sessions(h), 'a', 'přejmenuj ty klíče', { model: 'gpt-6.1-sol', replied: true })
  const prompts: string[] = []
  const r = await route({ prompt: 'přejmenuj ty klíče' }, { codexHome: h, runner: async p => (prompts.push(p), '{"where": "here", "model": "sonnet", "effort": "low", "why": "a mechanical edit"}') })
  assert.match(r, /switch with `\/model gpt-6\.1-sol low`/)
  assert.doesNotMatch(r, /Subagent|spawn_agent/)
  assert.match(prompts[0], /for here use the current one/)
})

test('the desktop skips the feature with midChatModelDetection auto too', async () => {
  const h = home({ midChatModelDetection: 'auto', effortDetection: 'auto' })
  rollout(sessions(h), 'a', 'přejmenuj ty klíče', { model: 'gpt-6.1-sol', replied: true })
  const r = await route({ prompt: 'přejmenuj ty klíče' }, { codexHome: h, runner: async () => '{"where": "here", "model": "sonnet", "effort": "low", "why": "a mechanical edit"}' })
  assert.match(r, /switch with `\/model gpt-6\.1-sol low`/)
  assert.doesNotMatch(r, /Subagent|spawn_agent|decide yourself/)
})

test('nothing to switch tells the agent to go on', async () => {
  const h = home()
  rollout(sessions(h), 'a', 'ok', { model: 'gpt-6.1-sol' })
  const r = await route({ prompt: 'ok' }, { codexHome: h, runner: async () => PICK.keep })
  assert.match(r, /nothing to switch/i)
})

test('a classifier failure never breaks the turn', async () => {
  const h = home()
  rollout(sessions(h), 'a', 'ok')
  const r = await route({ prompt: 'ok' }, { codexHome: h, runner: async () => { throw new Error('boom') } })
  assert.match(r, /nothing to switch/i)
})

// Drives the stdio server with JSON-RPC lines and collects its answers.
async function rpc(msgs: unknown[], deps = {}) {
  const out: any[] = []
  await serve(msgs.map(m => JSON.stringify(m)), line => out.push(JSON.parse(line)), deps)
  return out
}

test('the server answers initialize, lists route and skips notifications', async () => {
  const out = await rpc([
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codex' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'nope' },
  ])
  assert.equal(out.length, 3)
  assert.equal(out[0].result.protocolVersion, '2025-06-18')
  assert.ok(out[0].result.capabilities.tools)
  const tool = out[1].result.tools[0]
  assert.equal(tool.name, 'route')
  assert.deepEqual(tool.inputSchema.required, ['prompt'])
  assert.equal(tool.annotations.readOnlyHint, true)
  assert.equal(out[2].error.code, -32601)
})

test('tools/call route returns the note as text', async () => {
  const h = home({ effortMode: 'auto', modelMode: 'auto' })
  rollout(sessions(h), 'a', 'napiš zprávu')
  const out = await rpc([{ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'route', arguments: { prompt: 'napiš zprávu' } } }], { codexHome: h, runner: async () => PICK.subagent.replace('subagent', 'here') })
  assert.equal(out[0].id, 7)
  assert.match(out[0].result.content[0].text, /switch with `\/model gpt-6-luna low`/)
})

// The desktop has no spawn_agent: a subagent pick stays here, as with subagentSuggestions off.
test('the desktop never offers a subagent, with subagentSuggestions ask or auto', async () => {
  for (const subagentSuggestions of ['ask', 'auto']) {
    const h = home({ subagentSuggestions })
    rollout(sessions(h), 'a', 'spusť testy', { model: 'gpt-6.1-sol', replied: true })
    const r = await route({ prompt: 'spusť testy' }, { codexHome: h, runner: async () => PICK.subagent })
    assert.doesNotMatch(r, /Subagent|spawn_agent/)
    // Past REUSE_MS, so the first answer is not handed back again.
    const s = await route({ prompt: 'spusť testy' }, { codexHome: h, now: Date.now() + REUSE_MS + 1, runner: async () => PICK.session })
    assert.match(s, /New session/)
    assert.doesNotMatch(s, /Subagent|spawn_agent/)
  }
})

test('the desktop logs each decision under the chat id from the rollout', async () => {
  const h = home()
  rollout(sessions(h), 'chat-42', 'napiš zprávu pro kolegu')
  await route({ prompt: 'napiš zprávu pro kolegu' }, { codexHome: h, runner: async () => PICK.first })
  const d = readStats(h).find(r => r.kind === 'decision')
  assert.equal(d?.kind === 'decision' && d.chat, 'chat-42')
})

test('route hands back the hook answer for the same prompt in the same chat, without the classifier', async () => {
  const h = home()
  rollout(sessions(h), 'chat-7', 'přejmenuj tu proměnnou')
  const now = Date.now()
  const hook = await handle({ session_id: 'chat-7', prompt: 'přejmenuj tu proměnnou', transcript_path: null, model: 'gpt-6.1-sol', turn_id: 't9' }, { codexHome: h, now, runner: async () => PICK.first })
  let calls = 0
  const r = await route({ prompt: 'přejmenuj tu proměnnou' }, { codexHome: h, now: now + 5000, runner: async () => (calls++, PICK.keep) })
  assert.equal(calls, 0)
  assert.equal(r, hook?.hookSpecificOutput?.additionalContext)
  assert.equal(readStats(h).filter(x => x.kind === 'decision').length, 1)
})

test('route: a prompt the hook left as it is goes on; an old answer is classified again', async () => {
  const h = home()
  rollout(sessions(h), 'chat-8', 'ok')
  const now = Date.now()
  await handle({ session_id: 'chat-8', prompt: 'ok', transcript_path: null, model: 'gpt-6.1-sol' }, { codexHome: h, now, runner: async () => PICK.keep })
  let calls = 0
  const runner = async () => (calls++, PICK.keep)
  assert.match(await route({ prompt: 'ok' }, { codexHome: h, now: now + 1000, runner }), /nothing to switch/i)
  assert.equal(calls, 0)
  await route({ prompt: 'ok' }, { codexHome: h, now: now + REUSE_MS + 1, runner })
  assert.equal(calls, 1)
})

test('route skips app-generated requests without the classifier', async () => {
  const h = home()
  const prompt = 'This is an app-generated request for a suggested next user message.'
  rollout(sessions(h), 'chat-9', prompt)
  let calls = 0
  assert.match(await route({ prompt }, { codexHome: h, runner: async () => (calls++, PICK.here) }), /nothing to switch/i)
  assert.equal(calls, 0)
})
