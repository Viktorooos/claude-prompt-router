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
  assert.match(text, /^rename foo to bar everywhere\n\n\[Prompt Router suggests model Sonnet instead of Opus and effort low instead of medium/)
  assert.match(text, /question tool/)
  assert.match(text, /"Switch \(Sonnet · Low\)", "Keep as is"/)
  assert.match(text, /call the router_switch tool with \{"model":"sonnet","effort":"low"\}/)
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
  assert.match(text, /Prompt Router suggests running this prompt in a subagent \(Haiku · low\), because: just run the tests/)
  assert.match(text, /"Subagent \(Haiku · low\)", "Do it here \(Low\)", "Do it here \(keep Medium\)"/)
  assert.match(text, /call the task tool with subagent_type "router-haiku"/)
  assert.equal(config.agent['router-haiku'].model, 'anthropic/claude-haiku-5-5')
  assert.equal(config.agent['router-haiku'].mode, 'subagent')
})

test('subagent effort: the task call carries the pick to the child session', async () => {
  const { hooks } = await setup({ reply: PICK.subagent, history: ongoing(S), parents: { ses_child: S } })
  await send(hooks, S, 'run the whole test suite')
  await hooks['tool.execute.before']({ tool: 'task', sessionID: S, callID: 'c1' }, { args: { subagent_type: 'router-haiku', prompt: 'run tests', description: 'tests' } })
  const child = await send(hooks, 'ses_child', 'run tests', { agent: 'router-haiku', model: 'anthropic/claude-haiku-5-5' })
  assert.equal(child.message.variant, 'low')
  assert.equal(said(child), 'run tests')
})

test('session pick: the note offers a new session through router_session', async () => {
  const { hooks } = await setup({ reply: PICK.session, history: ongoing(S) })
  const text = said(await send(hooks, S, 'now build the settings screen'))
  assert.match(text, /in a new session \(Sonnet · medium\)/)
  assert.match(text, /"New session \(Sonnet · medium\)", "Subagent \(Sonnet · medium\)", "Do it here"/)
  assert.match(text, /call the router_session tool right away with model "sonnet", effort "medium"/)
  assert.match(text, /opencode --model anthropic\/claude-sonnet-5-5 --prompt/)
})

test('router_session starts a session on the model and variant and is not routed', async () => {
  const { hooks, calls } = await setup({ reply: PICK.session })
  const r = await hooks.tool.router_session.execute({ model: 'sonnet', effort: 'high', prompt: 'build the settings screen' }, { sessionID: S })
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
  assert.match(r, /Switched this chat to model Sonnet and effort High\./)
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
  assert.equal(await hooks.tool.router_switch.execute({ model: 'fable', effort: 'huge' }, { sessionID: S }), 'Nothing switched. Not switched: model "fable" (not offered in this chat), effort "huge" (unknown).')
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
