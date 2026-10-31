import { expect, test } from 'claude-code/testing'
import { cost } from '../core/prices.ts'
import type { Usage } from '../core/prices.ts'
import { byDay, parseLog, rotate, savingLabel, statsHtml, statsText, summarize } from '../core/stats.ts'
import type { Accept, Decision, Turn } from '../core/stats.ts'

// Dollars as floats: equal to 9 decimal places (the runner has no toBeCloseTo).
function close(a: number | null, b: number) {
  expect(Math.round((a ?? NaN) * 1e9)).toBe(Math.round(b * 1e9))
}

const NOW = new Date(2026, 9, 31, 15, 0).getTime()
const HOUR = 3_600_000
const DAY = 24 * HOUR
const U: Usage = { input: 1_000, output: 2_000, cacheRead: 50_000, cacheWrite: 4_000 }

function turn(model: string, baseline: string, extra: Partial<Turn> = {}): Turn {
  return { kind: 'turn', ts: NOW - HOUR, platform: 'claude-code', chat: 'c1', model, baseline, usage: U, ...extra }
}

function decision(over: Partial<Decision> = {}): Decision {
  return {
    kind: 'decision', ts: NOW - HOUR, platform: 'claude-code', chat: 'c1', where: 'here',
    from: { model: 'opus', effort: 'medium' }, to: { model: 'opus', effort: 'medium' }, outcome: 'applied', ...over,
  }
}

test('a cheaper model saves the baseline price minus the real price', () => {
  const s = summarize([turn('haiku', 'opus')], NOW).today
  close(s.actualUsd, cost(U, 'haiku')!)
  close(s.withoutUsd, cost(U, 'opus')!)
  close(s.savedUsd, cost(U, 'opus')! - cost(U, 'haiku')!)
  expect(s.extraUsd).toBe(0)
  close(s.netUsd, s.savedUsd)
})

test('a stronger model is shown as extra cost, apart from the saving', () => {
  const s = summarize([turn('opus', 'sonnet'), turn('haiku', 'opus')], NOW).today
  close(s.extraUsd, cost(U, 'opus')! - cost(U, 'sonnet')!)
  close(s.savedUsd, cost(U, 'opus')! - cost(U, 'haiku')!)
  close(s.netUsd, s.savedUsd)
})

test('the classifier cost is taken off the saving, and the percent is of the price without the router', () => {
  const cls = { model: 'sonnet', usage: { input: 3_000, output: 100, cacheRead: 0, cacheWrite: 0 } }
  const s = summarize([turn('haiku', 'opus'), decision({ classifier: cls }), decision({ classifier: { ...cls, usd: 0.5 } })], NOW).today
  const clsUsd = cost(cls.usage, 'sonnet')! + 0.5
  close(s.classifierUsd, clsUsd)
  close(s.netUsd, s.savedUsd - clsUsd)
  close(s.netPct, (s.netUsd / s.withoutUsd) * 100)
})

test('a turn without usage is counted as unknown, not priced', () => {
  const s = summarize([turn('haiku', 'opus', { usage: undefined })], NOW).today
  expect(s.unknownTurns).toBe(1)
  expect(s.actualUsd).toBe(0)
  expect(s.netPct).toBe(0)
})

test('a model with no price claims no saving; a cost the platform reported still counts', () => {
  const s = summarize([turn('gpt-5', 'gpt-5-mini', { usd: 0.3 }), turn('gpt-5', 'gpt-5')], NOW).today
  expect(s.unpricedTurns).toBe(2)
  close(s.actualUsd, 0.3)
  close(s.withoutUsd, 0.3)
  expect(s.savedUsd).toBe(0)
  expect(s.extraUsd).toBe(0)
})

test('the same model on both sides costs the same, a reported cost wins over the price list', () => {
  const s = summarize([turn('opus', 'opus', { usd: 1 })], NOW).today
  expect(s.actualUsd).toBe(1)
  expect(s.withoutUsd).toBe(1)
  expect(s.savedUsd).toBe(0)
})

test('a subagent turn is priced against the main chat model', () => {
  const s = summarize([turn('haiku', 'opus', { agentId: 'a1' })], NOW).today
  close(s.savedUsd, cost(U, 'opus')! - cost(U, 'haiku')!)
})

test('today, 7 days and total cover their own time', () => {
  const r = summarize([
    turn('haiku', 'opus'),
    turn('haiku', 'opus', { ts: new Date(2026, 9, 30, 23, 0).getTime() }),
    turn('haiku', 'opus', { ts: NOW - 8 * DAY }),
  ], NOW)
  const one = cost(U, 'opus')! - cost(U, 'haiku')!
  close(r.today.savedUsd, one)
  close(r.week.savedUsd, 2 * one)
  close(r.total.savedUsd, 3 * one)
})

test('decisions are counted by what changed; asked and declined ones change nothing', () => {
  const s = summarize([
    decision({ to: { model: 'haiku', effort: 'low' } }),
    decision({ to: { model: 'opus', effort: 'high' } }),
    decision({ where: 'subagent', to: { model: 'haiku', effort: 'low' } }),
    decision({ where: 'session', to: { model: 'sonnet', effort: 'medium' } }),
    decision({ to: { model: 'haiku', effort: 'low' }, outcome: 'asked' }),
    decision({ where: 'subagent', to: { model: 'haiku', effort: 'low' }, outcome: 'declined' }),
    decision({ where: 'keep' }),
  ], NOW).today
  expect(s.prompts).toBe(7)
  expect(s.modelChanges).toBe(1)
  expect(s.effortDown).toBe(1)
  expect(s.effortUp).toBe(1)
  expect(s.subagents).toBe(1)
  expect(s.sessions).toBe(1)
  expect(s.asked).toBe(1)
  expect(s.declined).toBe(1)
})

test('tokens are summed by model', () => {
  const s = summarize([turn('haiku', 'opus'), turn('haiku', 'opus', { agentId: 'a' }), turn('opus', 'opus')], NOW).today
  expect(s.tokens.haiku).toEqual({ input: 2_000, output: 4_000, cacheRead: 100_000, cacheWrite: 8_000 })
  expect(s.tokens.opus).toEqual(U)
})

test('byDay gives the net saving per local day, oldest first, for the graph', () => {
  const yesterday = new Date(2026, 9, 30, 10, 0).getTime()
  const days = byDay([
    turn('haiku', 'opus'),
    turn('haiku', 'opus', { ts: yesterday }),
    decision({ ts: yesterday, classifier: { model: 'haiku', usage: U, usd: 0.01 } }),
  ], NOW, 7)
  expect(days.length).toBe(7)
  expect(days[6].day).toBe('2026-10-31')
  expect(days[5].day).toBe('2026-10-30')
  const one = cost(U, 'opus')! - cost(U, 'haiku')!
  close(days[6].netUsd, one)
  close(days[5].netUsd, one - 0.01)
  expect(days[0].netUsd).toBe(0)
})

test('parseLog keeps the good lines and skips the broken ones', () => {
  const t = turn('haiku', 'opus')
  const d = decision()
  const out = parseLog(`${JSON.stringify(t)}\nnot json\n{"kind":"other"}\n\n${JSON.stringify(d)}\n`)
  expect(out).toEqual([t, d])
})

test('an asked decision the user then took counts as applied, once', () => {
  const asked = decision({ ts: NOW - 2 * HOUR, where: 'subagent', to: { model: 'haiku', effort: 'low' }, outcome: 'asked' })
  const accept: Accept = { kind: 'accept', ts: NOW - HOUR, platform: 'claude-code', chat: 'c1', decision: asked.ts }
  const other: Accept = { kind: 'accept', ts: NOW - HOUR, platform: 'claude-code', chat: 'c2', decision: asked.ts }
  const s = summarize([asked, accept, accept, other], NOW).today
  expect(s.prompts).toBe(1)
  expect(s.asked).toBe(1)
  expect(s.subagents).toBe(1)
})

test('rotate drops lines older than 90 days and the oldest lines over the size cap', () => {
  const old = JSON.stringify(turn('haiku', 'opus', { ts: NOW - 91 * DAY }))
  const a = JSON.stringify(turn('haiku', 'opus', { ts: NOW - 2 * DAY }))
  const b = JSON.stringify(turn('haiku', 'opus', { ts: NOW - DAY }))
  expect(rotate(`${old}\n${a}\nbroken\n${b}\n`, NOW)).toBe(`${a}\n${b}\n`)
  expect(rotate(`${a}\n${b}\n`, NOW, b.length + 5)).toBe(`${b}\n`)
  expect(rotate('', NOW)).toBe('')
})

test('statsText shows the three periods, the net saving and the extra cost apart', () => {
  const t = statsText(summarize([turn('haiku', 'opus'), turn('opus', 'sonnet'), decision({ classifier: { model: 'haiku', usage: U, usd: 0.001 } })], NOW))
  expect(t).toMatch(/Today\s+7 days\s+Total/)
  expect(t).toMatch(/Net saving/)
  expect(t).toMatch(/Classifier/)
  expect(t).toMatch(/Extra cost \(stronger model\)/)
  expect(t).toMatch(/estimate/i)
  expect(t).toMatch(/Effort lower \/ higher/)
})

test('savingLabel is short, empty when there is nothing to show', () => {
  expect(savingLabel(summarize([], NOW).today)).toBe('')
  const s = summarize([turn('haiku', 'opus', { usage: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 } })], NOW).today
  expect(savingLabel(s)).toBe(`saved $${s.netUsd.toFixed(2)} today`)
  const loss = summarize([decision({ classifier: { model: 'opus', usage: U, usd: 0.05 } })], NOW).today
  expect(savingLabel(loss)).toBe('router cost $0.05 today')
})

test('statsHtml is one page with the periods, a bar per day and the estimate note', () => {
  const records = [turn('haiku', 'opus'), turn('opus', 'sonnet', { ts: NOW - 2 * DAY }), decision({ classifier: { model: 'haiku', usage: U, usd: 0.001 } })]
  const html = statsHtml(summarize(records, NOW), byDay(records, NOW, 30))
  expect(html.startsWith('<!doctype html>')).toBe(true)
  expect(html).toMatch(/<svg/)
  expect((html.match(/<rect class="bar/g) ?? []).length).toBe(30)
  expect(html).toMatch(/2026-10-31/)
  expect(html).toMatch(/Net saving/)
  expect(html).toMatch(/Extra cost \(stronger model\)/)
  expect(html).toMatch(/estimate/i)
  expect(html).toMatch(/prefers-color-scheme: dark/)
  expect(html).not.toMatch(/<script/)
})
