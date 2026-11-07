import assert from 'node:assert/strict'
import { test } from 'node:test'

import { describeOptions } from '../../../plugins/prompt-router/core/router.ts'
import { fromTiers, shownOptions, tierLine, tierModel, toTiers } from '../tiers.ts'

test('tier names, old names and model ids map to the core model', () => {
  assert.equal(tierModel('light'), 'haiku')
  assert.equal(tierModel('Strong'), 'opus')
  assert.equal(tierModel('top'), 'fable')
  assert.equal(tierModel('sonnet'), 'sonnet')
  assert.equal(tierModel('anthropic/claude-opus-5-5'), 'opus')
  assert.equal(tierModel('gpt-6-luna'), '')
})

test('options: tier keys become core keys, old keys still work, a tier key wins', () => {
  const o = fromTiers({ classifier: 'standard', models: { light: 'a', opus: 'b', strong: 'c', fable: 'd' }, rules: 'x' })
  assert.equal(o.classifier, 'sonnet')
  assert.deepEqual(o.models, { haiku: 'a', opus: 'c', fable: 'd' })
  assert.equal(o.rules, 'x (Tiers: light = haiku, standard = sonnet, strong = opus, top = fable.)')
  assert.deepEqual(fromTiers({ classifier: 'opus' }), { classifier: 'opus' })
})

test('defaults are written with tier keys', () => {
  assert.deepEqual(toTiers({ haiku: 'a', sonnet: 'b', opus: 'c', fable: 'd' }), { light: 'a', standard: 'b', strong: 'c', top: 'd' })
})

test('/router and the log name the classifier by its tier and show the rules as written', () => {
  const lines = describeOptions(shownOptions({ classifier: 'strong', rules: 'keep it short' })).map(tierLine)
  assert.ok(lines.includes('classifier: strong (set)'), lines.join('\n'))
  assert.ok(lines.includes('rules: "keep it short" (set)'), lines.join('\n'))
  assert.equal(tierLine('language=auto classifier=haiku effortDetection=ask'), 'language=auto classifier=light effortDetection=ask')
})

test('compareWith names a tier and an effort; the core reads the model, /router shows the tier', async () => {
  assert.equal(fromTiers({ compareWith: 'strong-medium' }).compareWith, 'opus-medium')
  assert.equal(fromTiers({ compareWith: 'light-high' }).compareWith, 'haiku-high')
  assert.equal(fromTiers({ compareWith: 'first' }).compareWith, 'first')
  assert.equal(fromTiers({ compareWith: 'sonnet-low' }).compareWith, 'sonnet-low')
  assert.equal(tierLine('compareWith: opus-medium'), 'compareWith: strong-medium')
})
