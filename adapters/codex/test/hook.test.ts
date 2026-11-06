import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { CHECKED, REUSE_MS, childPath, classifierArgs, codexBin, codexRunner, codexSpawn, configDefaults, effortFor, isAppRequest, needsUserConfig, readHistory, recentAnswer } from '../hook.ts'
import type { Output } from '../hook.ts'
import { readStats } from '../stats.ts'
import { FIXTURE, PICK, home, send, tmp } from './helpers.ts'

const checked = (r: Output | null) => r?.hookSpecificOutput?.additionalContext === CHECKED && !r.systemMessage

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
  assert.equal(checked((await send('rename that variable', { reply: PICK.same })).r), true)
  assert.equal(checked((await send('yes, go on', { reply: PICK.keep })).r), true)
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
  assert.equal(checked((await send('also that one', { reply: PICK.here, turn: 't3' })).r), true)
})

test('custom model mapping and Fable from the models cache', async () => {
  const h = home({ models: { opus: 'my-sol' } })
  writeFileSync(join(h, 'models_cache.json'), JSON.stringify({ models: [{ slug: 'gpt-6-astra', supported_reasoning_levels: [{ effort: 'low' }] }, { slug: 'my-sol', supported_reasoning_levels: [{ effort: 'low' }, { effort: 'medium' }] }] }))
  const { calls, system } = await send('fix it properly', { codexHome: h, model: 'gpt-6.1-terra', reply: '{"where":"subagent","model":"opus","effort":"max","why":"x"}' })
  assert.match(calls[0].prompt, /haiku\|sonnet\|opus\|fable/)
  assert.equal(system, 'Prompt Router: suggests a subagent on my-sol · medium (x)')
})

test('a failing classifier or an unparsed reply leaves only the neutral note', async () => {
  const failed = await send('fix it', { reply: new Error('boom') })
  assert.equal(checked(failed.r), true)
  assert.equal(failed.system, '')
  assert.match(readFileSync(join(failed.home, 'log', 'prompt-router.log'), 'utf8'), /classifier: boom/)
  const { r, home: h } = await send('fix it', { reply: 'no json here' })
  assert.equal(checked(r), true)
  assert.match(readFileSync(join(h, 'log', 'prompt-router.log'), 'utf8'), /parse: reply could not be parsed/)
})

test('the neutral note names no decision and no model', () => {
  assert.match(CHECKED, /^\[Prompt Router: /)
  assert.doesNotMatch(CHECKED, /gpt|model|effort|subagent|session/i)
  // A quick reply such as "1" may answer a question the agent asked: the note must not hide it.
  assert.match(CHECKED, /answers a question you asked, act on/i)
  assert.doesNotMatch(CHECKED, /do not mention/i)
})

test('the hook remembers its answer for MCP route, by chat and prompt key, for REUSE_MS', async () => {
  const { home: h, context } = await send('Rename  THAT variable', { reply: PICK.here, now: 1_000_000 })
  assert.equal(await recentAnswer(h, 's1', 'rename that variable', 1_000_000 + REUSE_MS - 1), context)
  assert.equal(await recentAnswer(h, '', 'rename that variable', 1_000_001), context)
  assert.equal(await recentAnswer(h, 's2', 'rename that variable', 1_000_001), null)
  assert.equal(await recentAnswer(h, 's1', 'something else', 1_000_001), null)
  assert.equal(await recentAnswer(h, 's1', 'rename that variable', 1_000_000 + REUSE_MS), null)
  const kept = await send('yes, go on', { reply: PICK.keep, now: 2_000_000 })
  assert.equal(await recentAnswer(kept.home, 's1', 'yes, go on', 2_000_001), CHECKED)
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
  assert.match(args, /^1 exec -m gpt-6-luna -c model_reasoning_effort=low --ignore-user-config --ignore-rules -c model_instructions_file="\S+instructions\.md" -c web_search="disabled" (--disable \w+ )+(-c include_\w+=false )+--ephemeral --skip-git-repo-check -s read-only --json --output-schema \S+ -o \S+ -C \S+ -$/m)
  for (const f of ['multi_agent', 'apps', 'plugins', 'hooks', 'shell_tool', 'unified_exec']) assert.match(args, new RegExp(`--disable ${f} `))
  assert.equal(readFileSync(`${log}.in`, 'utf8'), 'the prompt')
})

test('classifierArgs: the plain args keep the user config with only our MCP server off', () => {
  const t = { file: '/t/s.json', out: '/t/o', dir: '/t', instructions: 'C:\\t\\i.md' }
  assert.deepEqual(classifierArgs({ model: 'm', effort: 'low' }, t, false), ['exec', '-m', 'm', '-c', 'model_reasoning_effort=low', '-c', 'mcp_servers.prompt_router.enabled=false', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '--output-schema', '/t/s.json', '-o', '/t/o', '-C', '/t', '-'])
  // A Windows path stays a valid TOML string (backslashes escaped).
  assert.ok(classifierArgs({ model: 'm', effort: 'low' }, t, true).includes('model_instructions_file="C:\\\\t\\\\i.md"'))
})

test('needsUserConfig: a custom provider or endpoint keeps the user config', () => {
  assert.equal(needsUserConfig('model = "gpt-6.1-sol"\n[tui]\n'), false)
  assert.equal(needsUserConfig('model_provider = "azure"\n'), true)
  assert.equal(needsUserConfig('openai_base_url = "https://x"\n'), true)
  assert.equal(needsUserConfig('model = "x"\n[model_providers.azure]\nname = "Azure"\n'), true)
})

test('needsUserConfig: where the login is kept or forced keeps the user config (the light run would not find it)', () => {
  assert.equal(needsUserConfig('cli_auth_credentials_store = "keyring"\n'), true)
  assert.equal(needsUserConfig('forced_login_method = "api"\n'), true)
  assert.equal(needsUserConfig('forced_chatgpt_workspace_id = "ws"\n'), true)
})

test('codexRunner: a Codex that rejects a light flag gets the plain args', async () => {
  const log = join(tmp(), 'args')
  const bin = fakeCodex(`echo "$@" >> ${log}; cat > /dev/null; case "$*" in *--ignore-user-config*) echo "Error: Unknown feature flag: sleep_tool" >&2; exit 1;; esac; while [ "$1" != "-o" ]; do shift; done; echo '{"where":"keep"}' > "$2"`)
  process.env.PROMPT_ROUTER_CODEX = bin
  try {
    assert.equal((await codexRunner('x', { model: 'm', effort: 'low', timeoutMs: 5000 })).trim(), '{"where":"keep"}')
  } finally {
    delete process.env.PROMPT_ROUTER_CODEX
  }
  const runs = readFileSync(log, 'utf8').trim().split('\n')
  assert.equal(runs.length, 2)
  assert.match(runs[1], /mcp_servers\.prompt_router\.enabled=false/)
  assert.doesNotMatch(runs[1], /--ignore-user-config/)
})

test('codexRunner: a custom provider in config.toml runs with the plain args', async () => {
  const log = join(tmp(), 'args')
  const h = tmp()
  writeFileSync(join(h, 'config.toml'), 'model_provider = "azure"\n')
  const bin = fakeCodex(`echo "$@" >> ${log}; cat > /dev/null; while [ "$1" != "-o" ]; do shift; done; echo '{"where":"keep"}' > "$2"`)
  process.env.PROMPT_ROUTER_CODEX = bin
  const old = process.env.CODEX_HOME
  process.env.CODEX_HOME = h
  try {
    await codexRunner('x', { model: 'm', effort: 'low', timeoutMs: 5000 })
  } finally {
    delete process.env.PROMPT_ROUTER_CODEX
    if (old === undefined) delete process.env.CODEX_HOME
    else process.env.CODEX_HOME = old
  }
  assert.doesNotMatch(readFileSync(log, 'utf8'), /--ignore-user-config/)
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

// Here on another model: switching this chat's model would break the prompt cache, so the router
// offers a subagent on that model or staying here with only the effort judged again.
const OTHER = {
  lower: '{"where": "here", "model": "sonnet", "effort": "low", "why": "a mechanical edit"}',
  lowerSame: '{"where": "here", "model": "sonnet", "effort": "medium", "why": "a mechanical edit"}',
  higher: '{"where": "here", "model": "opus", "effort": "high", "why": "new logic"}',
}

test('mid-chat, the classifier is asked which model the task needs, also for here', async () => {
  const { calls } = await send('rename the keys we just found', { reply: OTHER.lower })
  assert.doesNotMatch(calls[0].prompt, /for here use the current one/)
  assert.match(calls[0].prompt, /MODEL \(the model the task needs, also for here/)
})

test('here on a cheaper model (ask): offers a subagent or staying here, switches nothing', async () => {
  const { context, system } = await send('rename the keys we just found', { reply: OTHER.lower, options: { effortMode: 'ask', modelMode: 'ask' } })
  assert.match(context, /^\[Prompt Router/)
  assert.match(context, /fits gpt-6\.1-terra · low better than this chat's gpt-6\.1-sol, because: a mechanical edit/)
  assert.match(context, /ask the user in one short message/)
  assert.match(context, /"Subagent \(gpt-6\.1-terra · low\)", "Stay here \(Low\)", "Stay here \(keep Medium\)"/)
  assert.match(context, /spawn_agent tool with model "gpt-6\.1-terra" and reasoning_effort "low"/)
  assert.match(context, /give it everything it needs from this chat/)
  assert.match(context, /if this session has no spawn_agent tool, say so in one line and do it here/)
  assert.match(context, /"Stay here \(Low\)" = give the user the line "Prompt Router: for this, switch with `\/model gpt-6\.1-sol low`"/)
  assert.match(context, /never switch this chat's model/)
  assert.doesNotMatch(context, /\/model gpt-6\.1-terra/)
  assert.doesNotMatch(context, /New session/)
  assert.doesNotMatch(context, /AskUserQuestion/)
  assert.equal(system, 'Prompt Router: suggests a subagent on gpt-6.1-terra · low (a mechanical edit)')
})

test('here on a stronger model: the same offer, the chat model stays', async () => {
  const { context } = await send('now work out the sync logic for it', { reply: OTHER.higher, model: 'gpt-6-luna' })
  assert.match(context, /fits gpt-6\.1-sol · high better than this chat's gpt-6-luna, because: new logic/)
  assert.match(context, /"Subagent \(gpt-6\.1-sol · high\)", "Stay here \(High\)", "Stay here \(keep Medium\)"/)
  assert.match(context, /spawn_agent tool with model "gpt-6\.1-sol" and reasoning_effort "high"/)
  assert.match(context, /`\/model gpt-6-luna high`/)
  assert.doesNotMatch(context, /\/model gpt-6\.1-sol/)
})

test('here on another model (auto): one Stay here option that switches only the effort', async () => {
  const { context } = await send('rename the keys we just found', { reply: OTHER.lower, options: { effortMode: 'auto', modelMode: 'auto' } })
  assert.match(context, /"Subagent \(gpt-6\.1-terra · low\)", "Stay here \(Low\)"/)
  assert.doesNotMatch(context, /keep Medium/)
  assert.match(context, /"Stay here \(Low\)" = give the user the line "Prompt Router: for this, switch with `\/model gpt-6\.1-sol low`"/)
  // The question comes first: no "begin your reply with" line before the user picks.
  assert.doesNotMatch(context, /Begin your reply with/)
})

test('here on another model at the same effort: Stay here just goes on', async () => {
  const { context } = await send('rename the keys we just found', { reply: OTHER.lowerSame })
  assert.match(context, /"Subagent \(gpt-6\.1-terra · medium\)", "Stay here"/)
  assert.match(context, /"Stay here" = continue normally/)
  assert.doesNotMatch(context, /\/model/)
})

test('modelMode off: here on another model only judges the effort, as before', async () => {
  const { context, system, calls } = await send('rename the keys we just found', { reply: OTHER.lower, options: { effortMode: 'auto', modelMode: 'off' } })
  assert.match(calls[0].prompt, /for here use the current one/)
  assert.equal(system, 'Prompt Router: for this, switch with `/model gpt-6.1-sol low` (a mechanical edit)')
  assert.match(context, /Begin your reply with/)
  assert.doesNotMatch(context, /Subagent/)
})

test('here on another model typed over a running turn: nothing changes', async () => {
  assert.equal(checked((await send('and rename these too', { reply: OTHER.lower, turn: 't3' })).r), true)
})

test('here on another model when the chat model is unknown: as before', async () => {
  const { context, system, calls } = await send('rename the keys we just found', { reply: OTHER.lower, model: 'some-custom-model', options: { effortMode: 'auto', modelMode: 'auto' } })
  assert.match(calls[0].prompt, /for here use the current one/)
  assert.equal(system, 'Prompt Router: for this, switch with `/model some-custom-model low` (a mechanical edit)')
  assert.doesNotMatch(context, /Subagent/)
})

// One switch per feature (0.8.0), read from ~/.codex/prompt-router.json like the real hook.
test('effortDetection off: no effort line and no level in the options', async () => {
  assert.equal(checked((await send('rename that variable', { reply: PICK.here, options: { effortDetection: 'off' } })).r), true)
  const s = await send('run the tests', { reply: PICK.subagent, options: { effortDetection: 'off' } })
  assert.match(s.context, /"Subagent \(gpt-6-luna · low\)", "Do it here"\./)
  assert.doesNotMatch(s.context, /Do it here \(/)
  const o = await send('rename the keys we just found', { reply: OTHER.lower, options: { effortDetection: 'off' } })
  assert.match(o.context, /"Subagent \(gpt-6\.1-terra · low\)", "Stay here"\./)
  assert.doesNotMatch(o.context, /\/model/)
})

test('firstChatDetection off: the first prompt keeps the model, the effort is still judged', async () => {
  const { context, system } = await send('rename foo', { reply: PICK.first, transcript: null, options: { firstChatDetection: 'off', effortDetection: 'auto' } })
  assert.equal(system, 'Prompt Router: for this, switch with `/model gpt-6.1-sol low` (mechanical rename)')
  assert.doesNotMatch(context, /gpt-6\.1-terra/)
})

test('midChatModelDetection off: no Subagent / Stay here question, only the effort', async () => {
  const { context, calls } = await send('rename the keys we just found', { reply: OTHER.lower, options: { midChatModelDetection: 'off' } })
  assert.match(calls[0].prompt, /for here use the current one/)
  assert.doesNotMatch(context, /Subagent|Stay here/)
  assert.match(context, /suggests effort low instead of medium/)
})

test('midChatModelDetection auto: no question, the agent decides between spawn_agent and here', async () => {
  const { context } = await send('rename the keys we just found', { reply: OTHER.lower, options: { midChatModelDetection: 'auto', effortDetection: 'auto' } })
  assert.doesNotMatch(context, /ask the user in one short message|Where should this go/)
  assert.match(context, /Do not ask the user; decide yourself/)
  assert.match(context, /only when it is worth it: a larger self-contained piece of work/)
  assert.match(context, /a quick question, a short answer or a short message stays here/)
  assert.match(context, /Subagent = call the spawn_agent tool with model "gpt-6\.1-terra" and reasoning_effort "low"/)
  assert.match(context, /Here = give the user the line "Prompt Router: for this, switch with `\/model gpt-6\.1-sol low`"/)
  assert.match(context, /never switch this chat's model/)
  assert.match(context, /tell the user in one sentence what you chose/)
})

test('midChatModelDetection auto with effortDetection off: staying here changes nothing', async () => {
  const { context } = await send('rename the keys we just found', { reply: OTHER.lower, options: { midChatModelDetection: 'auto', effortDetection: 'off' } })
  assert.doesNotMatch(context, /ask the user in one short message|\/model /)
  assert.match(context, /Here = handle the prompt normally/)
})

test('subagentSuggestions off: a subagent pick is handled as here', async () => {
  const { context } = await send('run the tests', { reply: '{"where": "subagent", "model": "opus", "effort": "low", "why": "just run the tests"}', options: { subagentSuggestions: 'off' } })
  assert.doesNotMatch(context, /in a subagent|spawn_agent/)
  assert.match(context, /suggests effort low instead of medium/)
})

test('sessionSuggestions off: a session pick is handled as here', async () => {
  assert.equal(checked((await send('build the billing page', { reply: '{"where": "session", "model": "opus", "effort": "medium", "why": "unrelated"}', options: { sessionSuggestions: 'off' } })).r), true)
})

test('notifications off: the auto line is still given, but no system message', async () => {
  const { context, system } = await send('rename that variable', { reply: PICK.here, options: { effortDetection: 'auto', notifications: 'off' } })
  assert.equal(system, '')
  assert.match(context, /Begin your reply with exactly this one line/)
})

test('old keys still work when the new ones are missing; modelMode off turns off both model checks', async () => {
  const a = await send('rename that variable', { reply: PICK.here, options: { effortMode: 'auto' } })
  assert.match(a.context, /Begin your reply with/)
  const first = await send('rename foo', { reply: PICK.first, transcript: null, options: { modelMode: 'off', effortMode: 'auto' } })
  assert.doesNotMatch(first.context, /gpt-6\.1-terra/)
  const mid = await send('rename the keys we just found', { reply: OTHER.lower, options: { modelMode: 'off', effortMode: 'auto' } })
  assert.doesNotMatch(mid.context, /Subagent/)
  const both = await send('rename that variable', { reply: PICK.here, options: { effortDetection: 'ask', effortMode: 'auto' } })
  assert.match(both.context, /"Switch \(Low\)", "Keep as is"/)
})

test('/router prints every option with its value and where it came from', async () => {
  const { system } = await send('/router', { options: { effortMode: 'auto', notifications: 'off' } })
  assert.match(system, /effortDetection: auto \(old key effortMode; rename it to effortDetection\)/)
  assert.match(system, /notifications: off \(set\)/)
  assert.match(system, /classifier: light \(default\)/)
  for (const k of ['project', 'rules', 'language', 'firstChatDetection', 'midChatModelDetection', 'subagentSuggestions', 'sessionSuggestions']) assert.match(system, new RegExp(`${k}: .*\\(default\\)`))
})

test('the first prompt of a chat logs the effective options', async () => {
  const { home: h } = await send('rename foo', { reply: PICK.first, transcript: null, options: { effortDetection: 'off' } })
  const log = readFileSync(join(h, 'log', 'prompt-router.log'), 'utf8')
  assert.match(log, /effective options: .*effortDetection=off/)
  const later = await send('rename that', { reply: PICK.same, options: { effortDetection: 'off' } })
  let text = ''
  try {
    text = readFileSync(join(later.home, 'log', 'prompt-router.log'), 'utf8')
  } catch {
    text = ''
  }
  assert.doesNotMatch(text, /effective options/)
})

// newSessionAt: a rollout whose last request held `tokens` of a `window` (none: the field is left out).
function longChat(tokens: number, window?: number) {
  const f = join(tmp(), 'r.jsonl')
  const w = window === undefined ? '' : `,"model_context_window":${window}`
  writeFileSync(f, readFileSync(FIXTURE, 'utf8').replace('"total_tokens":41000}', `"total_tokens":${tokens}}`).replace(',"model_context_window":258400', w))
  return f
}
const HERE_NEW = '{"where": "here", "model": "opus", "effort": "medium", "work": "new", "why": "a new screen"}'

test('readHistory: the context window from the token count', async () => {
  assert.equal((await readHistory(FIXTURE)).window, 258400)
  assert.equal((await readHistory(longChat(1000))).window, undefined)
})

test('newSessionAt: new work past half of the context window is offered as a new session', async () => {
  const { context, system } = await send('now add a favourites screen', { reply: HERE_NEW, transcript: longChat(150_000, 258_400) })
  assert.match(system, /new session/)
  assert.match(system, /58% of context/)
  assert.match(context, /"New session \(gpt-6\.1-sol · medium\)"/)
})

test('newSessionAt: without a window the chat counts against 200k', async () => {
  assert.match((await send('now add a favourites screen', { reply: HERE_NEW, transcript: longChat(150_000) })).system, /75% of context/)
})

test('newSessionAt: a continuation goes to a session too; a big window or the option off stays here', async () => {
  const goOn = HERE_NEW.replace('"new"', '"continue"')
  assert.match((await send('fix it', { reply: goOn, transcript: longChat(200_000, 258_400) })).system, /new session/)
  assert.equal(checked((await send('now add a favourites screen', { reply: HERE_NEW, transcript: longChat(150_000, 1_000_000) })).r), true)
  assert.equal(checked((await send('now add a favourites screen', { reply: HERE_NEW, transcript: longChat(200_000, 258_400), options: { newSessionAt: 'off' } })).r), true)
  assert.equal(checked((await send('now add a favourites screen', { reply: HERE_NEW, transcript: longChat(200_000, 258_400), options: { sessionSuggestions: 'off' } })).r), true)
})

// subagentSuggestions auto: the subagent starts with no "Where should this go?".
test('subagentSuggestions auto: a subagent pick runs right away and is logged as applied', async () => {
  const { context, system, home: h } = await send('run the tests', { reply: PICK.subagent, options: { subagentSuggestions: 'auto' } })
  assert.doesNotMatch(context, /Where should this go/)
  assert.match(context, /start the subagent right away/)
  assert.match(context, /tell the user in one sentence/)
  assert.match(context, /spawn_agent tool with model "gpt-6-luna" and reasoning_effort "low"/)
  assert.match(system, /^Prompt Router: subagent gpt-6-luna · low/)
  const d = readStats(h).find(r => r.kind === 'decision')
  assert.equal(d?.kind === 'decision' && d.outcome, 'applied')
  assert.equal(d?.kind === 'decision' && d.where, 'subagent')
})

test('subagentSuggestions auto: another model mid-chat runs a subagent on it, without a system line when notifications are off', async () => {
  const { context, system } = await send('work out the sync logic', { reply: OTHER.higher, model: 'gpt-6.1-terra', options: { subagentSuggestions: 'auto', notifications: 'off' } })
  assert.doesNotMatch(context, /Where should this go/)
  assert.match(context, /fits gpt-6\.1-sol · high better than this chat's gpt-6\.1-terra/)
  assert.match(context, /give it everything it needs from this chat/)
  assert.equal(system, '')
})

test('subagentSuggestions auto does not override midChatModelDetection auto (the agent decides)', async () => {
  const { context } = await send('rename the keys we just found', { reply: OTHER.lower, options: { subagentSuggestions: 'auto', midChatModelDetection: 'auto' } })
  assert.doesNotMatch(context, /start the subagent right away/)
  assert.match(context, /decide yourself/)
})

// Codex strict structured output: every property listed in required, the optional ones nullable.
test('codexRunner: the output schema has every field the classifier template asks for', async () => {
  const copy = join(tmp(), 'schema.json')
  process.env.PROMPT_ROUTER_CODEX = fakeCodex(`s=""; o=""; while [ $# -gt 0 ]; do case "$1" in --output-schema) s="$2";; -o) o="$2";; esac; shift; done; cat > /dev/null; cp "$s" ${copy}; echo '{"where":"here"}' > "$o"`)
  try {
    await codexRunner('x', { model: 'm', effort: 'low', timeoutMs: 5000 })
  } finally {
    delete process.env.PROMPT_ROUTER_CODEX
  }
  const schema = JSON.parse(readFileSync(copy, 'utf8'))
  const asked = ['where', 'model', 'effort', 'work', 'why', 'follows', 'note']
  for (const k of asked) assert.ok(schema.properties[k], `schema lacks ${k}`)
  assert.deepEqual([...schema.required].sort(), Object.keys(schema.properties).sort())
  assert.deepEqual(schema.properties.work.enum, ['new', 'continue', null])
  assert.deepEqual(schema.properties.follows.enum, ['continues', 'corrects', 'new', null])
  assert.deepEqual(schema.properties.note.type, ['string', 'null'])
})

test('/router off leaves an options file it cannot read and logs the error', async () => {
  const h = home()
  const file = join(h, 'prompt-router.json')
  writeFileSync(file, '{"classifier": "strong",')
  const { system } = await send('/router off', { codexHome: h })
  assert.equal(readFileSync(file, 'utf8'), '{"classifier": "strong",')
  assert.match(system, /could not read/)
  assert.match(readFileSync(join(h, 'log', 'prompt-router.log'), 'utf8'), /router off/)
})

test('an invalid classifier value falls back to the Codex default, light', async () => {
  const { calls } = await send('fix it', { options: { classifier: 'bogus' } })
  assert.equal(calls[0].model, 'gpt-6-luna')
})

// The desktop app asks its own model things through the same chat machinery (e.g. a suggested next
// prompt); those are no user prompts: no classifier, no note, no stats.
const APP_REQUEST = 'This is an app-generated request for a suggested next user message. Based on the conversation so far, suggest one short follow-up.'

test('app-generated requests are skipped: no classifier, no note, no decision', async () => {
  const { r, calls, home: h } = await send(APP_REQUEST, { reply: PICK.here })
  assert.equal(r, null)
  assert.equal(calls.length, 0)
  assert.equal(readStats(h).filter(x => x.kind === 'decision').length, 0)
  assert.equal(isAppRequest('  this is an App-Generated request for a title'), true)
  assert.equal(isAppRequest('why is this an app-generated request?'), false)
})

test('app-generated requests in the rollout do not count as user prompts', async () => {
  const f = join(tmp(), 'r.jsonl')
  const msg = (text: string) => ({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] } })
  writeFileSync(f, [msg('opravit login'), msg(APP_REQUEST)].map(l => JSON.stringify(l)).join('\n') + '\n')
  assert.deepEqual((await readHistory(f)).users, ['opravit login'])
})

// Windows: npm puts codex.cmd (a batch shim) on PATH, a standalone install codex.exe.
test('codexBin on Windows: codex.exe or codex.cmd on PATH (;), else %APPDATA%\\npm', () => {
  const have = (...files: string[]) => (f: string) => files.includes(f)
  const env = { PATH: 'C:\\Windows;C:\\Users\\x\\AppData\\Roaming\\npm', APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }
  assert.equal(codexBin(env, undefined, 'win32', have('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')), 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')
  assert.equal(codexBin(env, undefined, 'win32', have('C:\\Windows\\codex.exe', 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')), 'C:\\Windows\\codex.exe')
  // The desktop app's short PATH: the npm folder from APPDATA.
  assert.equal(codexBin({ Path: 'C:\\Windows', APPDATA: env.APPDATA }, undefined, 'win32', have('C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')), 'C:\\Users\\x\\AppData\\Roaming\\npm\\codex.cmd')
  assert.equal(codexBin(env, undefined, 'win32', have()), 'codex')
})

test('codexSpawn: a codex.cmd shim runs its codex.js with node, no shell; anything else runs as it is', () => {
  const js = 'C:\\npm\\node_modules\\@openai\\codex\\bin\\codex.js'
  assert.deepEqual(codexSpawn('C:\\npm\\codex.cmd', 'win32', f => f === js, 'C:\\node\\node.exe'), { file: 'C:\\node\\node.exe', args: [js], shell: false })
  // A shim without the package next to it: through the shell, as Windows runs a .cmd.
  assert.deepEqual(codexSpawn('C:\\npm\\codex.cmd', 'win32', () => false, 'node'), { file: 'C:\\npm\\codex.cmd', args: [], shell: true })
  assert.deepEqual(codexSpawn('C:\\bin\\codex.exe', 'win32', () => true, 'node'), { file: 'C:\\bin\\codex.exe', args: [], shell: false })
  assert.deepEqual(codexSpawn('/opt/homebrew/bin/codex', 'darwin', () => true, 'node'), { file: '/opt/homebrew/bin/codex', args: [], shell: false })
})

test('a plain reply ("yes", "option 2") gets the neutral note with no classifier call, and no decision', async () => {
  for (const prompt of ['yes, go on', 'option 2', 'ano']) {
    const { r, calls, home: h } = await send(prompt)
    assert.equal(calls.length, 0)
    assert.equal(checked(r), true)
    assert.deepEqual(readStats(h), [])
    // route reuses that answer.
    assert.equal(await recentAnswer(h, 's1', prompt, Date.now()), CHECKED)
  }
})
