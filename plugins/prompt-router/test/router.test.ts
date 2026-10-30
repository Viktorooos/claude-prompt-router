import { expect, test } from 'claude-code/testing'

// Canned classifier replies; nothing here calls a real model.
const PICK = {
  here: '{"where": "here", "model": "opus", "effort": "low", "why": "small follow-up"}',
  same: '{"where": "here", "model": "opus", "effort": "medium", "why": "fits"}',
  keep: '{"where": "keep", "model": "keep", "effort": "keep", "why": "approval"}',
  subagent: '{"where": "subagent", "model": "haiku", "effort": "low", "why": "just run the tests"}',
  session: '{"where": "session", "model": "sonnet", "effort": "medium", "why": "unrelated feature"}',
}

const EFFORT_ROW = {
  key: 'effort',
  label: 'Effort',
  kind: 'choice',
  value: 'medium',
  options: ['low', 'medium', 'high', 'xhigh', 'max'],
  provider: { plugin: 'engine' },
  isLocked: false,
}

type Seen = { prompts: string[]; models: string[]; sent: string[]; sets: unknown[]; toasts: string[]; store: Map<string, unknown> }

// Stands for the engine beneath the plugin: each `$` call it makes is answered here.
function engine(on: any, reply: string | (() => string), opts: { isFirst?: boolean; model?: string; rows?: unknown[]; files?: Record<string, string> } = {}): Seen {
  const seen: Seen = { prompts: [], models: [], sent: [], sets: [], toasts: [], store: new Map() }
  const messages = opts.isFirst
    ? []
    : [
        { role: 'user', text: 'Fix the duplicate recipes in search', toolUses: [] },
        { role: 'assistant', text: 'Fixed: the query now groups by recipe id.', toolUses: [] },
      ]
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__prompt-router__${e.name}` } }))
  on('model.complete', (_: unknown, e: any) => {
    seen.prompts.push(e.prompt)
    seen.models.push(e.model)
    const text = typeof reply === 'function' ? reply() : reply
    return { value: { isAnswered: true, text, usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  on('session.messages', () => ({ value: messages }))
  on('session.model', () => ({ value: opts.model ?? 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 85000 }, rateLimits: [] } }))
  on('config.list', () => ({ value: [EFFORT_ROW, ...(opts.rows ?? [])] }))
  on('config.set', (_: unknown, e: any) => {
    seen.sets.push(e.value)
    return { value: e.value }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', (_: unknown, e: any) => {
    seen.toasts.push(typeof e.text === 'string' ? e.text : JSON.stringify(e))
    return { value: undefined }
  })
  on('store.get', (_: unknown, e: any) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_: unknown, e: any) => ({ value: opts.files?.[e.path] ?? '' }))
  on('fs.write', () => ({ value: undefined }))
  on('clock.now', () => ({ value: 0 }))
  on('prompt.submit', (_: unknown, e: any) => {
    seen.sent.push(e.text)
    return { text: e.text }
  })
  return seen
}

async function start($: any) {
  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
}

async function submit($: any, text: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

test('here with another effort: sets effort itself and shows a toast (auto)', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  await start($)
  await submit($, 'the new test fails on an empty search, fix that too')
  expect(seen.sent).toEqual(['the new test fails on an empty search, fix that too'])
  expect(seen.sets).toEqual(['low'])
  expect(seen.toasts.join(' ')).toMatch(/Effort: Low \(was Medium\), small follow-up/)
})

test('here with the same effort: nothing changes', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  await start($)
  await submit($, 'and the mobile search too')
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.sent).toEqual(['and the mobile search too'])
})

test('effortMode ask: does not set effort, tells Claude to offer it', { options: { effortMode: 'ask' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  await start($)
  await submit($, 'fix that too')
  expect(seen.sets).toEqual([])
  expect(seen.sent[0]).toMatch(/^fix that too\n\n\[Prompt Router suggests effort low/)
  expect(seen.sent[0]).toMatch(/\/effort low/)
  expect(seen.sent[0]).toMatch(/in the user's language/)
})

test('keep answers and slash commands pass untouched', async ($: any, on: any) => {
  const seen = engine(on, PICK.keep)
  await start($)
  await submit($, 'yes, go on')
  expect(seen.sent).toEqual(['yes, go on'])
  expect(seen.sets).toEqual([])
  const before = seen.prompts.length
  await submit($, '/compact')
  expect(seen.prompts.length).toBe(before)
})

test('subagent pick: appends the AskUserQuestion note with the Agent call', async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent)
  await start($)
  await submit($, 'run the whole test suite and tell me what fails')
  const t = seen.sent[0] ?? ''
  expect(t.startsWith('run the whole test suite and tell me what fails\n\n[Prompt Router suggests')).toBe(true)
  expect(t).toMatch(/in a subagent \(Haiku · low\), because: just run the tests/)
  expect(t).toMatch(/AskUserQuestion/)
  expect(t).toMatch(/"Subagent \(Haiku · low\)", "Do it here \(Low\)", "Do it here \(keep Medium\)"/)
  expect(t).toMatch(/"Do it here \(Low\)" = call the mcp__prompt-router__switch tool with \{"effort":"low"\}/)
  expect(t).toMatch(/never set_session_model or set_session_effort/)
  expect(t).toMatch(/Agent tool with model "haiku" and effort "low"/)
  expect(t).not.toMatch(/New session/)
  expect(seen.sets).toEqual([])
})

test('session pick: offers a new session first, with start_session', async ($: any, on: any) => {
  const seen = engine(on, PICK.session)
  await start($)
  await submit($, 'unrelated: add a shopping list')
  const t = seen.sent[0] ?? ''
  expect(t).toMatch(/"New session \(Sonnet · medium\)", "Subagent \(Sonnet · medium\)", "Do it here"/)
  expect(t).toMatch(/start_session/)
  expect(t).toMatch(/model "claude-sonnet-5-5", effort "medium"/)
  expect(t).toMatch(/Where should this go\?/)
})

test('the first prompt of a chat stays here', async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { isFirst: true, model: 'claude-sonnet-5-5' })
  await start($)
  await submit($, 'add a shopping list')
  expect(seen.sent).toEqual(['add a shopping list'])
  expect(seen.sets).toEqual([])
})

const MODEL_ROW = {
  key: 'model',
  label: 'Model',
  kind: 'choice',
  value: 'opus',
  options: ['default', 'opus', 'opus[1m]', 'sonnet', 'haiku'],
  provider: { plugin: 'engine' },
  isLocked: false,
}

test('first prompt, another model fits: switches the model setting and says so (auto)', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { isFirst: true, rows: [MODEL_ROW] })
  await start($)
  await submit($, 'rename every string key from snake to camel case')
  expect(seen.prompts[0]).toMatch(/FIRST prompt of a new chat/)
  expect(seen.sets).toEqual(['sonnet'])
  expect(seen.toasts.join(' ')).toMatch(/Model: Sonnet \(was Opus\), unrelated feature/)
  expect(seen.sent).toEqual(['rename every string key from snake to camel case'])
})

test('first prompt without a model setting: holds the model on main-chat requests (auto)', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { isFirst: true })
  await start($)
  await submit($, 'rename every string key')
  expect(seen.toasts.join(' ')).toMatch(/Model: Sonnet \(was Opus\)/)
  const status = await $.command.run({ command: 'router', args: '' })
  expect(status.text).toMatch(/runs on claude-sonnet-5-5 \(held by the router\)/)
})

test('first prompt, the current model fits: the model stays', async ($: any, on: any) => {
  const seen = engine(on, PICK.same, { isFirst: true, rows: [MODEL_ROW] })
  await start($)
  await submit($, 'design the offline sync')
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('modelMode ask: does not switch, tells Claude to offer it', { options: { modelMode: 'ask' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent, { isFirst: true, rows: [MODEL_ROW] })
  await start($)
  await submit($, 'run the tests')
  expect(seen.sets).toEqual([])
  expect(seen.sent[0]).toMatch(/^run the tests\n\n\[Prompt Router suggests model Haiku instead of Opus and effort low instead of medium/)
})

test('modelMode off: the model is never judged', { options: { modelMode: 'off' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { isFirst: true, rows: [MODEL_ROW] })
  await start($)
  await submit($, 'rename every string key')
  expect(seen.prompts[0]).not.toMatch(/FIRST prompt/)
  expect(seen.sets).toEqual([])
})

test('a later prompt never switches the chat model', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "haiku", "effort": "medium", "why": "fits"}', { rows: [MODEL_ROW] })
  await start($)
  await submit($, 'and the mobile search too')
  expect(seen.prompts[0]).not.toMatch(/FIRST prompt/)
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('config reaches the classifier prompt and model', { options: { project: 'a Flutter food delivery app', rules: 'Payments: opus, high.', language: 'Czech', classifier: 'haiku' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  await start($)
  await submit($, 'fix the price format')
  const p = seen.prompts[0] ?? ''
  expect(p).toMatch(/chat about a Flutter food delivery app\./)
  expect(p).toMatch(/PROJECT RULES[^\n]*\nPayments: opus, high\./)
  expect(p).toMatch(/in Czech"\}$/)
  expect(seen.models[0]).toBe('claude-haiku-5-5')
})

test('defaults: neutral project, prompt language, sonnet', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  await start($)
  await submit($, 'fix the price format')
  const p = seen.prompts[0] ?? ''
  expect(p).toMatch(/chat about a software project\./)
  expect(p).not.toMatch(/PROJECT RULES/)
  expect(p).toMatch(/in the language of the new prompt"\}$/)
  expect(seen.models[0]).toBe('claude-sonnet-5-5')
})

test('odd and broken classifier replies', async ($: any, on: any) => {
  const replies = [
    '```json\n{"where": "subagent", "model": "Claude Haiku", "effort": "Extra High", "why": "a — b"}\n```',
    '{"where": "session", "model": "sonnet", "effort": "max", "why": "x"} trailing words',
    '{"where": "elsewhere", "model": "opus", "effort": "low", "why": "x"}',
    '{"where": "here", "model": "opus", "effort": "huge", "why": "x"}',
    'not json at all',
    '{"where": "keep", "model": "keep", "effort": "keep"}',
    '{"where":"here","effort":"low"}',
  ]
  let i = 0
  engine(on, () => replies[i++] ?? '')
  on('tool.call', () => ({ result: {} }))
  await start($)
  const cases = replies.map((_, n) => ({ id: `c${n}`, prompt: 'p' }))
  const r = await $.tool.call({ tool: 'mcp__prompt-router__test', cases })
  const text = String(r.result ?? r.text ?? JSON.stringify(r))
  expect(text).toMatch(/c0: subagent haiku xhigh ×1/)
  expect(text).toMatch(/c1: session sonnet max ×1/)
  expect(text).toMatch(/c2: UNPARSED/)
  expect(text).toMatch(/c3: UNPARSED/)
  expect(text).toMatch(/c4: UNPARSED not json at all/)
  expect(text).toMatch(/c5: keep ×1/)
  expect(text).toMatch(/c6: here opus low ×1/)
})

test('the test tool takes per-case config and repeats runs', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  on('tool.call', () => ({ result: {} }))
  await start($)
  const r = await $.tool.call({
    tool: 'mcp__prompt-router__test',
    runs: 2,
    cases: [{ id: 'a', prompt: 'p', project: 'a recipe app', rules: 'Search: haiku.', language: 'German' }],
  })
  const text = String(r.result ?? r.text ?? JSON.stringify(r))
  expect(text).toMatch(/a: here opus medium ×2/)
  expect(seen.prompts[0]).toMatch(/about a recipe app\./)
  expect(seen.prompts[0]).toMatch(/Search: haiku\./)
  expect(seen.prompts[0]).toMatch(/in German"\}$/)
})

test('/router off, on and status', async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent)
  const store = seen.store
  await start($)
  const off = await $.command.run({ command: 'router', args: 'off' })
  expect(off.text).toBe('Prompt Router is off. Turn it back on with /router on.')
  expect(store.get('enabled')).toBe(false)
  await submit($, 'run the tests')
  expect(seen.sent).toEqual(['run the tests'])
  expect(seen.prompts).toEqual([])
  const status = await $.command.run({ command: 'router', args: '' })
  expect(status.text).toMatch(/^Prompt Router is off \(classifier sonnet, effort mode ask, model mode ask\)\./)
  expect(status.text).toMatch(/Commands: \/router off, \/router on\./)
  const back = await $.command.run({ command: 'router', args: 'on' })
  expect(back.text).toBe('Prompt Router is on.')
  await submit($, 'run the tests')
  expect(seen.prompts.length).toBe(1)
  expect(seen.sent[1]).toMatch(/Prompt Router suggests/)
})

test('first prompt: an empty session model falls back to the model setting (auto)', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "haiku", "effort": "low", "why": "short message"}', { isFirst: true, model: '', rows: [MODEL_ROW] })
  await start($)
  await submit($, 'write a message wishing a colleague a nice day')
  expect(seen.prompts[0]).toMatch(/The chat now: model opus,/)
  expect(seen.sets).toEqual(['haiku', 'low'])
  expect(seen.toasts.join(' ')).toMatch(/Model: Haiku \(was Opus\), Effort: Low \(was Medium\), short message/)
})

test('first prompt with an unknown model: the model is left alone', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "haiku", "effort": "medium", "why": "short"}', { isFirst: true, model: 'some-custom-model' })
  await start($)
  await submit($, 'write a message')
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('a prompt holding {{slots}} reaches the classifier as written', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  await start($)
  await submit($, 'why does {{project}} show up raw in the email template?')
  expect(seen.prompts[0]).toMatch(/why does \{\{project\}\} show up raw/)
  expect(seen.prompts[0]).not.toMatch(/\{\{(model_head|rules|first|lang)\}\}/)
})

test('the test tool takes a template file and the first-prompt flag', async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent, { files: { '/t.txt': 'TEMPLATE {{model_head}} :: {{prompt}}' } })
  on('tool.call', () => ({ result: {} }))
  await start($)
  const r = await $.tool.call({ tool: 'mcp__prompt-router__test', template: '/t.txt', cases: [{ id: 'a', prompt: 'run lint', isFirst: true }] })
  expect(seen.prompts[0]).toMatch(/^TEMPLATE MODEL \(this is the FIRST prompt/)
  expect(seen.prompts[0]).toMatch(/:: run lint$/)
  expect(JSON.stringify(r)).toMatch(/a: subagent haiku low ×1/)
})

test('classifier opus: the routing call runs on Opus', { options: { classifier: 'opus' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  await start($)
  await submit($, 'and the mobile search too')
  expect(seen.models).toEqual(['claude-opus-5-5'])
})

test('defaults ask: one dialog for model and effort, nothing switched', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "haiku", "effort": "low", "why": "short message"}', { isFirst: true, rows: [MODEL_ROW] })
  await start($)
  await submit($, 'write a message wishing a colleague a nice day')
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
  expect(seen.sent[0]).toMatch(/suggests model Haiku instead of Opus and effort low instead of medium/)
  expect(seen.sent[0]).toMatch(/AskUserQuestion/)
  expect(seen.sent[0]).toMatch(/"Switch \(Haiku · Low\)", "Keep as is"/)
  expect(seen.sent[0]).toMatch(/On Switch, call the mcp__prompt-router__switch tool with \{"model":"haiku","effort":"low"\}/)
  expect(seen.sent[0]).toMatch(/tell the user in one line to run \/model haiku and \/effort low/)
  expect(seen.sent[0]).not.toMatch(/set_session_model "/)
})

test('defaults ask: an effort change alone is asked too', async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  await start($)
  await submit($, 'fix that too')
  expect(seen.sets).toEqual([])
  expect(seen.sent[0]).toMatch(/suggests effort low instead of medium/)
  expect(seen.sent[0]).not.toMatch(/model Opus/)
  expect(seen.sent[0]).toMatch(/"Switch \(Low\)", "Keep as is"/)
})

test('a prompt typed over a running turn keeps model and effort', async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  await start($)
  await $.prompt.submit({ text: 'and push it', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  expect(seen.sent).toEqual(['and push it'])
})

test('a prompt typed over a running turn still offers a session', async ($: any, on: any) => {
  const seen = engine(on, PICK.session)
  await start($)
  await $.prompt.submit({ text: 'unrelated: a shopping list', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  expect(seen.sent[0]).toMatch(/Prompt Router suggests running this prompt in a new session/)
})

test('subagent pick (auto): Do it here switches the effort too', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent)
  await start($)
  await submit($, 'run the whole test suite and tell me what fails')
  const t = seen.sent[0] ?? ''
  expect(t).toMatch(/"Subagent \(Haiku · low\)", "Do it here \(Low\)"/)
  expect(t).not.toMatch(/keep Medium/)
  expect(seen.sets).toEqual([])
})

const FABLE_ROW = { ...MODEL_ROW, options: ['default', 'opus', 'sonnet', 'haiku', 'fable', 'fable[1m]'] }

test('Switch: the mod tool sets the chat model and effort', async ($: any, on: any) => {
  const seen = engine(on, PICK.same, { rows: [FABLE_ROW] })
  on('tool.call', () => ({ result: {} }))
  await start($)
  const r = await $.tool.call({ tool: 'mcp__prompt-router__switch', model: 'fable', effort: 'max' })
  expect(seen.sets).toEqual(['fable', 'max'])
  expect(JSON.stringify(r)).toMatch(/Switched this chat to model Fable and effort Max/)
  const none = await $.tool.call({ tool: 'mcp__prompt-router__switch' })
  expect(JSON.stringify(none)).toMatch(/Nothing switched/)
})

test('Switch: refuses a model this chat is not offered and names what it skipped', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  on('tool.call', () => ({ result: {} }))
  await start($)
  const r = await $.tool.call({ tool: 'mcp__prompt-router__switch', model: 'fable', effort: 'high' })
  expect(seen.sets).toEqual(['high'])
  expect(r.result).toMatch(/Switched this chat to effort High\. Not switched: model "fable"/)
  const bad = await $.tool.call({ tool: 'mcp__prompt-router__switch', model: 'opus', effort: 'ultra' })
  expect(bad.result).toMatch(/Switched this chat to model Opus\. Not switched: effort "ultra"/)
})

test('Fable listed in the model setting: offered, with its rule', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "session", "model": "fable", "effort": "high", "why": "new cross-platform architecture"}', { rows: [FABLE_ROW] })
  await start($)
  await submit($, 'design offline sync for shared, iOS and Android')
  const t = seen.sent[0] ?? ''
  expect(seen.prompts[0]).toMatch(/"model": "haiku\|sonnet\|opus\|fable"/)
  expect(seen.prompts[0]).toMatch(/- fable: rare/)
  expect(t).toMatch(/"New session \(Fable · high\)"/)
  expect(t).toMatch(/model "claude-fable-5-1", effort "high"/)
  expect(t).toMatch(/Agent tool with model "fable"/)
})

test('Fable not in the model setting: never offered, a fable pick becomes Opus', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "session", "model": "fable", "effort": "high", "why": "x"}', { rows: [MODEL_ROW] })
  await start($)
  await submit($, 'design offline sync')
  expect(seen.prompts[0]).toMatch(/"model": "haiku\|sonnet\|opus"/)
  expect(seen.prompts[0]).not.toMatch(/fable/)
  expect(seen.sent[0]).toMatch(/"New session \(Opus · high\)"/)
})

test('no model setting: the base models only', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  await start($)
  await submit($, 'and the mobile search too')
  expect(seen.prompts[0]).toMatch(/"model": "haiku\|sonnet\|opus"/)
})

test('a chat running on Fable can keep Fable', async ($: any, on: any) => {
  const seen = engine(on, PICK.same, { model: 'claude-fable-5-1' })
  await start($)
  await submit($, 'and the mobile search too')
  expect(seen.prompts[0]).toMatch(/model claude-fable-5-1/)
  expect(seen.prompts[0]).toMatch(/\|fable"/)
})

test('max stays max (auto): the effort is set to max', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "opus", "effort": "max", "why": "irreversible production fix"}')
  await start($)
  await submit($, 'run the one-off production data repair, maximum care')
  expect(seen.sets).toEqual(['max'])
  expect(seen.toasts.join(' ')).toMatch(/Effort: Max \(was Medium\)/)
})

test('max (ask): offered as Switch (Max) through the mod tool', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "opus", "effort": "max", "why": "x"}')
  await start($)
  await submit($, 'p')
  expect(seen.sent[0]).toMatch(/"Switch \(Max\)", "Keep as is"/)
  expect(seen.sent[0]).toMatch(/\{"effort":"max"\}/)
})

test('the test tool takes the models on offer per case', async ($: any, on: any) => {
  const seen = engine(on, '{"where": "session", "model": "fable", "effort": "xhigh", "why": "x"}')
  on('tool.call', () => ({ result: {} }))
  await start($)
  const r = await $.tool.call({ tool: 'mcp__prompt-router__test', cases: [{ id: 'all', prompt: 'p' }, { id: 'nofable', prompt: 'p', models: ['haiku', 'sonnet', 'opus'] }] })
  const text = JSON.stringify(r)
  expect(text).toMatch(/all: session fable xhigh ×1/)
  expect(text).toMatch(/nofable: session opus xhigh ×1/)
  expect(seen.prompts[0]).toMatch(/- fable: rare/)
  expect(seen.prompts[1]).not.toMatch(/fable/)
})
