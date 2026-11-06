// node --test plugins/prompt-router/test/node/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { sha256 } from '../../core/hash.ts'

test('sha256 matches node:crypto on ASCII, Czech, emoji and block-edge lengths', () => {
  for (const t of ['', 'abc', 'ano, pokračuj', 'příliš žluťoučký kůň', '👍 emoji', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'x'.repeat(1000)]) {
    assert.equal(sha256(t), createHash('sha256').update(t).digest('hex'), JSON.stringify(t.slice(0, 20)))
  }
})
