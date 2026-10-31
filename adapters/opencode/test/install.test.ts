import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { install, paths, uninstall } from '../install.ts'
import { tmp } from './helpers.ts'

const SCRIPT = fileURLToPath(new URL('../install.ts', import.meta.url))
const PLUGIN = fileURLToPath(new URL('../prompt-router.ts', import.meta.url))

test('install writes the shim and default options; uninstall removes the shim', async () => {
  const home = tmp('pr-home-')
  const p = paths(home)
  await install(home)
  const shim = readFileSync(p.shim, 'utf8')
  assert.match(shim, /import \{ tool \} from '@opencode-ai\/plugin'/)
  assert.ok(shim.includes(JSON.stringify(PLUGIN)))
  assert.match(shim, /export const PromptRouter = routerPlugin\(tool\)/)
  assert.equal(JSON.parse(readFileSync(p.options, 'utf8')).models.strong, 'anthropic/claude-opus-5-5')
  assert.deepEqual(await install(home), [`Already installed: ${p.shim}`, `Options: ${p.options} (kept)`, 'Restart OpenCode to load it.'])
  await uninstall(home)
  assert.equal(existsSync(p.shim), false)
  assert.equal(existsSync(p.options), true)
})

test('install backs up a foreign file and uninstall puts it back', async () => {
  const home = tmp('pr-home-')
  const p = paths(home)
  mkdirSync(p.plugins, { recursive: true })
  writeFileSync(p.shim, 'export const Mine = async () => ({})\n')
  writeFileSync(p.options, '{"effortMode":"auto"}\n')
  const out = await install(home, 1234)
  assert.match(out[0], /kept as .*prompt-router\.ts\.bak-1234/)
  assert.equal(readFileSync(`${p.shim}.bak-1234`, 'utf8'), 'export const Mine = async () => ({})\n')
  assert.equal(readFileSync(p.options, 'utf8'), '{"effortMode":"auto"}\n')
  await uninstall(home)
  assert.equal(readFileSync(p.shim, 'utf8'), 'export const Mine = async () => ({})\n')
  assert.deepEqual(readdirSync(p.plugins), ['prompt-router.ts'])
})

test('uninstall leaves a file that is not the shim alone', async () => {
  const home = tmp('pr-home-')
  const p = paths(home)
  mkdirSync(p.plugins, { recursive: true })
  writeFileSync(p.shim, 'mine')
  assert.match((await uninstall(home))[0], /Left .* alone/)
  assert.equal(readFileSync(p.shim, 'utf8'), 'mine')
})

test('the script installs and uninstalls under $HOME', () => {
  const home = tmp('pr-home-')
  const env = { ...process.env, HOME: home }
  assert.match(execFileSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' }), /Installed .*\.config\/opencode\/plugins\/prompt-router\.ts/)
  assert.ok(existsSync(paths(home).shim))
  assert.match(execFileSync(process.execPath, [SCRIPT, '--uninstall'], { env, encoding: 'utf8' }), /Removed/)
  assert.equal(existsSync(paths(home).shim), false)
})
