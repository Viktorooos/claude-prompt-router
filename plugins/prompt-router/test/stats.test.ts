import { expect, test } from 'claude-code/testing'
import { cost } from '../core/prices.ts'
import { promptKey } from '../core/router.ts'
import type { Usage } from '../core/prices.ts'
import { FAILURE_WEIGHTS, MIN_PCT, glance, limitRate, withTranscripts, REFERENCE, ROUGH_BELOW, balance, balanceLabel, balanceText, balances, byDay, compareLabel, episodes, failureOf, historyCompare, historyMix, needsRotate, parseLog, Pending, rotate, savingLabel, statsHtml, statsRows, statsText, summarize, usd, wilson } from '../core/stats.ts'
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

test('a lower effort is not re-priced by a guess', () => {
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

test('needsRotate: only past the size cap or with a first line older than 90 days', () => {
  const fresh = JSON.stringify(turn('haiku', 'opus', { ts: NOW - DAY }))
  const old = JSON.stringify(turn('haiku', 'opus', { ts: NOW - 91 * DAY }))
  expect(needsRotate(fresh, 1000, NOW)).toBe(false)
  expect(needsRotate(fresh, 6_000_000, NOW)).toBe(true)
  expect(needsRotate(old, 1000, NOW)).toBe(true)
  expect(needsRotate('broken', 1000, NOW)).toBe(true)
  expect(needsRotate('', 0, NOW)).toBe(false)
})

// A store that rewrites the whole file, slowly: two writes at once lose one of them.
function slowFile() {
  const f = { text: '', writes: 0 }
  const write = async (batch: string[]) => {
    const old = f.text
    await new Promise(r => setTimeout(r, 5))
    f.text = old + batch.map(l => `${l}\n`).join('')
    f.writes++
  }
  return { f, write }
}

test('Pending: two flushes at once keep both records', async () => {
  const { f, write } = slowFile()
  const p = new Pending<string>()
  p.push('a')
  const one = p.flush(write)
  p.push('b')
  const two = p.flush(write)
  await Promise.all([one, two])
  expect(f.text).toBe('a\nb\n')
  expect(p.items).toEqual([])
})

test('Pending: a failed write keeps its records for the next flush', async () => {
  const p = new Pending<string>()
  p.push('a')
  let fail = true
  const got: string[][] = []
  const write = async (batch: string[]) => {
    if (fail) throw new Error('disk full')
    got.push(batch)
  }
  await expect(p.flush(write)).rejects.toThrow('disk full')
  expect(p.items).toEqual(['a'])
  fail = false
  p.push('b')
  await p.flush(write)
  expect(got).toEqual([['a', 'b']])
  expect(p.items).toEqual([])
})

test('Pending: past its cap the oldest records go', () => {
  const p = new Pending<number>(2)
  for (const n of [1, 2, 3]) p.push(n)
  expect(p.items).toEqual([2, 3])
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
test('balance: routed tasks priced by the token re-pricing, with parts and accuracy', () => {
  const down = { to: { model: 'haiku', effort: 'low' as const } }
  const records = [
    ...task('a', down, [{ usd: 1, durationMs: 60 * SEC }]),
    ...task('b', down, [{ usd: 1, durationMs: 60 * SEC }], [{ d: { follows: 'corrects' }, turns: [{ usd: 0.5, durationMs: 30 * SEC }] }]),
    ...task('c', { from: { model: 'sonnet', effort: 'medium' }, to: { model: 'opus', effort: 'medium' } }, [{ model: 'opus', baseline: 'sonnet' }]),
  ]
  const b = balance(records)
  expect(b.routed).toBe(3)
  // Each haiku turn would have cost the gap to Opus more. a: one turn. b: two turns, its correction
  // (0.7 × 0.5 = 0.35) is re-work. c: sonnet − opus, an escalation. Four prompts' classifier: 0.04.
  const gap = cost(U, 'opus')! - cost(U, 'haiku')!
  const esc = cost(U, 'sonnet')! - cost(U, 'opus')!
  close(b.parts.cheaper, 3 * gap + 0.35)
  close(b.parts.rework, -0.35)
  close(b.parts.escalation, esc)
  close(b.parts.classifier, -0.04)
  close(b.usd, 3 * gap + esc - 0.04)
  close(b.accuracy!.pct, (1 - 0.7 / 3) * 100)
  const w = wilson(3 - 0.7, 3)
  close(b.accuracy!.low, w.low * 100)
  close(b.accuracy!.high, w.high * 100)
  const haiku = b.byModel.find(r => r.model === 'haiku')!
  expect(haiku.tasks).toBe(2)
  close(haiku.usdPerTask, (1.01 + 1.52) / 2)
  close(haiku.reworkPct, 35)
  close(haiku.minutesPerTask, (61 + 92) / 2 / 60)
  const opus = b.byModel.find(r => r.model === 'opus')!
  close(opus.usdPerTask, cost(U, 'opus')! + 0.01)
  expect(opus.minutesPerTask).toBeNull()
})

test('balance: nothing routed has no accuracy; prompts the router left alone cost only the classifier', () => {
  const b = balance(task('a', {}, [{ usd: 1 }]))
  expect(b.routed).toBe(0)
  expect(b.accuracy).toBeNull()
  close(b.usd, -0.01)
})

test('wilson: the 95 % interval of a share', () => {
  const w = wilson(10, 10)
  expect(w.high).toBe(1)
  close(Math.round(w.low * 1e4) / 1e4, 0.7225)
  expect(wilson(0, 0)).toEqual({ low: 0, high: 1 })
})

test('balanceLabel: the money; "~" while it stands on few tasks', () => {
  const down = { to: { model: 'haiku', effort: 'low' as const } }
  const routed = (n: number) => Array.from({ length: n }, (_, i) => task(`r${i}`, down, [{ usd: 1, durationMs: 60 * SEC }])).flat()
  expect(balanceLabel(balance([]))).toBe('')
  // One routed task: the gap to Opus, less its classifier ($0.01).
  const gap = cost(U, 'opus')! - cost(U, 'haiku')!
  expect(balanceLabel(balance(routed(1)))).toBe(`~+$${(gap - 0.01).toFixed(2)}`)
  expect(balanceLabel(balance(routed(ROUGH_BELOW))).startsWith('+$')).toBe(true)
})

test('balances: today, 7 days and total count tasks by when they started', () => {
  const old = task('old', { ts: NOW - 10 * DAY, to: { model: 'haiku', effort: 'low' } }, [{ ts: NOW - 10 * DAY + 1, usd: 1 }])
  const b = balances(old, NOW)
  expect([b.today.routed, b.week.routed, b.total.routed]).toEqual([0, 0, 1])
})

test('balanceText and statsText: the per-task section under the token table', () => {
  const records = task('a', { to: { model: 'haiku', effort: 'low' } }, [{ usd: 1, durationMs: 60 * SEC }])
  const b = balance(records)
  const gap = cost(U, 'opus')! - cost(U, 'haiku')!
  const t = balanceText(b)
  expect(t.startsWith(`Per task (total, estimated)\nMoney      +$${(gap - 0.01).toFixed(2)}\n`)).toBe(true)
  expect(t).toContain(`  Cheaper picks  +$${gap.toFixed(2)}`)
  expect(t).toMatch(/Accuracy   100 % \(95 %: 21–100 %\)/)
  expect(t).toMatch(/1 routed task · few tasks, rough/)
  expect(t).toMatch(/haiku  1 +\$1\.01/)
  const all = statsText(summarize(records, NOW), null, b)
  expect(all).toContain(t)
  expect(statsText(summarize(records, NOW))).not.toMatch(/Per task/)
  expect(statsHtml(summarize(records, NOW), [], null, b)).toMatch(/<h2>Per task<\/h2>/)
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
  // Same model: nothing to re-price (effort is not re-priced by a guess).
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

test('balance: an effort-only step up is an escalation the re-pricing prices at nothing', () => {
  const up = { from: { model: 'haiku', effort: 'low' as const }, to: { model: 'haiku', effort: 'high' as const } }
  const b = balance(task('a', up, [{ baseline: 'haiku', effort: 'high', baseEffort: 'low', durationMs: 60 * SEC }]))
  expect(b.routed).toBe(1)
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

test('older records parse: a spawn line is skipped, a held-back prompt (holdout, wanted, trial) is a keep', () => {
  const held = { ...decision({ key: 'a', where: 'keep', classifier: { model: 'haiku', usage: { input: 0, output: 0 }, usd: 0.01 } }), holdout: true, wanted: { model: 'haiku', effort: 'low' }, wantedWhere: 'subagent', trial: 'control' }
  const log = [JSON.stringify(held), JSON.stringify({ kind: 'spawn', ts: NOW - HOUR + 5, platform: 'claude-code', chat: 'c1', key: 'build it' })].join('\n')
  const rs = parseLog(log)
  expect(rs.map(r => r.kind)).toEqual(['decision'])
  const s = summarize(rs, NOW).today
  expect([s.prompts, s.routed, s.modelChanges, s.subagents]).toEqual([1, 0, 0, 0])
  const b = balance(rs)
  expect(b.routed).toBe(0)
  close(b.usd, -0.01)
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

test('an old text key and the new hash of the same prompt never match: the old one is not counted as repeated', () => {
  const ds = [
    decision({ ts: NOW - 60 * MIN, key: 'why is it slow', follows: 'new' }),
    decision({ ts: NOW - 50 * MIN, key: promptKey('why is it slow'), follows: 'new' }),
  ]
  expect(parseLog(ds.map(d => JSON.stringify(d)).join('\n')).length).toBe(2)
  expect(episodes(ds).length).toBe(2)
})

test('the summary counts the new tokens subagents took in, never the main chat\'s', () => {
  const s = summarize([
    turn('opus', 'opus'),
    turn('haiku', 'opus', { agentId: 'a1' }),
    turn('haiku', 'opus', { agentId: 'a2', usage: undefined }),
  ], NOW).today
  expect(s.offloadTokens).toBe(U.input + U.cacheWrite)
})

test('glance shows only the figures with data: context kept out, cheaper picks and the plan limit', () => {
  expect(glance(summarize([], NOW).today)).toEqual([])
  const sub = (n: number) => turn('haiku', 'opus', { agentId: `a${n}`, usage: { input: 100_000, output: 0, cacheRead: 0, cacheWrite: 150_000 } })
  const s = summarize([sub(1), sub(2), turn('haiku', 'opus'), turn('opus', 'haiku')], NOW).today
  const g = Object.fromEntries(glance(s, 200_000).map(x => [x.key, x]))
  expect(g.offload!.value).toBe('500 k tokens')
  expect(g.offload!.sub).toBe('read by subagents instead, ≈ 2 full contexts')
  expect(g.cheaper!.value).toBe(usd(s.savedUsd))
  expect(g.cheaper!.sub).toMatch(/^at list price; stronger picks used \$\d+\.\d\d$/)
  // No weekly reading yet: the share is of what the work would have cost without the router.
  expect(g.limit!.label).toBe('Cost, all in')
  expect(g.limit!.value).toBe(`${Math.round((Math.abs(s.balanceUsd) / s.withoutUsd) * 100)} % ${s.balanceUsd < 0 ? 'more' : 'less'}`)
  // With the measured price of 1 % of the weekly limit, money reads as a share of it.
  const w = Object.fromEntries(glance(s, 200_000, 2).map(x => [x.key, x]))
  expect(w.cheaper!.sub).toMatch(new RegExp(`^≈ ${(s.savedUsd / 2).toFixed(1).replace('.', '\\.')} % of your weekly limit`))
  expect(w.limit!.label).toBe('Weekly limit, all in')
  expect(w.limit!.sub).toMatch(/1 % of your limit ≈ \$2\.00, measured$/)
})

test('limitRate: list price between weekly readings per point the fill moved, resets and drops left out', () => {
  const t = (ts: number, usd: number, week?: { pct: number; resets?: string }) => turn('opus', 'opus', { ts: NOW - DAY + ts, usd, ...(week ? { week } : {}) })
  // Nothing before the first reading counts; 1 → 3 % for $4 + $2, then a reset ($9 left out), then 0.5 → 1.5 % for $1.
  const r = [t(1, 50), t(2, 0, { pct: 1, resets: 'A' }), t(3, 4), t(4, 2, { pct: 3, resets: 'A' }), t(5, 9, { pct: 0.5, resets: 'B' }), t(6, 1, { pct: 1.5, resets: 'B' })]
  expect(limitRate(r)).toBe(7 / 3)
  // Until the fill moved MIN_PCT points there is no figure.
  expect(limitRate([t(1, 1, { pct: 1, resets: 'A' }), t(2, 1, { pct: 1 + MIN_PCT / 2, resets: 'A' })])).toBeNull()
  // A classifier's price counts too.
  const d = decision({ ts: NOW - DAY + 3, classifier: { model: 'haiku', usage: U, usd: 1 } })
  expect(limitRate([t(1, 0, { pct: 0, resets: 'A' }), d, t(4, 3, { pct: 2, resets: 'A' })])).toBe(2)
})
