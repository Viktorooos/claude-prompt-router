import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import { PICK, named, ongoing, said, send, setup } from './helpers.ts'

const S = 'ses_main'

test('auto mode: a here pick switches the variant on the message and toasts', async () => {
  const { hooks, calls } = await setup({ reply: PICK.here, history: ongoing(S) }, { effortMode: 'auto', modelMode: 'auto' })
  const out = await send(hooks, S, 'rename that variable')
  assert.equal(out.message.variant, 'low')
  assert.equal(out.message.model.variant, 'low')
  assert.equal(out.message.model.modelID, 'claude-opus-5-5')
  assert.equal(said(out), 'rename that variable')
  assert.match(named(calls, 'tui.showToast')[0].args.body.message, /Effort: Low \(was Medium\)/)
  // The held level stays on the next messages while the picker is not moved.
  const next = await send(hooks, S, 'and the other one', {})
  assert.equal(next.message.variant, 'low')
})

test('the hold lets go when the person moves the variant picker', async () => {
  const { hooks, client } = await setup({ reply: PICK.here, history: ongoing(S) }, { effortMode: 'auto' })
  await send(hooks, S, 'rename that variable')
  client.reply = PICK.keep
  const out = await send(hooks, S, 'ok', { variant: 'high' })
  assert.equal(out.message.variant, undefined)
})

test('auto mode: the first prompt picks the model for the chat', async () => {
  const { hooks } = await setup({ reply: PICK.first }, { effortMode: 'auto', modelMode: 'auto' })
  const out = await send(hooks, S, 'rename foo to bar everywhere')
  assert.equal(out.message.model.providerID, 'anthropic')
  assert.equal(out.message.model.modelID, 'claude-sonnet-5-5')
  assert.equal(out.message.variant, 'low')
  // Held on the next message too.
  const next = await send(hooks, S, 'continue', { model: 'anthropic/claude-opus-5-5' })
  assert.equal(next.message.model.modelID, 'claude-sonnet-5-5')
})

test('ask mode: adds the switch note and changes nothing', async () => {
  const { hooks, calls } = await setup({ reply: PICK.first })
  const out = await send(hooks, S, 'rename foo to bar everywhere')
  assert.equal(out.message.variant, undefined)
  assert.equal(out.message.model.modelID, 'claude-opus-5-5')
  const text = said(out)
  assert.match(text, /^rename foo to bar everywhere\n\n\[Prompt Router suggests model claude-sonnet-5-5 instead of claude-opus-5-5 and effort low instead of medium/)
  assert.match(text, /question tool/)
  assert.match(text, /"Switch \(claude-sonnet-5-5 · Low\)", "Keep as is"/)
  assert.match(text, /call the router_switch tool with \{"model":"standard","effort":"low"\}/)
  assert.equal(named(calls, 'tui.showToast').length, 0)
})

test('keep (an approval) passes the prompt untouched', async () => {
  const { hooks } = await setup({ reply: PICK.keep, history: ongoing(S) }, { effortMode: 'auto' })
  const out = await send(hooks, S, 'yes, go on')
  assert.equal(said(out), 'yes, go on')
  assert.equal(out.message.variant, undefined)
})

test('a here pick at the current effort changes nothing', async () => {
  const { hooks } = await setup({ reply: PICK.same, history: ongoing(S) })
  const out = await send(hooks, S, 'and the tests?')
  assert.equal(said(out), 'and the tests?')
})

test('slash commands pass: typed and run through command.execute.before', async () => {
  const { hooks, calls } = await setup({ reply: PICK.here, history: ongoing(S) })
  const out = await send(hooks, S, '/review')
  assert.equal(said(out), '/review')
  await hooks['command.execute.before']({ command: 'review', sessionID: S, arguments: '' }, { parts: [] })
  const expanded = await send(hooks, S, 'Review the changes in this branch and list the bugs.')
  assert.equal(said(expanded), 'Review the changes in this branch and list the bugs.')
  assert.equal(named(calls, 'session.prompt').length, 0)
})

test('blocks like <system-reminder> are stripped before the classifier', async () => {
  const { hooks, calls } = await setup({ reply: PICK.same, history: ongoing(S) })
  await send(hooks, S, '<system-reminder>SECRET CONTEXT</system-reminder>\nadd a test for login')
  const prompt = named(calls, 'session.prompt')[0].args.body.parts[0].text
  assert.match(prompt, /<prompt>\nadd a test for login\n<\/prompt>/)
  assert.doesNotMatch(prompt, /SECRET CONTEXT/)
  // Only a reminder: nothing to route.
  const before = named(calls, 'session.prompt').length
  await send(hooks, S, '<system-reminder>only this</system-reminder>')
  assert.equal(named(calls, 'session.prompt').length, before)
})

test('the classifier runs in a scratch session that is skipped and deleted', async () => {
  const { hooks, calls } = await setup({ reply: PICK.same, history: ongoing(S) }, { classifier: 'haiku' })
  await send(hooks, S, 'add a test')
  const [prompt] = named(calls, 'session.prompt')
  assert.equal(prompt.args.path.id, 'scratch-1')
  assert.deepEqual(prompt.args.body.model, { providerID: 'anthropic', modelID: 'claude-haiku-5-5' })
  assert.equal(prompt.args.body.variant, 'low')
  assert.deepEqual(named(calls, 'session.delete')[0].args.path, { id: 'scratch-1' })
  // OpenCode runs chat.message for the scratch prompt too: the router must not route it again.
  const n = named(calls, 'session.prompt').length
  const out = await send(hooks, 'scratch-1', 'You route one prompt…')
  assert.equal(named(calls, 'session.prompt').length, n)
  assert.equal(said(out), 'You route one prompt…')
})

test('a classifier failure passes the prompt through untouched and logs', async () => {
  const { hooks, calls, dir } = await setup({ reply: new Error('provider down'), history: ongoing(S) }, { effortMode: 'auto' })
  const out = await send(hooks, S, 'add a test')
  assert.equal(said(out), 'add a test')
  assert.equal(out.message.variant, undefined)
  assert.match(readFileSync(join(dir, 'prompt-router.log'), 'utf8'), /pick: provider down/)
  assert.ok(named(calls, 'app.log').some(c => /provider down/.test(c.args.body.message)))
  assert.equal(named(calls, 'session.delete').length, 1)
})

test('a classifier timeout passes the prompt through, aborts and deletes the scratch session', async () => {
  const { hooks, calls, dir } = await setup({ reply: 'hang', history: ongoing(S) })
  const out = await send(hooks, S, 'add a test')
  assert.equal(said(out), 'add a test')
  assert.equal(named(calls, 'session.abort').length, 1)
  assert.equal(named(calls, 'session.delete').length, 1)
  assert.match(readFileSync(join(dir, 'prompt-router.log'), 'utf8'), /timed out/)
})

test('an unparsable reply is logged and the prompt passes', async () => {
  const { hooks, dir } = await setup({ reply: 'I think here', history: ongoing(S) })
  const out = await send(hooks, S, 'add a test')
  assert.equal(said(out), 'add a test')
  assert.match(readFileSync(join(dir, 'prompt-router.log'), 'utf8'), /parse: reply could not be parsed/)
})

test('subagent pick: the note asks and names the task tool and router agent', async () => {
  const { hooks, config } = await setup({ reply: PICK.subagent, history: ongoing(S) })
  const out = await send(hooks, S, 'run the whole test suite')
  const text = said(out)
  assert.match(text, /Prompt Router suggests running this prompt in a subagent \(claude-haiku-5-5 · low\), because: just run the tests/)
  assert.match(text, /"Subagent \(claude-haiku-5-5 · low\)", "Do it here \(Low\)", "Do it here \(keep Medium\)"/)
  assert.match(text, /call the task tool with subagent_type "router-light"/)
  assert.equal(config.agent['router-light'].model, 'anthropic/claude-haiku-5-5')
  assert.equal(config.agent['router-light'].mode, 'subagent')
})

test('subagent effort: the task call carries the pick to the child session', async () => {
  const { hooks } = await setup({ reply: PICK.subagent, history: ongoing(S), parents: { ses_child: S } })
  await send(hooks, S, 'run the whole test suite')
  await hooks['tool.execute.before']({ tool: 'task', sessionID: S, callID: 'c1' }, { args: { subagent_type: 'router-light', prompt: 'run tests', description: 'tests' } })
  const child = await send(hooks, 'ses_child', 'run tests', { agent: 'router-light', model: 'anthropic/claude-haiku-5-5' })
  assert.equal(child.message.variant, 'low')
  assert.equal(said(child), 'run tests')
})

test('session pick: the note offers a new session through router_session', async () => {
  const { hooks } = await setup({ reply: PICK.session, history: ongoing(S) })
  const text = said(await send(hooks, S, 'now build the settings screen'))
  assert.match(text, /in a new session \(claude-sonnet-5-5 · medium\)/)
  assert.match(text, /"New session \(claude-sonnet-5-5 · medium\)", "Subagent \(claude-sonnet-5-5 · medium\)", "Do it here"/)
  assert.match(text, /call the router_session tool right away with model "standard", effort "medium"/)
  assert.match(text, /opencode --model anthropic\/claude-sonnet-5-5 --prompt/)
})

test('router_session starts a session on the model and variant and is not routed', async () => {
  const { hooks, calls } = await setup({ reply: PICK.session })
  const r = await hooks.tool.router_session.execute({ model: 'standard', effort: 'high', prompt: 'build the settings screen' }, { sessionID: S })
  assert.match(r, /Started a new session "build the settings screen" \(scratch-1\) on anthropic\/claude-sonnet-5-5 at effort High/)
  const [p] = named(calls, 'session.promptAsync')
  assert.deepEqual(p.args.body.model, { providerID: 'anthropic', modelID: 'claude-sonnet-5-5' })
  assert.equal(p.args.body.variant, 'high')
  await send(hooks, 'scratch-1', 'build the settings screen')
  assert.equal(named(calls, 'session.prompt').length, 0)
})

test('a prompt over a running turn keeps its model and effort', async () => {
  const { hooks } = await setup({ reply: PICK.here, history: ongoing(S), busy: [S] }, { effortMode: 'auto' })
  const out = await send(hooks, S, 'also check the logout')
  assert.equal(out.message.variant, undefined)
  assert.equal(said(out), 'also check the logout')
})

test('switch tool: sets model and variant for the next message, effort within the turn', async () => {
  const { hooks } = await setup({ reply: PICK.keep, history: ongoing(S) })
  await send(hooks, S, 'yes')
  const r = await hooks.tool.router_switch.execute({ model: 'sonnet', effort: 'high' }, { sessionID: S })
  assert.match(r, /Switched this chat to model claude-sonnet-5-5 and effort High\./)
  assert.match(r, /model applies from the next message/)
  // The rest of this turn: chat.params puts the high variant's options on the next request.
  const output = { temperature: 0, topP: 1, topK: 0, maxOutputTokens: undefined, options: { a: 1 } as Record<string, unknown> }
  const model = { id: 'claude-opus-5-5', providerID: 'anthropic', variants: { high: { thinking: { type: 'enabled', budgetTokens: 16000 } } } }
  await hooks['chat.params']({ sessionID: S, agent: 'build', model, provider: {}, message: { model: { providerID: 'anthropic', modelID: 'claude-opus-5-5' }, variant: 'medium' } }, output)
  assert.deepEqual(output.options, { a: 1, thinking: { type: 'enabled', budgetTokens: 16000 } })
  // The next message.
  const next = await send(hooks, S, 'ok')
  assert.equal(next.message.model.modelID, 'claude-sonnet-5-5')
  assert.equal(next.message.variant, 'high')
})

test('switch tool: refuses unknown values and Fable when no provider lists it', async () => {
  const { hooks } = await setup()
  assert.equal(await hooks.tool.router_switch.execute({ model: 'top', effort: 'huge' }, { sessionID: S }), 'Nothing switched. Not switched: model "top" (not offered in this chat), effort "huge" (unknown).')
  assert.equal(await hooks.tool.router_switch.execute({}, { sessionID: S }), 'Nothing switched. Give model and/or effort.')
})

test('options map models and variants; Fable is offered when a provider lists it', async () => {
  const providers = [{ id: 'anthropic', models: { 'claude-fable-5-1': {} } }]
  const { hooks, calls } = await setup({ reply: PICK.here, history: ongoing(S), providers }, { effortMode: 'auto', variants: { low: 'fast' } })
  const out = await send(hooks, S, 'rename that variable', { variant: 'fast' })
  // The picker is already on the variant mapped to low: nothing to change.
  assert.equal(out.message.variant, undefined)
  assert.match(named(calls, 'session.prompt')[0].args.body.parts[0].text, /"model": "haiku\|sonnet\|opus\|fable"/)
  assert.equal(named(calls, 'session.prompt')[0].args.body.variant, 'fast')
})

test('options come from the JSON file when the plugin gets none', async () => {
  const { tool } = await import('./helpers.ts')
  const { routerPlugin } = await import('../prompt-router.ts')
  const { mockClient, tmp } = await import('./helpers.ts')
  const { writeFileSync } = await import('node:fs')
  const dir = tmp()
  writeFileSync(join(dir, 'opts.json'), JSON.stringify({ effortMode: 'auto', classifier: 'opus' }))
  const { client, calls } = mockClient({ reply: PICK.here, history: ongoing(S) })
  const hooks: any = await routerPlugin(tool)({ client }, { stateDir: dir, optionsFile: join(dir, 'opts.json') })
  const out = await send(hooks, S, 'rename that variable')
  assert.equal(out.message.variant, 'low')
  assert.equal(named(calls, 'session.prompt')[0].args.body.model.modelID, 'claude-opus-5-5')
})

test('/router: status, off and on (command and typed)', async () => {
  const { hooks, calls, config, dir } = await setup({ reply: PICK.here, history: ongoing(S) }, { effortMode: 'auto' })
  assert.equal(config.command.router.description, 'Prompt Router: status, or off / on')
  await send(hooks, S, 'rename that variable')
  const parts = [{ type: 'text', text: 'Prompt Router ' }]
  await hooks['command.execute.before']({ command: 'router', sessionID: S, arguments: '' }, { parts })
  assert.match(parts[0].text, /Reply with exactly the text below/)
  assert.match(parts[0].text, /Prompt Router is on \(classifier sonnet, effort mode auto, model mode ask\)\./)
  assert.match(parts[0].text, /This chat runs on anthropic\/claude-opus-5-5, effort Low \(held by the router: Low\)\./)
  // The command's own message is not routed.
  const n = named(calls, 'session.prompt').length
  await send(hooks, S, parts[0].text)
  assert.equal(named(calls, 'session.prompt').length, n)

  const off = await send(hooks, S, '/router off')
  assert.match(said(off), /Prompt Router is off\. Turn it back on with \/router on\./)
  assert.equal(JSON.parse(readFileSync(join(dir, 'state.json'), 'utf8')).enabled, false)
  const plain = await send(hooks, S, 'rename that variable')
  assert.equal(said(plain), 'rename that variable')
  assert.equal(plain.message.variant, undefined)
  assert.equal(named(calls, 'session.prompt').length, n)

  const on = [{ type: 'text', text: 'x' }]
  await hooks['command.execute.before']({ command: 'router', sessionID: S, arguments: 'on' }, { parts: on })
  assert.match(on[0].text, /Prompt Router is on\./)
})

test('the router note in the history is not shown to the classifier again', async () => {
  const history = {
    [S]: [
      { info: { role: 'user' }, parts: [{ type: 'text', text: 'run the tests\n\n[Prompt Router suggests running this prompt in a subagent]' }] },
      { info: { role: 'assistant', tokens: { input: 1000 } }, parts: [{ type: 'text', text: 'All green.' }] },
    ],
  }
  const { hooks, calls } = await setup({ reply: PICK.same, history })
  await send(hooks, S, 'and lint?')
  const prompt = named(calls, 'session.prompt')[0].args.body.parts[0].text
  assert.match(prompt, /<first>run the tests<\/first>/)
  assert.match(prompt, /- run the tests/)
  assert.match(prompt, /<reply>All green\.<\/reply>/)
  assert.doesNotMatch(prompt, /suggests running/)
})

// Here on another model: switching this chat's model would break the prompt cache, so the router
// offers a subagent on that model or staying here with only the effort judged again.
const OTHER = {
  lower: '{"where": "here", "model": "sonnet", "effort": "low", "why": "a mechanical edit"}',
  lowerSame: '{"where": "here", "model": "sonnet", "effort": "medium", "why": "a mechanical edit"}',
  higher: '{"where": "here", "model": "opus", "effort": "high", "why": "new logic"}',
}

test('mid-chat, the classifier is asked which model the task needs, also for here', async () => {
  const { hooks, calls } = await setup({ reply: OTHER.lower, history: ongoing(S) })
  await send(hooks, S, 'rename the keys we just found')
  const prompt = named(calls, 'session.prompt')[0].args.body.parts[0].text
  assert.doesNotMatch(prompt, /for here use the current one/)
  assert.match(prompt, /MODEL \(the model the task needs, also for here/)
})

test('here on a cheaper model (ask): offers a subagent or staying here, switches nothing', async () => {
  const { hooks, calls } = await setup({ reply: OTHER.lower, history: ongoing(S) }, { effortMode: 'ask', modelMode: 'ask' })
  const out = await send(hooks, S, 'rename the keys we just found')
  const t = said(out)
  assert.ok(t.startsWith('rename the keys we just found\n\n[Prompt Router'))
  assert.match(t, /fits claude-sonnet-5-5 · low better than this chat's claude-opus-5-5, because: a mechanical edit/)
  assert.match(t, /question tool/)
  assert.match(t, /"Subagent \(claude-sonnet-5-5 · low\)", "Stay here \(Low\)", "Stay here \(keep Medium\)"/)
  assert.match(t, /call the task tool with subagent_type "router-standard"/)
  assert.match(t, /give it everything it needs from this chat/)
  assert.match(t, /"Stay here \(Low\)" = call the router_switch tool with \{"effort":"low"\}/)
  assert.match(t, /never switch this chat's model/)
  assert.doesNotMatch(t, /\{"model"/)
  assert.doesNotMatch(t, /New session/)
  assert.equal(out.message.variant, undefined)
  assert.equal(out.message.model.modelID, 'claude-opus-5-5')
  assert.equal(named(calls, 'tui.showToast').length, 0)
})

test('here on a stronger model: the same offer, the chat model stays', async () => {
  const { hooks } = await setup({ reply: OTHER.higher, history: ongoing(S) })
  const out = await send(hooks, S, 'now work out the sync logic for it', { model: 'anthropic/claude-haiku-5-5' })
  const t = said(out)
  assert.match(t, /fits claude-opus-5-5 · high better than this chat's claude-haiku-5-5, because: new logic/)
  assert.match(t, /"Subagent \(claude-opus-5-5 · high\)", "Stay here \(High\)", "Stay here \(keep Medium\)"/)
  assert.match(t, /subagent_type "router-strong"/)
  assert.equal(out.message.variant, undefined)
  assert.equal(out.message.model.modelID, 'claude-haiku-5-5')
})

test('here on another model (auto): one Stay here option that switches only the effort', async () => {
  const { hooks, calls } = await setup({ reply: OTHER.lower, history: ongoing(S) }, { effortMode: 'auto', modelMode: 'auto' })
  const out = await send(hooks, S, 'rename the keys we just found')
  const t = said(out)
  assert.match(t, /"Subagent \(claude-sonnet-5-5 · low\)", "Stay here \(Low\)"/)
  assert.doesNotMatch(t, /keep Medium/)
  assert.match(t, /"Stay here \(Low\)" = call the router_switch tool with \{"effort":"low"\}/)
  // The question comes first: nothing is set before the user picks.
  assert.equal(out.message.variant, undefined)
  assert.equal(out.message.model.modelID, 'claude-opus-5-5')
  assert.equal(named(calls, 'tui.showToast').length, 0)
})

test('here on another model: the subagent gets the pick\'s effort', async () => {
  const { hooks } = await setup({ reply: OTHER.lower, history: ongoing(S), parents: { ses_child: S } }, { effortMode: 'auto', modelMode: 'auto' })
  await send(hooks, S, 'rename the keys we just found')
  await hooks['tool.execute.before']({ tool: 'task', sessionID: S, callID: 'c1' }, { args: { subagent_type: 'router-standard', prompt: 'rename', description: 'rename' } })
  const child = await send(hooks, 'ses_child', 'rename', { agent: 'router-standard', model: 'anthropic/claude-sonnet-5-5' })
  assert.equal(child.message.variant, 'low')
})

test('here on another model at the same effort: Stay here just goes on', async () => {
  const { hooks } = await setup({ reply: OTHER.lowerSame, history: ongoing(S) })
  const out = await send(hooks, S, 'rename the keys we just found')
  const t = said(out)
  assert.match(t, /"Subagent \(claude-sonnet-5-5 · medium\)", "Stay here"/)
  assert.match(t, /"Stay here" = continue normally/)
  assert.doesNotMatch(t, /router_switch/)
  assert.equal(out.message.variant, undefined)
})

test('modelMode off: here on another model only judges the effort, as before', async () => {
  const { hooks, calls } = await setup({ reply: OTHER.lower, history: ongoing(S) }, { effortMode: 'auto', modelMode: 'off' })
  const out = await send(hooks, S, 'rename the keys we just found')
  assert.match(named(calls, 'session.prompt')[0].args.body.parts[0].text, /for here use the current one/)
  assert.equal(said(out), 'rename the keys we just found')
  assert.equal(out.message.variant, 'low')
  assert.equal(out.message.model.modelID, 'claude-opus-5-5')
})

test('here on another model typed over a running turn: nothing changes', async () => {
  const { hooks } = await setup({ reply: OTHER.lower, history: ongoing(S), busy: [S] })
  const out = await send(hooks, S, 'and rename these too')
  assert.equal(said(out), 'and rename these too')
  assert.equal(out.message.variant, undefined)
})

test('here on another model when the chat model is unknown: as before', async () => {
  const { hooks } = await setup({ reply: OTHER.lower, history: ongoing(S) }, { effortMode: 'auto', modelMode: 'auto' })
  const out = await send(hooks, S, 'rename the keys we just found', { model: 'other/some-custom-model' })
  assert.equal(said(out), 'rename the keys we just found')
  assert.equal(out.message.variant, 'low')
  assert.equal(out.message.model.modelID, 'some-custom-model')
})

// One switch per feature (0.8.0), read from ~/.config/opencode/prompt-router.json the way the
// auto-loaded plugin reads it (no plugin options).
async function fromFile(o: Parameters<typeof setup>[0], options: Record<string, unknown>) {
  const { tool, mockClient, tmp } = await import('./helpers.ts')
  const { routerPlugin } = await import('../prompt-router.ts')
  const { writeFileSync } = await import('node:fs')
  const dir = tmp()
  writeFileSync(join(dir, 'prompt-router.json'), JSON.stringify(options))
  const { client, calls } = mockClient(o)
  const hooks: any = await routerPlugin(tool)({ client }, { stateDir: dir, optionsFile: join(dir, 'prompt-router.json') })
  const config: any = {}
  await hooks.config(config)
  return { hooks, client, calls, dir, config }
}

test('effortDetection off: no variant set or offered, Do it here has no level', async () => {
  const { hooks, calls } = await fromFile({ reply: PICK.here, history: ongoing(S) }, { effortDetection: 'off' })
  const out = await send(hooks, S, 'rename that variable')
  assert.equal(out.message.variant, undefined)
  assert.equal(said(out), 'rename that variable')
  assert.equal(named(calls, 'tui.showToast').length, 0)
  const sub = await fromFile({ reply: PICK.subagent, history: ongoing(S) }, { effortDetection: 'off' })
  const t = said(await send(sub.hooks, S, 'run the tests'))
  assert.match(t, /"Subagent \(claude-haiku-5-5 · low\)", "Do it here"/)
  assert.doesNotMatch(t, /Do it here \(/)
  const other = await fromFile({ reply: OTHER.lower, history: ongoing(S) }, { effortDetection: 'off' })
  const o = said(await send(other.hooks, S, 'rename the keys we just found'))
  assert.match(o, /"Subagent \(claude-sonnet-5-5 · low\)", "Stay here"/)
  assert.doesNotMatch(o, /Stay here \(/)
})

test('firstChatDetection off: the first prompt keeps its model, the effort is still judged', async () => {
  const { hooks } = await fromFile({ reply: PICK.first }, { firstChatDetection: 'off', effortDetection: 'auto' })
  const out = await send(hooks, S, 'rename foo to bar everywhere')
  assert.equal(out.message.model.modelID, 'claude-opus-5-5')
  assert.equal(out.message.variant, 'low')
  assert.equal(said(out), 'rename foo to bar everywhere')
})

test('midChatModelDetection off: no Subagent / Stay here question, only the effort', async () => {
  const { hooks, calls } = await fromFile({ reply: OTHER.lower, history: ongoing(S) }, { midChatModelDetection: 'off' })
  const t = said(await send(hooks, S, 'rename the keys we just found'))
  assert.doesNotMatch(t, /Subagent|Stay here/)
  assert.match(t, /suggests effort low instead of medium/)
  const prompt = named(calls, 'session.prompt')[0].args.body.parts[0].text
  assert.match(prompt, /for here use the current one/)
})

test('midChatModelDetection auto: no question, the agent decides between the task tool and here', async () => {
  const { hooks } = await fromFile({ reply: OTHER.lower, history: ongoing(S) }, { midChatModelDetection: 'auto', effortDetection: 'auto' })
  const t = said(await send(hooks, S, 'rename the keys we just found'))
  assert.doesNotMatch(t, /question tool|Where should this go/)
  assert.match(t, /Do not ask the user; decide yourself/)
  assert.match(t, /only when it is worth it: a larger self-contained piece of work/)
  assert.match(t, /a quick question, a short answer or a short message stays here/)
  assert.match(t, /Subagent = call the task tool with subagent_type "router-standard"/)
  assert.match(t, /Here = call the router_switch tool with \{"effort":"low"\}/)
  assert.match(t, /never switch this chat's model/)
  assert.match(t, /tell the user in one sentence what you chose/)
})

test('midChatModelDetection auto with effortDetection off: staying here changes nothing', async () => {
  const { hooks } = await fromFile({ reply: OTHER.lower, history: ongoing(S) }, { midChatModelDetection: 'auto', effortDetection: 'off' })
  const t = said(await send(hooks, S, 'rename the keys we just found'))
  assert.doesNotMatch(t, /question tool|router_switch/)
  assert.match(t, /Here = handle the prompt normally/)
})

test('subagentSuggestions off: a subagent pick is handled as here', async () => {
  const { hooks } = await fromFile({ reply: '{"where": "subagent", "model": "opus", "effort": "low", "why": "just run the tests"}', history: ongoing(S) }, { subagentSuggestions: 'off' })
  const t = said(await send(hooks, S, 'run the tests'))
  assert.doesNotMatch(t, /in a subagent|task tool/)
  assert.match(t, /suggests effort low instead of medium/)
})

test('sessionSuggestions off: a session pick is handled as here', async () => {
  const { hooks } = await fromFile({ reply: '{"where": "session", "model": "opus", "effort": "medium", "why": "unrelated"}', history: ongoing(S) }, { sessionSuggestions: 'off' })
  assert.equal(said(await send(hooks, S, 'build the billing page')), 'build the billing page')
})

test('notifications off: the variant is still set, but no toast', async () => {
  const { hooks, calls } = await fromFile({ reply: PICK.here, history: ongoing(S) }, { effortDetection: 'auto', notifications: 'off' })
  const out = await send(hooks, S, 'rename that variable')
  assert.equal(out.message.variant, 'low')
  assert.equal(named(calls, 'tui.showToast').length, 0)
})

test('old keys still work when the new ones are missing; modelMode off turns off both model checks', async () => {
  const a = await fromFile({ reply: PICK.here, history: ongoing(S) }, { effortMode: 'auto' })
  assert.equal((await send(a.hooks, S, 'rename that variable')).message.variant, 'low')
  const first = await fromFile({ reply: PICK.first }, { modelMode: 'off', effortMode: 'auto' })
  assert.equal((await send(first.hooks, S, 'rename foo')).message.model.modelID, 'claude-opus-5-5')
  const mid = await fromFile({ reply: OTHER.lower, history: ongoing(S) }, { modelMode: 'off', effortMode: 'auto' })
  assert.doesNotMatch(said(await send(mid.hooks, S, 'rename the keys we just found')), /Subagent/)
})

test('/router prints every option with its value and where it came from', async () => {
  const { hooks } = await fromFile({ reply: PICK.same, history: ongoing(S) }, { effortMode: 'auto', notifications: 'off' })
  const parts = [{ type: 'text', text: '' }]
  await hooks['command.execute.before']({ command: 'router', sessionID: S, arguments: '' }, { parts })
  const t = parts[0].text
  assert.match(t, /effortDetection: auto \(old key effortMode; rename it to effortDetection\)/)
  assert.match(t, /notifications: off \(set\)/)
  for (const k of ['project', 'rules', 'language', 'classifier', 'firstChatDetection', 'midChatModelDetection', 'subagentSuggestions', 'sessionSuggestions']) assert.match(t, new RegExp(`${k}: .*\\(default\\)`))
})

test('the plugin logs the effective options once when it loads', async () => {
  const { hooks, dir } = await fromFile({ reply: PICK.same, history: ongoing(S) }, { effortDetection: 'off' })
  await send(hooks, S, 'rename that variable')
  const log = readFileSync(join(dir, 'prompt-router.log'), 'utf8')
  assert.equal(log.match(/effective options/g)?.length, 1)
  assert.match(log, /effortDetection=off/)
})

// newSessionAt: a chat whose last reply held `tokens`, on a model with a `context` window (none: no limit listed).
const longChat = (tokens: number) => ({
  [S]: [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'add a pet weight chart' }] },
    { info: { role: 'assistant', tokens: { input: tokens, output: 0, cache: { read: 0, write: 0 } } }, parts: [{ type: 'text', text: 'Done: the chart is in.' }] },
  ],
})
const withWindow = (context?: number) => [{ id: 'anthropic', models: { 'claude-opus-5-5': context ? { limit: { context, output: 32_000 } } : {}, 'claude-sonnet-5-5': {}, 'claude-haiku-5-5': {} } }]
const HERE_NEW = '{"where": "here", "model": "opus", "effort": "medium", "work": "new", "why": "a new screen"}'

test('newSessionAt: new work past half of the model context window is offered as a new session', async () => {
  const { hooks } = await setup({ reply: HERE_NEW, history: longChat(600_000), providers: withWindow(1_000_000) })
  const text = said(await send(hooks, S, 'now add a favourites screen'))
  assert.match(text, /"New session \(claude-opus-5-5 · medium\)"/)
  assert.match(text, /60% of context/)
})

test('newSessionAt: the share counts, so the same tokens in a bigger window stay here', async () => {
  const { hooks } = await setup({ reply: HERE_NEW, history: longChat(150_000), providers: withWindow(1_000_000) })
  assert.equal(said(await send(hooks, S, 'now add a favourites screen')), 'now add a favourites screen')
})

test('newSessionAt: without a listed window the chat counts against 200k', async () => {
  const { hooks } = await setup({ reply: HERE_NEW, history: longChat(150_000), providers: withWindow() })
  assert.match(said(await send(hooks, S, 'now add a favourites screen')), /75% of context/)
})

test('newSessionAt: a continuation or the option off stays here', async () => {
  const goOn = await setup({ reply: HERE_NEW.replace('"new"', '"continue"'), history: longChat(180_000), providers: withWindow(200_000) })
  assert.equal(said(await send(goOn.hooks, S, 'fix it')), 'fix it')
  const off = await fromFile({ reply: HERE_NEW, history: longChat(180_000), providers: withWindow(200_000) }, { newSessionAt: 'off' })
  assert.equal(said(await send(off.hooks, S, 'now add a favourites screen')), 'now add a favourites screen')
})
