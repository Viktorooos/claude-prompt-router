import { expect, test } from 'claude-code/testing'
import { ago, barText, contextBarSvg, sparkSvg, sparkText, splitBarSvg, splitBarText, tone } from '../core/panel.ts'

const PANE = {
  plugin: 'prompt-router',
  component: 'Pane',
  requestId: 'prompt-router',
  props: { title: 'Prompt Router', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SESSION_PICK = '{"where": "session", "model": "sonnet", "effort": "medium", "work": "new", "why": "unrelated feature"}'

type Seen = { sets: { key: string; value: unknown }[]; store: Map<string, unknown>; opened: unknown[]; sent: string[] }

// The engine beneath the plugin, as far as the pane needs it.
function engine(on: any, opts: { reply?: string; now?: number; usage?: { tokens: number; window?: number }; log?: string; rows?: any[] } = {}): Seen {
  const seen: Seen = { sets: [], store: new Map(), opened: [], sent: [] }
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
  on('config.list', () => ({ value: [{ key: 'effort', label: 'Effort', kind: 'choice', value: 'medium', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine' }, isLocked: false }, ...(opts.rows ?? [])] }))
  on('config.set', (_: unknown, e: any) => {
    if (opts.rows && !opts.rows.some(r => r.key === e.key)) throw new Error(`no /config row with key ${e.key}`)
    seen.sets.push({ key: e.key, value: e.value })
    return { value: e.value }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.invalidate', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_: unknown, e: any) => {
    seen.opened.push(e)
    return { value: { isPlaced: true } }
  })
  on('store.get', (_: unknown, e: any) => ({ value: seen.store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    seen.store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.read', (_: unknown, e: any) => ({ value: String(e.path).endsWith('prompt-router-stats.jsonl') ? (opts.log ?? '') : '' }))
  on('fs.write', () => ({ value: undefined }))
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
    expect(texts).toMatch(/47 % used(?: · |\n)asks for a new session at 50 % \(100k\)/)
    const key = (k: string, v: string) => (surface === 'terminal' ? `toggle-${k}` : `toggle-${k}-${v}`)
    expect(await ui.find({ type: 'Button', key: key('effortDetection', 'ask') })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: key('newSessionAt', '50%') })).toBeDefined()
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
  expect(texts).toMatch(/Router\nPicks the cheapest model/)
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
  expect(texts).toMatch(/YOU SAVED\ncompared with running every prompt on Opus medium\nWithout router\n\$\d+\.\d\d\nWith router\n\$\d+\.\d\d/)
  expect(texts.indexOf('YOU SAVED')).toBeLessThan(texts.indexOf('THIS CHAT'))
  expect(texts.indexOf('THIS CHAT')).toBeLessThan(texts.indexOf('SETTINGS'))
  expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toMatch(/You saved: \$\d+\.\d\d/)
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
    expect(texts).toMatch(/Router balance \(rough\)\n\+\$2\.00/)
    expect(texts).toMatch(/Decisions right\n100 % \(95 %: 21–100 %\)/)
    expect(texts).toMatch(/Tasks\nhaiku 1/)
    await ui.press({ key: 'fold-details' })
    await ui.unmount()
  }
})

test('a press on a value saves the option the way /config does, and the pane shows it chosen', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle-effortDetection-auto' })
  await ui.press({ key: 'toggle-newSessionAt-60%' })
  await ui.press({ key: 'toggle-subagentSuggestions-off' })
  expect(seen.sets).toEqual([
    { key: 'prompt-router.effortDetection', value: 'auto' },
    { key: 'prompt-router.newSessionAt', value: '60%' },
    { key: 'prompt-router.subagentSuggestions', value: 'off' },
  ])
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await again.find({ type: 'Button', key: 'toggle-effortDetection-auto' }))).toMatch(/"variant":"primary"/)
  expect(JSON.stringify(await again.find({ type: 'Button', key: 'toggle-effortDetection-ask' }))).not.toMatch(/"variant":"primary"/)
  expect(await textsOf(again)).toMatch(/asks for a new session at 60 %/)
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
  await ui.press({ key: 'toggle-newSessionAt-off' })
  await ui.unmount()
  const off = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await textsOf(off)).toMatch(/never asks for a new session/)
  await off.unmount()
  seen.sets.length = 0
  const ui2 = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui2.press({ key: 'toggle-newSessionAt-40%' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.newSessionAt', value: '40%' })
  await ui2.unmount()
})

test('More settings, folded: the classifier, what the saving is compared with, the pane on start', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const shut = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await shut.find({ type: 'Button', key: 'toggle-classifier-haiku' })).toBeUndefined()
  await shut.press({ key: 'fold-more' })
  await shut.unmount()
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await ui.find({ type: 'Button', key: 'toggle-classifier-opus' })).toBeUndefined()
  await ui.press({ key: 'toggle-classifier-haiku' })
  await ui.press({ key: 'toggle-compareModel-haiku' })
  await ui.press({ key: 'toggle-openPane-on' })
  expect(seen.sets).toEqual([
    { key: 'prompt-router.classifier', value: 'haiku' },
    { key: 'prompt-router.compareWith', value: 'haiku-medium' },
    { key: 'prompt-router.openPane', value: 'on' },
  ])
  await ui.press({ key: 'toggle-compareEffort-high' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'haiku-high' })
  await ui.press({ key: 'toggle-compareModel-first' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'first' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await again.find({ type: 'Button', key: 'toggle-compareEffort-medium' })).toBeUndefined()
  await again.press({ key: 'toggle-compareModel-opus' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'opus-medium' })
  await again.unmount()
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
  expect(ring).toMatch(/prefers-reduced-motion/)
  expect(ring).toMatch(/prefers-color-scheme: ?dark/)
  expect(ring).not.toMatch(/<script|on\w+=/)
  expect(ring).toMatch(/<title>Context 47%, new session at 50%<\/title>/)
  // Still: nothing replays on a redraw.
  expect(ring).not.toMatch(/@keyframes/)
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
  await ui.press({ key: 'toggle-firstChatDetection-ask' })
  await ui.press({ key: 'toggle-notifications-off' })
  expect(seen.sets).toEqual([
    { key: `${ID}.firstChatDetection`, value: 'ask' },
    { key: `${ID}.notifications`, value: 'off' },
  ])
  await ui.unmount()
})
