// Installs Prompt Router for Codex: node adapters/codex/install.ts [--uninstall]
//
// Adds the command hook `node <this dir>/hook.ts` for UserPromptSubmit (routing) and Stop /
// SubagentStop (turn tokens for /router stats) to $CODEX_HOME/hooks.json
// (~/.codex by default), keeping every other hook there. Before it changes the file it keeps a copy
// as hooks.json.bak-prompt-router-<time>. --uninstall removes only the router's entry (again after a
// backup). It also creates $CODEX_HOME/prompt-router.json with the default options when there is none.
// Codex runs a new or changed hook only after the user trusts it once with /hooks in the TUI.

import { existsSync, realpathSync } from 'node:fs'
import { copyFile, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { DEFAULT_MODELS, codexHome, paths } from './hook.ts'
import { toTiers } from '../shared/tiers.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const HOOK = join(HERE, 'hook.ts')
const MCP = join(HERE, 'mcp.ts')
// UserPromptSubmit routes; Stop and SubagentStop log each turn's tokens for /router stats.
const EVENTS = ['UserPromptSubmit', 'Stop', 'SubagentStop'] as const

export const DEFAULT_OPTIONS = {
  classifier: 'light',
  effortDetection: 'ask',
  firstChatDetection: 'ask',
  midChatModelDetection: 'ask',
  subagentSuggestions: 'ask',
  sessionSuggestions: 'ask',
  notifications: 'on',
  project: '',
  rules: '',
  language: 'auto',
  enabled: true,
  timeoutMs: 20_000,
  models: toTiers(DEFAULT_MODELS),
  efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
}

// Node by its full path: the desktop app runs hooks with a PATH that has no Homebrew node.
// A link that survives node updates (/opt/homebrew/bin/node) beats the versioned Cellar path.
export function nodeBin() {
  const real = (p: string) => { try { return realpathSync(p) } catch { return '' } }
  const self = real(process.execPath)
  return ['/opt/homebrew/bin/node', '/usr/local/bin/node'].find(p => real(p) === self) ?? process.execPath
}

// The ChatGPT desktop app runs no hooks: it gets an MCP tool and an AGENTS.md rule to call it.
const TOML = { start: '# >>> prompt-router (desktop)', end: '# <<< prompt-router (desktop)' }
const MD = { start: '<!-- prompt-router -->', end: '<!-- /prompt-router -->' }

export function mcpBlock(mcp = MCP) {
  return [
    '[mcp_servers.prompt_router]',
    `command = ${JSON.stringify(nodeBin())}`,
    `args = [${JSON.stringify(mcp)}]`,
    'default_tools_approval_mode = "approve"',
  ].join('\n')
}

export const AGENTS_RULE = [
  'Prompt Router: at the start of every new user prompt, before anything else, call the `route` tool of the',
  '`prompt_router` MCP server with the prompt exactly as typed, and follow what it returns. Skip the call when',
  'this turn already carries a "[Prompt Router: ..." note, or the prompt is a reply to your own question.',
].join('\n')

// Puts body between the markers (replacing an old copy), or removes the block when body is null.
export function setBlock(text: string, m: { start: string; end: string }, body: string | null) {
  const i = text.indexOf(m.start)
  const j = i < 0 ? -1 : text.indexOf(m.end, i)
  let rest = j < 0 ? text : text.slice(0, i).replace(/\n+$/, '\n') + text.slice(j + m.end.length).replace(/^\n+/, '\n')
  rest = rest.replace(/^\n+/, '').replace(/\n+$/, '')
  if (body === null) return rest ? `${rest}\n` : ''
  return `${rest ? `${rest}\n\n` : ''}${m.start}\n${body}\n${m.end}\n`
}

async function editFile(file: string, m: { start: string; end: string }, body: string | null, now: number, out: string[]) {
  const old = existsSync(file) ? await readFile(file, 'utf8') : ''
  const next = setBlock(old, m, body)
  if (next === old) return false
  if (existsSync(file)) {
    const bak = `${file}.bak-prompt-router-${now}`
    if (!existsSync(bak)) await copyFile(file, bak)
    out.push(`Backup: ${bak}`)
  }
  // A file that held only the router's block goes away with it.
  if (body === null && !next) await unlink(file)
  else await writeFile(file, next)
  return true
}

export async function installDesktop(home = codexHome(), now = Date.now(), mcp = MCP) {
  const out: string[] = []
  if (await editFile(join(home, 'config.toml'), TOML, mcpBlock(mcp), now, out)) out.push(`Added the prompt_router MCP server to ${join(home, 'config.toml')}`)
  if (await editFile(join(home, 'AGENTS.md'), MD, AGENTS_RULE, now, out)) out.push(`Added the routing rule to ${join(home, 'AGENTS.md')}`)
  return out
}

export async function uninstallDesktop(home = codexHome(), now = Date.now()) {
  const out: string[] = []
  for (const [f, m] of [[join(home, 'config.toml'), TOML], [join(home, 'AGENTS.md'), MD]] as const) {
    if (existsSync(f) && (await editFile(f, m, null, now, out))) out.push(`Removed the Prompt Router block from ${f}`)
  }
  return out
}

export function command(hook = HOOK) {
  return `${JSON.stringify(nodeBin())} ${JSON.stringify(hook)}`
}

export function entry(hook = HOOK, event: (typeof EVENTS)[number] = 'UserPromptSubmit') {
  if (event !== 'UserPromptSubmit') return { type: 'command', command: command(hook), timeout: 10 }
  return { type: 'command', command: command(hook), timeout: 30, statusMessage: 'Routing...' }
}

// The router's entry, wherever this repo was when it was installed.
function isOurs(h: unknown) {
  return !!h && typeof h === 'object' && typeof (h as { command?: unknown }).command === 'string' && /adapters\/codex\/hook\.ts"?\s*$/.test((h as { command: string }).command)
}

type Group = { hooks?: unknown[]; [k: string]: unknown }
type HooksFile = { hooks?: Record<string, Group[]>; [k: string]: unknown }

async function readHooks(file: string): Promise<HooksFile> {
  if (!existsSync(file)) return {}
  const j = JSON.parse(await readFile(file, 'utf8'))
  if (!j || typeof j !== 'object' || Array.isArray(j)) throw new Error(`${file} is not a JSON object; left it alone`)
  return j as HooksFile
}

async function save(file: string, j: HooksFile, now: number, out: string[]) {
  if (existsSync(file)) {
    const bak = `${file}.bak-prompt-router-${now}`
    await copyFile(file, bak)
    out.push(`Backup: ${bak}`)
  }
  await writeFile(file, `${JSON.stringify(j, null, 2)}\n`)
}

export async function install(home = codexHome(), now = Date.now(), hook = HOOK) {
  const p = paths(home)
  const out: string[] = []
  await mkdir(home, { recursive: true })
  const j = await readHooks(p.hooks)
  const hooks = (j.hooks ??= {})
  const done: string[] = []
  for (const event of EVENTS) {
    const want = entry(hook, event)
    const groups = (hooks[event] ??= [])
    const found = groups.flatMap(g => (Array.isArray(g.hooks) ? g.hooks : [])).filter(isOurs)
    if (found.length === 1 && JSON.stringify(found[0]) === JSON.stringify(want)) continue
    // Drop old copies (another path, other settings), then add the current one at the end, so the
    // other hooks keep their place (Codex binds trust to each hook's position and command).
    for (const g of groups) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter(h => !isOurs(h))
    hooks[event] = [...groups.filter(g => !Array.isArray(g.hooks) || g.hooks.length), { hooks: [want] }]
    done.push(`${found.length ? 'Updated' : 'Installed'} the ${event} hook in ${p.hooks}: ${want.command}`)
  }
  if (!done.length) out.push(`Already installed in ${p.hooks}`)
  else {
    await save(p.hooks, j, now, out)
    out.push(...done)
  }
  if (!existsSync(p.options)) {
    await writeFile(p.options, `${JSON.stringify(DEFAULT_OPTIONS, null, 2)}\n`)
    out.push(`Options: ${p.options} (defaults written)`)
  } else out.push(`Options: ${p.options} (kept)`)
  out.push(...(await installDesktop(home, now)))
  out.push('Codex runs the hook only once you trust it: start codex, type /hooks and trust the Prompt Router hooks ("Routing..." and the two stop hooks; again after every change of the hook command). Then start a new session.')
  return out
}

export async function uninstall(home = codexHome(), now = Date.now()) {
  const p = paths(home)
  const out: string[] = []
  const j = await readHooks(p.hooks)
  let n = 0
  for (const event of EVENTS) {
    const groups = j.hooks?.[event]
    if (!groups) continue
    n += groups.flatMap(g => (Array.isArray(g.hooks) ? g.hooks : [])).filter(isOurs).length
    for (const g of groups) if (Array.isArray(g.hooks)) g.hooks = g.hooks.filter(h => !isOurs(h))
    const left = groups.filter(g => !Array.isArray(g.hooks) || g.hooks.length)
    if (left.length) j.hooks![event] = left
    else delete j.hooks![event]
  }
  if (!n) out.push(`Not installed: no Prompt Router hook in ${p.hooks}`)
  else {
    await save(p.hooks, j, now, out)
    out.push(`Removed the Prompt Router hook from ${p.hooks}`)
  }
  out.push(...(await uninstallDesktop(home, now)))
  if (existsSync(p.options)) out.push(`Kept your options in ${p.options}; delete it by hand if you no longer need it.`)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const run = process.argv.includes('--uninstall') ? uninstall : install
  run().then(
    lines => console.log(lines.join('\n')),
    err => {
      console.error(`prompt-router install: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    },
  )
}
