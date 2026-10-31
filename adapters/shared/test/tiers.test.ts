import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { loadOptions } from '../../codex/hook.ts'
import { fromTiers, tierModel, toTiers } from '../tiers.ts'

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

test('codex reads tier keys and keeps the file as written', async () => {
  const h = mkdtempSync(join(tmpdir(), 'tiers-'))
  writeFileSync(join(h, 'prompt-router.json'), JSON.stringify({ classifier: 'strong', models: { strong: 'my-big', haiku: 'my-small' } }))
  const o = await loadOptions(h)
  assert.equal(o.cfg.classifier, 'opus')
  assert.equal(o.models.opus, 'my-big')
  assert.equal(o.models.haiku, 'my-small')
  assert.equal(o.models.sonnet, 'gpt-6.1-terra')
  assert.deepEqual(o.raw.models, { strong: 'my-big', haiku: 'my-small' })
})
