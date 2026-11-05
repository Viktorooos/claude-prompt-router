import { expect, test } from 'claude-code/testing'
import { ago, barText, contextBarSvg, sparkSvg, sparkText, splitBarSvg, splitBarText, tone } from '../core/panel.ts'

const PANE = {
  plugin: 'prompt-router',
  component: 'Pane',
  requestId: 'prompt-router',
  props: { title: 'Prompt Router', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SESSION_PICK = '{"where": "session", "model": "sonnet", "effort": "medium", "work": "new", "why": "unrelated feature"}'

type Seen = { writes: Map<string, string>; sets: { key: string; value: unknown }[]; store: Map<string, unknown>; opened: unknown[]; sent: string[]; redraws: number; state: Map<string, unknown> }

// The mod's /config rows where the engine lists them (a terminal session); the desktop app lists none.
const MOD_ROWS = ['effortDetection', 'firstChatDetection', 'midChatModelDetection', 'subagentSuggestions', 'sessionSuggestions', 'newSessionAt', 'notifications', 'stats', 'openPane', 'holdoutPct', 'compareWith', 'classifier']
  .map(k => ({ key: `prompt-router.${k}`, label: k, kind: 'choice', value: '', options: [], provider: { plugin: 'prompt-router', tier: 'user' }, isLocked: false }))

// The engine beneath the plugin, as far as the pane needs it.
function engine(on: any, opts: { reply?: string; now?: number; usage?: { tokens: number; window?: number }; log?: string; rows?: any[]; settings?: string } = {}): Seen {
  const seen: Seen = { writes: new Map(), sets: [], store: new Map(), opened: [], sent: [], redraws: 0, state: new Map() }
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__prompt-router__${e.name}` } }))
  on('model.complete', () => ({ value: { isAnswered: true, text: opts.reply ?? SESSION_PICK, usage: { input_tokens: 1, output_tokens: 1 } } }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: 'Fix the duplicate recipes in search', toolUses: [] },
      { role: 'assistant', text: 'Fixed.', toolUses: [] },
    ],
  }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: opts.usage ?? { tokens: 94_000, window: 200_000 }, rateLimits: [] } }))
  on('config.list', () => ({ value: [{ key: 'effort', label: 'Effort', kind: 'choice', value: 'medium', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine' }, isLocked: false }, ...(opts.rows ?? MOD_ROWS)] }))
  on('config.set', (_: unknown, e: any) => {
    if (opts.rows && !opts.rows.some(r => r.key === e.key)) throw new Error(`no /config row with key ${e.key}`)
    seen.sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => {
    seen.redraws++
    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_: unknown, e: any) => {
    seen.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('state.get', (_: unknown, e: any) => ({ value: { value: seen.state.get(JSON.stringify(e.key ?? e)) ?? null } }))
  on('state.set', (_: unknown, e: any) => {
    seen.state.set(JSON.stringify(e.key ?? e), e.value)
    return { value: undefined }
  })
  on('store.get', (_: unknown, e: any) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_: unknown, e: any) => {
    const path = String(e.path)
    if (seen.writes.has(path)) return { value: seen.writes.get(path) }
    return { value: path.endsWith('prompt-router-stats.jsonl') ? (opts.log ?? '') : path.endsWith('.claude/settings.json') ? (opts.settings ?? '') : '' }
  })
  on('fs.write', (_: unknown, e: any) => {
    seen.writes.set(String(e.path), String(e.text))
    return { value: undefined }
  })
  on('tool.list', () => ({ value: [{ name: 'mcp__ccd_session__start_session', description: '', mcp: true }] }))
  on('session.surfaces', () => ({ value: ['desktop'] }))
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

const HOUR = 3_600_000
// A day with a saving: one Opus turn the router moved to Haiku.
const TURN = (ts: number) => JSON.stringify({ kind: 'turn', ts, platform: 'claude-code', chat: 'c', model: 'claude-haiku-5-5', baseline: 'claude-opus-5-5', usage: { input: 100_000, output: 2_000, cacheRead: 0, cacheWrite: 0 } })

const textsOf = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')

test('the pane draws on every surface: the context against the new-session share, the model and effort, the settings', async ($: any, on: any) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)
    expect(texts).toMatch(/Opus · Medium\n94k of 200k tokens/)
    // The terminal says the share in words; the app surfaces draw it as a big figure (its alt says it).
    const all = `${texts}\n${JSON.stringify(await ui.findAll({ type: 'Svg' }))}`
    expect(all).toMatch(/47 % used/)
    expect(texts).toMatch(/asks for a new session at 50 % \(100k\)/i)
    // The terminal steps each setting with one button, the desktop and VS Code pick from a Select, mobile has buttons.
    const has = async (k: string, v: string) => (surface === 'terminal' ? ui.find({ type: 'Button', key: `toggle-${k}` })
      : surface === 'mobile' ? ui.find({ type: 'Button', key: `toggle-${k}-${v}` })
      : ui.find({ type: 'Select', key: `pick-${k}` }))
    expect(await has('effortDetection', 'ask')).toBeDefined()
    expect(await has('newSessionAt', '50%')).toBeDefined()
    if (surface === 'desktop' || surface === 'vscode') expect(JSON.stringify(await has('newSessionAt', '50%'))).toMatch(/"value":"50%"/)
    if (surface === 'terminal') {
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /▰/ }))?.text).toMatch(/▰+▱*│▱+ 47%/)
    } else {
      const bar = (await ui.findAll({ type: 'Svg' })).find((x: any) => /Context 47%/.test(JSON.stringify(x)))
      expect(bar).toBeDefined()
      expect(JSON.stringify(bar)).toMatch(/new session at 50%/)
    }
    await ui.unmount()
  }
})

test('every setting says in one line what it does', async ($: any, on: any) => {
  engine(on)
  await start($)
  const texts = await textsOf(await $.ui.mount({ ...PANE, surface: 'desktop' }))
  expect(texts).toMatch(/Router\nRouting every prompt\nPicks the cheapest model/)
  expect(texts).toMatch(/Model for a new chat\nOn your first prompt/)
  expect(texts).toMatch(/Model mid-chat\nWhen a later prompt/)
  expect(texts).toMatch(/Effort\nRaises or lowers/)
  expect(texts).toMatch(/Subagents\nSends a side task/)
  expect(texts).toMatch(/Start a new session at\nOnce the chat fills/)
  expect(texts).toMatch(/Notifications\nShows a short note/)
})

test('You saved comes first: the period\'s saving against compareWith, without and with the router', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: [TURN(now - HOUR), TURN(now - 3 * 86_400_000)].join('\n') })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = await textsOf(ui)
  // Each card is headed by its name and a line under it; the saving as a big figure, how much less, then without and with.
  expect(texts).toMatch(/You saved\ncompared with running every prompt on Opus medium\n\d+ % less\nWithout router\n\$\d+\.\d\d\nWith router\n\$\d+\.\d\d/)
  expect(texts.indexOf('You saved')).toBeLessThan(texts.indexOf('This chat'))
  expect(texts.indexOf('This chat')).toBeLessThan(texts.indexOf('Model & effort'))
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toMatch(/You saved: \$\d+\.\d\d/)
  // As the preview: no header line, the periods inside You saved, a hairline above each section and between settings.
  expect(texts).not.toMatch(/PROMPT ROUTER/)
  expect(JSON.stringify(await ui.find({ key: 'saved' }))).toMatch(/period-week/)
  // Cards part the sections; Settings is three cards, each in a colour of its own with an icon heading.
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' })).split('role=\\"presentation\\"').length - 1).toBe(0)
  const router = await ui.find({ key: 'group-router' })
  expect(JSON.stringify(router)).toMatch(/router-head[\s\S]*toggle-enabled/)
  const model = await ui.find({ key: 'group-model' })
  expect(model.props.borderColor).toBe('#5b9cf6')
  expect(JSON.stringify(model)).toMatch(/group-model-head[\s\S]*"Svg"[\s\S]*set-firstChatDetection[\s\S]*set-midChatModelDetection[\s\S]*set-effortDetection[\s\S]*set-subagentSuggestions/)
  const session = await ui.find({ key: 'group-session' })
  expect(session.props.borderColor).toBe('#36b3a8')
  expect(JSON.stringify(session)).toMatch(/group-session-head[\s\S]*"Svg"[\s\S]*set-newSessionAt[\s\S]*set-notifications/)
  expect(JSON.stringify(model)).not.toMatch(/set-newSessionAt/)
  // Each fold is headed by an icon, its name and what is inside; closed, its button says Show.
  expect(JSON.stringify(await ui.find({ key: 'more' }))).toMatch(/More settings, closed/)
  expect(JSON.stringify(await ui.find({ type: 'Button', key: 'fold-more' }))).toMatch(/Show/)
  // 7 days by default; the picked period is the primary button.
  expect(JSON.stringify(await ui.find({ type: 'Button', key: 'period-week' }))).toMatch(/"variant":"primary"/)
  await ui.press({ key: 'period-today' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await again.find({ type: 'Button', key: 'period-today' }))).toMatch(/"variant":"primary"/)
  await again.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await textsOf(term)).toMatch(/You saved\n\$\d+\.\d\d\ncompared with/)
  await term.unmount()
})

test('each draw animates once only what changed: a period or baseline the saving, the session share the bar', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: TURN(now - HOUR) })
  await start($)
  const draw = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    // Any animation inside the card, and the tiles' pop on any card.
    const moves = async (key: string) => /animation:/.test(JSON.stringify(await ui.find({ key })))
    const svgs = JSON.stringify(await ui.findAll({ type: 'Svg' }))
    return { ui, saved: await moves('saved'), bar: await moves('chat'), heads: /animation:p/.test(svgs) }
  }
  let d = await draw()
  expect([d.saved, d.bar, d.heads]).toEqual([false, false, false])
  await d.ui.press({ key: 'period-today' })
  await d.ui.unmount()
  d = await draw()
  expect([d.saved, d.bar, d.heads]).toEqual([true, false, false])
  await d.ui.unmount()
  d = await draw()
  expect([d.saved, d.bar, d.heads]).toEqual([false, false, false])
  // The period already shown changes nothing, so nothing moves.
  await d.ui.press({ key: 'period-today' })
  await d.ui.unmount()
  d = await draw()
  expect(d.saved).toBe(false)
  await d.ui.select({ key: 'pick-newSessionAt', value: 'off' })
  await d.ui.unmount()
  d = await draw()
  expect([d.saved, d.bar, d.heads]).toEqual([false, true, false])
  await d.ui.unmount()
})

test('a reply animates the pane once, then a still redraw replaces it, so a host that redraws the image never replays it', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  const seen = engine(on, { now, log: TURN(now - HOUR) })
  const waits: { ms: number; release: () => void }[] = []
  on('clock.after', (_: unknown, e: any) => new Promise<any>(r => waits.push({ ms: e.ms, release: () => r({ value: undefined }) })))
  on('turn.complete', () => ({ text: '' }))
  await start($)
  const moving = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const m = /animation:/.test(JSON.stringify(await ui.findAll({ type: 'Svg' })))
    await ui.unmount()
    return m
  }
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await moving()).toBe(true)
  // Once the animation has played, the pane draws itself again, still.
  expect(waits.length).toBe(1)
  expect(waits[0].ms).toBeGreaterThanOrEqual(2000)
  const before = seen.redraws
  waits[0].release()
  await new Promise(r => setTimeout(r, 0))
  expect(seen.redraws).toBe(before + 1)
  expect(await moving()).toBe(false)
  // A still draw asks for no further redraw, so nothing loops.
  expect(waits.length).toBe(1)
  // A subagent's turn does not animate the pane.
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer', agentId: 'a1' })
  expect(await moving()).toBe(false)
})

test('a setting\'s line sits beside its control, not under it', async ($: any, on: any) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const row = await ui.find({ key: 'set-firstChatDetection' })
  expect(row.props.flexDirection).toBe('row')
  expect(row.props.alignItems).toBe('center')
  // Each setting is a tile of its own, tinted and outlined in its card's colour.
  expect(row.props.borderStyle).toBe('round')
  expect(row.props.borderColor).toBe('#5b9cf638')
  expect(row.props.backgroundColor).toBe('#5b9cf60f')
  expect((await ui.find({ key: 'set-notifications' })).props.backgroundColor).toBe('#36b3a80f')
  const [left, right] = row.children
  expect(JSON.stringify(left)).toMatch(/On your first prompt, suggests a better model/)
  expect(JSON.stringify(right)).toMatch(/pick-firstChatDetection/)
  await ui.unmount()
})

// Five control tasks ($1…$5, 1…5 min: median $3, 3 min) and one routed task ($1, 1 min), all today.
function controlLog(now: number) {
  const dec = (chat: string, ts: number, over: object) => JSON.stringify({ kind: 'decision', ts, platform: 'claude-code', chat, where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'haiku', effort: 'low' }, outcome: 'applied', follows: 'new', ...over })
  const turn = (chat: string, ts: number, model: string, usd: number, min: number) => JSON.stringify({ kind: 'turn', ts, platform: 'claude-code', chat, model, baseline: 'opus', usage: { input: 10, output: 10 }, usd, durationMs: min * 60_000 })
  const lines: string[] = []
  for (let i = 0; i < 5; i++) lines.push(dec(`k${i}`, now - 3 * HOUR, { where: 'keep', to: { model: 'opus', effort: 'medium' }, holdout: true, wanted: { model: 'haiku', effort: 'low' } }), turn(`k${i}`, now - 3 * HOUR + 1, 'opus', i + 1, i + 1))
  lines.push(dec('r', now - HOUR, {}), turn('r', now - HOUR + 1, 'haiku', 1, 1))
  return lines.join('\n')
}

test('Details, folded: the strict balance, how often it was right, where the tasks went', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: controlLog(now) })
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const shut = await $.ui.mount({ ...PANE, surface })
    expect(await textsOf(shut)).not.toMatch(/Router balance/)
    await shut.press({ key: 'fold-details' })
    await shut.unmount()
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)
    if (surface === 'terminal') {
      // The terminal puts the figure beside the name.
      expect(texts).toMatch(/Router balance \(rough\)\n\+\$2\.00/)
      expect(texts).toMatch(/Decisions right\n100 % \(95 %: 21–100 %\)/)
      expect(texts).toMatch(/Tasks\nhaiku 1/)
    } else {
      // The app surfaces: one tinted tile, the balance as a big figure in the colour of its sign beside a
      // ring of how often it was right; then one bar parted by model over a legend of tasks, cost and share.
      const hero = await ui.find({ key: 'details-hero' })
      expect(hero.props.backgroundColor).toBe('#8b7cf60f')
      expect(hero.props.borderColor).toBe('#8b7cf638')
      expect(texts).toMatch(/Router balance \(rough\)\nvs\. your own picks, classifier included\nDecisions right · 95 %: 21–100 %\nWhere tasks went\n1 task\nhaiku\n1 task · \$1\.00\/task\n100 %/)
      const balance = JSON.stringify(await ui.find({ key: 'balance' }))
      expect(balance).toMatch(/Router balance \(rough\) \+\$2\.00/)
      expect(balance).toMatch(/fill=\\"#1fa37a\\"[^<]*>\+\$2\.00</)
      const ring = JSON.stringify(await ui.find({ key: 'accuracy' }))
      expect(ring).toMatch(/Decisions right: 100 %/)
      expect(ring).toMatch(/>100%<[\s\S]*>right</)
      expect(ring).toMatch(/95 %: 21–100 %/)
      expect(JSON.stringify(await ui.find({ key: 'tasks' }))).toMatch(/Where tasks went[\s\S]*Tasks: haiku 100 %[\s\S]*tasks-haiku/)
      expect(JSON.stringify(await ui.find({ key: 'tasks-haiku' }))).toMatch(/haiku: 1 of 1 tasks[\s\S]*#6d5ce8|#6d5ce8[\s\S]*haiku: 1 of 1 tasks/)
    }
    await ui.press({ key: 'fold-details' })
    await ui.unmount()
  }
})

test('a press on a value saves the option the way /config does, and the pane shows it chosen', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'pick-effortDetection', value: 'auto' })
  await ui.select({ key: 'pick-newSessionAt', value: '60%' })
  await ui.select({ key: 'pick-subagentSuggestions', value: 'off' })
  expect(seen.sets).toEqual([
    { key: 'prompt-router.effortDetection', value: 'auto' },
    { key: 'prompt-router.newSessionAt', value: '60%' },
    { key: 'prompt-router.subagentSuggestions', value: 'off' },
  ])
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await again.find({ type: 'Select', key: 'pick-effortDetection' }))).toMatch(/"value":"auto"/)
    expect(await textsOf(again)).toMatch(/asks for a new session at 60 %/i)
  await again.unmount()
  expect(String((await $.command.run({ command: 'router', args: '' })).text)).toMatch(/effortDetection: auto \(set\)/)
})

test('the terminal steps a setting to its next value, numbers from low to high', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'toggle-newSessionAt' }))?.text).toMatch(/Start a new session at: 50%/)
  await ui.press({ key: 'toggle-newSessionAt' })
  await ui.press({ key: 'toggle-newSessionAt' })
  expect(seen.sets).toEqual([{ key: 'prompt-router.newSessionAt', value: '60%' }, { key: 'prompt-router.newSessionAt', value: '70%' }])
  await ui.unmount()
})

test('new session at off turns the suggestion off; a share turns it back on', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'pick-newSessionAt', value: 'off' })
  await ui.unmount()
  const off = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(off)).toMatch(/never asks for a new session/i)
  await off.unmount()
  seen.sets.length = 0
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui2.select({ key: 'pick-newSessionAt', value: '40%' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.newSessionAt', value: '40%' })
  await ui2.unmount()
})

test('More settings, folded: the classifier, what the saving is compared with, the pane on start', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const shut = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shut.find({ type: 'Select', key: 'pick-classifier' })).toBeUndefined()
  await shut.press({ key: 'fold-more' })
  await shut.unmount()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await ui.find({ type: 'Select', key: 'pick-classifier' }))).not.toMatch(/opus/)
  await ui.select({ key: 'pick-classifier', value: 'haiku' })
  await ui.select({ key: 'pick-compareModel', value: 'haiku' })
  await ui.press({ key: 'toggle-openPane-on' })
  expect(seen.sets).toEqual([
    { key: 'prompt-router.classifier', value: 'haiku' },
    { key: 'prompt-router.compareWith', value: 'haiku-medium' },
    { key: 'prompt-router.openPane', value: 'on' },
  ])
  await ui.select({ key: 'pick-compareEffort', value: 'high' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'haiku-high' })
  await ui.select({ key: 'pick-compareModel', value: 'first' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'first' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await again.find({ type: 'Select', key: 'pick-compareEffort' })).toBeUndefined()
  await again.select({ key: 'pick-compareModel', value: 'opus' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'opus-medium' })
  await again.unmount()
  // History mixes the models and efforts used before the router: it has no effort to pick.
  const hist = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await hist.select({ key: 'pick-compareModel', value: 'history' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'history' })
  await hist.unmount()
  const histAgain = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await histAgain.find({ type: 'Select', key: 'pick-compareEffort' })).toBeUndefined()
  await histAgain.unmount()
})

test('the router switch turns the router off and on as /router off and /router on do', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'toggle-enabled' })
  expect(seen.store.get('enabled')).toBe(false)
  expect(String((await $.command.run({ command: 'router', args: '' })).text)).toMatch(/Prompt Router is off/)
  await ui.press({ key: 'toggle-enabled' })
  expect(seen.store.get('enabled')).toBe(true)
  await ui.unmount()
  const desk = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await desk.press({ key: 'toggle-enabled-off' })
  expect(seen.store.get('enabled')).toBe(false)
  await desk.unmount()
})

test('/router panel opens the pane', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const r = await $.command.run({ command: 'router', args: 'panel' })
  expect(seen.opened).toEqual([expect.objectContaining({ id: 'prompt-router', title: 'Prompt Router' })])
  expect(String(r.text)).toMatch(/pane/i)
})

test('drawings: tone, bars, sparklines and times', () => {
  expect([tone(20, 50), tone(42, 50), tone(55, 50), tone(30, 0), tone(80, 0)]).toEqual(['calm', 'near', 'over', 'calm', 'over'])
  expect(barText(47, 50, 10)).toBe('▰▰▰▰▰│▱▱▱▱▱')
  expect(barText(null, 50, 4)).toBe('▱▱│▱▱')
  expect(barText(100, 0, 4)).toBe('▰▰▰▰')
  expect(sparkText([0, 1, 2, 4])).toBe('▁▃▅█')
  expect(sparkText([0, 0])).toBe('▁▁')
  expect([ago(3_000), ago(45_000), ago(5 * 60_000), ago(3 * HOUR), ago(50 * HOUR)]).toEqual(['just now', '45 s ago', '5 min ago', '3 h ago', '2 d ago'])
  expect(splitBarText(0.5, 8)).toBe('····│██··')
  expect(splitBarText(-1, 8)).toBe('████│····')
  expect(splitBarText(0, 4)).toBe('··│··')
  const ring = contextBarSvg(47, 50)
  expect(ring).toMatch(/^<svg [^>]*xmlns="http:\/\/www.w3.org\/2000\/svg"/)
  expect(ring).toMatch(/prefers-color-scheme: ?dark/)
  expect(ring).not.toMatch(/<script|on\w+=/)
  expect(ring).toMatch(/<title>Context 47%, new session at 50%<\/title>/)
  // Still by default: only the redraw after a turn ends animates, so nothing loops.
  expect(ring).not.toMatch(/@keyframes/)
  expect(contextBarSvg(47, 50, 280, 10, true)).toMatch(/@keyframes[^]*prefers-reduced-motion/)
  expect(ring).toMatch(/width="100%"/)
  const left = splitBarSvg(-0.5, '#e0483f', 100, 8)
  expect(left).toMatch(/<rect x="25" width="25" [^>]*fill="#e0483f"/)
  expect(left).not.toMatch(/@keyframes|<script|on\w+=/)
  const spark = sparkSvg([0, 0.1, -0.05, 0.3], ['a', 'b', 'c', 'd'])
  expect(spark).toMatch(/pathLength="1"/)
  expect(spark).toMatch(/<title>d<\/title>/)
  for (const s of [ring, left, spark]) expect(s.length).toBeLessThan(20_000)
})


test('an installed mod saves through its marketplace-named /config rows', async ($: any, on: any) => {
  const ID = 'prompt-router@prompt-router'
  const row = (k: string, value: string) => ({ key: `${ID}.${k}`, label: k, kind: 'choice', value, options: [], provider: { plugin: ID, tier: 'user' }, isLocked: false })
  const seen = engine(on, { rows: [row('firstChatDetection', 'auto'), row('notifications', 'on')] })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'pick-firstChatDetection', value: 'ask' })
  await ui.press({ key: 'toggle-notifications-off' })
  expect(seen.sets).toEqual([
    { key: `${ID}.firstChatDetection`, value: 'ask' },
    { key: `${ID}.notifications`, value: 'off' },
  ])
  await ui.unmount()
})

test('with no /config row for the mod, a press saves the option in settings.json, under the id it is read from', async ($: any, on: any) => {
  const ID = 'prompt-router@prompt-router'
  const settings = JSON.stringify({ model: 'opus', pluginConfigs: { other: { options: { a: 1 } }, [ID]: { options: { language: 'Czech', modelMode: 'auto' } } } }, null, 2) + '\n'
  const seen = engine(on, { rows: [], settings })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.select({ key: 'pick-firstChatDetection', value: 'ask' })
  await ui.select({ key: 'pick-newSessionAt', value: '60%' })
  const file = [...seen.writes].find(([p]) => p.endsWith('.claude/settings.json'))?.[1] ?? ''
  const saved = JSON.parse(file)
  expect(saved.model).toBe('opus')
  expect(saved.pluginConfigs.other).toEqual({ options: { a: 1 } })
  expect(saved.pluginConfigs[ID].options).toEqual({ language: 'Czech', modelMode: 'auto', firstChatDetection: 'ask', newSessionAt: '60%' })
  expect(file.endsWith('}\n')).toBe(true)
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await again.find({ type: 'Select', key: 'pick-firstChatDetection' }))).toMatch(/"value":"ask"/)
  await again.unmount()
})

test('a fold stays open while a value under it changes', async ($: any, on: any) => {
  const now = 30 * 86_400_000
  const seen = engine(on, { now, log: controlLog(now) })
  await start($)
  const draw = async (act?: (ui: any) => Promise<void>) => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const shown = { more: /Hide/.test(JSON.stringify(await ui.find({ type: 'Button', key: 'fold-more' }))), details: /Hide/.test(JSON.stringify(await ui.find({ type: 'Button', key: 'fold-details' }))) }
    if (act) await act(ui)
    await ui.unmount()
    return shown
  }
  await draw(async ui => {
    for (const id of ['more', 'details']) {
      if (/Show/.test(JSON.stringify(await ui.find({ type: 'Button', key: `fold-${id}` })))) await ui.press({ key: `fold-${id}` })
    }
  })
  // Saving an option reloads the mod, which keeps $.state but not module variables: the folds live there.
  expect(JSON.stringify([...seen.state.values()])).toMatch(/"more"[\s\S]*"details"|"details"[\s\S]*"more"/)
  await draw(ui => ui.select({ key: 'pick-classifier', value: 'haiku' }))
  expect(await draw()).toEqual({ more: true, details: true })
  await draw(ui => ui.select({ key: 'pick-compareModel', value: 'opus' }))
  expect(await draw()).toEqual({ more: true, details: true })
  await draw(ui => ui.select({ key: 'pick-newSessionAt', value: '60%' }))
  expect(await draw()).toEqual({ more: true, details: true })
})
