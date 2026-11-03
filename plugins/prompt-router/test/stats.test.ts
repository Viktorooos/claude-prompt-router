import { expect, test } from 'claude-code/testing'
import { cost } from '../core/prices.ts'
import type { Usage } from '../core/prices.ts'
import { EFFORT_OUTPUT, REFERENCE, byDay, episodes, parseLog, rotate, savingLabel, statsHtml, statsText, summarize } from '../core/stats.ts'
import type { Accept, Decision, Entry, Turn } from '../core/stats.ts'

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

test("a routed subagent also saves the main chat's context its requests did not read", () => {
  const s = summarize([turn('haiku', 'opus', { agentId: 'a1', mainContext: 150_000, requests: 4 })], NOW).today
  const without = cost({ ...U, cacheRead: U.cacheRead + 600_000 }, 'opus')!
  close(s.withoutUsd, without)
  close(s.savedUsd, without - cost(U, 'haiku')!)
})

test('a routed subagent on the main model still saves the context it did not carry', () => {
  const s = summarize([turn('opus', 'opus', { agentId: 'a1', mainContext: 100_000, requests: 2 })], NOW).today
  close(s.savedUsd, cost({ ...U, cacheRead: U.cacheRead + 200_000 }, 'opus')! - cost(U, 'opus')!)
  expect(s.extraUsd).toBe(0)
})

test('a turn the router switched models on: the cache it rewrote counts against it', () => {
  const s = summarize([turn('opus', 'haiku', { switched: true })], NOW).today
  const without = cost({ ...U, cacheRead: U.cacheRead + U.cacheWrite, cacheWrite: 0 }, 'haiku')!
  close(s.withoutUsd, without)
  close(s.extraUsd, cost(U, 'opus')! - without)
})

test('a lower effort is priced apart, as an estimate: the output the person’s own level would have made', () => {
  const s = summarize([turn('opus', 'opus', { effort: 'low', baseEffort: 'high' })], NOW).today
  const without = cost({ ...U, output: U.output * (EFFORT_OUTPUT.high / EFFORT_OUTPUT.low) }, 'opus')!
  close(s.withoutUsd, without)
  close(s.effortUsd, without - cost(U, 'opus')!)
  expect(s.savedUsd).toBe(0)
  close(s.balanceUsd, s.effortUsd)
})

test('a model change and a higher effort on one turn: each part apart, the balance takes both', () => {
  const s = summarize([turn('haiku', 'opus', { effort: 'high', baseEffort: 'medium' })], NOW).today
  const sameEffort = cost(U, 'opus')!
  close(s.savedUsd, sameEffort - cost(U, 'haiku')!)
  close(s.effortUsd, cost({ ...U, output: U.output * (EFFORT_OUTPUT.medium / EFFORT_OUTPUT.high) }, 'opus')! - sameEffort)
  expect(s.effortUsd < 0).toBe(true)
  close(s.balanceUsd, s.savedUsd + s.effortUsd)
})

test('the balance is the cost without the router minus the work and the classifier, the stronger model included', () => {
  const s = summarize([turn('opus', 'sonnet'), turn('haiku', 'opus'), decision({ classifier: { model: 'haiku', usage: U, usd: 0.01 } })], NOW).today
  close(s.balanceUsd, s.withoutUsd - s.actualUsd - 0.01)
  close(s.balanceUsd, s.savedUsd - s.extraUsd - 0.01)
  close(s.balancePct, (s.balanceUsd / s.withoutUsd) * 100)
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

test('parseLog loads records with and without the duration and follows fields', () => {
  const old = turn('haiku', 'opus')
  const timed = { ...turn('haiku', 'opus'), durationMs: 5000 }
  const d = decision({ follows: 'corrects' })
  const out = parseLog([old, timed, d].map(r => JSON.stringify(r)).join('\n'))
  expect(out).toEqual([old, timed, d])
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

test('statsText shows the three periods, the balance and its parts apart', () => {
  const t = statsText(summarize([turn('haiku', 'opus'), turn('opus', 'sonnet'), decision({ classifier: { model: 'haiku', usage: U, usd: 0.001 } })], NOW))
  expect(t).toMatch(/Today\s+7 days\s+Total/)
  expect(t).toMatch(/Balance/)
  expect(t).toMatch(/Classifier/)
  expect(t).toMatch(/Effort \(estimate\)/)
  expect(t).toMatch(/Extra cost \(stronger model\)/)
  expect(t).toMatch(/estimate/i)
  expect(t).toMatch(/Effort lower \/ higher/)
})

test('savingLabel is short, empty when there is nothing to show', () => {
  expect(savingLabel(summarize([], NOW).today)).toBe('')
  const s = summarize([turn('haiku', 'opus', { usage: { input: 0, output: 1_000_000, cacheRead: 0, cacheWrite: 0 } })], NOW).today
  expect(savingLabel(s)).toBe(`saved $${s.balanceUsd.toFixed(2)} today`)
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
  expect(html).toMatch(/Balance/)
  expect(html).toMatch(/Extra cost \(stronger model\)/)
  expect(html).toMatch(/estimate/i)
  expect(html).toMatch(/prefers-color-scheme: dark/)
  expect(html).not.toMatch(/<script/)
})

test('the reference is one fixed model and effort, the same for every chat whatever its own pick', () => {
  expect(REFERENCE).toEqual({ model: 'opus', effort: 'medium' })
  // A Haiku-low chat escalated to Opus high: a loss against its own pick, priced fairly against the reference.
  const t = turn('opus', 'haiku', { effort: 'high', baseEffort: 'low' })
  const s = summarize([t], NOW).today
  expect(s.balanceUsd < 0).toBe(true)
  const ref = cost({ ...U, output: U.output * (EFFORT_OUTPUT.medium / EFFORT_OUTPUT.high) }, 'opus')!
  close(s.referenceUsd, ref)
  close(s.vsReferenceUsd, ref - cost(U, 'opus')!)
  // The same turn in an Opus-medium chat lands on the same reference number.
  const o = summarize([turn('opus', 'opus', { effort: 'high', baseEffort: 'medium' })], NOW).today
  close(o.referenceUsd, s.referenceUsd)
  close(o.vsReferenceUsd, s.vsReferenceUsd)
})

test('versus the reference: cheaper turns win, the classifier counts, the percent is of the reference', () => {
  const cls = { model: 'haiku', usage: U, usd: 0.01 }
  const s = summarize([turn('haiku', 'haiku', { effort: 'medium', baseEffort: 'medium' }), decision({ classifier: cls })], NOW).today
  close(s.referenceUsd, cost(U, 'opus')!)
  close(s.vsReferenceUsd, cost(U, 'opus')! - cost(U, 'haiku')! - 0.01)
  close(s.vsReferencePct, (s.vsReferenceUsd / s.referenceUsd) * 100)
})

test("a routed subagent's reference also reads the main chat's context it did not carry", () => {
  const s = summarize([turn('haiku', 'opus', { agentId: 'a', mainContext: 10_000, requests: 3 })], NOW).today
  close(s.referenceUsd, cost({ ...U, cacheRead: U.cacheRead + 30_000 }, 'opus')!)
})

test('cost per turn is the cost with the router over the priced turns, unknown turns left out', () => {
  const cls = { model: 'haiku', usage: U, usd: 0.02 }
  const s = summarize([turn('haiku', 'opus'), turn('opus', 'opus'), turn('opus', 'opus', { usage: undefined }), decision({ classifier: cls })], NOW).today
  expect(s.pricedTurns).toBe(2)
  close(s.perTurnUsd, (cost(U, 'haiku')! + cost(U, 'opus')! + 0.02) / 2)
  expect(summarize([], NOW).today.perTurnUsd).toBe(0)
  expect(summarize([], NOW).today.vsReferencePct).toBe(0)
})

test('statsText shows the reference line and the cost per turn', () => {
  const t = statsText(summarize([turn('haiku', 'opus')], NOW))
  expect(t).toMatch(/Vs\. always opus medium/)
  expect(t).toMatch(/Cost per turn/)
})

test('a routed prompt that comes again within three prompts counts as re-work', () => {
  const cheap = { model: 'haiku', effort: 'low' as const }
  const routed = (ts: number, key: string) => decision({ ts, key, from: { model: 'opus', effort: 'medium' }, to: cheap })
  const records: Entry[] = [
    routed(NOW - 5 * HOUR, 'why is it slow'),
    decision({ ts: NOW - 4 * HOUR, key: 'thanks', from: { model: 'opus', effort: 'medium' }, to: { model: 'opus', effort: 'medium' } }),
    routed(NOW - 3 * HOUR, 'why is it slow'),
    routed(NOW - 2 * HOUR, 'fix the parser'),
    routed(NOW - HOUR, 'rename the field'),
  ]
  const total = summarize(records, NOW).total
  expect(total.routed).toBe(4)
  expect(total.rework).toBe(1)
  expect(Math.round(total.accuracyPct ?? NaN)).toBe(75)
})

test('accuracy is null when nothing was routed', () => {
  expect(summarize([decision({ key: 'hi' })], NOW).total.accuracyPct).toBe(null)
})

const MIN = 60_000
const cheap = { model: 'haiku', effort: 'low' as const }

test('episodes: each new prompt starts its own task, with the turns that answered it', () => {
  const eps = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'add a button', follows: 'new' }),
    turn('opus', 'opus', { ts: NOW - 58 * MIN }),
    decision({ ts: NOW - 50 * MIN, key: 'rename the screen', follows: 'new' }),
    turn('opus', 'opus', { ts: NOW - 49 * MIN }),
  ])
  expect(eps.length).toBe(2)
  expect(eps.map(e => [e.decisions.length, e.turns.length])).toEqual([[1, 1], [1, 1]])
  expect(eps[0]!.start).toBe(NOW - 60 * MIN)
  expect(eps[0]!.end).toBe(NOW - 58 * MIN)
})

test('episodes: a correction and the next step stay in the task, new work starts another', () => {
  const eps = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'fix the parser', follows: 'new', to: cheap }),
    turn('haiku', 'opus', { ts: NOW - 59 * MIN }),
    decision({ ts: NOW - 55 * MIN, key: 'still broken', follows: 'corrects' }),
    turn('haiku', 'opus', { ts: NOW - 54 * MIN }),
    decision({ ts: NOW - 50 * MIN, key: 'now run the tests', follows: 'continues' }),
    turn('haiku', 'opus', { ts: NOW - 49 * MIN }),
    decision({ ts: NOW - 40 * MIN, key: 'write the release notes', follows: 'new' }),
  ])
  expect(eps.length).toBe(2)
  expect(eps[0]!.decisions.map(d => d.key)).toEqual(['fix the parser', 'still broken', 'now run the tests'])
  expect(eps[0]!.turns.length).toBe(3)
  expect(eps[1]!.decisions.map(d => d.key)).toEqual(['write the release notes'])
})

test('episodes: the same prompt again after a switch to a stronger model is the same task', () => {
  const eps = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'why is it slow', follows: 'new', to: cheap }),
    turn('haiku', 'opus', { ts: NOW - 59 * MIN }),
    // The person moved the picker to Opus by hand and asked again; the classifier may read it as new.
    decision({ ts: NOW - 50 * MIN, key: 'why is it slow', follows: 'new', from: { model: 'opus', effort: 'high' } }),
    turn('opus', 'opus', { ts: NOW - 45 * MIN }),
  ])
  expect(eps.length).toBe(1)
  expect(eps[0]!.turns.map(t => t.model)).toEqual(['haiku', 'opus'])
})

test('episodes: 30 minutes of quiet end the task, a turn that runs long does not', () => {
  const at = (gap: number) => episodes([
    decision({ ts: NOW - 120 * MIN, key: 'refactor the store', follows: 'new' }),
    turn('opus', 'opus', { ts: NOW - 100 * MIN }),
    decision({ ts: NOW - 100 * MIN + gap * MIN, key: 'and the tests', follows: 'continues' }),
  ]).length
  expect(at(29)).toBe(1)
  expect(at(31)).toBe(2)
  // The turn ended 45 minutes after its prompt: the gap counts from the turn's end.
  expect(episodes([
    decision({ ts: NOW - 120 * MIN, key: 'migrate the db', follows: 'new' }),
    turn('opus', 'opus', { ts: NOW - 75 * MIN }),
    decision({ ts: NOW - 70 * MIN, key: 'go on', follows: 'continues' }),
  ]).length).toBe(1)
})

test('episodes: older records without follows count each prompt as its own task, unless it is the same text', () => {
  const eps = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'why is it slow' }),
    decision({ ts: NOW - 55 * MIN, key: 'thanks' }),
    decision({ ts: NOW - 50 * MIN, key: 'thanks' }),
    // Another chat at the same time is its own task.
    decision({ ts: NOW - 52 * MIN, chat: 'c2', key: 'thanks' }),
  ])
  // Oldest first by where each task started.
  expect(eps.map(e => [e.chat, e.decisions.length])).toEqual([['c1', 1], ['c1', 2], ['c2', 1]])
})

test('episodes: turns before the first prompt the router saw form a task with no prompt', () => {
  const eps = episodes([turn('opus', 'opus', { ts: NOW - 60 * MIN }), decision({ ts: NOW - 50 * MIN, key: 'next', follows: 'new' })])
  expect(eps.map(e => [e.decisions.length, e.turns.length])).toEqual([[0, 1], [1, 0]])
})
