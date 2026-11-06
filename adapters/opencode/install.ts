// Installs Prompt Router for OpenCode: node adapters/opencode/install.ts [--uninstall]
//
// Writes ~/.config/opencode/plugins/prompt-router.ts, a shim that imports the plugin from this repo
// by absolute path (so its import of core/router.ts keeps working) and hands it `tool` from
// @opencode-ai/plugin, which OpenCode installs in ~/.config/opencode. A file it would overwrite is
// kept as prompt-router.ts.bak-<time> and put back on --uninstall. It also creates
// ~/.config/opencode/prompt-router.json with the default options when there is none.

import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const MARK = '// prompt-router shim'
const HERE = dirname(fileURLToPath(import.meta.url))

export const DEFAULT_OPTIONS = {
  classifier: 'standard',
  effortDetection: 'ask',
  firstChatDetection: 'ask',
  midChatModelDetection: 'ask',
  subagentSuggestions: 'ask',
  sessionSuggestions: 'ask',
  newSessionAt: '50%',
  holdoutPct: '30',
  notifications: 'on',
  project: '',
  rules: '',
  language: 'auto',
  models: { light: 'anthropic/claude-haiku-5-5', standard: 'anthropic/claude-sonnet-5-5', strong: 'anthropic/claude-opus-5-5', top: 'anthropic/claude-fable-5-1' },
  variants: { low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' },
}

export function paths(home: string) {
  const config = join(home, '.config', 'opencode')
  return { config, plugins: join(config, 'plugins'), shim: join(config, 'plugins', 'prompt-router.ts'), options: join(config, 'prompt-router.json') }
}

export function shim(repoPlugin = join(HERE, 'prompt-router.ts')) {
  return `${MARK}, written by ${join(HERE, 'install.ts')}. Remove it with: node ${join(HERE, 'install.ts')} --uninstall
import { tool } from '@opencode-ai/plugin'
import { routerPlugin } from ${JSON.stringify(repoPlugin)}

export const PromptRouter = routerPlugin(tool)
`
}

export async function install(home: string, now = Date.now()) {
  const p = paths(home)
  const out: string[] = []
  await mkdir(p.plugins, { recursive: true })
  const text = shim()
  if (existsSync(p.shim)) {
    const old = await readFile(p.shim, 'utf8')
    if (old === text) out.push(`Already installed: ${p.shim}`)
    else if (old.startsWith(MARK)) {
      await writeFile(p.shim, text)
      out.push(`Updated ${p.shim}`)
    } else {
      const bak = `${p.shim}.bak-${now}`
      await rename(p.shim, bak)
      await writeFile(p.shim, text)
      out.push(`Installed ${p.shim} (the file there was kept as ${bak})`)
    }
  } else {
    await writeFile(p.shim, text)
    out.push(`Installed ${p.shim}`)
  }
  if (!existsSync(p.options)) {
    await writeFile(p.options, `${JSON.stringify(DEFAULT_OPTIONS, null, 2)}\n`)
    out.push(`Options: ${p.options} (defaults written)`)
  } else out.push(`Options: ${p.options} (kept)`)
  out.push('Restart OpenCode to load it.')
  return out
}

export async function uninstall(home: string) {
  const p = paths(home)
  const out: string[] = []
  if (!existsSync(p.shim)) out.push(`Not installed: no ${p.shim}`)
  else if (!(await readFile(p.shim, 'utf8')).startsWith(MARK)) {
    out.push(`Left ${p.shim} alone: it is not the Prompt Router shim.`)
    return out
  } else {
    await rm(p.shim)
    out.push(`Removed ${p.shim}`)
  }
  const baks = existsSync(p.plugins) ? (await readdir(p.plugins)).filter(f => f.startsWith('prompt-router.ts.bak-')).sort() : []
  const latest = baks.at(-1)
  if (latest && !existsSync(p.shim)) {
    await rename(join(p.plugins, latest), p.shim)
    out.push(`Restored ${p.shim} from ${latest}`)
  }
  if (existsSync(p.options)) out.push(`Kept your options in ${p.options}; delete it by hand if you no longer need it.`)
  return out
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const home = process.env.HOME || homedir()
  const run = process.argv.includes('--uninstall') ? uninstall : install
  run(home).then(
    lines => console.log(lines.join('\n')),
    err => {
      console.error(`prompt-router install: ${err instanceof Error ? err.message : String(err)}`)
      process.exit(1)
    },
  )
}
