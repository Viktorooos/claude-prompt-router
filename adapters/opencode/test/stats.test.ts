import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { agentFor } from '../notes.ts'
import { promptKey } from '../../../plugins/prompt-router/core/router.ts'
import { PICK, named, ongoing, said, send, setup, tmp } from './helpers.ts'

const S = 'ses_main'
const DAY = 86_400_000

const CLASSIFIER = { tokens: { input: 1200, output: 30, reasoning: 10, cache: { read: 0, write: 0 } }, cost: 0.0042 }

function stats(dir: string): any[] {
  const path = join(dir, 'prompt-router-stats.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
}
const decisions = (dir: string) => stats(dir).filter(r => r.kind === 'decision')
const turns = (dir: string) => stats(dir).filter(r => r.kind === 'turn')

// A finished assistant message, the way OpenCode sends message.updated.
function done(sid: string, id: string, o: { model?: string; agent?: string; tokens?: any; cost?: number; completed?: boolean; error?: unknown } = {}) {
  return {
    event: {
      type: 'message.updated',
      properties: {
        info: {
          id,
          sessionID: sid,
          role: 'assistant',
          providerID: 'anthropic',
          modelID: o.model ?? 'claude-opus-5-5',
          mode: o.agent ?? 'build',
          cost: o.cost ?? 0.5,
          tokens: 'tokens' in o ? o.tokens : { input: 1000, output: 200, reasoning: 50, cache: { read: 30_000, write: 2000 } },
          time: o.completed === false ? { created: 1 } : { created: 1, completed: 2 },
          ...(o.error ? { error: o.error } : {}),
        },
      },
    },
  }
}

test('stats: an applied decision is logged with what the classifier cost', async () => {
  const { hooks, dir } = await setup({ reply: PICK.here, history: ongoing(S), classifierInfo: CLASSIFIER }, { effortMode: 'auto' })
  await send(hooks, S, 'rename that variable')
  const [d] = decisions(dir)
  assert.equal(d.platform, 'opencode')
  assert.equal(d.chat, S)
  assert.equal(d.where, 'here')
  assert.equal(d.outcome, 'applied')
  assert.deepEqual(d.from, { model: 'opus', effort: 'medium' })
  assert.deepEqual(d.to, { model: 'opus', effort: 'low' })
  assert.equal(typeof d.ts, 'number')
  assert.equal(d.classifier.model, 'anthropic/claude-sonnet-5-5')
  // Reasoning counts as output.
  assert.deepEqual(d.classifier.usage, { input: 1200, output: 40, cacheRead: 0, cacheWrite: 0 })
  assert.equal(d.classifier.usd, 0.0042)
})

test('stats: a suggestion in ask mode is logged as asked, with what was proposed', async () => {
  const { hooks, dir } = await setup({ reply: PICK.first, classifierInfo: CLASSIFIER })
  await send(hooks, S, 'rename foo to bar everywhere')
  const [d] = decisions(dir)
  assert.equal(d.outcome, 'asked')
  assert.deepEqual(d.from, { model: 'opus', effort: 'medium' })
  assert.deepEqual(d.to, { model: 'sonnet', effort: 'low' })
})

test('stats: a subagent offer is logged as asked, a keep as keep', async () => {
  const { hooks, client, dir } = await setup({ reply: PICK.subagent, history: ongoing(S) })
  await send(hooks, S, 'run the tests')
  client.reply = PICK.keep
  await send(hooks, S, 'yes, go on')
  const [a, b] = decisions(dir)
  assert.equal(a.where, 'subagent')
  assert.equal(a.outcome, 'asked')
  assert.deepEqual(a.to, { model: 'haiku', effort: 'low' })
  assert.equal(b.where, 'keep')
  // No classifier tokens in the reply: no classifier cost is made up.
  assert.equal(a.classifier.usage.input, 0)
  assert.equal(a.classifier.usd, undefined)
})

test('stats: a finished reply in the main chat is logged once, reasoning as output, cost as usd', async () => {
  const { hooks, dir } = await setup({ reply: PICK.same, history: ongoing(S) })
  await send(hooks, S, 'go on')
  await hooks.event(done(S, 'msg_1', { completed: false }))
  assert.equal(turns(dir).length, 0)
  await hooks.event(done(S, 'msg_1'))
  await hooks.event(done(S, 'msg_1'))
  const t = turns(dir)
  assert.equal(t.length, 1)
  assert.equal(t[0].platform, 'opencode')
  assert.equal(t[0].chat, S)
  assert.equal(t[0].agentId, undefined)
  assert.equal(t[0].model, 'claude-opus-5-5')
  assert.equal(t[0].baseline, 'claude-opus-5-5')
  assert.deepEqual(t[0].usage, { input: 1000, output: 250, cacheRead: 30_000, cacheWrite: 2000 })
  assert.equal(t[0].usd, 0.5)
})

test('stats: user messages and the classifier session are not turns', async () => {
  const { hooks, dir, calls } = await setup({ reply: PICK.same, history: ongoing(S) })
  await send(hooks, S, 'go on')
  // The mock names the classifier's throwaway session scratch-1.
  assert.equal(named(calls, 'session.create').length, 1)
  await hooks.event(done('scratch-1', 'msg_c'))
  const user = done(S, 'msg_u')
  user.event.properties.info.role = 'user'
  await hooks.event(user)
  await hooks.event({ event: { type: 'session.idle', properties: { sessionID: S } } })
  assert.equal(turns(dir).length, 0)
})

test('stats: a turn on the model the router picked is measured against the model the chat started on', async () => {
  const { hooks, dir } = await setup({ reply: PICK.first }, { effortMode: 'auto', modelMode: 'auto' })
  await send(hooks, S, 'rename foo to bar everywhere')
  await hooks.event(done(S, 'msg_1', { model: 'claude-sonnet-5-5' }))
  const [t] = turns(dir)
  assert.equal(t.model, 'claude-sonnet-5-5')
  assert.equal(t.baseline, 'claude-opus-5-5')
})

test('stats: a model the person picked themselves is not a saving', async () => {
  const { hooks, client, dir } = await setup({ reply: PICK.first }, { effortMode: 'auto', modelMode: 'auto' })
  await send(hooks, S, 'rename foo to bar everywhere')
  client.reply = PICK.keep
  // The person moves the picker to Haiku: the router lets go.
  await send(hooks, S, 'ok', { model: 'anthropic/claude-haiku-5-5' })
  await hooks.event(done(S, 'msg_2', { model: 'claude-haiku-5-5' }))
  const [t] = turns(dir)
  assert.equal(t.baseline, 'claude-haiku-5-5')
})

test('stats: a router subagent is measured against the main chat model', async () => {
  const { hooks, dir } = await setup({ reply: PICK.same, history: ongoing(S), parents: { ses_child: S, ses_other: S } })
  await send(hooks, S, 'go on')
  await hooks.event(done('ses_child', 'msg_c1', { model: 'claude-haiku-5-5', agent: agentFor('haiku') }))
  // A subagent the router did not send runs on what the person set up: no saving claimed.
  await hooks.event(done('ses_other', 'msg_o1', { model: 'claude-haiku-5-5', agent: 'explore' }))
  const [a, b] = turns(dir)
  assert.equal(a.chat, S)
  assert.equal(a.agentId, 'ses_child')
  assert.equal(a.model, 'claude-haiku-5-5')
  assert.equal(a.baseline, 'claude-opus-5-5')
  assert.equal(b.agentId, 'ses_other')
  assert.equal(b.baseline, 'claude-haiku-5-5')
})

test('stats: a cut-off reply has no usage', async () => {
  const { hooks, dir } = await setup({ reply: PICK.same, history: ongoing(S) })
  await send(hooks, S, 'go on')
  await hooks.event(done(S, 'msg_1', { tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0, error: { name: 'MessageAbortedError' } }))
  const [t] = turns(dir)
  assert.equal(t.usage, undefined)
  assert.equal(t.usd, undefined)
})

test('stats: the stats tool shows today, 7 days and total, with the net saving and the extra cost apart', async () => {
  const { hooks, dir } = await setup({ reply: PICK.here, history: ongoing(S), classifierInfo: CLASSIFIER }, { effortMode: 'auto', modelMode: 'auto' })
  await send(hooks, S, 'rename that variable')
  const now = Date.now()
  const lines = [
    { kind: 'turn', ts: now - 3 * DAY, platform: 'opencode', chat: 'old', model: 'claude-haiku-5-5', baseline: 'claude-opus-5-5', usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { kind: 'turn', ts: now - 3 * DAY, platform: 'opencode', chat: 'old', model: 'claude-fable-5-1', baseline: 'claude-opus-5-5', usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } },
    { kind: 'turn', ts: now - 3 * DAY, platform: 'opencode', chat: 'old', model: 'gpt-5', baseline: 'claude-opus-5-5', usage: { input: 1000, output: 0, cacheRead: 0, cacheWrite: 0 }, usd: 0.01 },
  ]
  writeFileSync(join(dir, 'prompt-router-stats.jsonl'), readFileSync(join(dir, 'prompt-router-stats.jsonl'), 'utf8') + lines.map(l => JSON.stringify(l)).join('\n') + '\n')
  const out: string = await hooks.tool.router_stats.execute({}, { sessionID: S })
  assert.match(out, /Today/)
  assert.match(out, /7 days/)
  assert.match(out, /Total/)
  // Haiku instead of Opus on 1M input: $3.90 saved; Fable instead of Opus: $6.00 extra, shown apart.
  assert.match(out, /Saved .*\$3\.90/)
  assert.match(out, /Stronger model .*\$6\.00/)
  assert.match(out, /Classifier .*\$0\.0042/)
  assert.match(out, /Net saving .*\$3\.90/)
  assert.match(out, /Effort lowered .* 1 /)
  assert.match(out, /Unpriced turns .* 1/)
  assert.match(out, /estimate/i)
})

test('stats: /router stats answers with the same table', async () => {
  const { hooks } = await setup({ reply: PICK.same, history: ongoing(S) })
  const out = await send(hooks, S, '/router stats')
  assert.match(said(out), /Net saving/)
})

test('stats: the log drops records older than 90 days and stays under 5 MB', async () => {
  const dir = tmp()
  const path = join(dir, 'prompt-router-stats.jsonl')
  const now = Date.now()
  const row = (ts: number) => JSON.stringify({ kind: 'turn', ts, platform: 'opencode', chat: 'x'.repeat(200), model: 'claude-opus-5-5', baseline: 'claude-opus-5-5' })
  const old = row(now - 100 * DAY)
  const recent: string[] = []
  for (let i = 0; i < 25_000; i++) recent.push(row(now - DAY))
  writeFileSync(path, [old, ...recent].join('\n') + '\n')
  assert.ok(statSync(path).size > 5_000_000)
  const { hooks } = await setup({ reply: PICK.same, history: ongoing(S) }, { stateDir: dir })
  await send(hooks, S, 'go on')
  const text = readFileSync(path, 'utf8')
  assert.ok(statSync(path).size < 5_000_000)
  assert.ok(!text.includes(old))
  // The newest records stay, the one just written among them.
  assert.match(text.trimEnd().split('\n').at(-1) as string, /"kind":"decision"/)
})

test('stats: a router subagent is measured against the main chat model without the router, not the one it holds', async () => {
  const { hooks, dir } = await setup({ reply: PICK.first, parents: { ses_child: S } }, { effortMode: 'auto', modelMode: 'auto' })
  // The router moves the main chat from Opus to Sonnet; a subagent then runs on Haiku.
  await send(hooks, S, 'rename foo to bar everywhere')
  await hooks.event(done('ses_child', 'msg_c1', { model: 'claude-haiku-5-5', agent: agentFor('haiku') }))
  const [t] = turns(dir)
  assert.equal(t.baseline, 'claude-opus-5-5')
})

test('stats: a session the router started counts its first turn under the old chat, later turns as its own chat', async () => {
  const { hooks, dir } = await setup({ reply: PICK.same, history: ongoing('scratch-1') })
  await hooks.tool.router_session.execute({ model: 'standard', effort: 'high', prompt: 'build the settings screen' }, { sessionID: S })
  await send(hooks, 'scratch-1', 'build the settings screen')
  await hooks.event(done('scratch-1', 'msg_1', { model: 'claude-sonnet-5-5' }))
  await send(hooks, 'scratch-1', 'now the tests')
  await hooks.event(done('scratch-1', 'msg_2', { model: 'claude-sonnet-5-5' }))
  const [a, b] = turns(dir)
  assert.equal(a.chat, S)
  assert.equal(a.agentId, 'scratch-1')
  assert.equal(b.chat, 'scratch-1')
  assert.equal(b.agentId, undefined)
  assert.equal(b.baseline, 'claude-sonnet-5-5')
})

test('stats: the other-model offer is logged as a subagent suggestion', async () => {
  const { hooks, dir } = await setup({ reply: '{"where": "here", "model": "sonnet", "effort": "low", "why": "a mechanical edit"}', history: ongoing(S) }, { effortMode: 'ask', modelMode: 'ask' })
  await send(hooks, S, 'rename the keys we just found')
  const [d] = decisions(dir)
  assert.equal(d.where, 'subagent')
  assert.equal(d.outcome, 'asked')
})

test('stats: the table compares with the compareWith option', async () => {
  const now = Date.now()
  const line = { kind: 'turn', ts: now - DAY, platform: 'opencode', chat: 'old', model: 'claude-haiku-5-5', baseline: 'claude-opus-5-5', usage: { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 } }
  const first = await setup({}, { compareWith: 'first' })
  writeFileSync(join(first.dir, 'prompt-router-stats.jsonl'), JSON.stringify(line) + '\n')
  assert.match(await first.hooks.tool.router_stats.execute({}, { sessionID: S }), /Saved .*\$3\.90/)
  const haiku = await setup({}, { compareWith: 'haiku-low' })
  writeFileSync(join(haiku.dir, 'prompt-router-stats.jsonl'), JSON.stringify(line) + '\n')
  const out: string = await haiku.hooks.tool.router_stats.execute({}, { sessionID: S })
  assert.doesNotMatch(out, /Saved .*\$3\.90/)
  assert.match(out, /Saved \(cheaper model\)\s+\$0\.00\s+\$0\.00\s+\$0\.00/)
})

// The trial and the per-prompt fields, as the Claude Code mod writes them (register.tsx).
const withFollows = (reply: string, follows: string) => reply.replace(/}$/, `, "follows": "${follows}"}`)
const accepts = (dir: string) => stats(dir).filter(r => r.kind === 'accept')

test('every decision carries the prompt key, what the classifier read of it (follows) and redo', async () => {
  const { hooks, client, dir } = await setup({ reply: withFollows(PICK.here, 'new'), history: ongoing(S) })
  await send(hooks, S, 'Fix   the login BUG')
  client.reply = withFollows(PICK.keep, 'corrects')
  await send(hooks, S, 'still not working')
  const [a, b] = decisions(dir)
  assert.equal(a.key, promptKey('Fix   the login BUG'))
  assert.equal(a.follows, 'new')
  assert.equal(a.redo, undefined)
  assert.equal(b.key, promptKey('still not working'))
  assert.equal(b.follows, 'corrects')
  assert.equal(b.redo, true)
})

test('trial: a control task gets no note and no switch, and the router stays quiet for the prompts that go on with it', async () => {
  const draws: number[] = []
  const draw = (_seed: string, pct: number) => (draws.push(pct), true)
  const { hooks, client, dir } = await setup({ reply: PICK.subagent, history: ongoing(S) }, { effortMode: 'auto', draw })
  const first = await send(hooks, S, 'run the tests')
  assert.equal(said(first), 'run the tests')
  client.reply = withFollows(PICK.here, 'continues')
  const next = await send(hooks, S, 'and the lint')
  assert.equal(said(next), 'and the lint')
  assert.equal(next.message.variant, undefined)
  assert.deepEqual(draws, [30])
  const [a, b] = decisions(dir)
  assert.deepEqual([a.where, a.outcome, a.holdout, a.trial, a.wantedWhere], ['keep', 'applied', true, 'control', 'subagent'])
  assert.deepEqual(a.wanted, { model: 'haiku', effort: 'low' })
  assert.deepEqual(a.to, a.from)
  assert.deepEqual([b.where, b.holdout, b.trial, b.wantedWhere], ['keep', true, undefined, undefined])
  assert.deepEqual(b.wanted, { model: 'opus', effort: 'low' })
})

test('trial: new work draws again; a router task is routed as usual; holdoutPct is the share drawn', async () => {
  const draws: number[] = []
  const draw = (_seed: string, pct: number) => (draws.push(pct), false)
  const { hooks, client, dir } = await setup({ reply: PICK.subagent, history: ongoing(S) }, { holdoutPct: '10', draw })
  assert.match(said(await send(hooks, S, 'run the tests')), /Subagent/)
  // The same question again goes on with its task.
  await send(hooks, S, 'run the tests')
  client.reply = withFollows(PICK.session, 'new')
  await send(hooks, S, 'build the export screen')
  assert.deepEqual(draws, [10, 10])
  assert.deepEqual(decisions(dir).map(d => d.trial), ['router', undefined, 'router'])
})

test('trial: a prompt that names a setting, an xhigh pick, or nothing to change is never drawn', async () => {
  let draws = 0
  const { hooks, client, dir } = await setup({ reply: PICK.subagent, history: ongoing(S) }, { draw: () => (draws++, true) })
  assert.match(said(await send(hooks, S, 'do it with opus')), /Subagent/)
  client.reply = withFollows(PICK.subagent.replace('"low"', '"xhigh"'), 'new')
  assert.match(said(await send(hooks, S, 'redesign the sync')), /Subagent/)
  client.reply = withFollows(PICK.same, 'new')
  await send(hooks, S, 'ok')
  assert.equal(draws, 0)
  assert.ok(decisions(dir).every(d => d.trial === undefined && d.holdout === undefined))
})

test('trial: a here prompt over a running turn is never drawn (the router leaves it alone anyway)', async () => {
  let draws = 0
  const { hooks, dir } = await setup({ reply: PICK.here, history: ongoing(S), busy: [S] }, { effortMode: 'auto', draw: () => (draws++, true) })
  await send(hooks, S, 'and push it')
  assert.equal(draws, 0)
  assert.deepEqual(decisions(dir).map(d => [d.where, d.trial, d.holdout]), [['keep', undefined, undefined]])
})

test('trial: a finished turn keeps the task going, so a long turn does not split it', async t => {
  const T0 = Date.UTC(2026, 10, 6, 10)
  t.mock.timers.enable({ apis: ['Date'], now: T0 })
  let draws = 0
  const { hooks, client, dir } = await setup({ reply: PICK.subagent, history: ongoing(S) }, { draw: () => (draws++, true) })
  await send(hooks, S, 'run the tests')
  // The turn ran for 40 minutes; the next prompt 5 minutes after it goes on with the task.
  t.mock.timers.tick(40 * 60_000)
  await hooks.event(done(S, 'm1'))
  t.mock.timers.tick(5 * 60_000)
  client.reply = withFollows(PICK.here, 'continues')
  await send(hooks, S, 'and the lint')
  assert.equal(draws, 1)
  assert.deepEqual(decisions(dir).map(d => [d.where, d.holdout, d.trial]), [['keep', true, 'control'], ['keep', true, undefined]])
})

test('accept: the router subagent, session or switch the user took after the offer, once', async () => {
  const sub = await setup({ reply: PICK.subagent, history: ongoing(S) })
  await send(sub.hooks, S, 'run the tests')
  const task = () => sub.hooks['tool.execute.before']({ tool: 'task', sessionID: S, callID: 'c1' }, { args: { subagent_type: 'router-light', prompt: 'run tests', description: 'tests' } })
  await task()
  await task()
  const [d] = decisions(sub.dir)
  assert.deepEqual(accepts(sub.dir).map(a => [a.platform, a.chat, a.decision]), [['opencode', S, d.ts]])

  const ses = await setup({ reply: PICK.session, history: ongoing(S) })
  await send(ses.hooks, S, 'build the export screen')
  await ses.hooks.tool.router_session.execute({ model: 'standard', effort: 'medium', prompt: 'build the export screen' }, { sessionID: S })
  assert.deepEqual(accepts(ses.dir).map(a => a.decision), [decisions(ses.dir)[0].ts])

  const here = await setup({ reply: PICK.here, history: ongoing(S) }, { effortMode: 'ask' })
  await send(here.hooks, S, 'rename that variable')
  await here.hooks.tool.router_switch.execute({ effort: 'low' }, { sessionID: S })
  assert.deepEqual(accepts(here.dir).map(a => a.decision), [decisions(here.dir)[0].ts])
})

test('accept: none without an offer, or for a tool that does not take it', async () => {
  const sub = await setup({ reply: PICK.subagent, history: ongoing(S) })
  await send(sub.hooks, S, 'run the tests')
  await sub.hooks.tool.router_switch.execute({ effort: 'low' }, { sessionID: S })
  await sub.hooks['tool.execute.before']({ tool: 'task', sessionID: S, callID: 'c1' }, { args: { subagent_type: 'general', prompt: 'x', description: 'x' } })
  const none = await setup({ reply: PICK.same, history: ongoing(S) })
  await send(none.hooks, S, 'ok')
  await none.hooks['tool.execute.before']({ tool: 'task', sessionID: S, callID: 'c1' }, { args: { subagent_type: 'router-light', prompt: 'x', description: 'x' } })
  assert.deepEqual([...accepts(sub.dir), ...accepts(none.dir)], [])
})
