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
function engine(on: any, reply: string | (() => string), opts: { isFirst?: boolean } = {}): Seen {
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
  on('session.usage', () => ({ value: { startedAt: 0, context: { tokens: 85000 }, rateLimits: [] } }))
  on('config.list', () => ({ value: [EFFORT_ROW] }))
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
  on('fs.read', () => ({ value: '' }))
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

test('here with another effort: sets effort itself and shows a toast', async ($: any, on: any) => {
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
  expect(t).toMatch(/"Subagent \(Haiku · low\)", "Do it here"/)
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
  const seen = engine(on, PICK.session, { isFirst: true })
  await start($)
  await submit($, 'add a shopping list')
  expect(seen.sent).toEqual(['add a shopping list'])
  expect(seen.sets).toEqual([])
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
  expect(text).toMatch(/c1: session sonnet xhigh ×1/)
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
  expect(status.text).toMatch(/^Prompt Router is off \(classifier sonnet, effort mode auto\)\./)
  expect(status.text).toMatch(/Commands: \/router off, \/router on\./)
  const back = await $.command.run({ command: 'router', args: 'on' })
  expect(back.text).toBe('Prompt Router is on.')
  await submit($, 'run the tests')
  expect(seen.prompts.length).toBe(1)
  expect(seen.sent[1]).toMatch(/Prompt Router suggests/)
})
