import { expect, test } from 'claude-code/testing'
import { ago, barText, cacheBarSvg, cacheTime, cacheView, contextBarSvg, dayLabel, dayLineSvg, dayReadSvg, sparkText, splitBarSvg, splitBarText, tone } from '../core/panel.ts'

const PANE = {
  plugin: 'prompt-router',
  component: 'Pane',
  requestId: 'prompt-router',
  props: { title: 'Prompt Router', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SESSION_PICK = '{"where": "session", "model": "sonnet", "effort": "medium", "work": "new", "why": "unrelated feature"}'

type Seen = { writes: Map<string, string>; sets: { key: string; value: unknown }[]; store: Map<string, unknown>; opened: unknown[]; sent: string[]; redraws: number; state: Map<string, unknown>; statsReads: number; blits: any[]; blitDeny: string }

// The mod's /config rows where the engine lists them (a terminal session); the desktop app lists none.
const MOD_ROWS = ['effortDetection', 'firstChatDetection', 'midChatModelDetection', 'subagentSuggestions', 'sessionSuggestions', 'newSessionAt', 'notifications', 'stats', 'openPane', 'compareWith', 'classifier']
  .map(k => ({ key: `prompt-router.${k}`, label: k, kind: 'choice', value: '', options: [], provider: { plugin: 'prompt-router', tier: 'user' }, isLocked: false }))

// The engine beneath the plugin, as far as the pane needs it.
function engine(on: any, opts: { reply?: string; now?: number; usage?: { tokens: number; window?: number }; log?: string; rows?: any[]; settings?: string; cost?: number } = {}): Seen {
  const seen: Seen = { writes: new Map(), sets: [], store: new Map(), opened: [], sent: [], redraws: 0, state: new Map(), statsReads: 0, blits: [], blitDeny: '' }
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
  on('session.usage', () => ({ value: { startedAt: 0, context: opts.usage ?? { tokens: 94_000, window: 200_000 }, rateLimits: [], ...(opts.cost != null ? { cost: { usd: opts.cost } } : {}) } }))
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
  on('ui.blit', (_: unknown, e: any) => {
    seen.blits.push(e)
    return { value: seen.blitDeny ? { deny: seen.blitDeny } : {} }
  })
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
    if (path.endsWith('prompt-router-stats.jsonl')) seen.statsReads++
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
// A Raster's cells back as its lines of text, trailing blanks cut.
const rasterText = (cells: string, columns: number) => {
  const bytes = Uint8Array.from(atob(cells), c => c.charCodeAt(0))
  const words = new Uint32Array(bytes.buffer)
  const lines: string[] = []
  for (let at = 0; at < words.length; at += columns * 3) {
    let line = ''
    for (let c = 0; c < columns; c++) line += String.fromCodePoint(words[at + c * 3]!)
    lines.push(line.trimEnd())
  }
  return lines.join('\n')
}

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
  // The cards that used to fold are always open: an icon heading, the content, no Show/Hide button.
  expect(JSON.stringify(await ui.find({ key: 'more' }))).not.toMatch(/closed/)
  expect(await ui.find({ type: 'Button', key: 'fold-more' })).toBeUndefined()
  expect(await ui.find({ type: 'Select', key: 'pick-classifier' })).toBeDefined()
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

test('a press in the pane draws still: the pointer is on the pane, and every hover would replay an animated drawing', async ($: any, on: any) => {
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
  expect([d.saved, d.bar, d.heads]).toEqual([false, false, false])
  // The period already shown changes nothing, so nothing moves.
  await d.ui.press({ key: 'period-today' })
  await d.ui.unmount()
  d = await draw()
  expect(d.saved).toBe(false)
  await d.ui.select({ key: 'pick-newSessionAt', value: 'off' })
  await d.ui.unmount()
  d = await draw()
  expect([d.saved, d.bar, d.heads]).toEqual([false, false, false])
  await d.ui.unmount()
})

test('nothing in the pane animates: not after a reply, not after a press, and no extra redraw', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  const opts = { now, log: [TURN(now - 30 * HOUR), TURN(now - HOUR)].join('\n') }
  const seen = engine(on, opts)
  const waits: unknown[] = []
  on('clock.after', (_: unknown, e: any) => { waits.push(e); return new Promise<any>(() => {}) })
  on('turn.complete', () => ({ text: '' }))
  await start($)
  const moving = async () => {
    const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
    const r = /animation:/.test(JSON.stringify(await ui.findAll({ type: 'Svg' })))
    await ui.unmount()
    return r
  }
  expect(await moving()).toBe(false)
  opts.log = [TURN(now - 30 * HOUR), TURN(now - 2 * HOUR), TURN(now - HOUR)].join('\n')
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  seen.writes.clear()
  expect(await moving()).toBe(false)
  expect(waits.length).toBe(0)
})

test('a card\'s line under its heading wraps, never cut short with dots', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: TURN(now - HOUR) })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = await ui.findAll({ type: 'Text' })
  const sub = texts.find((t: any) => /compared with/.test(t.text))
  expect(sub).toBeTruthy()
  expect(texts.filter((t: any) => /truncate/.test(String(t.props?.wrap ?? ''))).map((t: any) => t.text)).toEqual([])
  await ui.unmount()
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

// Five kept tasks and one routed task (150k output tokens: $0.08 on Haiku, $3.00 on Opus at list price), all today.
function taskLog(now: number) {
  const dec = (chat: string, ts: number, over: object) => JSON.stringify({ kind: 'decision', ts, platform: 'claude-code', chat, where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'haiku', effort: 'low' }, outcome: 'applied', follows: 'new', ...over })
  const turn = (chat: string, ts: number, model: string, usd: number, min: number, output = 10) => JSON.stringify({ kind: 'turn', ts, platform: 'claude-code', chat, model, baseline: 'opus', usage: { input: 10, output }, usd, durationMs: min * 60_000 })
  const lines: string[] = []
  for (let i = 0; i < 5; i++) lines.push(dec(`k${i}`, now - 3 * HOUR, { where: 'keep', to: { model: 'opus', effort: 'medium' } }), turn(`k${i}`, now - 3 * HOUR + 1, 'opus', i + 1, i + 1))
  lines.push(dec('r', now - HOUR, {}), turn('r', now - HOUR + 1, 'haiku', 1, 1, 150_000))
  return lines.join('\n')
}

test('Details, always open: the strict balance, how often it was right, where the tasks went', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: taskLog(now) })
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'fold-details' })).toBeUndefined()
    const texts = await textsOf(ui)
    if (surface === 'terminal') {
      // The terminal puts the figure beside the name.
      expect(texts).toMatch(/Router balance \(rough\)\n\+\$2\.93/)
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
      expect(balance).toMatch(/Router balance \(rough\) \+\$2\.93/)
      expect(balance).toMatch(/fill=\\"#1fa37a\\"[^<]*>\+\$2\.93</)
      const ring = JSON.stringify(await ui.find({ key: 'accuracy' }))
      expect(ring).toMatch(/Decisions right: 100 %/)
      expect(ring).toMatch(/>100%<[\s\S]*>right</)
      expect(ring).toMatch(/95 %: 21–100 %/)
      expect(JSON.stringify(await ui.find({ key: 'tasks' }))).toMatch(/Where tasks went[\s\S]*Tasks: haiku 100 %[\s\S]*tasks-haiku/)
      expect(JSON.stringify(await ui.find({ key: 'tasks-haiku' }))).toMatch(/haiku: 1 of 1 tasks[\s\S]*#6d5ce8|#6d5ce8[\s\S]*haiku: 1 of 1 tasks/)
    }
    await ui.unmount()
  }
})

test('the pane runs overview, Cache, This chat, then What you got, on both surfaces: cheaper picks and the plan limit', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: taskLog(now) })
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)
    expect(texts).toMatch(surface === 'terminal' ? /What you got/ : /What you got\nFrom the log, same period as above/)
    expect(texts).toMatch(/Cheaper picks saved\n\$\d+\.\d\d\nat list price/)
    expect(texts).toMatch(/Cost, all in\n\d+ % (less|more)\n[+−]\$\d+\.\d\d than without the router/)
    // The overview first, then the Cache card with its countdown, This chat, and What you got.
    const cache = surface === 'terminal' ? texts.search(/\nCache\n/) : texts.indexOf('No cache yet')
    expect(cache).toBeGreaterThan(texts.indexOf('You saved'))
    expect(cache).toBeLessThan(texts.indexOf('This chat'))
    expect(texts.indexOf('This chat')).toBeLessThan(texts.indexOf('What you got'))
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

test('every setting says which value is recommended, on both surfaces', async ($: any, on: any) => {
  engine(on)
  await start($)
  const want = [/suggests a better model[^\n]*Recommended: ask\./, /offers to switch[^\n]*Recommended: ask\./, /thinking effort[^\n]*Recommended: ask\./, /cheaper subagent[^\n]*Recommended: ask\./, /fresh session[^\n]*Recommended: 50%\./, /short note[^\n]*Recommended: on\./, /decides[^\n]*Recommended: haiku\./, /measured against[^\n]*Recommended: history\./, /by itself[^\n]*Recommended: off\./, /cheapest model[^]*?Recommended: on\./]
  for (const surface of ['desktop', 'terminal']) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)
    for (const w of want) expect(texts).toMatch(w)
    await ui.unmount()
  }
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

test('More settings, always open: the classifier, what the saving is compared with, the pane on start', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
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
  const vals = [0, 0.1, -0.05, 0.3]
  const slices = vals.map((_, i) => dayLineSvg(vals, i, `D${i}`))
  // Each day is its column's slice of one line: the whole path, cropped by the viewBox to the column,
  // stretched to the width (its stroke is not).
  expect(slices[1]).toMatch(/^<svg [^>]*width="100%" height="104"/)
  expect(slices[1]).toMatch(/viewBox="250 0 250 104" preserveAspectRatio="none"/)
  expect(slices[1]).toMatch(/vector-effect="non-scaling-stroke"/)
  expect(new Set(slices.map(x => x.match(/<path d="([^"]+)" fill="none"/)?.[1])).size).toBe(1)
  // A day in the minus turns its stretch of the line red, however small; the others keep the color.
  const stops = [...slices[1]!.match(/<linearGradient id="s"[^]*?<\/linearGradient>/)![0].matchAll(/offset="([\d.]+)" stop-color="([^"]+)"/g)].map(m => [Number(m[1]), m[2]])
  expect(stops).toEqual([[0.05, '#d97757'], [0.2, '#d97757'], [0.3, '#d97757'], [0.45, '#d97757'], [0.55, '#e0483f'], [0.7, '#e0483f'], [0.8, '#d97757'], [0.95, '#d97757']])
  expect(dayLineSvg([1, -0.01, 1], 0)).toMatch(/offset="0.4" stop-color="#e0483f"/)
  expect(slices[1]).toMatch(/stroke="url\(#s\)"/)
  // One zero line at one height across the columns, labelled or not.
  const zeroY = (svg: string) => svg.match(/<line x1="0" y1="([\d.]+)" x2="100%"/)?.[1]
  expect(new Set([...slices, dayLineSvg(vals, 1)].map(zeroY)).size).toBe(1)
  // A small point on each day, red below zero; the last day's on a halo.
  const cy = (svg: string, r: string) => svg.match(new RegExp(`cy="([\\d.]+)" r="${r}"`))?.[1]
  expect(slices[1]).toMatch(/<circle cx="50%" cy="[\d.]+" r="2" fill="#d97757"/)
  expect(slices[2]).toMatch(/<circle cx="50%" cy="[\d.]+" r="2" fill="#e0483f"/)
  expect(Number(cy(slices[2]!, '2'))).toBeGreaterThan(Number(zeroY(slices[2]!)))
  expect(slices[3]).toMatch(/r="7"[^>]*opacity=".18"\/><circle class="d" cx="50%"[^>]*r="3.6"/)
  // Its label under it, escaped.
  expect(slices[1]).toMatch(/<text x="50%"[^>]*class="m">D1<\/text>/)
  expect(dayLineSvg(vals, 1, 'a<b')).toContain('>a&lt;b<')
  expect(dayLineSvg(vals, 1)).not.toMatch(/<text/)
  // A plain image: no hover of its own, no <title>.
  for (const x of slices) expect(x).not.toMatch(/<title>|:hover/)
  // A hovered day's numbers draw smaller than the period's readout, the detail escaped.
  const read = dayReadSvg('Tue 3 Nov: saved $10.35', '$1 with <router>', '#1fa37a')
  expect(read).toMatch(/font-size="12"[^>]*fill="#1fa37a">Tue 3 Nov: saved \$10\.35</)
  expect(read).toContain('font-size="11">$1 with &lt;router&gt;<')
  // A hovered day: only its point on a halo at the line's own height, and the label as a chip.
  const hi = dayLineSvg(vals, 3, 'D3', 104, '#1fa37a', true)
  const rest = dayLineSvg(vals, 3, 'D3', 104, '#1fa37a')
  expect(hi).not.toMatch(/class="b"|url\(#c\)|width="84%"|width="56%"/)
  expect(cy(hi, '4.2')).toBe(cy(rest, '3.6'))
  expect(hi).toMatch(/<rect x="50%" [^>]*rx="7"[^>]*fill="#1fa37a"\/><text [^>]*font-weight="600" fill="#fff">D3</)
  for (const x of [...slices, hi]) expect(x).not.toMatch(/animation|transition|<script|on\w+=/)
  expect(dayLabel('2026-11-05')).toBe('Thu 5 Nov')
  for (const s of [ring, left, ...slices]) expect(s.length).toBeLessThan(20_000)
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

test('no surface has a fold button, and a saved option leaves the content shown', async ($: any, on: any) => {
  const now = 30 * 86_400_000
  engine(on, { now, log: taskLog(now) })
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Button', key: 'fold-more' })).toBeUndefined()
    expect(await ui.find({ type: 'Button', key: 'fold-details' })).toBeUndefined()
    expect(await textsOf(ui)).toMatch(/Router balance/)
    await ui.unmount()
  }
})

test('You saved with too little data says so instead of a figure', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: '' })
  await start($)
  for (const surface of ['desktop', 'terminal']) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)
    expect(texts).toMatch(/Not enough data yet/)
    expect(JSON.stringify(await ui.find({ key: 'saved' }))).not.toMatch(/You saved|Cost extra|\$0\.00/)
    await ui.unmount()
  }
})

test('a negative balance says the router cost more, never You saved', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  const FABLE = JSON.stringify({ kind: 'turn', ts: now - HOUR, platform: 'claude-code', chat: 'c', model: 'claude-fable-5-1', baseline: 'claude-opus-5-5', usage: { input: 100_000, output: 2_000, cacheRead: 0, cacheWrite: 0 } })
  engine(on, { now, log: FABLE })
  await start($)
  for (const surface of ['desktop', 'terminal']) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = await textsOf(ui)
    expect(texts).toMatch(/The router cost more/)
    expect(texts).toMatch(/Stronger models cost more than the cheaper ones saved/)
    // The always-open settings quote "You saved" in a label, so only the saving card is checked.
    expect(JSON.stringify(await ui.find({ key: 'saved' }))).not.toMatch(/You saved/)
    // The figure carries a minus sign, so it never reads as a saving.
    expect(JSON.stringify(await ui.find({ key: 'saved' }))).toMatch(/−\$\d/)
    await ui.unmount()
  }
})

test('new session at offers exactly 10 … 100 %, and session suggestions offer ask, auto, off', async ($: any, on: any) => {
  engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const pct = JSON.stringify(await ui.find({ type: 'Select', key: 'pick-newSessionAt' }))
  for (let n = 10; n <= 100; n += 10) expect(pct).toContain(`"value":"${n}%"`)
  const mode = JSON.stringify(await ui.find({ type: 'Select', key: 'pick-sessionSuggestions' }))
  for (const v of ['ask', 'auto', 'off']) expect(mode).toContain(`"value":"${v}"`)
  await ui.unmount()
})


test('the cache: warm, then soon in its last fifth, then cold; another model starts it over', () => {
  const MIN = 60_000
  const mark = (ttl: '5m' | '1h' | null) => ({ at: 0, ttl, model: 'claude-opus-5-5' })
  expect(cacheView(null, 'opus', 0).state).toBe('none')
  expect([2, 4.5, 5, 30].map(m => cacheView(mark('5m'), 'opus', m * MIN).state)).toEqual(['warm', 'soon', 'cold', 'cold'])
  expect([47, 49, 60].map(m => cacheView(mark('1h'), 'claude-opus-5-5', m * MIN).state)).toEqual(['warm', 'soon', 'cold'])
  // A lifetime not known yet counts as 5 minutes.
  expect(cacheView(mark(null), 'opus', 6 * MIN)).toMatchObject({ state: 'cold', ttl: '5m' })
  // A cache is per model: another model starts it over; an unknown model changes nothing.
  expect(cacheView(mark('1h'), 'claude-sonnet-5-5', MIN)).toMatchObject({ state: 'cold', moved: true, leftMs: 0 })
  expect(cacheView(mark('1h'), '', MIN)).toMatchObject({ state: 'warm', moved: false })
  expect([0, 4.5, 6].map(m => cacheTime(cacheView(mark('5m'), 'opus', m * MIN)))).toEqual(['5 min left', 'under 1 min left', 'expired'])
  expect(cacheTime(cacheView(mark('1h'), 'opus', 20 * MIN))).toBe('40 min left')
  expect(cacheTime(cacheView(mark('1h'), 'sonnet', MIN))).toBe('starts over')
  const half = cacheView(mark('5m'), 'opus', 2.5 * MIN)
  expect(barText(half.share * 100, 20, 10)).toBe('▰▰│▰▰▰▱▱▱▱▱')
  const bar = cacheBarSvg(half)
  expect(bar).toMatch(/width="50%"/)
  expect(bar).toMatch(/#1fa37a/)
  expect(bar).toMatch(/<title>Cache 2 min left<\/title>/)
  expect(bar).not.toMatch(/animation|<script|on\w+=/)
  expect(cacheBarSvg(cacheView(mark('5m'), 'opus', 6 * MIN))).not.toMatch(/fill="url\(#s\)"/)
})

test('the Cache card: none before a reply, then warm with what the next message costs, soon, expired; the transcript says 1 hour', async ($: any, on: any) => {
  const MIN = 60_000
  const now = 20 * 86_400_000 + 12 * HOUR
  const opts: { now: number; ttl: string } = { now, ttl: '' }
  engine(on, opts)
  const runs: string[][] = []
  on('process.run', (_: unknown, e: any) => {
    const argv = (e.argv ?? []) as string[]
    runs.push(argv)
    const out = argv.some(a => String(a).endsWith('cache-ttl.mjs')) ? JSON.stringify(opts.ttl ? { ttl: opts.ttl, ts: opts.now - 2_000 } : {}) : ''
    return { value: { exitCode: 0, stdout: out, stderr: '', isStdoutTruncated: false } }
  })
  on('session.id', () => ({ value: 's1' }))
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 4_000 } }))
  await start($)
  const draw = async (surface: 'desktop' | 'terminal' = 'desktop') => {
    const ui = await $.ui.mount({ ...PANE, surface })
    const r = { texts: await textsOf(ui), svgs: JSON.stringify(await ui.findAll({ type: 'Svg' })), card: await ui.find({ type: 'Box', key: 'cache' }) }
    await ui.unmount()
    return r
  }
  expect((await draw()).texts).toMatch(/No cache yet\nThe first reply caches this chat/)

  // A reply: 94k tokens of context on Opus, no lifetime in the transcript yet (5 minutes, assumed).
  await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  let d = await draw()
  expect(d.texts).toMatch(/Continue here\nThe next message reads this chat's 94k tokens from the cache: \$0\.02 instead of \$0\.47\./)
  expect(d.texts).toMatch(/5-minute cache \(assumed\)/)
  expect(d.texts).toMatch(/Next message, cache warm\n\$0\.02/)
  expect(d.svgs).toMatch(/Cache 5 min left/)
  expect(d.card?.props?.borderColor).toBe('#1fa37a')
  expect(runs.some(a => a.some(x => String(x).endsWith('cache-ttl.mjs')))).toBe(true)

  opts.now = now + 4.5 * MIN
  d = await draw()
  expect(d.texts).toMatch(/Reply soon to keep the cache\nIt lapses at \d+:\d\d\. After that the next message writes the 94k tokens again \(\$0\.47\)\./)
  expect(d.card?.props?.borderColor).toBe('#d98a1c')

  opts.now = now + 6 * MIN
  d = await draw()
  expect(d.texts).toMatch(/Cache expired\nIt lapsed at \d+:\d\d\. The next message writes the 94k tokens again \(\$0\.47\); for a new topic a new session starts smaller\./)
  expect(d.card?.props?.borderColor).toBe('#e0483f')
  const term = await draw('terminal')
  expect(term.texts).toMatch(/Cache expired · expired/)
  expect(term.texts).toMatch(/▱▱│▱{8,}/)

  // The transcript says the chat writes 1-hour entries: 6 minutes later it is still warm, and a
  // lapse costs 2 × input.
  opts.ttl = '1h'
  await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 't2', reason: 'answer' })
  opts.now += 6 * MIN
  d = await draw()
  expect(d.texts).toMatch(/Continue here\nThe next message reads this chat's 94k tokens from the cache: \$0\.02 instead of \$0\.75\./)
  expect(d.texts).toMatch(/1-hour cache\n/)
  expect(d.svgs).toMatch(/Cache 53 min left/)
  // The terminal draws the countdown as a Raster the ticker repaints in place: the name, the time
  // left to the second, the bar.
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const clock = await ui.find({ type: 'Raster', key: 'cache-clock' })
  expect(rasterText(clock.props.cells, clock.props.columns)).toMatch(/^Continue here · 53:58 left\n▰+│▰+▱+$/)
  await ui.unmount()
  expect(d.svgs).toMatch(/53:58/)
})

test('the countdown ticks every second on its own: the desktop redraws on each new second without reading the stats again, never once it lapsed', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  const opts = { now }
  const seen = engine(on, opts)
  const ticks: (() => void)[] = []
  const every: number[] = []
  on('clock.every', (_: unknown, e: any) => { every.push(e.ms ?? e.intervalMs ?? e.every ?? e); return new Promise<any>(res => ticks.push(() => res({ value: undefined }))) })
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 4_000 } }))
  await start($)
  await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  let ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) }
  const tick = async () => {
    await settle()
    expect(ticks.length).toBeGreaterThan(0)
    const before = seen.redraws
    ticks.shift()!()
    await settle()
    return seen.redraws - before
  }
  expect(JSON.stringify(every)).toMatch(/1000/)
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toMatch(/5:00/)
  const steps: number[] = []
  steps.push(await tick())
  opts.now = now + 1_000
  steps.push(await tick())
  steps.push(await tick())
  opts.now = now + 2_500
  steps.push(await tick())
  // The ticker's redraw reuses the savings it read: the stats log is not read again.
  // (The test engine does not redraw on invalidate, so the redraw is a fresh mount.)
  await ui.unmount()
  const reads = seen.statsReads
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toMatch(/4:58/)
  expect(seen.statsReads).toBe(reads)
  await ui.unmount()
  // Any other redraw reads them fresh.
  ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(seen.statsReads).toBe(reads + 1)
  opts.now = now + 5 * 60_000 + 1
  steps.push(await tick())
  opts.now = now + 40 * 60_000
  steps.push(await tick())
  expect(steps).toEqual([0, 1, 0, 1, 1, 0])
  await ui.unmount()
})

test('This chat shows what the last reply cost (the /cost total it added, classifier and subagents in) and the whole session', async ($: any, on: any) => {
  const opts: { now: number; cost: number } = { now: 20 * 86_400_000 + 12 * HOUR, cost: 1.2 }
  engine(on, opts)
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 4_000 } }))
  await start($)
  const draw = async (surface: 'desktop' | 'terminal') => {
    const ui = await $.ui.mount({ ...PANE, surface })
    const t = await textsOf(ui)
    await ui.unmount()
    return t
  }
  // Before any reply in this session: the total only.
  expect(await draw('desktop')).toMatch(/Last reply\n–\nThis session\n\$1\.20/)
  await $.prompt.submit({ text: 'fix the search', wait: false, origin: { kind: 'composer' } })
  opts.cost = 1.62
  await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(await draw('desktop')).toMatch(/Last reply\n\$0\.42\nThis session\n\$1\.62/)
  expect(await draw('terminal')).toMatch(/Last reply \$0\.42\nThis session \$1\.62/)
})

test('the day chart hovers without a sandboxed frame: with one, a click on a setting pulled the desktop pane\'s scroll to its bottom', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: [TURN(now - HOUR), TURN(now - 3 * 86_400_000)].join('\n') })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // No Svg anywhere in the pane is drawn as a frame.
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).not.toMatch(/isInteractive/)
  const chart = JSON.stringify(await ui.find({ key: 'saved-trend' }))
  // One column per day, in the flow (an absolute Box takes no pointer of its own), lights its own hover
  // group: the day's highlight over its slice and the day's numbers in the readout.
  expect(chart.match(/"key":"spark-col-\d+"/g)).toHaveLength(7)
  expect(chart).toMatch(/"key":"spark-col-6","width":0,"flexGrow":1\},"hover":\{"scope":"spark-day-6","backgroundColor":"#00000000"\},"children":\[\{"type":"Svg"[^]*?"position":"absolute"[^}]*"display":"none"\},"hover":\{"scope":"spark-day-6","display":"flex"\}/)
  expect(chart).not.toMatch(/"key":"spark-cols","position"|"key":"spark-col-\d+","position"/)
  expect(chart).toMatch(/"key":"spark-read-6","position":"absolute"[^}]*"display":"none"\},"hover":\{"scope":"spark-day-6","display":"flex"\},"children":\[\{"type":"Svg"[^]*?: saved \$\d+\.\d\d/)
  // A scope alone never lit the group in the desktop app: the column's hover carries a style too.
  expect(chart).not.toMatch(/"hover":\{"scope":"spark-day-\d+"\}/)
  // The period's readout stays (a hover cannot hide it); the day's numbers show in two rows kept below it.
  expect(chart).toMatch(/"children":\["7 days: saved[^]*"key":"spark-read","height":2/)
  expect(chart).not.toMatch(/spark-any|transparent/)
  await ui.unmount()
})

test('in the terminal the ticker repaints only the countdown Raster, no pane redraw; refused, it redraws instead', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  const opts = { now }
  const seen = engine(on, opts)
  const ticks: (() => void)[] = []
  on('clock.every', () => new Promise<any>(res => ticks.push(() => res({ value: undefined }))))
  on('turn.complete', () => ({ text: '', usage: { model: 'claude-opus-5-5', input_tokens: 10, output_tokens: 10, cache_read_input_tokens: 90_000, cache_creation_input_tokens: 4_000 } }))
  await start($)
  await $.turn.complete({ answer: '', durationMs: 5_000, isAborted: false, turnId: 't1', reason: 'answer' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(r => setTimeout(r, 0)) }
  const tick = async () => {
    await settle()
    const before = seen.redraws
    ticks.shift()!()
    await settle()
    return seen.redraws - before
  }
  opts.now = now + 7_000
  expect(await tick()).toBe(0)
  expect(seen.blits).toHaveLength(1)
  const b = seen.blits[0]
  expect(b).toMatchObject({ requestId: PANE.requestId, key: 'cache-clock' })
  expect(rasterText(b.cells, b.columns)).toMatch(/^Continue here · 4:53 left\n/)
  // A surface that refuses the blit gets a redraw for the new second.
  seen.blitDeny = 'not mounted'
  opts.now = now + 8_000
  expect(await tick()).toBe(1)
  await ui.unmount()
})

