// Golden tests: lock what Claude Code sees from the mod today (classifier prompts, notes, toasts,
// config writes, log records, the stats page, the options) as whole texts, so a refactor of the flow
// shows every changed character. The test sandbox has no file access, so the snapshots are .ts
// modules beside this file; a missing key prints a GOLDEN line and fails, and
// `GOLDEN_WRITE=1 node test/golden/write.mjs` turns those lines into the modules.
import { expect, test } from 'claude-code/testing'
import { OPTIONS, toConfig } from '../core/router.ts'
import { balance, byDay, statsHtml, summarize } from '../core/stats.ts'
import type { Entry } from '../core/stats.ts'
import config from './golden/config.ts'
import log from './golden/log.ts'
import notes from './golden/notes.ts'
import prompts from './golden/prompts.ts'
import stats from './golden/stats.ts'

const GOLDEN: Record<string, Record<string, unknown>> = { config, log, notes, prompts, stats }

// The sandbox has no TZ to set: every time sits at noon UTC, so local days match for UTC−11…+11.
const NOW = Date.UTC(2026, 10, 10, 12)

// Strings with line breaks as line arrays: readable snapshot files and line-wise diffs.
function lines(v: unknown): unknown {
  if (typeof v === 'string') return v.includes('\n') ? v.split('\n') : v
  if (Array.isArray(v)) return v.map(lines)
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, lines(x)]))
  return v
}

// A missing key prints its GOLDEN line and fails the test at its end, so one run prints them all.
let missing: string[] = []
function golden(key: string, actual: unknown) {
  const [group = '', name = ''] = key.split('/')
  const got = lines(actual)
  const want = GOLDEN[group]?.[name]
  if (want !== undefined) return expect(got).toEqual(want)
  console.log(`GOLDEN\t${key}\t${JSON.stringify(got)}`)
  missing.push(key)
}

function gtest(name: string, options: Record<string, string> | null, body: ($: any, on: any) => unknown) {
  const run = async ($: any, on: any) => {
    missing = []
    await body($, on)
    if (missing.length) throw new Error(`no golden snapshot for ${missing.join(', ')}: run GOLDEN_WRITE=1 node test/golden/write.mjs`)
  }
  if (options) test(name, { options } as any, run)
  else test(name, run)
}

const MODEL_ROW = { key: 'model', label: 'Model', kind: 'choice', value: 'opus', options: ['default', 'opus', 'sonnet', 'haiku', 'fable'], provider: { plugin: 'engine' }, isLocked: false }
const EFFORT_ROW = { key: 'effort', label: 'Effort', kind: 'choice', value: 'medium', options: ['low', 'medium', 'high', 'xhigh', 'max'], provider: { plugin: 'engine' }, isLocked: false }
const IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' } as const

type Seen = { prompts: string[]; sent: string[]; sets: unknown[]; toasts: string[]; writes: { path: string; text: string }[]; files: Map<string, string> }
type Opts = { isFirst?: boolean; model?: string; tokens?: number | null; tools?: string[]; surfaces?: string[]; files?: Record<string, string>; messages?: () => unknown[] }

// The engine beneath the plugin, as in router.test.ts, with fixed time and environment. process.run
// and process.spawn are not answered, so the logs go through fs.read / fs.write.
function engine(on: any, reply: string | (() => string), opts: Opts = {}): Seen {
  const seen: Seen = { prompts: [], sent: [], sets: [], toasts: [], writes: [], files: new Map(Object.entries(opts.files ?? {})) }
  const store = new Map<string, unknown>()
  const chat = [
    { role: 'user', text: 'Fix the duplicate recipes in search', toolUses: [] },
    { role: 'assistant', text: 'Fixed: the query now groups by recipe id.', toolUses: [] },
  ]
  on('session.start', (_: unknown, e: any) => ({ cwd: e.cwd }))
  on('env.get', (_: unknown, e: any) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('command.register', (_: unknown, e: any) => ({ value: { command: e.name } }))
  on('tool.register', (_: unknown, e: any) => ({ value: { tool: `mcp__prompt-router__${e.name}` } }))
  on('model.complete', (_: unknown, e: any) => {
    seen.prompts.push(e.prompt)
    return { value: { isAnswered: true, text: typeof reply === 'function' ? reply() : reply, usage: { input_tokens: 1, output_tokens: 1 } } }
  })
  on('session.messages', () => ({ value: opts.messages?.() ?? (opts.isFirst ? [] : chat) }))
  on('session.model', () => ({ value: opts.model ?? IDS.opus }))
  // tokens null: the engine has no reading of the context yet.
  on('session.usage', () => ({ value: { startedAt: 0, context: opts.tokens === null ? {} : { tokens: opts.tokens ?? 85000 }, rateLimits: [{ kind: 'seven_day', percentUsed: 20, resetsAt: '2026-11-16T08:00:00Z' }] } }))
  on('config.list', () => ({ value: [EFFORT_ROW, MODEL_ROW] }))
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
  on('ui.render', () => ({ type: 'Text', props: {} }))
  on('store.get', (_: unknown, e: any) => ({ value: store.get(e.key) }))
  on('store.set', (_: unknown, e: any) => {
    store.set(e.key, e.value)
    return { value: undefined }
  })
  on('fs.exists', () => ({ value: false }))
  const file = (path: string) => seen.files.get(path) ?? [...seen.files].find(([k]) => k.startsWith('*') && path.endsWith(k.slice(1)))?.[1]
  on('fs.read', (_: unknown, e: any) => ({ value: file(e.path) ?? '' }))
  on('fs.write', (_: unknown, e: any) => {
    seen.writes.push({ path: e.path, text: e.text })
    seen.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('tool.list', () => ({ value: (opts.tools ?? ['mcp__ccd_session__start_session']).map(name => ({ name, description: '', mcp: true })) }))
  on('session.surfaces', () => ({ value: opts.surfaces ?? ['desktop'] }))
  on('clock.now', () => ({ value: NOW }))
  // The pane's countdown timer never ticks here (DLUH: clock.every ticks are not covered).
  on('clock.every', () => new Promise<any>(() => {}))
  on('tool.call', () => ({ result: {} }))
  on('prompt.submit', (_: unknown, e: any) => {
    seen.sent.push(e.text)
    return { text: e.text }
  })
  return seen
}

async function start($: any) {
  await $.session.start({ cwd: '/work/app', surface: 'desktop', isInteractive: true })
}

async function submit($: any, text: string, turnId?: string) {
  await $.prompt.submit({ text, wait: false, origin: { kind: 'composer' }, ...(turnId ? { turnId } : {}) })
}

// The plugin folder differs per checkout (it lands in the log's "effective options" line), and the
// chat id ends in Math.random, which the sandbox will not let a test pin.
const stable = (s: string) => s.replace(/(effective options: )[^|\n]* \|/g, '$1<plugin-root> |').replaceAll(`"chat":"${NOW}-`, '"chat":"<chat>').replace(/"chat":"<chat>[a-z0-9]{0,8}"/g, '"chat":"<chat>"')

// 1. The classifier prompt for each kind of chat.
const reply = (where: string, model: string, effort: string) => JSON.stringify({ where, model, effort, why: 'fits the task' })
type PromptCase = { name: string; isFirst: boolean; tokens: number | null; model: keyof typeof IDS; options?: Record<string, string>; text?: string }
const PROMPT_CASES: PromptCase[] = []
for (const isFirst of [true, false]) {
  for (const tokens of [85000, null]) {
    for (const model of ['haiku', 'sonnet', 'opus', 'fable'] as const) {
      PROMPT_CASES.push({ name: `${isFirst ? 'first' : 'later'}-${tokens ? 'tokens' : 'notokens'}-${model}`, isFirst, tokens, model })
    }
  }
}
PROMPT_CASES.push(
  { name: 'rules-cs', isFirst: false, tokens: 85000, model: 'opus', options: { project: 'a Flutter food delivery app', rules: 'Payments: opus, high.', language: 'Czech', classifier: 'haiku' }, text: 'oprav platby v košíku' },
  { name: 'rules-en', isFirst: false, tokens: 85000, model: 'opus', options: { rules: 'Database migrations: opus, high.', language: 'English', classifier: 'opus' } },
  { name: 'auto-cs', isFirst: false, tokens: 85000, model: 'sonnet', text: 'přidej test na prázdné hledání' },
  { name: 'long-chat', isFirst: false, tokens: 150000, model: 'opus' },
)

for (const k of PROMPT_CASES) {
  gtest(`golden prompt: ${k.name}`, k.options ?? {}, async ($: any, on: any) => {
    const seen = engine(on, reply('here', k.model, 'medium'), { isFirst: k.isFirst, tokens: k.tokens, model: IDS[k.model] })
    await start($)
    await submit($, k.text ?? 'the new test fails on an empty search, fix that too')
    golden(`prompts/${k.name}`, seen.prompts)
  })
}

// 2 + 4. Notes appended to the prompt, toasts and config writes, for each mode and route.
type NoteCase = { name: string; reply: string; isFirst?: boolean; model?: keyof typeof IDS; tokens?: number; turnId?: string; tools?: string[]; surfaces?: string[] }
const NOTE_CASES: NoteCase[] = [
  { name: 'here-first-model-effort', reply: reply('here', 'haiku', 'low'), isFirst: true },
  { name: 'here-first-effort', reply: reply('here', 'opus', 'high'), isFirst: true },
  { name: 'here-first-model', reply: reply('here', 'sonnet', 'medium'), isFirst: true },
  { name: 'here-effort', reply: reply('here', 'opus', 'low') },
  { name: 'here-same', reply: reply('here', 'opus', 'medium') },
  { name: 'here-other-model', reply: reply('here', 'haiku', 'low') },
  { name: 'here-other-model-same-effort', reply: reply('here', 'sonnet', 'medium') },
  { name: 'here-max', reply: reply('here', 'opus', 'max') },
  { name: 'here-mid-turn', reply: reply('here', 'haiku', 'low'), turnId: 't0' },
  { name: 'keep', reply: reply('keep', 'keep', 'keep') },
  { name: 'subagent', reply: reply('subagent', 'haiku', 'low') },
  { name: 'subagent-same-effort', reply: reply('subagent', 'sonnet', 'medium') },
  { name: 'subagent-on-fable', reply: reply('subagent', 'opus', 'high'), model: 'fable' },
  { name: 'session', reply: reply('session', 'sonnet', 'medium') },
  { name: 'session-mid-turn', reply: reply('session', 'sonnet', 'medium'), turnId: 't0' },
  { name: 'session-terminal', reply: reply('session', 'sonnet', 'medium'), tools: [], surfaces: ['terminal'] },
  { name: 'session-long', reply: reply('here', 'opus', 'medium'), tokens: 150000 },
]
const MODES: Record<string, Record<string, string>> = {
  ask: {},
  auto: { effortDetection: 'auto', firstChatDetection: 'auto', midChatModelDetection: 'auto', subagentSuggestions: 'auto', sessionSuggestions: 'ask' },
  'auto-mid-ask': { effortDetection: 'auto', firstChatDetection: 'auto', subagentSuggestions: 'auto' },
  off: { effortDetection: 'off', firstChatDetection: 'off', midChatModelDetection: 'off', subagentSuggestions: 'off', sessionSuggestions: 'off' },
  'auto-quiet': { effortDetection: 'auto', firstChatDetection: 'auto', notifications: 'off' },
}

for (const [mode, options] of Object.entries(MODES)) {
  for (const k of NOTE_CASES) {
    gtest(`golden note: ${mode} ${k.name}`, options, async ($: any, on: any) => {
      const seen = engine(on, k.reply, { isFirst: k.isFirst, model: k.model && IDS[k.model], tokens: k.tokens, tools: k.tools, surfaces: k.surfaces })
      await start($)
      await submit($, 'run the whole test suite and tell me what fails', k.turnId)
      golden(`notes/${mode}-${k.name}`, { sent: seen.sent, toasts: seen.toasts, sets: seen.sets })
    })
  }
}

// 3. The log records from a scripted chat of five turns.
const TURN = { answer: '', durationMs: 4000, isAborted: false, reason: 'answer' }
const usage = (model: string) => ({ input_tokens: 1000, output_tokens: 2000, cache_read_input_tokens: 30000, cache_creation_input_tokens: 500, model })

gtest('golden log: five turns', null, async ($: any, on: any) => {
  const replies = [reply('here', 'haiku', 'low'), reply('subagent', 'haiku', 'low'), reply('keep', 'keep', 'keep'), reply('here', 'opus', 'high'), reply('session', 'sonnet', 'medium')]
  let i = 0
  let first = true
  // After the first turn the chat has an answer, so later prompts are not first.
  const seen = engine(on, () => replies[i] ?? '', { messages: () => (first ? [] : [{ role: 'user', text: 'what does this regex match', toolUses: [] }, { role: 'assistant', text: 'It matches dates.', toolUses: [] }]) })
  let turnModel = IDS.opus
  on('turn.complete', () => ({ text: '', usage: usage(turnModel) }))
  on('agent.spawn', () => ({ model: IDS.haiku, agentId: 'a1' }))
  await start($)
  await submit($, 'what does this regex match')
  await $.turn.complete({ ...TURN, turnId: 't1' })
  first = false
  i = 1
  await submit($, 'run the whole test suite and tell me what fails')
  await $.agent.spawn({ tool_use_id: 'x', prompt: 'run tests', description: 'tests', subagentType: 'general-purpose', provider: { kind: 'builtin' } })
  turnModel = IDS.haiku
  await $.turn.complete({ ...TURN, turnId: 't2', agentId: 'a1' })
  turnModel = IDS.opus
  await $.turn.complete({ ...TURN, turnId: 't2' })
  i = 2
  await submit($, 'ok, go on')
  await submit($, 'go on with the next file')
  await $.turn.complete({ ...TURN, turnId: 't3' })
  i = 3
  await submit($, 'now redesign the cache layer')
  await $.turn.complete({ ...TURN, turnId: 't4' })
  i = 4
  await submit($, 'now build the shopping list feature')
  await $.turn.complete({ ...TURN, turnId: 't5' })
  golden('log/writes', seen.writes.map(w => ({ path: w.path, text: stable(w.text) })))
  golden('log/sent', seen.sent)
  golden('log/toasts', { toasts: seen.toasts, sets: seen.sets })
})

// 5. The stats page and text for fixed records, through the mod and straight from statsHtml.
const DAY = 86_400_000
const at = (days: number) => NOW - days * DAY
const u = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({ input, output, cacheRead, cacheWrite })
const RECORDS: Entry[] = [
  { kind: 'decision', ts: at(40), platform: 'claude-code', chat: 'c0', where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'sonnet', effort: 'medium' }, outcome: 'applied' },
  { kind: 'turn', ts: at(40) + 1000, platform: 'claude-code', chat: 'c0', model: IDS.sonnet, baseline: IDS.opus, usage: u(5000, 20000, 200000, 4000) },
  { kind: 'decision', ts: at(9), platform: 'claude-code', chat: 'c1', where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'haiku', effort: 'low' }, outcome: 'applied', key: 'k1' },
  { kind: 'turn', ts: at(9) + 1000, platform: 'claude-code', chat: 'c1', model: IDS.haiku, baseline: IDS.opus, usage: u(2000, 8000, 50000, 1000), durationMs: 30000 },
  { kind: 'decision', ts: at(3), platform: 'claude-code', chat: 'c2', where: 'subagent', from: { model: 'opus', effort: 'medium' }, to: { model: 'haiku', effort: 'low' }, outcome: 'asked', key: 'k2' },
  { kind: 'accept', ts: at(3) + 500, platform: 'claude-code', chat: 'c2', decision: at(3) },
  { kind: 'turn', ts: at(3) + 2000, platform: 'claude-code', chat: 'c2', agentId: 'a1', model: IDS.haiku, baseline: IDS.opus, usage: u(1000, 30000, 80000, 2000), mainContext: 90000, requests: 4 },
  { kind: 'turn', ts: at(3) + 3000, platform: 'claude-code', chat: 'c2', model: IDS.opus, baseline: IDS.opus, usage: u(500, 1000, 90000, 500), week: { pct: 30, resets: '2026-11-16T08:00:00Z' } },
  { kind: 'decision', ts: at(0), platform: 'claude-code', chat: 'c3', where: 'here', from: { model: 'opus', effort: 'medium' }, to: { model: 'opus', effort: 'high' }, outcome: 'asked', key: 'k3' },
  { kind: 'accept', ts: at(0) + 500, platform: 'claude-code', chat: 'c3', decision: at(0), outcome: 'declined' },
  { kind: 'turn', ts: at(0) + 1000, platform: 'claude-code', chat: 'c3', model: IDS.opus, baseline: IDS.opus, usage: u(800, 3000, 120000, 1500), week: { pct: 32, resets: '2026-11-16T08:00:00Z' } },
] as Entry[]

gtest('golden stats: /router stats text and the page it writes', null, async ($: any, on: any) => {
  const seen = engine(on, reply('keep', 'keep', 'keep'), { files: { '*/prompt-router-stats.jsonl': `${RECORDS.map(r => JSON.stringify(r)).join('\n')}\n` } })
  await start($)
  const r = await $.command.run({ command: 'router', args: 'stats' })
  golden('stats/command', r.text)
  golden('stats/writes', seen.writes.filter(w => !w.path.endsWith('prompt-router.log')).map(w => ({ path: w.path, text: stable(w.text) })))
})

gtest('golden stats: statsHtml for fixed records', null, () => {
  const report = summarize(RECORDS, NOW)
  golden('stats/html', statsHtml(report, byDay(RECORDS, NOW, 30), null, balance(RECORDS)))
  golden('stats/html-reference', statsHtml(summarize(RECORDS, NOW, { model: 'opus', effort: 'medium' }), byDay(RECORDS, NOW, 30, { model: 'opus', effort: 'medium' }), { model: 'opus', effort: 'medium' }, balance(RECORDS)))
})

// 6. Option names and defaults. The test cannot read plugin.json; the engine hands the mod the
// manifest defaults, and /router lists each option with its value and where it came from.
gtest('golden config: toConfig, OPTIONS and the options the mod gets by default', null, async ($: any, on: any) => {
  golden('config/options', OPTIONS)
  golden('config/empty', toConfig({}))
  engine(on, reply('keep', 'keep', 'keep'))
  await start($)
  golden('config/status', stable((await $.command.run({ command: 'router', args: '' })).text))
})
