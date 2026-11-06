import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { codexRunner, handleStop } from '../hook.ts'
import { appendStats, classifierUsage, codexUsage, readStats, statsPath, statsReport, turnUsage } from '../stats.ts'
import type { Decision, Entry, Turn } from '../../../plugins/prompt-router/core/stats.ts'
import { promptKey } from '../../../plugins/prompt-router/core/router.ts'
import { PICK, home, never, send, tmp } from './helpers.ts'

const HOOK = fileURLToPath(new URL('../hook.ts', import.meta.url))
const DAY = 86_400_000

const ev = (type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: '2026-10-30T10:00:00.000Z', type, payload })
const started = (id: string) => ev('event_msg', { type: 'task_started', turn_id: id })
const ctx = (id: string, model: string) => ev('turn_context', { turn_id: id, model, effort: 'medium' })
const tokens = (total: Record<string, number>) => ev('event_msg', { type: 'token_count', info: { total_token_usage: total, last_token_usage: {} } })

// Two turns: the chat started on gpt-6.1-sol, the second turn ran on gpt-6-luna.
function rollout(lines: string[]) {
  const f = join(tmp(), 'rollout.jsonl')
  writeFileSync(f, `${lines.join('\n')}\n`)
  return f
}
const TWO_TURNS = [
  started('t1'),
  ctx('t1', 'gpt-6.1-sol'),
  tokens({ input_tokens: 1000, cached_input_tokens: 200, output_tokens: 100, total_tokens: 1100 }),
  'not json',
  started('t2'),
  ctx('t2', 'gpt-6-luna'),
  tokens({ input_tokens: 1500, cached_input_tokens: 300, output_tokens: 150, total_tokens: 1650 }),
  tokens({ input_tokens: 3000, cached_input_tokens: 1200, cache_write_input_tokens: 50, output_tokens: 400, total_tokens: 3400 }),
]

test('codexUsage: cached input is a cache read, not also input', () => {
  assert.deepEqual(codexUsage({ input_tokens: 1000, cached_input_tokens: 600, cache_write_input_tokens: 20, output_tokens: 50, reasoning_output_tokens: 30 }), { input: 400, output: 50, cacheRead: 600, cacheWrite: 20 })
  assert.deepEqual(codexUsage({}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.equal(codexUsage(null), null)
})

test('classifierUsage: the usage of the last turn.completed in the codex exec --json stream', () => {
  const out = [
    '{"type":"thread.started","thread_id":"x"}',
    'garbage',
    '{"type":"item.completed","item":{"type":"agent_message","text":"{}"}}',
    '{"type":"turn.completed","usage":{"input_tokens":5000,"cached_input_tokens":4000,"output_tokens":80}}',
  ].join('\n')
  assert.deepEqual(classifierUsage(out), { input: 1000, output: 80, cacheRead: 4000, cacheWrite: 0 })
  assert.equal(classifierUsage('{"type":"turn.failed"}'), null)
})

test('turnUsage: the last turn is the growth of total_token_usage since the turn before', () => {
  const t = turnUsage(TWO_TURNS.join('\n'))
  assert.equal(t.model, 'gpt-6-luna')
  assert.equal(t.baseline, 'gpt-6.1-sol')
  // 3000-1000 input, of it 1200-200 cached; 400-100 output; 50 cache write.
  assert.deepEqual(t.usage, { input: 1000, output: 300, cacheRead: 1000, cacheWrite: 50 })
})

test('turnUsage: the first turn counts from zero; a turn with no token count has no usage', () => {
  assert.deepEqual(turnUsage(TWO_TURNS.slice(0, 3).join('\n')).usage, { input: 800, output: 100, cacheRead: 200, cacheWrite: 0 })
  const cut = turnUsage([...TWO_TURNS.slice(0, 3), started('t2'), ctx('t2', 'gpt-6-luna')].join('\n'))
  assert.equal(cut.usage, undefined)
  assert.equal(cut.model, 'gpt-6-luna')
})

test('Stop: writes the turn with the chat start model as the baseline', async () => {
  const h = home()
  await handleStop({ session_id: 's9', hook_event_name: 'Stop', transcript_path: rollout(TWO_TURNS), turn_id: 't2' }, { codexHome: h, now: 1000 })
  const [t] = readStats(h) as Turn[]
  assert.deepEqual(t, { kind: 'turn', ts: 1000, platform: 'codex', chat: 's9', model: 'gpt-6-luna', baseline: 'gpt-6.1-sol', usage: { input: 1000, output: 300, cacheRead: 1000, cacheWrite: 50 } })
})

test('SubagentStop: the subagent rollout, the main chat model as the baseline', async () => {
  const h = home()
  const parent = rollout([started('t1'), ctx('t1', 'gpt-6-astra'), started('t2'), ctx('t2', 'gpt-6.1-sol')])
  const child = rollout([started('a1'), ctx('a1', 'gpt-6-luna'), tokens({ input_tokens: 700, output_tokens: 70 })])
  await handleStop({ session_id: 's9', hook_event_name: 'SubagentStop', transcript_path: parent, agent_transcript_path: child, agent_id: 'ag1' }, { codexHome: h, now: 2000 })
  const [t] = readStats(h) as Turn[]
  assert.deepEqual(t, { kind: 'turn', ts: 2000, platform: 'codex', chat: 's9', agentId: 'ag1', model: 'gpt-6-luna', baseline: 'gpt-6.1-sol', usage: { input: 700, output: 70, cacheRead: 0, cacheWrite: 0 } })
})

test('Stop without a readable rollout writes nothing', async () => {
  const h = home()
  await handleStop({ session_id: 's9', hook_event_name: 'Stop', transcript_path: join(tmp(), 'missing.jsonl') }, { codexHome: h })
  assert.equal(existsSync(statsPath(h)), false)
})

test('the stats log sits next to the router log', () => {
  const h = home()
  assert.equal(statsPath(h), join(h, 'log', 'prompt-router-stats.jsonl'))
})

// Decisions: every routed prompt, with what the classifier call cost.
async function decisions(prompt: string, o: Parameters<typeof send>[1] = {}) {
  const h = o.codexHome ?? home(o.options)
  const r = await send(prompt, { ...o, codexHome: h })
  return { ...r, log: readStats(h) as Decision[] }
}

test('a routed prompt writes a decision with the classifier usage', async () => {
  const h = home({ effortDetection: 'auto' })
  const { calls } = await send('rename x', { codexHome: h, reply: PICK.here })
  assert.equal(calls.length, 1)
  const [d] = readStats(h) as Decision[]
  assert.equal(d.kind, 'decision')
  assert.equal(d.platform, 'codex')
  assert.equal(d.chat, 's1')
  assert.equal(d.where, 'here')
  assert.equal(d.outcome, 'applied')
  assert.deepEqual(d.from, { model: 'gpt-6.1-sol', effort: 'medium' })
  assert.deepEqual(d.to, { model: 'gpt-6.1-sol', effort: 'low' })
  assert.equal(typeof d.ts, 'number')
})

test('the classifier usage reported by the runner goes into the decision', async () => {
  const h = home()
  const { handle } = await import('../hook.ts')
  await handle({ session_id: 's1', transcript_path: null, model: 'gpt-6.1-sol', prompt: 'fix it', hook_event_name: 'UserPromptSubmit' }, {
    codexHome: h,
    draw: never,
    runner: async (_p, o) => {
      o.onUsage?.({ input: 10, output: 2, cacheRead: 5, cacheWrite: 0 })
      return PICK.first
    },
  })
  const [d] = readStats(h) as Decision[]
  assert.deepEqual(d.classifier, { model: 'gpt-6-luna', usage: { input: 10, output: 2, cacheRead: 5, cacheWrite: 0 } })
})

test('ask mode (the default) is asked; keep and nothing to switch are keep; a subagent offer is asked', async () => {
  assert.equal((await decisions('x', { reply: PICK.here })).log[0].outcome, 'asked')
  const keep = (await decisions('ok', { reply: PICK.keep })).log[0]
  assert.equal(keep.where, 'keep')
  assert.deepEqual(keep.to, keep.from)
  assert.equal((await decisions('same', { reply: PICK.same })).log[0].where, 'keep')
  const sub = (await decisions('run the tests', { reply: PICK.subagent })).log[0]
  assert.equal(sub.where, 'subagent')
  assert.equal(sub.outcome, 'asked')
  assert.deepEqual(sub.to, { model: 'gpt-6-luna', effort: 'low' })
})

test('a failing classifier, /router and other slash commands write no decision', async () => {
  for (const [p, reply] of [['x', new Error('boom')], ['/router', PICK.here], ['/model', PICK.here]] as const) {
    const h = home()
    // A failing classifier throws out of handle (main logs it); either way nothing is recorded.
    await send(p, { codexHome: h, reply }).catch(() => {})
    assert.deepEqual(readStats(h), [])
  }
})

test('rotation: records older than 90 days go', async () => {
  const h = home()
  const now = 200 * DAY
  await appendStats(h, { kind: 'turn', ts: now - 100 * DAY, platform: 'codex', chat: 'a', model: 'm', baseline: 'm' }, now - 100 * DAY)
  await appendStats(h, { kind: 'turn', ts: now - 10 * DAY, platform: 'codex', chat: 'b', model: 'm', baseline: 'm' }, now - 10 * DAY)
  await appendStats(h, { kind: 'turn', ts: now, platform: 'codex', chat: 'c', model: 'm', baseline: 'm' }, now)
  assert.deepEqual(readStats(h).map(r => r.chat), ['b', 'c'])
})

test('rotation: past 5 MB the oldest records go', async () => {
  const h = home()
  const now = Date.now()
  const big = { kind: 'turn', ts: now, platform: 'codex', chat: 'x'.repeat(1000), model: 'm', baseline: 'm' }
  const lines = Array.from({ length: 5200 }, (_, i) => JSON.stringify({ ...big, ts: now - 5200 + i })).join('\n')
  execFileSync('mkdir', ['-p', join(h, 'log')])
  writeFileSync(statsPath(h), `${lines}\n`)
  await appendStats(h, { kind: 'turn', ts: now, platform: 'codex', chat: 'new', model: 'm', baseline: 'm' }, now)
  assert.ok(statSync(statsPath(h)).size <= 5_000_000)
  const left = readStats(h)
  assert.equal(left.at(-1)?.chat, 'new')
  assert.ok(left.length > 1000)
  assert.ok(left[0].ts > now - 5200)
})

test('statsReport: Today / 7 days / Total with net saving, classifier, extra cost apart, effort as counts', () => {
  const now = new Date(2026, 9, 31, 15).getTime()
  const u = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
  const records: Entry[] = [
    // Today: 1M input on Sonnet instead of Opus saves $2; the classifier costs $0.10.
    { kind: 'decision', ts: now - 1000, platform: 'codex', chat: 'c', where: 'here', from: { model: 'opus', effort: 'high' }, to: { model: 'opus', effort: 'low' }, outcome: 'applied', classifier: { model: 'haiku', usage: u } },
    { kind: 'turn', ts: now - 500, platform: 'codex', chat: 'c', model: 'sonnet', baseline: 'opus', usage: u },
    // 3 days ago: Fable instead of Opus costs $6 more.
    { kind: 'turn', ts: now - 3 * DAY, platform: 'codex', chat: 'd', model: 'fable', baseline: 'opus', usage: u },
    // 30 days ago: a GPT turn has no price.
    { kind: 'turn', ts: now - 30 * DAY, platform: 'codex', chat: 'e', model: 'gpt-6-luna', baseline: 'gpt-6.1-sol', usage: u },
    { kind: 'decision', ts: now - 30 * DAY, platform: 'codex', chat: 'e', where: 'keep', from: { model: 'gpt-6.1-sol', effort: 'medium' }, to: { model: 'gpt-6.1-sol', effort: 'medium' }, outcome: 'applied', classifier: { model: 'gpt-6-luna', usage: u } },
  ]
  const text = statsReport(records, now)
  const row = (name: string) => text.split('\n').find(l => l.startsWith(name)) ?? ''
  assert.match(text, /Today\s+7 days\s+Total/)
  assert.match(row('Prompts'), /1\s+1\s+2$/)
  assert.match(row('Effort lower / higher'), /1 \/ 0\s+1 \/ 0\s+1 \/ 0$/)
  assert.match(row('Saved'), /\$2\.00\s+\$2\.00\s+\$2\.00$/)
  assert.match(row('Classifier cost'), /\$0\.10\s+\$0\.10\s+\$0\.10$/)
  assert.match(row('Net saving'), /\$1\.90 \(48 %\)\s+\$1\.90 \(24 %\)\s+\$1\.90 \(24 %\)$/)
  assert.match(row('Extra cost'), /\$0\.00\s+\$6\.00\s+\$6\.00$/)
  assert.match(row('Turns without a price'), /0\s+0\s+1$/)
  assert.match(row('Classifier calls without a price'), /0\s+0\s+1$/)
  assert.match(text, /estimate/i)
  assert.match(text, /not in the net/i)
  assert.match(text, /gpt-6-luna/)
})

test('statsReport with no records says so', () => {
  assert.match(statsReport([], Date.now()), /No statistics yet/)
})

test('/router stats: the table as the system message', async () => {
  const h = home()
  await appendStats(h, { kind: 'turn', ts: Date.now(), platform: 'codex', chat: 'c', model: 'sonnet', baseline: 'opus', usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } })
  const { system, context, calls } = await send('/router stats', { codexHome: h })
  assert.equal(calls.length, 0)
  assert.match(system, /Today\s+7 days\s+Total/)
  assert.match(system, /Net saving/)
  assert.match(context, /Today/)
})

test('codexRunner: reports the classifier usage from the --json stream', async () => {
  const f = join(tmp(), 'codex')
  writeFileSync(f, `#!/bin/sh\ncat > /dev/null; while [ "$1" != "-o" ]; do shift; done; echo '{"where":"here"}' > "$2"\necho '{"type":"turn.completed","usage":{"input_tokens":900,"cached_input_tokens":800,"output_tokens":40}}'\n`)
  chmodSync(f, 0o755)
  process.env.PROMPT_ROUTER_CODEX = f
  let got: unknown = null
  try {
    await codexRunner('p', { model: 'gpt-6-luna', effort: 'low', timeoutMs: 5000, onUsage: u => (got = u) })
  } finally {
    delete process.env.PROMPT_ROUTER_CODEX
  }
  assert.deepEqual(got, { input: 100, output: 40, cacheRead: 800, cacheWrite: 0 })
})

test('the script: a Stop event writes the turn and prints nothing', () => {
  const h = home()
  const input = JSON.stringify({ session_id: 's5', hook_event_name: 'Stop', transcript_path: rollout(TWO_TURNS), turn_id: 't2', stop_hook_active: false })
  assert.equal(execFileSync(process.execPath, [HOOK], { env: { ...process.env, CODEX_HOME: h }, input, encoding: 'utf8' }), '')
  const lines = readFileSync(statsPath(h), 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
  assert.equal(JSON.parse(lines[0]).chat, 's5')
})

test('statsReport with compareWith: every priced turn on the chosen tier and effort; Codex models stay unpriced', () => {
  const now = new Date(2026, 9, 31, 15).getTime()
  const u = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }
  const records: Entry[] = [
    // Logged against Haiku (the chat's first model), compared with the strong tier (Opus list price).
    { kind: 'turn', ts: now - 500, platform: 'codex', chat: 'c', model: 'sonnet', baseline: 'haiku', usage: u },
    { kind: 'turn', ts: now - 400, platform: 'codex', chat: 'c', model: 'gpt-6-luna', baseline: 'gpt-6.1-sol', usage: u },
  ]
  const row = (text: string, name: string) => text.split('\n').find(l => l.startsWith(name)) ?? ''
  const first = statsReport(records, now)
  assert.match(row(first, 'Extra cost'), /\$1\.90\s+\$1\.90\s+\$1\.90$/)
  assert.match(first, /option compareWith: first/)
  const strong = statsReport(records, now, { model: 'opus', effort: 'medium' })
  assert.match(row(strong, 'Saved'), /\$2\.00\s+\$2\.00\s+\$2\.00$/)
  assert.match(row(strong, 'Extra cost'), /\$0\.00\s+\$0\.00\s+\$0\.00$/)
  assert.match(row(strong, 'Turns without a price'), /1\s+1\s+1$/)
  assert.match(strong, /priced on the strong tier \(option compareWith[^)]*effort is not re-priced\)/)
})

// The trial and the per-prompt fields, as the Claude Code mod writes them (register.tsx).
const T0 = Date.UTC(2026, 10, 6, 10)
const withFollows = (reply: string, follows: string) => reply.replace(/}$/, `, "follows": "${follows}"}`)
const spawnCall = ev('response_item', { type: 'function_call', name: 'spawn_agent', arguments: '{}', call_id: 'c1' })

test('every decision carries the prompt key, what the classifier read of it (follows) and redo', async () => {
  const h = home()
  await send('Fix   the login BUG', { codexHome: h, reply: withFollows(PICK.here, 'new'), now: T0 })
  await send('still not working', { codexHome: h, reply: withFollows(PICK.keep, 'corrects'), now: T0 + 60_000 })
  const [a, b] = readStats(h) as Decision[]
  assert.equal(a.key, promptKey('Fix   the login BUG'))
  assert.equal(a.follows, 'new')
  assert.equal(a.redo, undefined)
  assert.equal(b.key, promptKey('still not working'))
  assert.equal(b.follows, 'corrects')
  assert.equal(b.redo, true)
})

test('trial: a control task gets no note, and the router stays quiet for the prompts that go on with it', async () => {
  const h = home()
  const draws: number[] = []
  const draw = (_seed: string, pct: number) => (draws.push(pct), true)
  const first = await send('fix the login bug', { codexHome: h, reply: PICK.subagent, now: T0, draw })
  assert.equal(first.r, null)
  const next = await send('and the logout one', { codexHome: h, reply: withFollows(PICK.here, 'continues'), now: T0 + 60_000, draw })
  assert.equal(next.r, null)
  assert.deepEqual(draws, [30])
  const [a, b] = readStats(h) as Decision[]
  assert.deepEqual([a.where, a.outcome, a.holdout, a.trial, a.wantedWhere], ['keep', 'applied', true, 'control', 'subagent'])
  assert.deepEqual(a.wanted, { model: 'gpt-6-luna', effort: 'low' })
  assert.deepEqual(a.to, a.from)
  assert.deepEqual([b.where, b.holdout, b.trial, b.wantedWhere], ['keep', true, undefined, undefined])
  assert.deepEqual(b.wanted, { model: 'gpt-6.1-sol', effort: 'low' })
  // New work starts a new task and draws again: a router task is routed as usual.
  const third = await send('add dark mode', { codexHome: h, reply: withFollows(PICK.subagent, 'new'), now: T0 + 120_000, draw: () => false })
  assert.match(third.context, /spawn_agent|Subagent/)
  const c = readStats(h)[2] as Decision
  assert.deepEqual([c.where, c.trial, c.holdout], ['subagent', 'router', undefined])
})

test('trial: each chat has its own task; holdoutPct is the share drawn', async () => {
  const h = home({ holdoutPct: '10' })
  const draws: number[] = []
  const draw = (_seed: string, pct: number) => (draws.push(pct), false)
  await send('fix the login bug', { codexHome: h, reply: PICK.subagent, now: T0, draw })
  await send('fix the login bug', { codexHome: h, reply: PICK.subagent, now: T0 + 1000, draw, session: 's2' })
  // The same question again in the first chat goes on with its task.
  await send('fix the login bug', { codexHome: h, reply: PICK.subagent, now: T0 + 2000, draw })
  assert.deepEqual(draws, [10, 10])
})

test('trial: a prompt that names a setting, an xhigh pick, or nothing to change is never drawn', async () => {
  const h = home()
  let draws = 0
  const draw = () => (draws++, true)
  const named = await send('do it with opus', { codexHome: h, reply: PICK.subagent, now: T0, draw })
  assert.notEqual(named.r, null)
  const xhigh = await send('redesign the sync', { codexHome: h, reply: withFollows(PICK.subagent.replace('"low"', '"xhigh"'), 'new'), now: T0 + 60_000, draw })
  assert.notEqual(xhigh.r, null)
  await send('ok', { codexHome: h, reply: withFollows(PICK.same, 'new'), now: T0 + 120_000, draw })
  assert.equal(draws, 0)
  assert.ok((readStats(h) as Decision[]).every(d => d.trial === undefined && d.holdout === undefined))
})

test('accept: the Stop hook sees spawn_agent in the turn after a subagent offer, once', async () => {
  const h = home()
  await send('run the tests', { codexHome: h, reply: PICK.subagent, now: T0 })
  // The user answers the question with a prompt of its own; the subagent starts in that turn.
  await send('Subagent', { codexHome: h, reply: PICK.keep, now: T0 + 30_000 })
  const stop = { session_id: 's1', hook_event_name: 'Stop', transcript_path: rollout([started('t1'), ctx('t1', 'gpt-6.1-sol'), started('t2'), ctx('t2', 'gpt-6.1-sol'), spawnCall]) }
  await handleStop(stop, { codexHome: h, now: T0 + 90_000 })
  await handleStop(stop, { codexHome: h, now: T0 + 95_000 })
  assert.deepEqual(readStats(h).filter(r => r.kind === 'accept'), [{ kind: 'accept', ts: T0 + 90_000, platform: 'codex', chat: 's1', decision: T0 }])
})

test('accept: none for a spawn in an earlier turn, a session offer, or another chat', async () => {
  const h = home()
  await send('run the tests', { codexHome: h, reply: PICK.subagent, now: T0 })
  await handleStop({ session_id: 's1', hook_event_name: 'Stop', transcript_path: rollout([started('t1'), spawnCall, started('t2'), ctx('t2', 'gpt-6.1-sol')]) }, { codexHome: h, now: T0 + 1000 })
  await handleStop({ session_id: 's2', hook_event_name: 'Stop', transcript_path: rollout([started('t1'), ctx('t1', 'gpt-6.1-sol'), spawnCall]) }, { codexHome: h, now: T0 + 2000 })
  await send('build the export', { codexHome: h, reply: PICK.session, now: T0 + 3000, session: 's3' })
  await handleStop({ session_id: 's3', hook_event_name: 'Stop', transcript_path: rollout([started('t1'), ctx('t1', 'gpt-6.1-sol'), spawnCall]) }, { codexHome: h, now: T0 + 4000 })
  assert.deepEqual(readStats(h).filter(r => r.kind === 'accept'), [])
})
