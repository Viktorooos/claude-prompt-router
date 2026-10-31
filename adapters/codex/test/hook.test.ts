import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { childPath, codexBin, codexRunner, configDefaults, effortFor, readHistory } from '../hook.ts'
import { FIXTURE, PICK, home, send, tmp } from './helpers.ts'

const HOOK = fileURLToPath(new URL('../hook.ts', import.meta.url))
const IDENTITY = { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } as const

test('readHistory: typed prompts, last reply, effort, tokens and open turns from a rollout', async () => {
  const h = await readHistory(FIXTURE)
  assert.deepEqual(h.users, ['fix the login bug'])
  assert.equal(h.reply, 'Found it in auth.ts.')
  assert.equal(h.isFirst, false)
  assert.equal(h.model, 'gpt-6.1-sol')
  assert.equal(h.effort, 'medium')
  assert.equal(h.tokens, 41000)
  assert.deepEqual(h.openTurns, ['t2'])
})

test('readHistory: without user_message events it takes the typed text and drops injected blocks', async () => {
  const f = join(tmp(), 'r.jsonl')
  writeFileSync(f, readFileSync(FIXTURE, 'utf8').split('\n').filter(l => !l.includes('"user_message"')).join('\n'))
  assert.deepEqual((await readHistory(f)).users, ['fix the login bug'])
})

test('readHistory: a missing or broken file is an empty chat', async () => {
  assert.equal((await readHistory('/nope/x.jsonl')).isFirst, true)
  const f = join(tmp(), 'r.jsonl')
  writeFileSync(f, '{"type":"turn_context","payload":null}\n{{{\n')
  assert.deepEqual((await readHistory(f)).users, [])
  assert.equal((await readHistory(null)).isFirst, true)
})

test('configDefaults reads only the top-level model and effort', async () => {
  assert.deepEqual(await configDefaults(home()), { model: 'gpt-6.1-sol', effort: 'medium' })
  assert.deepEqual(await configDefaults(tmp()), { model: '', effort: '' })
})

test('effortFor maps a level to one the model supports', () => {
  const levels = new Map([['gpt-6-luna', ['low', 'medium', 'high']]])
  assert.equal(effortFor({ ...IDENTITY }, levels, 'gpt-6-luna', 'max'), 'high')
  assert.equal(effortFor({ ...IDENTITY }, levels, 'gpt-6.1-sol', 'max'), 'max')
})

test('the classifier sees the chat and runs on the classifier model at low', async () => {
  const { calls } = await send('rename that variable')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].model, 'gpt-6-luna')
  assert.equal(calls[0].effort, 'low')
  assert.equal(calls[0].timeoutMs, 20_000)
  assert.match(calls[0].prompt, /<first>fix the login bug<\/first>/)
  assert.match(calls[0].prompt, /Found it in auth\.ts\./)
  assert.match(calls[0].prompt, /model gpt-6\.1-sol, effort medium, context 41k tokens/)
  assert.match(calls[0].prompt, /<prompt>\nrename that variable\n<\/prompt>/)
  // gpt-6-astra is not in this CODEX_HOME's models cache, so no Fable.
  assert.match(calls[0].prompt, /"model": "haiku\|sonnet\|opus"/)
})

test('here at the same effort, and keep, pass the prompt untouched', async () => {
  assert.equal((await send('rename that variable', { reply: PICK.same })).r, null)
  assert.equal((await send('yes, go on', { reply: PICK.keep })).r, null)
})

test('auto mode: a here pick at another effort makes the agent give the /model line and go on', async () => {
  const { context, system } = await send('rename that variable', { reply: PICK.here, options: { effortMode: 'auto' } })
  assert.equal(system, 'Prompt Router: for this, switch with `/model gpt-6.1-sol low` (small follow-up)')
  assert.match(context, /Begin your reply with exactly this one line: Prompt Router: for this, switch with `\/model gpt-6\.1-sol low`/)
  assert.match(context, /at the current setting; do not ask/)
})

test('ask mode: the agent asks in text whether to switch', async () => {
  const { context, system } = await send('rename that variable', { reply: PICK.here })
  assert.match(system, /`\/model gpt-6\.1-sol low`/)
  assert.match(context, /suggests effort low instead of medium/)
  assert.match(context, /ask the user in one short message/)
  assert.match(context, /"Switch \(Low\)", "Keep as is"/)
  assert.doesNotMatch(context, /AskUserQuestion/)
})

test('the first prompt picks the chat model; the line names the mapped Codex model', async () => {
  const { context, system } = await send('rename foo to bar everywhere', { reply: PICK.first, transcript: null, options: { modelMode: 'ask', effortMode: 'auto' } })
  assert.equal(system, 'Prompt Router: for this, switch with `/model gpt-6.1-terra low` (mechanical rename)')
  assert.match(context, /suggests model gpt-6\.1-terra instead of gpt-6\.1-sol and effort low instead of medium/)
  // A session pick on the first prompt counts as here.
  const s = await send('build the billing page', { reply: PICK.session, transcript: null, options: { modelMode: 'auto', effortMode: 'auto' } })
  assert.match(s.context, /^\[Prompt Router: this prompt fits gpt-6\.1-terra at effort medium/)
})

test('modelMode off keeps the model on the first prompt', async () => {
  const { system } = await send('rename foo', { reply: PICK.first, transcript: null, options: { modelMode: 'off', effortMode: 'auto' } })
  assert.equal(system, 'Prompt Router: for this, switch with `/model gpt-6.1-sol low` (mechanical rename)')
})

test('session: the agent asks, and the new session is a codex command', async () => {
  const { context, system } = await send('build the billing page', { reply: PICK.session })
  assert.equal(system, 'Prompt Router: suggests a new session on gpt-6.1-terra · medium (unrelated feature)')
  assert.match(context, /"New session \(gpt-6\.1-terra · medium\)", "Subagent \(gpt-6\.1-terra · medium\)", "Do it here"/)
  assert.match(context, /codex -m gpt-6\.1-terra -c model_reasoning_effort=medium "</)
  assert.match(context, /spawn_agent tool with model "gpt-6\.1-terra" and reasoning_effort "medium"/)
})

test('subagent: the options and the switch line for doing it here', async () => {
  const { context } = await send('run the tests', { reply: PICK.subagent })
  assert.match(context, /"Subagent \(gpt-6-luna · low\)", "Do it here \(Low\)", "Do it here \(keep Medium\)"/)
  assert.match(context, /`\/model gpt-6\.1-sol low`/)
})

test('a prompt typed over a running turn keeps its setting', async () => {
  assert.equal((await send('also that one', { reply: PICK.here, turn: 't3' })).r, null)
})

test('custom model mapping and Fable from the models cache', async () => {
  const h = home({ models: { opus: 'my-sol' } })
  writeFileSync(join(h, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6-astra', supported_reasoning_levels: [{ effort: 'low' }] }, { slug: 'my-sol', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }] }] }))
  const { calls, system } = await send('fix it properly', { codexHome: h, model: 'gpt-6.1-terra', reply: '{"where":"subagent","model":"opus","effort":"max","why":"x"}' })
  assert.match(calls[0].prompt, /haiku\|sonnet\|opus\|fable/)
  assert.equal(system, 'Prompt Router: suggests a subagent on my-sol · medium (x)')
})

test('a failing classifier or an unparsed reply passes the prompt untouched', async () => {
  await assert.rejects(send('x', { reply: new Error('boom') }))
  const { r, home: h } = await send('x', { reply: 'no json here' })
  assert.equal(r, null)
  assert.match(readFileSync(join(h, 'log', 'prompt-router.log'), 'utf8'), /parse: reply could not be parsed/)
})

test('/router: status, off and on, persisted in the options file', async () => {
  const h = home({ effortMode: 'auto' })
  const status = await send('/router', { codexHome: h })
  assert.match(status.system, /^Prompt Router is on \(classifier gpt-6-luna, effort mode auto, model mode ask\)\.\nThis chat runs on gpt-6\.1-sol, effort Medium\./)
  assert.match(status.context, /Reply with exactly the text below/)
  assert.equal(status.calls.length, 0)
  assert.equal((await send('/router off', { codexHome: h })).system, 'Prompt Router is off. Turn it back on with /router on.')
  assert.deepEqual(JSON.parse(readFileSync(join(h, 'prompt-router.json'), 'utf8')), { effortMode: 'auto', enabled: false })
  const off = await send('rename that', { codexHome: h, reply: PICK.here })
  assert.equal(off.r, null)
  assert.equal(off.calls.length, 0)
  await send('/router on', { codexHome: h })
  assert.notEqual((await send('rename that', { codexHome: h, reply: PICK.here })).r, null)
})

test('other slash commands are left alone', async () => {
  const { r, calls } = await send('/review', { reply: PICK.here })
  assert.equal(r, null)
  assert.equal(calls.length, 0)
})

test('the script: skips itself in the classifier run, and prints nothing on bad input', () => {
  const env = { ...process.env, CODEX_HOME: home() }
  const input = JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: '/router', transcript_path: FIXTURE, model: 'gpt-6.1-sol' })
  assert.equal(execFileSync(process.execPath, [HOOK], { env: { ...env, PROMPT_ROUTER_INNER: '1' }, input, encoding: 'utf8' }), '')
  assert.equal(execFileSync(process.execPath, [HOOK], { env, input: 'not json', encoding: 'utf8' }), '')
  const r = JSON.parse(execFileSync(process.execPath, [HOOK], { env, input, encoding: 'utf8' }))
  assert.equal(r.hookSpecificOutput.hookEventName, 'UserPromptSubmit')
  assert.match(r.systemMessage, /^Prompt Router is on/)
})

// A stand-in for the codex binary: answers through -o, or hangs.
function fakeCodex(body: string) {
  const f = join(tmp(), 'codex')
  writeFileSync(f, `#!/bin/sh\n${body}\n`)
  chmodSync(f, 0o755)
  return f
}

test('codexRunner: passes the flags and the inner env, reads the -o answer', async () => {
  const log = join(tmp(), 'args')
  const bin = fakeCodex(`echo "$PROMPT_ROUTER_INNER $@" > ${log}; cat > ${log}.in; while [ "$1" != "-o" ]; do shift; done; echo '{"where":"here"}' > "$2"`)
  process.env.PROMPT_ROUTER_CODEX = bin
  try {
    assert.equal((await codexRunner('the prompt', { model: 'gpt-6-luna', effort: 'low', timeoutMs: 5000 })).trim(), '{"where":"here"}')
  } finally {
    delete process.env.PROMPT_ROUTER_CODEX
  }
  const args = readFileSync(log, 'utf8')
  assert.match(args, /^1 exec -m gpt-6-luna -c model_reasoning_effort=low -c mcp_servers\.prompt_router\.enabled=false --ephemeral --skip-git-repo-check -s read-only --json --output-schema \S+ -o \S+ -C \S+ -$/m)
  assert.equal(readFileSync(`${log}.in`, 'utf8'), 'the prompt')
})

test('codexRunner: times out and kills the child', async () => {
  const pidFile = join(tmp(), 'pid')
  process.env.PROMPT_ROUTER_CODEX = fakeCodex(`echo $$ > ${pidFile}; sleep 30`)
  try {
    await assert.rejects(codexRunner('x', { model: 'm', effort: 'low', timeoutMs: 1500 }), /timed out/)
  } finally {
    delete process.env.PROMPT_ROUTER_CODEX
  }
  await new Promise(r => setTimeout(r, 100))
  const pid = Number(readFileSync(pidFile, 'utf8'))
  assert.throws(() => process.kill(pid, 0))
})

// The desktop app runs the hook with a PATH that has no Homebrew bin, so a bare `codex` is not found.
test('the classifier finds codex without it on PATH', () => {
  const dir = mkdtempSync(join(tmpdir(), 'pr-bin-'))
  const bin = join(dir, 'codex')
  writeFileSync(bin, '')
  assert.equal(codexBin({ PATH: '/usr/bin:/bin' }, [bin]), bin)
  assert.equal(codexBin({ PATH: '/usr/bin:/bin', PROMPT_ROUTER_CODEX: '/x/codex' }, [bin]), '/x/codex')
  assert.equal(codexBin({ PATH: '/usr/bin:/bin' }, [join(dir, 'missing')]), 'codex')
})

test('the classifier child gets node and codex folders on PATH', () => {
  const p = childPath({ PATH: '/usr/bin:/bin', PROMPT_ROUTER_CODEX: '/b/codex' }, '/n/bin/node').split(':')
  assert.deepEqual(p.slice(0, 2), ['/n/bin', '/b'])
  assert.ok(p.includes('/usr/bin'))
})
