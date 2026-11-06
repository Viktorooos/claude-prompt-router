import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { paths } from '../hook.ts'
import { command, install, isOurs, uninstall } from '../install.ts'
import { tmp } from './helpers.ts'

const SCRIPT = fileURLToPath(new URL('../install.ts', import.meta.url))
const HOOK = fileURLToPath(new URL('../hook.ts', import.meta.url))

const THEIRS = {
  hooks: {
    PreToolUse: [{ description: 'device gate', hooks: [{ type: 'command', command: 'node "/x/gate.cjs"', async: false }] }],
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo mine' }] }],
  },
  other: 1,
}

test('install merges into an existing hooks.json, keeps a backup, and writes default options', async () => {
  const h = tmp('pr-cxhome-')
  const p = paths(h)
  writeFileSync(p.hooks, JSON.stringify(THEIRS))
  const out = await install(h, 1234)
  assert.ok(out.includes(`Backup: ${p.hooks}.bak-prompt-router-1234`))
  assert.deepEqual(JSON.parse(readFileSync(`${p.hooks}.bak-prompt-router-1234`, 'utf8')), THEIRS)
  const j = JSON.parse(readFileSync(p.hooks, 'utf8'))
  assert.deepEqual(j.hooks.PreToolUse, THEIRS.hooks.PreToolUse)
  assert.equal(j.other, 1)
  assert.deepEqual(j.hooks.UserPromptSubmit, [THEIRS.hooks.UserPromptSubmit[0], { hooks: [{ type: 'command', command: command(HOOK), timeout: 30, statusMessage: 'Routing...' }] }])
  const o = JSON.parse(readFileSync(p.options, 'utf8'))
  assert.equal(o.models.light, 'gpt-6-luna')
  assert.equal(o.models.top, 'gpt-6-astra')
  assert.equal(o.classifier, 'light')
  assert.match(out.at(-1) ?? '', /\/hooks/)
  // Again: nothing changes, no new backup.
  const again = await install(h, 5678)
  assert.equal(again[0], `Already installed in ${p.hooks}`)
  assert.equal(existsSync(`${p.hooks}.bak-prompt-router-5678`), false)
})

test('install replaces an entry from an old path instead of adding a second', async () => {
  const h = tmp('pr-cxhome-')
  const p = paths(h)
  writeFileSync(p.hooks, JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: command('/old/repo/adapters/codex/hook.ts'), timeout: 30 }] }] } }))
  await install(h, 1)
  const groups = JSON.parse(readFileSync(p.hooks, 'utf8')).hooks.UserPromptSubmit
  assert.equal(groups.length, 1)
  assert.equal(groups[0].hooks[0].command, command(HOOK))
})

test('uninstall removes only the router entry', async () => {
  const h = tmp('pr-cxhome-')
  const p = paths(h)
  writeFileSync(p.hooks, JSON.stringify(THEIRS))
  await install(h, 1)
  const out = await uninstall(h, 2)
  assert.ok(out.includes(`Backup: ${p.hooks}.bak-prompt-router-2`))
  assert.deepEqual(JSON.parse(readFileSync(p.hooks, 'utf8')), THEIRS)
  assert.match((await uninstall(h, 3))[0], /Not installed/)
  assert.equal(existsSync(p.options), true)
})

test('uninstall drops an emptied UserPromptSubmit list', async () => {
  const h = tmp('pr-cxhome-')
  const p = paths(h)
  await install(h, 1)
  assert.deepEqual(readdirSync(h).sort(), ['AGENTS.md', 'config.toml', 'hooks.json', 'prompt-router.json'])
  await uninstall(h, 2)
  assert.deepEqual(JSON.parse(readFileSync(p.hooks, 'utf8')), { hooks: {} })
})

test('a hooks.json that does not parse is left alone', async () => {
  const h = tmp('pr-cxhome-')
  writeFileSync(paths(h).hooks, '{ nope')
  await assert.rejects(install(h))
  assert.equal(readFileSync(paths(h).hooks, 'utf8'), '{ nope')
})

test('the script installs and uninstalls under $CODEX_HOME', () => {
  const h = tmp('pr-cxhome-')
  const env = { ...process.env, CODEX_HOME: h }
  assert.match(execFileSync(process.execPath, [SCRIPT], { env, encoding: 'utf8' }), /Installed the UserPromptSubmit hook/)
  assert.match(execFileSync(process.execPath, [SCRIPT, '--uninstall'], { env, encoding: 'utf8' }), /Removed/)
})

// The ChatGPT desktop app starts hooks with the short PATH of a Dock app (no /opt/homebrew/bin),
// where a bare `node` is not found and the hook never runs.
test('the hook command names node by its full path', () => {
  const cmd = command('/repo/adapters/codex/hook.ts')
  const bin = JSON.parse(cmd.slice(0, cmd.indexOf('" ') + 1))
  assert.ok(bin.startsWith('/'), cmd)
  assert.equal(realpathSync(bin), realpathSync(process.execPath))
  assert.ok(cmd.endsWith('"/repo/adapters/codex/hook.ts"'), cmd)
})

test('install adds the MCP server and the AGENTS.md rule once, keeping the rest', async () => {
  const h = tmp()
  writeFileSync(join(h, 'config.toml'), 'model = "gpt-6.1-sol"\n\n[features]\nx = true\n')
  writeFileSync(join(h, 'AGENTS.md'), 'Moje pravidlo.\n')
  await install(h, 1)
  await install(h, 2)
  const toml = readFileSync(join(h, 'config.toml'), 'utf8')
  assert.ok(toml.startsWith('model = "gpt-6.1-sol"\n\n[features]\nx = true\n'))
  assert.equal(toml.match(/\[mcp_servers\.prompt_router\]/g)?.length, 1)
  assert.match(toml, /args = \[".*mcp\.ts"\]/)
  assert.match(toml, /default_tools_approval_mode = "approve"/)
  const md = readFileSync(join(h, 'AGENTS.md'), 'utf8')
  assert.ok(md.startsWith('Moje pravidlo.\n'))
  assert.match(md, /prompt_router/)
  assert.equal(md.match(/<!-- prompt-router -->/g)?.length, 1)
  assert.ok(existsSync(join(h, 'config.toml.bak-prompt-router-1')))
  assert.ok(existsSync(join(h, 'AGENTS.md.bak-prompt-router-1')))
})

test('install creates AGENTS.md when there is none', async () => {
  const h = tmp()
  await install(h, 1)
  assert.match(readFileSync(join(h, 'AGENTS.md'), 'utf8'), /route/)
})

test('uninstall removes the MCP server and the rule only', async () => {
  const h = tmp()
  writeFileSync(join(h, 'config.toml'), 'model = "gpt-6.1-sol"\n')
  writeFileSync(join(h, 'AGENTS.md'), 'Moje pravidlo.\n')
  await install(h, 1)
  await uninstall(h, 2)
  assert.equal(readFileSync(join(h, 'config.toml'), 'utf8'), 'model = "gpt-6.1-sol"\n')
  assert.equal(readFileSync(join(h, 'AGENTS.md'), 'utf8'), 'Moje pravidlo.\n')
})

test('install also registers the Stop and SubagentStop hooks for the statistics; uninstall removes them', async () => {
  const h = tmp('pr-cxhome-')
  const p = paths(h)
  writeFileSync(p.hooks, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo theirs' }] }] } }))
  const out = await install(h, 1)
  const j = JSON.parse(readFileSync(p.hooks, 'utf8'))
  assert.deepEqual(j.hooks.Stop, [{ hooks: [{ type: 'command', command: 'echo theirs' }] }, { hooks: [{ type: 'command', command: command(HOOK), timeout: 10 }] }])
  assert.deepEqual(j.hooks.SubagentStop, [{ hooks: [{ type: 'command', command: command(HOOK), timeout: 10 }] }])
  assert.ok(out.some(l => /Installed the Stop hook/.test(l)))
  assert.equal((await install(h, 2))[0], `Already installed in ${p.hooks}`)
  await uninstall(h, 3)
  assert.deepEqual(JSON.parse(readFileSync(p.hooks, 'utf8')).hooks, { Stop: [{ hooks: [{ type: 'command', command: 'echo theirs' }] }] })
})

// Windows: backslash paths, and a command cmd.exe reads (plain double quotes, no JSON escapes).
const WIN_HOOK = 'C:\\Users\\x\\prompt-router\\adapters\\codex\\hook.ts'
const WIN_NODE = 'C:\\Program Files\\nodejs\\node.exe'

test('command on Windows: each path in plain double quotes', () => {
  assert.equal(command(WIN_HOOK, 'win32', WIN_NODE), '"C:\\Program Files\\nodejs\\node.exe" "C:\\Users\\x\\prompt-router\\adapters\\codex\\hook.ts"')
})

test('isOurs knows the hook by a Windows path too, in either quoting', () => {
  assert.equal(isOurs({ command: command(WIN_HOOK, 'win32', WIN_NODE) }), true)
  assert.equal(isOurs({ command: JSON.stringify(WIN_NODE) + ' ' + JSON.stringify(WIN_HOOK) }), true)
  assert.equal(isOurs({ command: command('/repo/adapters/codex/hook.ts') }), true)
  assert.equal(isOurs({ command: 'node "C:\\x\\other\\hook.ts"' }), false)
})

test('install twice and uninstall with a Windows hook path: one entry, then none', async () => {
  const h = tmp()
  await install(h, 1, WIN_HOOK, 'win32')
  await install(h, 2, WIN_HOOK, 'win32')
  const j = JSON.parse(readFileSync(paths(h).hooks, 'utf8'))
  for (const ev of ['UserPromptSubmit', 'Stop', 'SubagentStop']) {
    const cmds = j.hooks[ev].flatMap((g: { hooks: { command: string }[] }) => g.hooks.map(x => x.command))
    assert.equal(cmds.length, 1, ev)
    assert.match(cmds[0], /^"[^"]+" "C:\\Users\\x\\prompt-router\\adapters\\codex\\hook\.ts"$/)
  }
  await uninstall(h, 3)
  const after = JSON.parse(readFileSync(paths(h).hooks, 'utf8'))
  assert.equal(JSON.stringify(after).includes('hook.ts'), false)
})
