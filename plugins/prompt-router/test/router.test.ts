import { expect, test } from 'claude-code/testing'
import { optionSources, toConfig } from '../core/router.ts'

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

type Seen = { prompts: string[]; models: string[]; sent: string[]; sets: unknown[]; toasts: string[]; store: Map<string, unknown>; writes: string[]; modes: string[][] }

// Stands for the engine beneath the plugin: each `$` call it makes is answered here.
function engine(on: any, reply: string | (() => string), opts: { isFirst?: boolean; model?: string; rows?: unknown[]; files?: Record<string, string>; tools?: string[]; surfaces?: string[]; messages?: unknown[]; noEffortRow?: boolean; now?: number } = {}): Seen {
  const seen: Seen = { prompts: [], models: [], sent: [], sets: [], toasts: [], store: new Map(), writes: [], modes: [] }
  const messages = opts.messages ?? (opts.isFirst
    ? []
    : [
        { role: 'user', text: 'Fix the duplicate recipes in search', toolUses: [] },
        { role: 'assistant', text: 'Fixed: the query now groups by recipe id.', toolUses: [] },
      ])
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
  on('config.list', () => ({ value: [...(opts.noEffortRow ? [] : [EFFORT_ROW]), ...(opts.rows ?? [])] }))
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
  // A key starting with * matches any path that ends with the rest (e.g. *\/.claude/settings.json).
  const file = (path: string) => opts.files?.[path] ?? Object.entries(opts.files ?? {}).find(([k]) => k.startsWith('*') && path.endsWith(k.slice(1)))?.[1]
  on('fs.read', (_: unknown, e: any) => ({ value: file(e.path) ?? '' }))
  on('tool.list', () => ({ value: (opts.tools ?? ['mcp__ccd_session__start_session']).map(name => ({ name, description: '', mcp: true })) }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['desktop'] }))
  on('fs.write', (_: unknown, e: any) => {
    seen.writes.push(JSON.stringify(e))
    return { value: undefined }
  })
  on('ui.render', (_: unknown, e: any) => {
    seen.modes.push(e.props?.modes ?? [])
    return { type: 'Text', props: {} }
  })
  on('clock.now', () => ({ value: opts.now ?? 0 }))
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
  expect(status.text).toMatch(/Commands: \/router off, \/router on, \/router stats\./)
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

// The app's own text before the prompt: it can be far longer than what the classifier reads.
const REMINDER = `<system-reminder>\nThe user started this session without choosing a project folder. ${'Setup detail. '.repeat(400)}\n</system-reminder>`

const SETTINGS = (key: string, options: Record<string, string>) => JSON.stringify({ pluginConfigs: { [key]: { options } } })

test('options saved under the short key still apply (auto): no dialog', async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { files: { '*/.claude/settings.json': SETTINGS('prompt-router', { effortMode: 'auto', modelMode: 'auto', language: 'Czech' }) } })
  await start($)
  await submit($, 'fix that too')
  expect(seen.sets).toEqual(['low'])
  expect(seen.sent).toEqual(['fix that too'])
  expect(seen.prompts[0]).toMatch(/Czech/)
})

test('options under the full id win over a stray short-key entry', { options: { effortMode: 'ask' } } as any, async ($: any, on: any) => {
  const both = JSON.stringify({ pluginConfigs: { 'prompt-router': { options: { effortMode: 'auto' } }, 'prompt-router@prompt-router': { options: { effortMode: 'ask' } } } })
  const seen = engine(on, PICK.here, { files: { '*/.claude/settings.json': both } })
  await start($)
  await submit($, 'fix that too')
  expect(seen.sets).toEqual([])
  expect(seen.sent[0]).toMatch(/AskUserQuestion/)
})

test('/router status says when the options sit under the short key', async ($: any, on: any) => {
  engine(on, PICK.same, { files: { '*/.claude/settings.json': SETTINGS('prompt-router', { effortMode: 'auto' }) } })
  await start($)
  const r = await $.command.run({ command: 'router', args: '' })
  expect(r.text).toMatch(/effort mode auto/)
  expect(r.text).toMatch(/prompt-router@prompt-router/)
})

test('the app text before a prompt never reaches the classifier as the prompt', async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { isFirst: true })
  await start($)
  await submit($, `${REMINDER}\n\nproč se mi přihlášení neuloží po restartu appky`)
  expect(seen.prompts.length).toBe(1)
  expect(seen.prompts[0]).toMatch(/proč se mi přihlášení neuloží/)
  expect(seen.prompts[0]).not.toMatch(/system-reminder|Setup detail/)
})

test('a prompt that is only app text is not classified', async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  await start($)
  await submit($, REMINDER)
  expect(seen.prompts.length).toBe(0)
  expect(seen.sent).toEqual([REMINDER])
})

test('a slash command after app text passes untouched', async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  await start($)
  await submit($, `${REMINDER}\n/compact`)
  expect(seen.prompts.length).toBe(0)
})

test('app text in earlier messages is left out of the chat summary', async ($: any, on: any) => {
  const messages = [
    { role: 'user', text: `${REMINDER}\nFix the duplicate recipes in search`, toolUses: [] },
    { role: 'assistant', text: 'Fixed.', toolUses: [] },
  ]
  const seen = engine(on, PICK.same, { messages })
  await start($)
  await submit($, 'and the mobile search too')
  expect(seen.prompts[0]).toMatch(/Fix the duplicate recipes in search/)
  expect(seen.prompts[0]).not.toMatch(/Setup detail/)
})

test('no start_session (terminal, VS Code): a session pick gives the claude command instead', async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { tools: [], surfaces: ['terminal'] })
  await start($)
  await submit($, 'now build the shopping list feature')
  const t = seen.sent[0]
  expect(t).not.toMatch(/start_session/)
  expect(t).toMatch(/claude --model claude-sonnet-5-5 --effort medium/)
  expect(t).toMatch(/AskUserQuestion/)
})

test('start_session deferred but the app draws: the session is started there', async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { tools: [], surfaces: ['desktop'] })
  await start($)
  await submit($, 'now build the shopping list feature')
  expect(seen.sent[0]).toMatch(/start_session/)
})

test('a -p / SDK run passes untouched: its flags chose model and effort', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { surfaces: [] })
  await start($)
  await $.prompt.submit({ text: 'now build the shopping list feature', wait: false, origin: { kind: 'sdk' } })
  expect(seen.sent).toEqual(['now build the shopping list feature'])
  expect(seen.prompts.length).toBe(0)
  expect(seen.sets).toEqual([])
})

// Here on another model: switching this chat's model would break the prompt cache, so the router
// offers a subagent on that model or staying here with only the effort judged again.
const OTHER = {
  lower: '{"where": "here", "model": "sonnet", "effort": "low", "why": "a mechanical edit"}',
  lowerSame: '{"where": "here", "model": "sonnet", "effort": "medium", "why": "a mechanical edit"}',
  higher: '{"where": "here", "model": "opus", "effort": "high", "why": "new logic"}',
}

test('mid-chat, the classifier is asked which model the task needs, also for here', async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower)
  await start($)
  await submit($, 'rename the keys we just found')
  expect(seen.prompts[0]).not.toMatch(/for here use the current one/)
  expect(seen.prompts[0]).toMatch(/MODEL \(the model the task needs, also for here/)
  expect(seen.prompts[0]).toMatch(/a quick question, or writing a short message or email keeps the current one, even where the haiku rule below says haiku/)
})

test('here on a cheaper model (ask): offers a subagent or staying here, switches nothing', { options: { effortMode: 'ask', modelMode: 'ask' } } as any, async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW] })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t.startsWith('rename the keys we just found\n\n[Prompt Router')).toBe(true)
  expect(t).toMatch(/fits Sonnet · low better than this chat's Opus, because: a mechanical edit/)
  expect(t).toMatch(/AskUserQuestion/)
  expect(t).toMatch(/"Subagent \(Sonnet · low\)", "Stay here \(Low\)", "Stay here \(keep Medium\)"/)
  expect(t).toMatch(/Agent tool with model "sonnet" and effort "low"/)
  expect(t).toMatch(/give it everything it needs from this chat/)
  expect(t).toMatch(/"Stay here \(Low\)" = call the mcp__prompt-router__switch tool with \{"effort":"low"\}/)
  expect(t).toMatch(/never switch this chat's model/)
  expect(t).not.toMatch(/\{"model"/)
  expect(t).not.toMatch(/New session/)
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('here on a stronger model: the same offer, the chat model stays', async ($: any, on: any) => {
  const seen = engine(on, OTHER.higher, { model: 'claude-haiku-5-5', rows: [{ ...MODEL_ROW, value: 'haiku' }] })
  await start($)
  await submit($, 'now work out the sync logic for it')
  const t = seen.sent[0] ?? ''
  expect(t).toMatch(/fits Opus · high better than this chat's Haiku, because: new logic/)
  expect(t).toMatch(/"Subagent \(Opus · high\)", "Stay here \(High\)", "Stay here \(keep Medium\)"/)
  expect(t).toMatch(/Agent tool with model "opus" and effort "high"/)
  expect(seen.sets).toEqual([])
})

test('here on another model (auto): one Stay here option that switches only the effort', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW] })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t).toMatch(/"Subagent \(Sonnet · low\)", "Stay here \(Low\)"/)
  expect(t).not.toMatch(/keep Medium/)
  expect(t).toMatch(/"Stay here \(Low\)" = call the mcp__prompt-router__switch tool with \{"effort":"low"\}/)
  // The question comes first: nothing is set before the user picks.
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
})

test('here on another model at the same effort: Stay here just goes on', async ($: any, on: any) => {
  const seen = engine(on, OTHER.lowerSame, { rows: [MODEL_ROW] })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t).toMatch(/"Subagent \(Sonnet · medium\)", "Stay here"/)
  expect(t).toMatch(/"Stay here" = continue normally/)
  expect(t).not.toMatch(/switch tool/)
  expect(seen.sets).toEqual([])
})

test('modelMode off: here on another model only judges the effort, as before', { options: { effortMode: 'auto', modelMode: 'off' } } as any, async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW] })
  await start($)
  await submit($, 'rename the keys we just found')
  expect(seen.prompts[0]).toMatch(/for here use the current one/)
  expect(seen.sent).toEqual(['rename the keys we just found'])
  expect(seen.sets).toEqual(['low'])
})

test('here on another model typed over a running turn: nothing changes', async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW] })
  await start($)
  await $.prompt.submit({ text: 'and rename these too', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  expect(seen.sent).toEqual(['and rename these too'])
  expect(seen.sets).toEqual([])
})

test('here on another model when the chat model is unknown: as before', { options: { effortMode: 'auto', modelMode: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { model: 'some-custom-model' })
  await start($)
  await submit($, 'rename the keys we just found')
  expect(seen.sent).toEqual(['rename the keys we just found'])
  expect(seen.sets).toEqual(['low'])
})

// One switch per feature (0.8.0). The options reach the mod the way they do for real: the engine
// passes pluginConfigs › prompt-router@prompt-router from ~/.claude/settings.json (with the manifest
// defaults filled in), and the mod reads that same entry, or the plain prompt-router one, from the file.
const FULL = (options: Record<string, string>) => ({ '*/.claude/settings.json': SETTINGS('prompt-router@prompt-router', options) })
const SHORT_KEY = (options: Record<string, string>) => ({ '*/.claude/settings.json': SETTINGS('prompt-router', options) })
const saved = (options: Record<string, string>) => ({ options } as any)

test('toConfig: the new keys, the old ones when they are missing, defaults otherwise', () => {
  const d = toConfig({})
  expect([d.effortDetection, d.firstChatDetection, d.midChatModelDetection, d.subagentSuggestions, d.sessionSuggestions, d.notifications]).toEqual(['ask', 'ask', 'ask', 'ask', 'ask', 'on'])
  const n = toConfig({ effortDetection: 'off', firstChatDetection: 'auto', midChatModelDetection: 'off', subagentSuggestions: 'off', sessionSuggestions: 'off', notifications: 'off' })
  expect([n.effortDetection, n.firstChatDetection, n.midChatModelDetection, n.subagentSuggestions, n.sessionSuggestions, n.notifications]).toEqual(['off', 'auto', 'off', 'off', 'off', 'off'])
  const old = toConfig({ effortMode: 'auto', modelMode: 'auto' })
  expect([old.effortDetection, old.firstChatDetection, old.midChatModelDetection]).toEqual(['auto', 'auto', 'ask'])
  const oldOff = toConfig({ modelMode: 'off' })
  expect([oldOff.firstChatDetection, oldOff.midChatModelDetection]).toEqual(['off', 'off'])
  const both = toConfig({ effortDetection: 'ask', effortMode: 'auto', firstChatDetection: 'auto', midChatModelDetection: 'ask', modelMode: 'off' })
  expect([both.effortDetection, both.firstChatDetection, both.midChatModelDetection]).toEqual(['ask', 'auto', 'ask'])
  expect(toConfig({ midChatModelDetection: 'auto' }).midChatModelDetection).toBe('auto')
  const bad = toConfig({ effortDetection: 'sometimes', midChatModelDetection: 'sometimes', notifications: 'loud', subagentSuggestions: 1 })
  expect([bad.effortDetection, bad.midChatModelDetection, bad.notifications, bad.subagentSuggestions]).toEqual(['ask', 'ask', 'on', 'ask'])
})

test('optionSources: each option says whether the new key, the old key or the default set it', () => {
  const s = optionSources({ effortMode: 'auto', modelMode: 'off', notifications: 'off' })
  expect(s.effortDetection).toEqual({ value: 'auto', from: 'old', key: 'effortMode' })
  expect(s.firstChatDetection).toEqual({ value: 'off', from: 'old', key: 'modelMode' })
  expect(s.midChatModelDetection).toEqual({ value: 'off', from: 'old', key: 'modelMode' })
  expect(s.notifications).toEqual({ value: 'off', from: 'new', key: 'notifications' })
  expect(s.subagentSuggestions).toEqual({ value: 'ask', from: 'default', key: 'subagentSuggestions' })
})

test('effortDetection off: no effort set or offered, Do it here has no level', saved({ effortDetection: 'off' }), async ($: any, on: any) => {
  const replies = [PICK.here, PICK.subagent]
  const seen = engine(on, () => replies.shift() ?? PICK.keep, { files: FULL({ effortDetection: 'off' }) })
  await start($)
  await submit($, 'fix that too')
  expect(seen.sent).toEqual(['fix that too'])
  expect(seen.sets).toEqual([])
  expect(seen.toasts).toEqual([])
  await submit($, 'run the whole test suite and tell me what fails')
  const t = seen.sent[1] ?? ''
  expect(t).toMatch(/"Subagent \(Haiku · low\)", "Do it here"/)
  expect(t).not.toMatch(/Do it here \(/)
  expect(t).not.toMatch(/switch tool/)
  expect(seen.sets).toEqual([])
})

test('effortDetection off: Stay here has no level either', saved({ effortDetection: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW], files: FULL({ effortDetection: 'off' }) })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t).toMatch(/"Subagent \(Sonnet · low\)", "Stay here"/)
  expect(t).not.toMatch(/Stay here \(/)
  expect(seen.sets).toEqual([])
})

test('firstChatDetection off: the first prompt keeps its model, the effort is still judged', saved({ firstChatDetection: 'off', effortDetection: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "sonnet", "effort": "low", "why": "a rename"}', { isFirst: true, rows: [MODEL_ROW], files: FULL({ firstChatDetection: 'off', effortDetection: 'auto' }) })
  await start($)
  await submit($, 'rename every string key')
  expect(seen.prompts[0]).not.toMatch(/FIRST prompt/)
  expect(seen.sent).toEqual(['rename every string key'])
  expect(seen.sets).toEqual(['low'])
  expect(seen.toasts.join(' ')).not.toMatch(/Model/)
})

test('midChatModelDetection off: no Subagent / Stay here question, only the effort', saved({ midChatModelDetection: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW], files: FULL({ midChatModelDetection: 'off' }) })
  await start($)
  await submit($, 'rename the keys we just found')
  expect(seen.prompts[0]).toMatch(/for here use the current one/)
  const t = seen.sent[0] ?? ''
  expect(t).not.toMatch(/Subagent|Stay here/)
  expect(t).toMatch(/Prompt Router suggests effort low instead of medium/)
  expect(seen.sets).toEqual([])
})

test('midChatModelDetection auto: no question, the agent decides between the subagent and here', saved({ midChatModelDetection: 'auto', effortDetection: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW], files: FULL({ midChatModelDetection: 'auto', effortDetection: 'auto' }) })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t).not.toMatch(/AskUserQuestion|Where should this go/)
  expect(t).toMatch(/Do not ask the user; decide yourself/)
  expect(t).toMatch(/only when it is worth it: a larger self-contained piece of work/)
  expect(t).toMatch(/a quick question, a short answer or a short message stays here/)
  expect(t).toMatch(/Subagent = call the Agent tool with model "sonnet" and effort "low"/)
  expect(t).toMatch(/Here = call the mcp__prompt-router__switch tool with \{"effort":"low"\}/)
  expect(t).toMatch(/never switch this chat's model/)
  expect(t).toMatch(/tell the user in one sentence what you chose/)
  expect(seen.sets).toEqual([])
})

test('midChatModelDetection auto with effortDetection ask: only the effort is asked, and only when staying here', saved({ midChatModelDetection: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW], files: FULL({ midChatModelDetection: 'auto' }) })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t).not.toMatch(/Where should this go|"Subagent \(/)
  expect(t).toMatch(/Do not ask the user; decide yourself/)
  expect(t).toMatch(/Here = ask the user only about the effort with the AskUserQuestion tool .*"Stay here \(Low\)", "Stay here \(keep Medium\)"/)
})

test('midChatModelDetection auto with effortDetection off: staying here changes nothing', saved({ midChatModelDetection: 'auto', effortDetection: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW], files: FULL({ midChatModelDetection: 'auto', effortDetection: 'off' }) })
  await start($)
  await submit($, 'rename the keys we just found')
  const t = seen.sent[0] ?? ''
  expect(t).not.toMatch(/AskUserQuestion|mcp__prompt-router__switch/)
  expect(t).toMatch(/Here = handle the prompt normally/)
})

test('midChatModelDetection off leaves the first prompt alone: its model is still judged', saved({ midChatModelDetection: 'off', effortDetection: 'auto', firstChatDetection: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { isFirst: true, rows: [MODEL_ROW], files: FULL({ midChatModelDetection: 'off', effortDetection: 'auto', firstChatDetection: 'auto' }) })
  await start($)
  await submit($, 'rename every string key')
  expect(seen.prompts[0]).toMatch(/FIRST prompt/)
  expect(seen.sets).toEqual(['sonnet'])
})

test('subagentSuggestions off: a subagent pick is handled as here', saved({ subagentSuggestions: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, '{"where": "subagent", "model": "opus", "effort": "low", "why": "just run the tests"}', { files: FULL({ subagentSuggestions: 'off' }) })
  await start($)
  await submit($, 'run the whole test suite and tell me what fails')
  const t = seen.sent[0] ?? ''
  expect(t).not.toMatch(/in a subagent|Subagent \(|Agent tool/)
  expect(t).toMatch(/Prompt Router suggests effort low instead of medium/)
})

test('subagentSuggestions off: a subagent pick on another model goes on to the other-model offer', saved({ subagentSuggestions: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent, { rows: [MODEL_ROW], files: FULL({ subagentSuggestions: 'off' }) })
  await start($)
  await submit($, 'run the whole test suite and tell me what fails')
  const t = seen.sent[0] ?? ''
  expect(t).not.toMatch(/suggests running this prompt in a subagent/)
  expect(t).toMatch(/fits Haiku · low better than this chat's Opus/)
})

test('subagentSuggestions and midChatModelDetection off: a subagent pick only judges the effort', saved({ subagentSuggestions: 'off', midChatModelDetection: 'off', effortDetection: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent, { rows: [MODEL_ROW], files: FULL({ subagentSuggestions: 'off', midChatModelDetection: 'off', effortDetection: 'auto' }) })
  await start($)
  await submit($, 'run the whole test suite and tell me what fails')
  expect(seen.sent).toEqual(['run the whole test suite and tell me what fails'])
  expect(seen.sets).toEqual(['low'])
})

test('sessionSuggestions off: a session pick is handled as here', saved({ sessionSuggestions: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, '{"where": "session", "model": "opus", "effort": "medium", "why": "unrelated feature"}', { files: FULL({ sessionSuggestions: 'off' }) })
  await start($)
  await submit($, 'unrelated: add a shopping list')
  expect(seen.sent).toEqual(['unrelated: add a shopping list'])
  expect(seen.sets).toEqual([])
})

test('sessionSuggestions off: a session pick over a running turn passes untouched', saved({ sessionSuggestions: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { files: FULL({ sessionSuggestions: 'off' }) })
  await start($)
  await $.prompt.submit({ text: 'unrelated: a shopping list', wait: false, origin: { kind: 'composer' }, turnId: 't1' })
  expect(seen.sent).toEqual(['unrelated: a shopping list'])
})

test('notifications off: the effort is still set, but no toast and no footer label', saved({ notifications: 'off', effortDetection: 'auto' }), async ($: any, on: any) => {
  // No effort setting to move: the mod holds the level, which the footer label would name.
  const seen = engine(on, PICK.here, { noEffortRow: true, files: FULL({ notifications: 'off', effortDetection: 'auto' }) })
  await start($)
  await submit($, 'fix that too')
  expect(seen.toasts).toEqual([])
  await $.ui.render({ component: 'SessionMode', surface: 'terminal', props: { modes: ['Plan'] } })
  expect(seen.modes.at(-1)).toEqual(['Plan'])
  const status = await $.command.run({ command: 'router', args: '' })
  expect(status.text).toMatch(/held by the router: Low/)
})

test('notifications on (default): the same change shows a toast and the footer label', saved({ effortDetection: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { noEffortRow: true, files: FULL({ effortDetection: 'auto' }) })
  await start($)
  await submit($, 'fix that too')
  expect(seen.toasts.join(' ')).toMatch(/Effort: Low/)
  await $.ui.render({ component: 'SessionMode', surface: 'terminal', props: { modes: ['Plan'] } })
  expect(seen.modes.at(-1)).toEqual(['Plan', 'Effort Low'])
})

test('old keys under the full id still work when the new ones are missing', saved({ effortMode: 'auto', modelMode: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { files: FULL({ effortMode: 'auto', modelMode: 'auto' }) })
  await start($)
  await submit($, 'fix that too')
  expect(seen.sets).toEqual(['low'])
  expect(seen.sent).toEqual(['fix that too'])
})

test('a new key set to its default wins over an old key', saved({ effortDetection: 'ask', effortMode: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { files: FULL({ effortDetection: 'ask', effortMode: 'auto' }) })
  await start($)
  await submit($, 'fix that too')
  expect(seen.sets).toEqual([])
  expect(seen.sent[0]).toMatch(/AskUserQuestion/)
})

test('modelMode off alone turns off both first-chat and mid-chat model detection', saved({ modelMode: 'off', effortMode: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.session, { isFirst: true, rows: [MODEL_ROW], files: FULL({ modelMode: 'off', effortMode: 'auto' }) })
  await start($)
  await submit($, 'rename every string key')
  expect(seen.prompts[0]).not.toMatch(/FIRST prompt/)
  expect(seen.sets).toEqual([])
  expect(seen.sent).toEqual(['rename every string key'])
})

test('modelMode off alone: no mid-chat Subagent / Stay here question', saved({ modelMode: 'off', effortMode: 'auto' }), async ($: any, on: any) => {
  const seen = engine(on, OTHER.lower, { rows: [MODEL_ROW], files: FULL({ modelMode: 'off', effortMode: 'auto' }) })
  await start($)
  await submit($, 'rename the keys we just found')
  expect(seen.prompts[0]).toMatch(/for here use the current one/)
  expect(seen.sent).toEqual(['rename the keys we just found'])
  expect(seen.sets).toEqual(['low'])
})

test('new keys under the short key apply too', async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { files: SHORT_KEY({ effortDetection: 'off' }) })
  await start($)
  await submit($, 'fix that too')
  expect(seen.sent).toEqual(['fix that too'])
  expect(seen.sets).toEqual([])
})

test('/router prints every option with its value and where it came from', saved({ effortMode: 'auto', notifications: 'off', language: 'Czech' }), async ($: any, on: any) => {
  engine(on, PICK.same, { files: FULL({ effortMode: 'auto', notifications: 'off', language: 'Czech' }) })
  await start($)
  const t = (await $.command.run({ command: 'router', args: '' })).text
  expect(t).toMatch(/effortDetection: auto \(old key effortMode; rename it to effortDetection\)/)
  expect(t).toMatch(/notifications: off \(set\)/)
  expect(t).toMatch(/language: Czech \(set\)/)
  for (const k of ['project', 'rules', 'classifier', 'firstChatDetection', 'midChatModelDetection', 'subagentSuggestions', 'sessionSuggestions']) expect(t).toMatch(new RegExp(`${k}: .*\\(default\\)`))
})

test('the session start logs the effective options once', saved({ effortDetection: 'off' }), async ($: any, on: any) => {
  const seen = engine(on, PICK.here, { files: FULL({ effortDetection: 'off' }) })
  await start($)
  await submit($, 'fix that too')
  const logs = seen.writes.filter(w => w.includes('prompt-router.log') && w.includes('effective options'))
  expect(logs.length).toBe(1)
  expect(logs[0]).toMatch(/effortDetection=off/)
  expect(logs[0]).toMatch(/notifications=on/)
})

// Stats: the records the mod writes to prompt-router-stats.jsonl.
function statsLines(seen: Seen) {
  return seen.writes
    .map(w => JSON.parse(w) as { path: string; text: string })
    .filter(w => w.path.endsWith('prompt-router-stats.jsonl'))
    .flatMap(w => w.text.split('\n').filter(Boolean).map(l => JSON.parse(l)))
}

const TURN_DONE = { answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' }

test('stats: a routed first prompt and its turn are noted, priced against the model the chat began on', { options: { firstChatDetection: 'auto', effortDetection: 'auto' } } as any, async ($: any, on: any) => {
  const seen = engine(on, '{"where": "here", "model": "haiku", "effort": "low", "why": "quick"}', { isFirst: true })
  on('turn.complete', () => ({ text: '', usage: { input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' } }))
  await start($)
  await submit($, 'what does this regex match')
  await $.turn.complete(TURN_DONE)
  const [d, t] = statsLines(seen)
  expect(d).toMatchObject({ kind: 'decision', platform: 'claude-code', where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'haiku', effort: 'low' }, outcome: 'applied' })
  expect(d.classifier).toEqual({ model: 'claude-sonnet-5-5', usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } })
  expect(t).toMatchObject({ kind: 'turn', model: 'claude-haiku-5-5', baseline: 'claude-opus-5-5', usage: { input: 1000, output: 2000, cacheRead: 0, cacheWrite: 0 } })
  expect(t.chat).toBe(d.chat)
  await $.ui.render({ component: 'SessionMode', surface: 'terminal', props: { modes: [] } })
  expect(seen.modes.at(-1)).toEqual(['Haiku · saved $0.04 today'])
})

test('stats: a subagent the user took is an accepted offer, priced against the main chat model', async ($: any, on: any) => {
  const seen = engine(on, PICK.subagent)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a1' }))
  on('turn.complete', () => ({ text: '', usage: { input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'claude-haiku-5-5' } }))
  await start($)
  await submit($, 'run the whole test suite and tell me what fails')
  await $.agent.spawn({ tool_use_id: 'x', prompt: 'run tests', description: 'tests', subagentType: 'general-purpose', provider: { kind: 'builtin' } })
  await $.turn.complete({ ...TURN_DONE, agentId: 'a1' })
  const [d, a, t] = statsLines(seen)
  expect(d).toMatchObject({ kind: 'decision', where: 'subagent', outcome: 'asked', to: { model: 'haiku', effort: 'low' } })
  expect(a).toMatchObject({ kind: 'accept', decision: d.ts, chat: d.chat })
  expect(t).toMatchObject({ kind: 'turn', agentId: 'a1', model: 'claude-haiku-5-5', baseline: 'claude-opus-5-5' })
})

test('stats: a subagent the router did not offer counts at its own price', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  on('agent.spawn', () => ({ model: 'claude-haiku-5-5', agentId: 'a2' }))
  on('turn.complete', () => ({ text: '', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-haiku-5-5' } }))
  await start($)
  await submit($, 'and the mobile search too')
  await $.agent.spawn({ tool_use_id: 'x', prompt: 'p', description: 'd', subagentType: 'general-purpose', provider: { kind: 'builtin' } })
  await $.turn.complete({ ...TURN_DONE, agentId: 'a2' })
  const lines = statsLines(seen)
  expect(lines.some(l => l.kind === 'accept')).toBe(false)
  expect(lines.find(l => l.kind === 'turn')).toMatchObject({ model: 'claude-haiku-5-5', baseline: 'claude-haiku-5-5' })
})

test('stats: a cut-off turn is noted without usage', async ($: any, on: any) => {
  const seen = engine(on, PICK.same)
  on('turn.complete', () => ({ text: '' }))
  await start($)
  await $.turn.complete({ ...TURN_DONE, isAborted: true, reason: 'aborted' })
  const t = statsLines(seen).find(l => l.kind === 'turn')
  expect(t.usage).toBe(undefined)
})

test('/router stats shows the table from the log', async ($: any, on: any) => {
  const now = Date.now()
  const log = [
    { kind: 'turn', ts: now, platform: 'claude-code', chat: 'c', model: 'claude-haiku-5-5', baseline: 'claude-opus-5-5', usage: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 } },
    { kind: 'decision', ts: now, platform: 'claude-code', chat: 'c', where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'haiku', effort: 'low' }, outcome: 'applied' },
  ].map(r => JSON.stringify(r)).join('\n')
  engine(on, PICK.same, { now, files: { '*/prompt-router-stats.jsonl': `${log}\n` } })
  await start($)
  const r = await $.command.run({ command: 'router', args: 'stats' })
  expect(r.text).toMatch(/Today\s+7 days\s+Total/)
  expect(r.text).toMatch(/Net saving\s+\$19\.50 \(98 %\)/)
  expect(r.text).toMatch(/Effort lower \/ higher\s+1 \/ 0/)
})

test('stats off: nothing is noted and /router stats says so', { options: { stats: 'off' } } as any, async ($: any, on: any) => {
  const seen = engine(on, PICK.here)
  on('turn.complete', () => ({ text: '', usage: { input_tokens: 10, output_tokens: 10, model: 'claude-opus-5-5' } }))
  await start($)
  await submit($, 'fix that too')
  await $.turn.complete(TURN_DONE)
  expect(statsLines(seen)).toEqual([])
  const r = await $.command.run({ command: 'router', args: 'stats' })
  expect(r.text).toMatch(/stats are off/)
})
