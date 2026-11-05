import { expect, test } from 'claude-code/testing'
import { ago, barText, contextBarSvg, sparkSvg, sparkText, splitBarSvg, splitBarText, tone } from '../core/panel.ts'
import { OPTIONS, SWITCHES } from '../core/router.ts'

const PANE = {
  plugin: 'prompt-router',
  component: 'Pane',
  requestId: 'prompt-router',
  props: { title: 'Prompt Router', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const

const SESSION_PICK = '{"where": "session", "model": "sonnet", "effort": "medium", "work": "new", "why": "unrelated feature"}'

type Seen = { sets: { key: string; value: unknown }[]; store: Map<string, unknown>; opened: unknown[]; sent: string[] }

// The engine beneath the plugin, as far as the pane needs it.
function engine(on: any, opts: { reply?: string; now?: number; usage?: { tokens: number; window?: number }; log?: string } = {}): Seen {
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
  on('config.list', () => ({ value: [{ key: 'effort', label: 'Effort', kind: 'choice', value: 'medium', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine' }, isLocked: false }] }))
  on('config.set', (_: unknown, e: any) => {
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

test('the pane draws on every surface: the context, the model and effort, the switches', async ($: any, on: any) => {
  engine(on)
  await start($)
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect((await ui.find({ type: 'Text', text: /Opus · Medium/ }))?.text).toMatch(/Opus · Medium/)
    expect(await ui.find({ type: 'Text', text: /No decision yet/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle-effortDetection' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'toggle-newSessionAt' })).toBeDefined()
    if (surface === 'terminal') {
      // No Svg on the terminal: the context is a bar with the threshold marked.
      expect(await ui.find({ type: 'Svg' })).toBeUndefined()
      expect((await ui.find({ type: 'Text', text: /▰/ }))?.text).toMatch(/▰+▱*│▱+ 47%/)
    } else {
      // The context bar (no ring any more), its share in the title.
      const bar = (await ui.findAll({ type: 'Svg' })).find((x: any) => /Context 47%/.test(JSON.stringify(x)))
      expect(bar).toBeDefined()
      expect(JSON.stringify(bar)).toMatch(/new session at 50%/)
    }
    await ui.unmount()
  }
})

test('the last decision shows where, model, effort and why, and a dot while fresh', async ($: any, on: any) => {
  engine(on, { now: 10 * HOUR })
  await start($)
  await $.prompt.submit({ text: 'add a settings screen to the admin app', wait: false, origin: { kind: 'composer' } })
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /New session/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Sonnet · Medium/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /unrelated feature/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /just now/ })).toBeDefined()
    // Fresh: a dot before the title (the pulse is gone, the design draws nothing that moves on its own).
    expect(await ui.find({ type: 'Text', text: /^● Last decision · just now/ })).toBeDefined()
    // What it had before → what the router picked.
    expect(await ui.find({ type: 'Text', text: / → Sonnet · Medium$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('savings: the old bill for the picked period, folded away (without, with, where the difference came from), and a 14-day sparkline', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: [TURN(now - HOUR), TURN(now - 3 * 86_400_000)].join('\n') })
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  // Folded by default; its button opens it.
  expect(await ui.find({ type: 'Text', text: /Without the router/ })).toBeUndefined()
  await ui.press({ key: 'more-legacy' })
  await ui.unmount()
  const open = await $.ui.mount({ ...PANE, surface: 'desktop' })
  const texts = (await open.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
  expect(texts).toMatch(/Without the router\n\$\d+\.\d\d/)
  expect(texts).toMatch(/With the router\n\$\d+\.\d\d/)
  expect(texts).toMatch(/Where the difference came from/)
  expect(texts).toMatch(/Balance\n\+\$\d+\.\d\d/)
  // 7 days by default; Today, 7 days and Total are buttons, the picked one primary.
  expect(JSON.stringify(await open.findAll({ type: 'Svg' }))).toMatch(/pathLength/)
  expect(JSON.stringify(await open.find({ type: 'Button', key: 'period-week' }))).toMatch(/"variant":"primary"/)
  await open.press({ key: 'period-today' })
  await open.press({ key: 'more-legacy' })
  await open.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await again.find({ type: 'Button', key: 'period-today' }))).toMatch(/"variant":"primary"/)
  expect(JSON.stringify(await again.find({ type: 'Button', key: 'period-week' }))).not.toMatch(/"variant":"primary"/)
  await again.unmount()
  const term = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await term.find({ type: 'Text', text: /[▁▂▃▄▅▆▇█]{14}/ })).toBeDefined()
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

test('savings: the balance per task against the control group, with its parts, accuracy and models', async ($: any, on: any) => {
  const now = 20 * 86_400_000 + 12 * HOUR
  engine(on, { now, log: controlLog(now) })
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text).join('\n')
    expect(texts).toMatch(/Router balance\n~\+\$2\.00\nsaved · 2 min saved\n(no range yet|range [^\n]+) · 1 tasks/i)
    expect(texts).toMatch(/1 routed tasks \(1 against the control group\) · 5 control tasks · rough estimate/)
    expect(texts).toMatch(/Cheaper picks\n\+\$2\.00/)
    expect(texts).toMatch(/Accuracy\n100 % \(95 %: 21–100 %\)/)
    expect(texts).toMatch(/Measured\n1\nEstimated\n0\nControl \(holdout\)\n5/)
    // The table column by column: model, tasks, $/task, re-work.
    expect(texts).toMatch(/model\nhaiku\ntasks\n1\n\$\/task\n\$1\.00\nre-work\n0 %/)
    if (surface === 'terminal') expect(texts).toMatch(/Cheaper picks\n\+\$2\.00\n·+│█+/)
    else expect(JSON.stringify(await ui.findAll({ type: 'Svg' }))).toMatch(/Cheaper picks: \+\$2\.00/)
    await ui.unmount()
  }
})

test('a switch press saves the option the way /config does, and the pane shows it', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.press({ key: 'toggle-effortDetection' })
  expect(seen.sets).toEqual([{ key: 'prompt-router.effortDetection', value: 'auto' }])
  await ui.press({ key: 'toggle-newSessionAt' })
  expect(seen.sets[1]).toEqual({ key: 'prompt-router.newSessionAt', value: '60%' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Button', key: 'toggle-effortDetection' }))?.text).toMatch(/auto/)
  expect((await again.find({ type: 'Button', key: 'toggle-newSessionAt' }))?.text).toMatch(/60%/)
  await again.unmount()
  // /router reads the same options.
  const status = await $.command.run({ command: 'router', args: '' })
  expect(String(status.text)).toMatch(/effortDetection: auto \(set\)/)
})

test('settings: every option can be changed in the pane', async ($: any, on: any) => {
  engine(on)
  await start($)
  for (const surface of ['desktop', 'terminal'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const key of OPTIONS) {
      const o = { options: key in SWITCHES || key === 'classifier' }
      if (key === 'compareWith') {
        expect(await ui.find({ type: 'Button', key: 'toggle-compareModel' })).toBeDefined()
        expect(await ui.find({ type: 'Button', key: 'toggle-compareEffort' })).toBeDefined()
      } else if (o.options) expect(await ui.find({ type: 'Button', key: `toggle-${key}` })).toBeDefined()
      else expect(await ui.find({ type: 'Input', key: `edit-${key}` })).toBeDefined()
    }
    await ui.unmount()
  }
})

test('settings: a press steps through the values, numbers from low to high', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await ui.find({ type: 'Button', key: 'toggle-holdoutPct' }))?.text).toMatch(/10 %/)
  await ui.press({ key: 'toggle-holdoutPct' })
  await ui.press({ key: 'toggle-holdoutPct' })
  await ui.press({ key: 'toggle-classifier' })
  await ui.press({ key: 'toggle-subagentSuggestions' })
  expect(seen.sets).toEqual([
    { key: 'prompt-router.holdoutPct', value: '20' },
    { key: 'prompt-router.holdoutPct', value: '0' },
    { key: 'prompt-router.classifier', value: 'haiku' },
    { key: 'prompt-router.subagentSuggestions', value: 'auto' },
  ])
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect((await again.find({ type: 'Button', key: 'toggle-holdoutPct' }))?.text).toMatch(/off/)
  expect((await again.find({ type: 'Button', key: 'toggle-classifier' }))?.text).toMatch(/haiku/)
  await again.unmount()
})

test('settings: compareWith is a model and an effort; first has no effort', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Button', key: 'toggle-compareModel' }))?.text).toMatch(/opus/)
  await ui.press({ key: 'toggle-compareModel' })
  await ui.press({ key: 'toggle-compareEffort' })
  expect(seen.sets).toEqual([{ key: 'prompt-router.compareWith', value: 'haiku-medium' }, { key: 'prompt-router.compareWith', value: 'haiku-high' }])
  for (let i = 0; i < 3; i++) await ui.press({ key: 'toggle-compareModel' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'first' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await again.find({ type: 'Button', key: 'toggle-compareModel' }))?.text).toMatch(/first/)
  expect(await again.find({ type: 'Button', key: 'toggle-compareEffort' })).toBeUndefined()
  // From first, the next model comes back at medium.
  await again.press({ key: 'toggle-compareModel' })
  expect(seen.sets.at(-1)).toEqual({ key: 'prompt-router.compareWith', value: 'opus-medium' })
  await again.unmount()
})

test('settings: a text option is a field that saves on Enter', async ($: any, on: any) => {
  const seen = engine(on)
  await start($)
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })
  await ui.input({ key: 'edit-project', text: '  a React web app ' })
  expect(seen.sets).toEqual([{ key: 'prompt-router.project', value: 'a React web app' }])
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(JSON.stringify(await again.find({ type: 'Input', key: 'edit-project' }))).toMatch(/a React web app/)
  await again.unmount()
  expect(String((await $.command.run({ command: 'router', args: '' })).text)).toMatch(/project: "a React web app" \(set\)/)
})

test('a section\'s "?" opens its explanation and closes it again', async ($: any, on: any) => {
  engine(on)
  await start($)
  const HELP = { type: 'Text', text: /^Measured: compared with a control task/ }
  const mount = () => $.ui.mount({ ...PANE, surface: 'desktop' })
  const shut = await mount()
  expect(await shut.find(HELP)).toBeUndefined()
  await shut.press({ key: 'help-sure' })
  await shut.unmount()
  const opened = await mount()
  expect(await opened.find(HELP)).toBeDefined()
  expect((await opened.find({ type: 'Button', key: 'help-sure' }))?.text).toBe('×')
  await opened.press({ key: 'help-sure' })
  await opened.unmount()
  const ui = await mount()
  expect(await ui.find(HELP)).toBeUndefined()
  // The period tabs come first, above the balance.
  const texts = (await ui.findAll({ type: 'Text' })).map((t: any) => t.text)
  expect(texts.indexOf('ROUTER BALANCE')).toBeLessThan(texts.indexOf('THIS CHAT'))
  await ui.unmount()
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

