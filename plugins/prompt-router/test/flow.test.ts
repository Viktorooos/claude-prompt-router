// core/flow.ts against the golden snapshots of Claude Code: the same cases as golden.test.tsx, run
// through the engine-free flow, must give the very notes, toasts, config writes and stats records.
import { expect, test } from 'claude-code/testing'
import { CLAUDE_CODE_NAMES, acceptRecord, decisionRecord, declinedAtEnd, finalizePick, isRouterQuestion, route, spawnAccepts } from '../core/flow.ts'
import type { Ctx, Step } from '../core/flow.ts'
import { ALL_MODELS, BASE_MODELS, compactWindow, knownModel, parsePick, promptKey, quickReply, toConfig } from '../core/router.ts'
import log from './golden/log.ts'
import notes from './golden/notes.ts'

const NOW = Date.UTC(2026, 10, 10, 12)
const IDS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' } as const
const TEXT = 'run the whole test suite and tell me what fails'

function lines(v: unknown): unknown {
  if (typeof v === 'string') return v.includes('\n') ? v.split('\n') : v
  if (Array.isArray(v)) return v.map(lines)
  return v
}

const reply = (where: string, model: string, effort: string) => JSON.stringify({ where, model, effort, why: 'fits the task' })

// The chat as golden.test.tsx's engine shows it: effort medium, 85k tokens, no window, fable only on a fable chat.
function step(n: Ctx, text: string, o: { isFirst?: boolean; model?: keyof typeof IDS; tokens?: number; midTurn?: boolean; inApp?: boolean }) {
  const model = IDS[o.model ?? 'opus']
  const models = knownModel(model) === 'fable' ? ALL_MODELS : [...BASE_MODELS]
  const p = finalizePick(parsePick(text, models), { cfg: n.cfg, tokens: o.tokens ?? 85000, window: compactWindow(undefined, {}), isFirst: !!o.isFirst, model })
  return route(n, { p, now: 'medium', from: knownModel(model) || model, classified: true, midTurn: !!o.midTurn, inApp: o.inApp ?? true })
}

const sent = (s: Step) => (s.note ? `${TEXT}\n\n[${s.note}]` : TEXT)
const sets = (s: Step) => [s.apply.model, s.apply.effort].filter(Boolean)

type NoteCase = { name: string; reply: string; isFirst?: boolean; model?: keyof typeof IDS; tokens?: number; midTurn?: boolean; inApp?: boolean }
const NOTE_CASES: NoteCase[] = [
  { name: 'here-first-model-effort', reply: reply('here', 'haiku', 'low'), isFirst: true },
  { name: 'here-first-effort', reply: reply('here', 'opus', 'high'), isFirst: true },
  { name: 'here-first-model', reply: reply('here', 'sonnet', 'medium'), isFirst: true },
  { name: 'here-effort', reply: reply('here', 'opus', 'low') },
  { name: 'here-same', reply: reply('here', 'opus', 'medium') },
  { name: 'here-other-model', reply: reply('here', 'haiku', 'low') },
  { name: 'here-other-model-same-effort', reply: reply('here', 'sonnet', 'medium') },
  { name: 'here-max', reply: reply('here', 'opus', 'max') },
  { name: 'here-mid-turn', reply: reply('here', 'haiku', 'low'), midTurn: true },
  { name: 'keep', reply: reply('keep', 'keep', 'keep') },
  { name: 'subagent', reply: reply('subagent', 'haiku', 'low') },
  { name: 'subagent-same-effort', reply: reply('subagent', 'sonnet', 'medium') },
  { name: 'subagent-on-fable', reply: reply('subagent', 'opus', 'high'), model: 'fable' },
  { name: 'session', reply: reply('session', 'sonnet', 'medium') },
  { name: 'session-mid-turn', reply: reply('session', 'sonnet', 'medium'), midTurn: true },
  { name: 'session-terminal', reply: reply('session', 'sonnet', 'medium'), inApp: false },
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
    test(`flow note: ${mode} ${k.name}`, () => {
      const s = step({ cfg: toConfig(options), names: CLAUDE_CODE_NAMES }, k.reply, k)
      const want = (notes as Record<string, unknown>)[`${mode}-${k.name}`]
      expect(want).toBeDefined()
      expect({ sent: [lines(sent(s))], toasts: s.toasts, sets: sets(s) }).toEqual(want)
    })
  }
}

// golden.test.tsx's five turns: the decision and accept records the flow writes, as the stats log holds them.
test('flow log: five turns give the golden decision and accept records', () => {
  const n: Ctx = { cfg: toConfig({}), names: CLAUDE_CODE_NAMES }
  const classifier = { model: IDS.sonnet, usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 }, ms: 0 }
  const base = { ts: NOW, platform: 'claude-code', chat: '<chat>', from: 'opus', now: 'medium' as const, classifier }
  const records: string[] = []
  let asked: Step['asked'] | null = null
  const turns: [string, string, boolean][] = [
    ['what does this regex match', reply('here', 'haiku', 'low'), true],
    ['run the whole test suite and tell me what fails', reply('subagent', 'haiku', 'low'), false],
    ['ok, go on', '', false],
    ['go on with the next file', reply('keep', 'keep', 'keep'), false],
    ['now redesign the cache layer', reply('here', 'opus', 'high'), false],
    ['now build the shopping list feature', reply('session', 'sonnet', 'medium'), false],
  ]
  for (const [text, r, isFirst] of turns) {
    // A quick reply skips the classifier and notes nothing.
    if (quickReply(text)) continue
    const s = step(n, r, { isFirst })
    if (s.decision) records.push(JSON.stringify(decisionRecord({ ...base, key: promptKey(text) }, s.decision)))
    asked = s.asked ?? null
    // The second turn's Agent call spawns a haiku subagent.
    if (spawnAccepts(asked, IDS.haiku)) {
      records.push(JSON.stringify(acceptRecord({ ts: NOW, platform: 'claude-code', chat: '<chat>', decision: NOW })))
      asked = null
    }
    // No turn showed the router's question, so none declined.
    expect(declinedAtEnd(asked, false)).toBe(false)
  }
  const writes = (log as unknown as { writes: { path: string; text: string[] }[] }).writes
  const stats = writes.filter(w => w.path.endsWith('-stats.jsonl')).at(-1)?.text ?? []
  expect(records).toEqual(stats.filter(l => /"kind":"(decision|accept)"/.test(l)))
})

test('flow: the declined record and the router question', () => {
  const n: Ctx = { cfg: toConfig({}), names: CLAUDE_CODE_NAMES }
  expect(isRouterQuestion(n, 'AskUserQuestion', { questions: [{ header: 'Prompt Router' }] })).toBe(true)
  expect(isRouterQuestion(n, 'AskUserQuestion', { questions: [{ header: 'Other' }] })).toBe(false)
  expect(declinedAtEnd({ where: 'here', model: 'opus' }, true)).toBe(true)
  expect(acceptRecord({ ts: 2, platform: 'claude-code', chat: 'c', decision: 1, declined: true })).toEqual({ kind: 'accept', ts: 2, platform: 'claude-code', chat: 'c', decision: 1, outcome: 'declined' })
})
