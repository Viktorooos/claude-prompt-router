import { expect, test } from 'claude-code/testing'
import { cost } from '../core/prices.ts'
import type { Usage } from '../core/prices.ts'
import { FAILURE_WEIGHTS, MIN_TRIAL, measuredLabel, trial, trialText, withTranscripts, MIN_CONTROL, REFERENCE, ROUGH_BELOW, balance, balanceLabel, balanceText, balances, byDay, compareLabel, episodes, failureOf, placeTask, historyCompare, historyMix, parseLog, rotate, savingLabel, statsHtml, statsRows, statsText, summarize, timeText, minutes, wilson } from '../core/stats.ts'
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

test('a lower effort is not re-priced by a guess: only the trial measures what effort saves', () => {
  const s = summarize([turn('opus', 'opus', { effort: 'low', baseEffort: 'high' })], NOW).today
  close(s.withoutUsd, cost(U, 'opus')!)
  expect(s.savedUsd).toBe(0)
  close(s.balanceUsd, 0)
  expect('effortUsd' in s).toBe(false)
})

test('a model change and a higher effort on one turn: only the model is re-priced', () => {
  const s = summarize([turn('haiku', 'opus', { effort: 'high', baseEffort: 'medium' })], NOW).today
  close(s.savedUsd, cost(U, 'opus')! - cost(U, 'haiku')!)
  close(s.balanceUsd, s.savedUsd)
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
  expect(t).not.toMatch(/Effort \(estimate\)/)
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
  const ref = cost(U, 'opus')!
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

test('re-work also counts a correction, a switch up by hand and a cut-off answer, each by its weight', () => {
  const routed = (ts: number, key: string) => decision({ ts, key, from: { model: 'opus', effort: 'medium' }, to: cheap })
  const records: Entry[] = [
    // Corrected: the next prompt says the answer was wrong.
    routed(NOW - 10 * HOUR, 'fix the parser'),
    turn('haiku', 'opus', { ts: NOW - 10 * HOUR + MIN }),
    decision({ ts: NOW - 10 * HOUR + 2 * MIN, key: 'still broken', follows: 'corrects' }),
    // Switched: the answer to the next prompt ran after the person moved the picker up.
    routed(NOW - 8 * HOUR, 'why is it slow'),
    turn('haiku', 'opus', { ts: NOW - 8 * HOUR + MIN }),
    decision({ ts: NOW - 8 * HOUR + 2 * MIN, key: 'look again', follows: 'continues' }),
    turn('opus', 'opus', { ts: NOW - 8 * HOUR + 3 * MIN, manual: true }),
    // Interrupted: the answer was cut off (no usage).
    routed(NOW - 6 * HOUR, 'rename the field'),
    turn('haiku', 'opus', { ts: NOW - 6 * HOUR + MIN, usage: undefined }),
    // Fine: the next step goes on.
    routed(NOW - 4 * HOUR, 'add a test'),
    turn('haiku', 'opus', { ts: NOW - 4 * HOUR + MIN }),
    decision({ ts: NOW - 4 * HOUR + 2 * MIN, key: 'now commit', follows: 'continues' }),
  ]
  const total = summarize(records, NOW).total
  expect(total.routed).toBe(4)
  close(total.rework, FAILURE_WEIGHTS.corrected + FAILURE_WEIGHTS.switched + FAILURE_WEIGHTS.interrupted)
  close(total.accuracyPct, (1 - total.rework / 4) * 100)
})

test('re-work: a subagent cut off or a switch before the next prompt is not the routed answer failing', () => {
  const records: Entry[] = [
    decision({ ts: NOW - 2 * HOUR, key: 'audit deps', to: cheap }),
    turn('haiku', 'opus', { ts: NOW - 2 * HOUR + MIN, agentId: 'a1', usage: undefined }),
    turn('haiku', 'opus', { ts: NOW - 2 * HOUR + 2 * MIN, manual: true }),
  ]
  expect(summarize(records, NOW).total.rework).toBe(0)
})

test('failureOf: the strongest sign in the task wins, with every reason listed', () => {
  const eps = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'fix the parser', follows: 'new', to: cheap }),
    turn('haiku', 'opus', { ts: NOW - 59 * MIN, usage: undefined }),
    decision({ ts: NOW - 55 * MIN, key: 'still broken', follows: 'corrects' }),
    turn('opus', 'opus', { ts: NOW - 50 * MIN, manual: true }),
    decision({ ts: NOW - 45 * MIN, key: 'fix the parser', follows: 'corrects' }),
  ])
  expect(eps.length).toBe(1)
  const f = failureOf(eps[0]!)
  expect(f.reasons.sort()).toEqual(['corrected', 'interrupted', 'repeated', 'switched'])
  expect(f.weight).toBe(1)
})

test('failureOf: a task that went on without trouble has no failure; a lone correction weighs less than a repeat', () => {
  const [ok] = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'add a button', follows: 'new', to: cheap }),
    turn('haiku', 'opus', { ts: NOW - 59 * MIN }),
    decision({ ts: NOW - 55 * MIN, key: 'and a test', follows: 'continues' }),
    turn('opus', 'opus', { ts: NOW - 54 * MIN }),
  ])
  expect(failureOf(ok!)).toEqual({ weight: 0, reasons: [] })
  const [fixed] = episodes([
    decision({ ts: NOW - 60 * MIN, key: 'add a button', follows: 'new', to: cheap }),
    turn('haiku', 'opus', { ts: NOW - 59 * MIN }),
    decision({ ts: NOW - 55 * MIN, key: 'the button is not visible', follows: 'corrects' }),
  ])
  expect(failureOf(fixed!)).toEqual({ weight: FAILURE_WEIGHTS.corrected, reasons: ['corrected'] })
  expect(FAILURE_WEIGHTS.corrected).toBeLessThan(FAILURE_WEIGHTS.repeated)
  // A switch up before the task's first answer is no sign against the task.
  const [first] = episodes([turn('opus', 'opus', { ts: NOW - 59 * MIN, manual: true }), decision({ ts: NOW - 58 * MIN, key: 'x', follows: 'continues' })])
  expect(failureOf(first!).reasons).toEqual([])
})

test('episodes: turns before the first prompt the router saw form a task with no prompt', () => {
  const eps = episodes([turn('opus', 'opus', { ts: NOW - 60 * MIN }), decision({ ts: NOW - 50 * MIN, key: 'next', follows: 'new' })])
  expect(eps.map(e => [e.decisions.length, e.turns.length])).toEqual([[0, 1], [1, 0]])
})

// Balance fixtures: one task per chat, so tasks never merge. Each prompt's classifier costs $0.01 and 1 s.
const CLS = { model: 'haiku', usage: { input: 0, output: 0 }, usd: 0.01, ms: 1000 }
const SEC = 1000
function task(chat: string, d: Partial<Decision>, turns: Partial<Turn>[], later: { d: Partial<Decision>; turns: Partial<Turn>[] }[] = []): Entry[] {
  const t0 = NOW - DAY
  const out: Entry[] = [decision({ chat, ts: t0, key: `${chat} first`, follows: 'new', classifier: CLS, ...d })]
  turns.forEach((t, i) => out.push(turn('haiku', 'opus', { chat, ts: t0 + 1 + i, ...t })))
  later.forEach((l, j) => {
    const ts = t0 + 100 * (j + 1)
    out.push(decision({ chat, ts, key: `${chat} later ${j}`, classifier: CLS, ...l.d }))
    l.turns.forEach((t, i) => out.push(turn('haiku', 'opus', { chat, ts: ts + 1 + i, ...t })))
  })
  return out
}
const CONTROL = (n: number) => Array.from({ length: n }, (_, i) =>
  task(`k${i}`, { where: 'keep', holdout: true, wanted: { model: 'haiku', effort: 'low' } }, [{ model: 'opus', usd: i + 1, durationMs: (i + 1) * 60 * SEC }])).flat()

test('balance: routed tasks against the control medians of their class, with quartiles, parts and accuracy', () => {
  const down = { to: { model: 'haiku', effort: 'low' as const } }
  const records = [
    ...CONTROL(5), // control $1…$5 and 1…5 min: median $3 / 3 min, quartiles $2–$4 / 2–4 min
    ...task('a', down, [{ usd: 1, durationMs: 60 * SEC }]),
    ...task('b', down, [{ usd: 1, durationMs: 60 * SEC }], [{ d: { follows: 'corrects' }, turns: [{ usd: 0.5, durationMs: 30 * SEC }] }]),
    ...task('c', { from: { model: 'sonnet', effort: 'medium' }, to: { model: 'opus', effort: 'medium' } }, [{ model: 'opus', baseline: 'sonnet' }]),
  ]
  const b = balance(records)
  expect([b.routed, b.control, b.measured, b.estimated]).toEqual([3, 5, 2, 1])
  const esc = cost(U, 'sonnet')! - cost(U, 'opus')!
  // a: 3 − 1 = 2. b: 3 − (1.5 − 0.7 × 0.5) = 1.85, its correction 0.35 is re-work. c (no control for
  // opus): the re-pricing, sonnet − opus. Nine prompts' classifier: 0.09.
  close(b.parts.cheaper, 3.85)
  close(b.parts.rework, -0.35)
  close(b.parts.escalation, esc)
  close(b.parts.classifier, -0.09)
  close(b.usd.value, 3.41 + esc)
  close(b.usd.low, (2 - 1) + (2 - 1.5) + esc - 0.09)
  close(b.usd.high, (4 - 1) + (4 - 1.5) + esc - 0.09)
  // Minutes: a 3 − 1, b 3 − 1.5, c no control time; nine classifier seconds.
  close(b.minutes.value, 2 + 1.5 - 0.15)
  close(b.minutes.low, 1 + 0.5 - 0.15)
  close(b.minutes.high, 3 + 2.5 - 0.15)
  close(b.accuracy!.pct, (1 - 0.7 / 3) * 100)
  const w = wilson(3 - 0.7, 3)
  close(b.accuracy!.low, w.low * 100)
  close(b.accuracy!.high, w.high * 100)
  const haiku = b.byModel.find(r => r.model === 'haiku')!
  expect([haiku.tasks, haiku.control]).toEqual([2, 5])
  close(haiku.usdPerTask, (1.01 + 1.52) / 2)
  close(haiku.reworkPct, 35)
  close(haiku.minutesPerTask, (61 + 92) / 2 / 60)
  const opus = b.byModel.find(r => r.model === 'opus')!
  close(opus.usdPerTask, cost(U, 'opus')! + 0.01)
  expect(opus.minutesPerTask).toBeNull()
})

test('balance: control tasks count only for the class the router wanted: a subagent, or a move up, is not a cheaper here', () => {
  const sub = Array.from({ length: MIN_CONTROL }, (_, i) =>
    task(`ks${i}`, { where: 'keep', holdout: true, wanted: { model: 'haiku', effort: 'low' }, wantedWhere: 'subagent' }, [{ model: 'opus', usd: 50 }])).flat()
  const up = Array.from({ length: MIN_CONTROL }, (_, i) =>
    task(`ku${i}`, { where: 'keep', holdout: true, from: { model: 'haiku', effort: 'low' }, wanted: { model: 'opus', effort: 'high' } }, [{ model: 'haiku', usd: 50 }])).flat()
  const hereHaiku = task('r1', { trial: 'router', to: { model: 'haiku', effort: 'low' } }, [{ usd: 1 }])
  const fableToOpus = task('r2', { trial: 'router', from: { model: 'fable', effort: 'medium' }, to: { model: 'opus', effort: 'medium' } }, [{ model: 'opus', usd: 1 }])
  const b = balance([...sub, ...up, ...hereHaiku, ...fableToOpus])
  expect(b.control).toBe(2 * MIN_CONTROL)
  expect([b.measured, b.estimated]).toEqual([0, 2])
  // A subagent to Haiku is measured against the control tasks that wanted that subagent.
  const subRouted = task('r3', { trial: 'router', where: 'subagent', to: { model: 'haiku', effort: 'low' } }, [{ usd: 1 }])
  expect(balance([...sub, ...subRouted]).measured).toBe(1)
})

test('balance: fewer control tasks than MIN_CONTROL fall back to the re-pricing, with no time saved', () => {
  const records = [...CONTROL(MIN_CONTROL - 1), ...task('a', { to: { model: 'haiku', effort: 'low' } }, [{ usd: 1, durationMs: 60 * SEC }])]
  const b = balance(records)
  expect([b.measured, b.estimated]).toEqual([0, 1])
  // The re-pricing: the turn's own price plus the list-price gap to the baseline.
  const without = 1 + cost(U, 'opus')! - cost(U, 'haiku')!
  close(b.usd.value, without - 1 - 0.05)
  close(b.usd.low, b.usd.value)
  close(b.usd.high, b.usd.value)
  close(b.minutes.value, -5 / 60)
})

test('balance: nothing routed has no accuracy; prompts the router left alone cost only the classifier', () => {
  const b = balance(task('a', {}, [{ usd: 1 }]))
  expect([b.routed, b.control]).toEqual([0, 0])
  expect(b.accuracy).toBeNull()
  close(b.usd.value, -0.01)
})

test('wilson: the 95 % interval of a share', () => {
  const w = wilson(10, 10)
  expect(w.high).toBe(1)
  close(Math.round(w.low * 1e4) / 1e4, 0.7225)
  expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
})

test('minutes and timeText: plain words for time, saved or lost', () => {
  expect([minutes(0.4), minutes(45), minutes(60), minutes(130)]).toEqual(['0 min', '45 min', '1 h', '2 h 10 min'])
  expect([timeText(130), timeText(-3), timeText(0.2)]).toEqual(['2 h 10 min saved', '3 min lost', 'no time'])
})

test('balanceLabel: money, then time once measured; "~" while rough', () => {
  const down = { to: { model: 'haiku', effort: 'low' as const } }
  const routed = (n: number) => Array.from({ length: n }, (_, i) => task(`r${i}`, down, [{ usd: 1, durationMs: 60 * SEC }])).flat()
  expect(balanceLabel(balance([]))).toBe('')
  // One routed task against the control: $3 − $1, less six prompts' classifier ($0.06); 3 − 1 min, less 6 s.
  const few = balance([...CONTROL(5), ...routed(1)])
  expect(balanceLabel(few)).toBe('~+$1.94 · 2 min saved')
  const many = balance([...CONTROL(5), ...routed(ROUGH_BELOW)])
  expect(balanceLabel(many).startsWith('+$')).toBe(true)
  // No control: no time, and rough.
  expect(balanceLabel(balance(routed(1)))).toMatch(/^~[+−]\$\d+\.\d\d$/)
})

test('balances: today, 7 days and total count tasks by when they started; the control medians use all', () => {
  const old = task('old', { ts: NOW - 10 * DAY, to: { model: 'haiku', effort: 'low' } }, [{ ts: NOW - 10 * DAY + 1, usd: 1 }])
  const b = balances([...CONTROL(5), ...old], NOW)
  expect([b.today.routed, b.week.routed, b.total.routed]).toEqual([0, 0, 1])
  expect(b.total.measured).toBe(1)
})

test('balanceText and statsText: the per-task section under the token table', () => {
  const records = [...CONTROL(5), ...task('a', { to: { model: 'haiku', effort: 'low' } }, [{ usd: 1, durationMs: 60 * SEC }])]
  const b = balance(records)
  const t = balanceText(b)
  expect(t).toMatch(/^Per task, against the control group \(total\)\nMoney      \+\$1\.94 \(\+\$0\.94 to \+\$2\.94\)\nTime       2 min saved \(1 min saved to 3 min saved\)/)
  expect(t).toMatch(/  Cheaper picks  \+\$2\.00/)
  expect(t).toMatch(/Accuracy   100 % \(95 %: 21–100 %\)/)
  expect(t).toMatch(/haiku  1 +5 +\$1\.01/)
  const all = statsText(summarize(records, NOW), null, b)
  expect(all).toContain(t)
  expect(statsText(summarize(records, NOW))).not.toMatch(/Per task/)
  expect(statsHtml(summarize(records, NOW), [], null, b)).toMatch(/<h2>Per task, against the control group<\/h2>/)
})

test('balance: an older routed task without turn times saves no time, even where control times exist', () => {
  const b = balance([...CONTROL(5), ...task('old', { to: { model: 'haiku', effort: 'low' } }, [{ usd: 1 }])])
  expect(b.measured).toBe(1)
  expect(b.timed).toBe(0)
  // Only the six prompts' classifier seconds.
  close(b.minutes.value, -0.1)
  expect(b.byModel.find(r => r.model === 'haiku')!.minutesPerTask).toBeNull()
})

test('balance: a subagent on a stronger model is an escalation, not a cheaper pick', () => {
  const asked = decision({ where: 'subagent', from: { model: 'haiku', effort: 'low' }, to: { model: 'opus', effort: 'medium' }, outcome: 'asked' })
  const accept: Accept = { kind: 'accept', ts: asked.ts + 1, platform: 'claude-code', chat: 'c1', decision: asked.ts }
  const sub = turn('claude-opus-5-5', 'claude-haiku-5-5', { ts: asked.ts + 2, agentId: 'a1' })
  const b = balance([asked, accept, sub])
  const extra = cost(U, 'claude-opus-5-5')! - cost(U, 'claude-haiku-5-5')!
  close(b.parts.cheaper, 0)
  close(b.parts.escalation, -extra)
})

// compareWith: the same tokens priced on one model and effort for every turn, from the log alone.
test('compareWith reprices old turns on the chosen model and effort, whatever baseline they logged', () => {
  const t = turn('opus', 'haiku', { effort: 'high', baseEffort: 'low' })
  const first = summarize([t], NOW).today
  expect(first.balanceUsd < 0).toBe(true)
  const s = summarize([t], NOW, { model: 'opus', effort: 'medium' }).today
  // Same model: nothing to re-price (effort is measured by the trial, not guessed).
  close(s.withoutUsd, cost(U, 'opus')!)
  close(s.balanceUsd, 0)
  expect(s.savedUsd).toBe(0)
  expect(s.extraUsd).toBe(0)
  // Against the reference it matches the fixed yardstick.
  close(s.balanceUsd, s.vsReferenceUsd)
})

test('compareWith on a cheaper model: a turn on a stronger one is extra cost; a turn with no effort keeps its output', () => {
  const sub = turn('opus', 'opus', { agentId: 'a1' })
  const s = summarize([sub], NOW, { model: 'sonnet', effort: 'high' }).today
  close(s.withoutUsd, cost(U, 'sonnet')!)
  close(s.extraUsd, cost(U, 'opus')! - cost(U, 'sonnet')!)
})

test('compareWith first is the old behaviour; byDay takes the same choice', () => {
  const records = [turn('haiku', 'opus'), turn('opus', 'sonnet')]
  expect(summarize(records, NOW, null)).toEqual(summarize(records, NOW))
  const c = { model: 'fable', effort: 'medium' } as const
  const d = byDay(records, NOW, 1, c).at(-1)!
  close(d.withoutUsd, summarize(records, NOW, c).today.withoutUsd)
  close(d.withoutUsd, 2 * cost(U, 'fable')!)
})

test('the rows name the comparison and drop the reference row when it is the same yardstick', () => {
  expect(compareLabel(null)).toBe("the chat's first model")
  expect(compareLabel({ model: 'opus', effort: 'medium' })).toBe('Opus medium')
  expect(compareLabel({ model: 'claude-sonnet-5-5', effort: 'xhigh' })).toBe('Sonnet extra high')
  const r = summarize([turn('haiku', 'opus')], NOW)
  const labels = (c: Parameters<typeof statsRows>[1]) => statsRows(r, c).map(x => x.label)
  expect(labels(null)).toContain('Cost without router')
  expect(labels(null).some(l => l.startsWith('Vs. always'))).toBe(true)
  expect(labels({ model: 'opus', effort: 'medium' })).toContain('Cost on Opus medium')
  expect(labels({ model: 'opus', effort: 'medium' }).some(l => l.startsWith('Vs. always'))).toBe(false)
  expect(labels({ model: 'sonnet', effort: 'medium' }).some(l => l.startsWith('Vs. always'))).toBe(true)
  expect(statsText(r, { model: 'opus', effort: 'medium' })).toMatch(/Compared with Opus medium for every turn/)
  expect(statsText(r)).toMatch(/compareWith: first/)
})

test('balance: an escalation never uses the control group, it falls back to the re-pricing with no time saved', () => {
  // Control: opus chats the router wanted on haiku. The routed task went haiku low → haiku high, a step up.
  const up = { from: { model: 'haiku', effort: 'low' as const }, to: { model: 'haiku', effort: 'high' as const } }
  const records = [...CONTROL(MIN_CONTROL), ...task('a', up, [{ baseline: 'haiku', effort: 'high', baseEffort: 'low', durationMs: 60 * SEC }])]
  const b = balance(records)
  expect([b.routed, b.measured, b.estimated, b.timed]).toEqual([1, 0, 1, 0])
  // Same model, effort only: the re-pricing claims nothing either way.
  close(b.parts.escalation, 0)
  expect(b.parts.cheaper).toBe(0)
})

test('a turn with an unknown effort level gets no effort re-pricing instead of NaN', () => {
  const bad = (x: Partial<Turn>) => turn('haiku', 'opus', x as Partial<Turn>)
  const records = parseLog([
    bad({ effort: 'turbo' as Turn['effort'], baseEffort: 'medium' }),
    bad({ effort: 'medium', baseEffort: 'ultra' as Turn['effort'] }),
  ].map(t => JSON.stringify(t)).join('\n'))
  const s = summarize(records, NOW).today
  close(s.withoutUsd, 2 * cost(U, 'opus')!)
  close(s.referenceUsd, 2 * cost(U, 'opus')!)
  expect(Number.isFinite(s.balanceUsd)).toBe(true)
  expect(Number.isFinite(s.vsReferenceUsd)).toBe(true)
})

test('balance: a cheaper model at a higher effort is partly an escalation, so it is not measured against the control group either', () => {
  const mixed = { from: { model: 'opus', effort: 'medium' as const }, to: { model: 'haiku', effort: 'high' as const } }
  const b = balance([...CONTROL(MIN_CONTROL), ...task('a', mixed, [{ effort: 'high', baseEffort: 'medium', durationMs: 60 * SEC }])])
  expect([b.routed, b.measured, b.estimated, b.timed]).toEqual([1, 0, 1, 0])
})

test('history: tokens per model and effort become shares, biggest first, medium when the transcript had none', () => {
  const mix = historyMix({ version: 1, before: 0, computedAt: 0, tokens: {
    'claude-opus-5-5|high': 600, 'claude-opus-5|high': 100, 'claude-sonnet-5-5|': 250, 'claude-haiku-5-5|medium': 50,
    '<synthetic>|': 999, 'gpt-5|high': 999, 'claude-fable-5-1|low': 1,
  } })!
  expect(mix.map(p => `${p.model} ${p.effort}`)).toEqual(['opus high', 'sonnet medium', 'haiku medium'])
  close(mix[0]!.share, 700 / 1000)
  close(mix[1]!.share, 250 / 1000)
  close(mix.reduce((a, p) => a + p.share, 0), 1)
  expect(compareLabel({ mix })).toBe('your history (70 % Opus high, 25 % Sonnet medium, 5 % Haiku medium)')
})

test('history: no file yet is Opus medium while counting, no sessions before the router is Opus medium too', () => {
  expect(historyMix(null)).toBe(null)
  expect(historyCompare(null, true)).toEqual({ ...REFERENCE, fallback: 'pending' })
  expect(historyCompare(null, false)).toEqual({ ...REFERENCE, fallback: 'none' })
  expect(historyCompare({ version: 1, before: 0, computedAt: 0, tokens: {} }, true)).toEqual({ ...REFERENCE, fallback: 'none' })
  expect(statsText(summarize([], NOW), historyCompare(null, true))).toMatch(/still being counted: compared with Opus medium/)
  expect(statsText(summarize([], NOW), historyCompare(null, false))).toMatch(/no sessions from before the router/)
})

test('history: a turn costs the share-weighted average of its price on each part', () => {
  const t = [turn('haiku', 'haiku', { effort: 'medium', baseEffort: 'medium' })]
  const opus = summarize(t, NOW, { model: 'opus', effort: 'high' }).today
  const sonnet = summarize(t, NOW, { model: 'sonnet', effort: 'medium' }).today
  const mix = summarize(t, NOW, { mix: [{ model: 'opus', effort: 'high', share: 0.7 }, { model: 'sonnet', effort: 'medium', share: 0.3 }] }).today
  for (const k of ['withoutUsd', 'savedUsd', 'extraUsd', 'balanceUsd'] as const) close(mix[k], 0.7 * opus[k] + 0.3 * sonnet[k])
  close(mix.actualUsd, opus.actualUsd)
  expect(mix.pricedTurns).toBe(1)
  expect(statsRows(summarize(t, NOW), { mix: [{ model: 'opus', effort: 'high', share: 1 }] }).some(r => r.label === 'Cost on your history')).toBe(true)
})

test('a declined offer counts as declined and never as taken', () => {
  const d = decision({ where: 'session', outcome: 'asked', to: { model: 'sonnet', effort: 'medium' } })
  const no: Accept = { kind: 'accept', ts: d.ts + 1, platform: 'claude-code', chat: 'c1', decision: d.ts, outcome: 'declined' }
  const s = summarize([d, no], NOW).today
  expect(s.declined).toBe(1)
  expect(s.sessions).toBe(0)
})

test('a prompt that redoes the last answer marks its task as failed (corrected), with no classifier', () => {
  const [e] = episodes([decision({ ts: NOW - HOUR, key: 'a' }), decision({ ts: NOW - HOUR + 1, key: 'b', follows: 'continues', redo: true })])
  expect(failureOf(e!).reasons).toEqual(['corrected'])
})

test('a spawn record is kept by parseLog and is no turn of any task', () => {
  const log = [JSON.stringify(decision({ key: 'a' })), JSON.stringify({ kind: 'spawn', ts: NOW - HOUR + 5, platform: 'claude-code', chat: 'c1', key: 'build it' })].join('\n')
  const rs = parseLog(log)
  expect(rs.map(r => r.kind)).toEqual(['decision', 'spawn'])
  const [e] = episodes(rs)
  expect(e!.turns).toEqual([])
  expect(summarize(rs, NOW).today.prompts).toBe(1)
})

// Trial fixtures: one task per chat. `down` = the router (or, in control, its wish) goes to Haiku low.
const DOWN = { to: { model: 'haiku', effort: 'low' as const } }
const routerTask = (chat: string, usd: number[], d: Partial<Decision> = {}) => task(chat, { trial: 'router', ...DOWN, ...d }, usd.map(u => ({ usd: u })))
const controlTask = (chat: string, usd: number[], d: Partial<Decision> = {}) =>
  task(chat, { trial: 'control', where: 'keep', holdout: true, wanted: DOWN.to, ...d }, usd.map(u => ({ model: 'opus', usd: u })))

test('trial: below MIN_TRIAL tasks in either group there is no saving, only the means', () => {
  expect(MIN_TRIAL).toBe(5)
  const records = [...routerTask('r0', [1]), ...controlTask('k0', [2]), ...controlTask('k1', [4])]
  const all = trial(records)[0]!
  expect(all.kind).toBe('all')
  expect([all.router.tasks, all.control.tasks]).toEqual([1, 2])
  // The router task pays its classifier ($0.01); a control task does not (no router, no classifier).
  close(all.router.usd, 1.01)
  close(all.control.usd, 3)
  expect(all.saving).toBe(null)
})

test('trial: the saving is control mean − router mean with a Welch 95 % interval', () => {
  const records = [
    ...[1, 2, 3, 4, 5].map((u, i) => routerTask(`r${i}`, [u - 0.01])).flat(),
    ...[2, 4, 6, 8, 10].map((u, i) => controlTask(`k${i}`, [u])).flat(),
  ]
  const all = trial(records)[0]!
  close(all.router.usd, 3)
  close(all.control.usd, 6)
  // Sample variances 2.5 and 10: se = √(2.5/5 + 10/5) = √2.5.
  const half = 1.96 * Math.sqrt(2.5)
  close(all.saving!.value, 3)
  close(all.saving!.low, 3 - half)
  close(all.saving!.high, 3 + half)
})

test('trial: a task costs all its prompts, subagents and the session it started; that session is not a task of its own', () => {
  const r = task('r', { trial: 'router', where: 'session', to: { model: 'opus', effort: 'medium' } }, [{ usd: 1 }, { usd: 0.5, agentId: 'a1' }],
    [{ d: { follows: 'continues' }, turns: [{ usd: 2 }] }])
  const t0 = NOW - DAY
  // The new session's prompt may end differently (a note added): the first 60 characters decide.
  const words = 'do the thing in the settings screen and keep the old layout as it is'
  const spawn: Entry = { kind: 'spawn', ts: t0 + 50, platform: 'claude-code', chat: 'r', key: words }
  const child = task('s', { ts: t0 + 60, key: `${words}, context: the plan`, where: 'here', to: { model: 'opus', effort: 'medium' } }, [{ ts: t0 + 70, usd: 3 }])
  // A session with the same words but started much later is its own task.
  const late = task('s2', { ts: t0 + 60 * 60_000, key: 'do the thing', trial: 'router', ...DOWN }, [{ ts: t0 + 60 * 60_000 + 1, usd: 7 }])
  const rows = trial([...r, spawn, ...child, ...late])
  const session = rows.find(x => x.kind === 'session')!
  expect(session.router.tasks).toBe(1)
  // 1 + 0.5 + 2 + 3, and three classifier calls of $0.01.
  close(session.router.usd, 6.53)
  expect(rows[0]!.router.tasks).toBe(2)
})

test('trial: a declined offer stays in the router group, and tasks outside the trial do not count', () => {
  const declined: Entry = { kind: 'accept', ts: NOW - DAY + 5, platform: 'claude-code', chat: 'r', decision: NOW - DAY, outcome: 'declined' }
  const records = [
    ...task('r', { trial: 'router', where: 'subagent', outcome: 'asked', to: { model: 'haiku', effort: 'low' } }, [{ usd: 2 }]), declined,
    ...task('x', DOWN, [{ usd: 100 }]),
  ]
  const rows = trial(records)
  expect(rows[0]!.router.tasks).toBe(1)
  expect(rows.find(x => x.kind === 'subagent')!.router.tasks).toBe(1)
})

test('trial: kinds come from where the router sent (or wanted to send) the task; an unknown effort counts as medium', () => {
  const records = [
    ...routerTask('down', [1]),
    ...routerTask('up', [1], { from: { model: 'haiku', effort: 'low' }, to: { model: 'opus', effort: 'high' } }),
    // No effort in the chat: medium → low is cheaper.
    ...routerTask('noEffort', [1], { from: { model: 'opus' }, to: { model: 'opus', effort: 'low' } }),
    ...controlTask('sub', [1], { wantedWhere: 'subagent' }),
    // An older control record without `trial` still counts as control.
    ...task('old', { where: 'keep', holdout: true, wanted: DOWN.to }, [{ usd: 1 }]),
  ]
  const rows = trial(records)
  const n = (kind: string) => { const r = rows.find(x => x.kind === kind); return r ? [r.router.tasks, r.control.tasks] : null }
  expect(n('all')).toEqual([3, 2])
  expect(n('cheaper')).toEqual([2, 1])
  expect(n('dearer')).toEqual([1, 0])
  expect(n('subagent')).toEqual([0, 1])
  expect(n('session')).toBe(null)
})

test('trial: a router task that kept the setting (or moved neither way) is in no cheaper/dearer row, only in all', () => {
  const records = [
    ...routerTask('kept', [1], { where: 'keep', to: { model: 'opus', effort: 'medium' } }),
    ...routerTask('same', [1], { outcome: 'asked', to: { model: 'opus', effort: 'medium' } }),
    // No effort in the chat and none in the pick: the same setting.
    ...routerTask('blank', [1], { where: 'keep', from: { model: 'opus', effort: '' }, to: { model: 'opus', effort: '' } }),
  ]
  const rows = trial(records)
  expect(rows.find(x => x.kind === 'all')!.router.tasks).toBe(3)
  expect(rows.find(x => x.kind === 'cheaper')).toBeUndefined()
  expect(rows.find(x => x.kind === 'dearer')).toBeUndefined()
})

test('trial: Codex and OpenCode model ids rank by the tier the platform maps them to', () => {
  const codex = { haiku: 'gpt-6-luna', sonnet: 'gpt-6.1-terra', opus: 'gpt-6.1-sol', fable: 'gpt-6-astra' }
  const records = [
    ...routerTask('down', [1], { platform: 'codex', from: { model: 'gpt-6.1-sol', effort: 'medium' }, to: { model: 'gpt-6-luna', effort: 'medium' } }),
    ...routerTask('up', [1], { platform: 'codex', from: { model: 'gpt-6-luna', effort: 'medium' }, to: { model: 'gpt-6-astra', effort: 'medium' } }),
    ...controlTask('kdown', [1], { platform: 'codex', from: { model: 'gpt-6-astra', effort: 'low' }, wanted: { model: 'gpt-6.1-terra', effort: 'low' } }),
  ]
  const rows = trial(records, -Infinity, codex)
  const n = (kind: string) => { const r = rows.find(x => x.kind === kind); return r ? [r.router.tasks, r.control.tasks] : null }
  expect(n('cheaper')).toEqual([1, 1])
  expect(n('dearer')).toEqual([1, 0])
})

test('trial: a session started from a started session still counts for the task at the root', () => {
  const t0 = NOW - DAY
  const a = task('a', { trial: 'router', where: 'session', to: { model: 'opus', effort: 'medium' } }, [{ usd: 1 }])
  const toB = 'build the export screen with the csv writer and the column picker'
  const toC = 'write the tests for the csv writer of the export screen in the app'
  const spawnB: Entry = { kind: 'spawn', ts: t0 + 50, platform: 'claude-code', chat: 'a', key: toB }
  const b = task('b', { ts: t0 + 60, key: toB, where: 'here', to: { model: 'opus', effort: 'medium' } }, [{ ts: t0 + 70, usd: 2 }])
  const spawnC: Entry = { kind: 'spawn', ts: t0 + 80, platform: 'claude-code', chat: 'b', key: toC }
  const c = task('c', { ts: t0 + 90, key: toC, where: 'here', to: { model: 'opus', effort: 'medium' } }, [{ ts: t0 + 95, usd: 4 }])
  const rows = trial([...a, spawnB, ...b, spawnC, ...c])
  const all = rows.find(x => x.kind === 'all')!
  expect(all.router.tasks).toBe(1)
  // 1 + 2 + 4, and three classifier calls of $0.01.
  close(all.router.usd, 7.03)
})

test('trial: `since` keeps the tasks that started then or later', () => {
  const records = [...routerTask('r', [1]), ...controlTask('k', [1])]
  expect(trial(records, NOW).length).toBe(1)
  expect(trial(records, NOW)[0]!.router.tasks + trial(records, NOW)[0]!.control.tasks).toBe(0)
})

// Transcript fixtures: chat c1 is transcript s1; requests of 1 000 output tokens each on Opus.
const REQ = (ts: number, agent?: string) => ({ ts, model: 'claude-opus-4-1', ...(agent ? { agent } : {}), usage: { input: 0, output: 1_000, cacheRead: 0, cacheWrite: 0 } })

test('withTranscripts: a cut-off turn gets the tokens of the main-chat requests since the turn before; it still counts as cut off', () => {
  const t0 = NOW - DAY
  const records: Entry[] = [
    decision({ ts: t0, session: 's1', key: 'a' }),
    turn('opus', 'opus', { ts: t0 + 10 }),
    decision({ ts: t0 + 20, key: 'b', follows: 'continues' }),
    turn('opus', 'opus', { ts: t0 + 30, usage: undefined }),
  ]
  const scans = [{ session: 's1', requests: [REQ(t0 + 5), REQ(t0 + 22), REQ(t0 + 25), REQ(t0 + 26, 'agent-a1'), REQ(t0 + 40)] }]
  const out = withTranscripts(records, scans)
  const cut = out.filter((r): r is Turn => r.kind === 'turn')[1]!
  // Two main requests in (t0 + 10, t0 + 30]; the subagent's and the later one are not this turn's.
  expect(cut.usage).toEqual({ input: 0, output: 2_000, cacheRead: 0, cacheWrite: 0 })
  expect(cut.transcript).toBe(true)
  // The first turn had its own usage: untouched. The input is not changed.
  expect(out[1]).toBe(records[1])
  expect((records[3] as Turn).usage).toBe(undefined)
  expect(failureOf(episodes(out)[0]!).reasons).toContain('interrupted')
  // Now priced: no turn with unknown tokens left.
  expect(summarize(out, NOW).total.unknownTurns).toBe(0)
  expect(summarize(records, NOW).total.unknownTurns).toBe(1)
})

test('withTranscripts: a chat with no transcript id or no scan stays as it is', () => {
  const records: Entry[] = [decision({ chat: 'c2' }), turn('opus', 'opus', { chat: 'c2', usage: undefined })]
  expect(withTranscripts(records, [{ session: 's1', requests: [REQ(NOW - HOUR)] }])).toEqual(records)
})

test('trialText: per kind the tasks and mean cost of each group, the saving with its interval, or too little data', () => {
  const records = [
    ...[1, 2, 3, 4, 5].map((u, i) => routerTask(`r${i}`, [u - 0.01])).flat(),
    ...[2, 4, 6, 8, 10].map((u, i) => controlTask(`k${i}`, [u])).flat(),
    ...controlTask('sub', [1], { wantedWhere: 'subagent' }),
  ]
  const t = trialText(trial(records))
  expect(t).toMatch(/Measured per task/)
  expect(t).toMatch(/All tasks\s+5 · \$3\.00\s+6 · \$5\.17\s+/)
  expect(t).toMatch(/Cheaper here\s+5 · \$3\.00\s+5 · \$6\.00\s+\+\$3\.00 \(−\$0\.10 to \+\$6\.10\)/)
  expect(t).toMatch(/Subagent\s+0 · –\s+1 · \$1\.00\s+too little data/)
  expect(trialText(trial([]))).toMatch(/no tasks in the trial yet/)
  const html = statsHtml(summarize(records, NOW), [], null, undefined, trial(records))
  expect(html).toMatch(/Measured per task/)
  expect(html).toMatch(/Cheaper here/)
  expect(statsText(summarize(records, NOW), null, undefined, trial(records))).toMatch(/All tasks/)
})

test('measuredLabel: the pane\'s short line for the whole trial', () => {
  const enough = [...[1, 2, 3, 4, 5].map((u, i) => routerTask(`r${i}`, [u - 0.01])).flat(), ...[2, 4, 6, 8, 10].map((u, i) => controlTask(`k${i}`, [u])).flat()]
  expect(measuredLabel(trial(enough)[0]!)).toBe('+$3.00 per task (−$0.10 to +$6.10)')
  expect(measuredLabel(trial(routerTask('r', [1]))[0]!)).toBe('1 router / 0 control tasks, too little data')
})

test('placeTask: the first prompt of a task draws the group once; later prompts of the task keep it', () => {
  let draws = 0
  const control = () => (draws++, true)
  const a = placeTask(null, { ts: 0, key: 'fix the bug' }, { eligible: true, control })
  expect(a).toEqual({ task: { end: 0, keys: ['fix the bug'], control: true }, trial: 'control', quiet: true })
  // Goes on with it: no new draw, no trial mark, still quiet while the router wants to act.
  const b = placeTask(a.task, { ts: 60_000, key: 'still broken', follows: 'corrects' }, { eligible: true, control })
  expect(b).toEqual({ task: { end: 60_000, keys: ['fix the bug', 'still broken'], control: true }, quiet: true })
  // A later prompt the router would not change (or that is exempt) is not held back.
  expect(placeTask(b.task, { ts: 70_000, key: 'ok', follows: 'continues' }, { eligible: false, control }).quiet).toBe(false)
  expect(draws).toBe(1)
  // New work starts a new task: a router task when the draw says so.
  const c = placeTask(b.task, { ts: 80_000, key: 'add dark mode', follows: 'new' }, { eligible: true, control: () => false })
  expect(c).toEqual({ task: { end: 80_000, keys: ['add dark mode'], control: false }, trial: 'router', quiet: false })
  // A task that starts with nothing to change is outside the trial, with no draw.
  const d = placeTask(null, { ts: 0, key: 'ok' }, { eligible: false, control })
  expect(d).toEqual({ task: { end: 0, keys: ['ok'], control: false }, quiet: false })
  expect(draws).toBe(1)
  // Past 30 minutes the same chat starts over.
  expect(placeTask(a.task, { ts: 31 * 60_000, key: 'x', follows: 'continues' }, { eligible: true, control: () => false }).trial).toBe('router')
})
