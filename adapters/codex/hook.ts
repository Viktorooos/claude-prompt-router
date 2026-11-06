// Prompt Router for OpenAI Codex (CLI and the desktop app, which share ~/.codex), as a
// UserPromptSubmit hook: `node <abs path>/hook.ts`, installed into ~/.codex/hooks.json by install.ts.
//
// The same router as the Claude Code mod (plugins/prompt-router/hooks/register.tsx): for each typed
// prompt a small model picks where it runs (keep / here / subagent / session), the model and the
// effort. The logic lives in core/router.ts; this file only wires it to Codex:
//   - stdin: { session_id, transcript_path, cwd, hook_event_name, model, turn_id, prompt, permission_mode }
//   - stdout: { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext }, systemMessage }
//   - the classifier is a child `codex exec` run with PROMPT_ROUTER_INNER=1, so this hook skips it.
//   - a hook cannot switch a running session's model or effort, so the note has the agent give the
//     user a `/model <model> <effort>` line (and the same line goes to systemMessage).
// The same script is the Stop / SubagentStop hook: it logs each finished turn's tokens to
// ~/.codex/log/prompt-router-stats.jsonl (stats.ts), next to a record of every routed prompt;
// `/router stats` shows the savings table.
// Any failure prints nothing: the prompt goes on untouched, and the reason goes to
// ~/.codex/log/prompt-router.log.
//
// Options: ~/.codex/prompt-router.json (install.ts writes the defaults), read like the mod's toConfig
// (project, rules, language, classifier, effortDetection, firstChatDetection, midChatModelDetection,
// subagentSuggestions, sessionSuggestions, newSessionAt, notifications; the 0.7 effortMode and modelMode still count) plus:
//   "models": { "light": "gpt-6-luna", "standard": "gpt-6.1-terra", "strong": "gpt-6.1-sol", "top": "gpt-6-astra" },
//                                                    the model of each tier (old keys haiku…fable still work)
//   "efforts": { "low": "low", ... "max": "max" }   the Codex effort for each router level
//   "enabled": true                                  /router off|on writes it
//   "timeoutMs": 20000                               the classifier's time limit

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join, posix, win32 } from 'node:path'
import { fileURLToPath } from 'node:url'

import { TIER_OF, fromTiers, shownOptions, tierLine, tierModel } from '../shared/tiers.ts'

import type { Level } from '../../plugins/prompt-router/types/index.d.ts'
import { ALL_MODELS, BASE_MODELS, LEVELS, NAMES, allowed, asLevel, clip, compareTarget, isRedo, mappedModel, preferSession, describeOptions, optionsLine, parseFollows, parsePick, pickPrompt, promptKey, quickReply, toConfig, typed } from '../../plugins/prompt-router/core/router.ts'
import type { Chat, Config, Model, Pick } from '../../plugins/prompt-router/core/router.ts'
import type { Usage } from '../../plugins/prompt-router/core/prices.ts'
import type { Decision, Turn } from '../../plugins/prompt-router/core/stats.ts'
import { appendStats, classifierUsage, readStats, spawnedAgent, statsReport, turnUsage } from './stats.ts'
import { askNote, autoNote, line, otherAutoNote, otherNote, runAgentLine, runAgentNote, statusNote, switchNote } from './notes.ts'
import type { NoteCtx } from './notes.ts'

export const DEFAULT_MODELS: Record<Model, string> = { haiku: 'gpt-6-luna', sonnet: 'gpt-6.1-terra', opus: 'gpt-6.1-sol', fable: 'gpt-6-astra' }

// The Codex classifier defaults to the light tier (gpt-6-luna): toConfig's default is sonnet.
const CODEX_DEFAULTS = { classifier: 'light' }

export type Input = { session_id?: string; transcript_path?: string | null; cwd?: string; hook_event_name?: string; model?: string; turn_id?: string; prompt?: string; permission_mode?: string; agent_id?: string; agent_transcript_path?: string | null; stop_hook_active?: boolean }
export type Output = { hookSpecificOutput?: { hookEventName: 'UserPromptSubmit'; additionalContext: string }; systemMessage?: string }
// Runs the classifier: the prompt in, the model's reply text out (throws on failure or timeout).
// onUsage: what the classifier call cost in tokens, when the runner can tell (for the statistics).
export type Runner = (prompt: string, o: { model: string; effort: string; timeoutMs: number; onUsage?: (u: Usage) => void }) => Promise<string>
// noSubagent: the client has no spawn_agent (the ChatGPT desktop through mcp.ts), so a here prompt
// that fits another model is not offered to a subagent.
export type Deps = { codexHome?: string; runner?: Runner; noSubagent?: boolean; now?: number }

export function codexHome() {
  return process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex')
}

export function paths(home: string) {
  return { hooks: join(home, 'hooks.json'), options: join(home, 'prompt-router.json'), config: join(home, 'config.toml'), cache: join(home, 'models_cache.json'), log: join(home, 'log', 'prompt-router.log'), tasks: join(home, 'log', 'prompt-router-tasks.json') }
}

async function log(home: string, what: string, err: unknown) {
  try {
    const path = paths(home).log
    await mkdir(join(home, 'log'), { recursive: true })
    try {
      // Keep it small: start over past 200 kB.
      if ((await stat(path)).size > 200_000) await rm(path)
    } catch {
      // A new log.
    }
    const msg = err instanceof Error ? err.message : String(err)
    await appendFile(path, `${new Date().toISOString()} ${what}: ${msg}\n`)
  } catch {
    // Nowhere left to report it.
  }
}

function strMap<K extends string>(keys: readonly K[], v: unknown, base: Record<K, string>): Record<K, string> {
  const out = { ...base }
  if (v && typeof v === 'object') for (const k of keys) if (typeof (v as Record<string, unknown>)[k] === 'string' && (v as Record<K, string>)[k]) out[k] = (v as Record<K, string>)[k]
  return out
}

type Options = { raw: Record<string, unknown>; source: string; cfg: Config; models: Record<Model, string>; efforts: Record<Level, string>; enabled: boolean; timeoutMs: number }

export async function loadOptions(home: string): Promise<Options> {
  let raw: Record<string, unknown> = {}
  let source = 'defaults'
  try {
    raw = JSON.parse(await readFile(paths(home).options, 'utf8'))
    source = paths(home).options
  } catch {
    // The defaults.
  }
  // `raw` stays as written (/router off|on writes it back); the parsing reads tier keys.
  // A classifier value that names no tier or model falls back to the Codex default, not toConfig's.
  const classifier = tierModel(raw.classifier) ? raw.classifier : CODEX_DEFAULTS.classifier
  const given = fromTiers({ ...CODEX_DEFAULTS, ...raw, classifier })
  const cfg = toConfig(given)
  return {
    raw,
    source,
    cfg,
    models: strMap(ALL_MODELS, given.models, DEFAULT_MODELS),
    efforts: strMap(LEVELS, raw.efforts, Object.fromEntries(LEVELS.map(l => [l, l])) as Record<Level, string>),
    enabled: raw.enabled !== false,
    timeoutMs: typeof raw.timeoutMs === 'number' && raw.timeoutMs > 0 ? raw.timeoutMs : 20_000,
  }
}

// The efforts each model takes, from Codex's own models cache; a model not listed takes any.
async function supported(home: string): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  try {
    const j = JSON.parse(await readFile(paths(home).cache, 'utf8')) as { models?: { slug?: string; supported_reasoning_levels?: ({ effort?: string } | string)[] }[] }
    for (const m of j.models ?? []) {
      if (typeof m.slug !== 'string') continue
      out.set(m.slug, (m.supported_reasoning_levels ?? []).map(x => (typeof x === 'string' ? x : (x.effort ?? ''))).filter(Boolean))
    }
  } catch {
    // No cache: no limits known.
  }
  return out
}

// The Codex effort for a level on a model: the mapped name, else the highest supported one below it.
export function effortFor(efforts: Record<Level, string>, levels: Map<string, string[]>, slug: string, l: Level) {
  const ok = levels.get(slug)
  if (!ok?.length) return efforts[l]
  for (let i = LEVELS.indexOf(l); i >= 0; i--) if (ok.includes(efforts[LEVELS[i]])) return efforts[LEVELS[i]]
  return ok[0]
}

// The model and effort config.toml starts a session on (its top-level keys only).
export async function configDefaults(home: string) {
  try {
    const top = (await readFile(paths(home).config, 'utf8')).split(/^\s*\[/m)[0] ?? ''
    const get = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*"([^"]*)"`, 'm').exec(top)?.[1] ?? ''
    return { model: get('model'), effort: get('model_reasoning_effort') }
  } catch {
    return { model: '', effort: '' }
  }
}

export type History = { id: string; users: string[]; reply: string; isFirst: boolean; model: string; effort: string; tokens: number | undefined; window?: number; openTurns: string[] }

// Requests the desktop app makes of the model itself (a suggested next prompt and the like), sent
// as user messages: no user typed them.
const APP_REQUEST = /^\s*This is an? (app|system|automatically)[- ]generated request\b/i
export const isAppRequest = (text: string) => APP_REQUEST.test(text)
// A click in the app's question window (request_user_input) arrives as a new prompt in this wrapper.
export const isQuestionReply = (text: string) => text.trimStart().startsWith('<send_user_message_question_reply>')

const INJECTED = /^\s*(<[a-z_]+[\s>/]|<\/[a-z_]+>|# AGENTS\.md instructions|\[Prompt Router|Codex could not read)/

function textParts(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(c => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
    .filter(t => t && !INJECTED.test(t) && !isAppRequest(t))
    .join('\n')
}

// The chat so far, from the rollout JSONL. Its format is not a stable interface: anything that does
// not read is skipped, and a missing file is an empty chat.
export async function readHistory(path: string | null | undefined): Promise<History> {
  const h: History = { id: '', users: [], reply: '', isFirst: true, model: '', effort: '', tokens: undefined, openTurns: [] }
  if (!path) return h
  let text = ''
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return h
  }
  const events: string[] = []
  const items: string[] = []
  const open = new Set<string>()
  for (const l of text.split('\n')) {
    if (!l.trim()) continue
    let j: any
    try {
      j = JSON.parse(l)
    } catch {
      continue
    }
    const p = j?.payload
    if (!p || typeof p !== 'object') continue
    try {
      if (j.type === 'session_meta') {
        const id = p.id ?? p.session_id
        if (typeof id === 'string' && !h.id) h.id = id
      } else if (j.type === 'turn_context') {
        if (typeof p.model === 'string') h.model = p.model
        const e = typeof p.effort === 'string' ? p.effort : p.collaboration_mode?.settings?.reasoning_effort
        if (typeof e === 'string') h.effort = e
      } else if (j.type === 'event_msg') {
        if (p.type === 'user_message' && typeof p.message === 'string') events.push(p.message)
        else if (p.type === 'agent_message' && typeof p.message === 'string' && p.message.trim()) {
          h.reply = p.message
          h.isFirst = false
        } else if (p.type === 'token_count' && p.info?.last_token_usage) {
          h.tokens = Number(p.info.last_token_usage.total_tokens) || h.tokens
          h.window = Number(p.info.model_context_window) || h.window
        }
        else if (p.type === 'task_started' && typeof p.turn_id === 'string') open.add(p.turn_id)
        else if ((p.type === 'task_complete' || p.type === 'turn_aborted') && typeof p.turn_id === 'string') open.delete(p.turn_id)
      } else if (j.type === 'response_item' && p.type === 'message') {
        const t = textParts(p.content)
        if (p.role === 'user' && t.trim()) items.push(t)
        if (p.role === 'assistant') {
          h.isFirst = false
          if (t.trim()) h.reply = t
        }
      }
    } catch {
      // One odd record: the rest still counts.
    }
  }
  // The event log has the typed text alone; the model's items carry context blocks around it.
  h.users = (events.length ? events : items).map(typed).filter(u => u && !isAppRequest(u))
  h.openTurns = [...open]
  return h
}

function schemaFile() {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-router-'))
  return { dir, file: join(dir, 'schema.json'), out: join(dir, 'last.txt') }
}

// Codex sends it as strict structured output: every property must be in required, so the fields
// the template does not always ask for are nullable (parsePick reads a null as missing).
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['where', 'model', 'effort', 'work', 'why', 'follows', 'note'],
  properties: {
    where: { type: 'string', enum: ['keep', 'here', 'subagent', 'session'] },
    model: { type: 'string' },
    effort: { type: 'string' },
    work: { type: ['string', 'null'], enum: ['new', 'continue', null] },
    why: { type: 'string' },
    follows: { type: ['string', 'null'], enum: ['continues', 'corrects', 'new', null] },
    note: { type: ['string', 'null'] },
  },
}

// The codex binary. The desktop app runs hooks with the short PATH of a Dock app (no Homebrew bin),
// so a bare `codex` is not found there: look in the usual places too. On Windows npm installs a
// codex.cmd shim (in %APPDATA%\\npm), a standalone install codex.exe.
export function codexBin(env: NodeJS.ProcessEnv = process.env, places?: string[], platform: NodeJS.Platform = process.platform, exists: (f: string) => boolean = existsSync) {
  if (env.PROMPT_ROUTER_CODEX) return env.PROMPT_ROUTER_CODEX
  const win = platform === 'win32'
  const p = win ? win32 : posix
  const names = win ? ['codex.exe', 'codex.cmd'] : ['codex']
  const usual = win ? (env.APPDATA ? [p.join(env.APPDATA, 'npm', 'codex.cmd')] : []) : ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', p.join(env.HOME || homedir(), '.local/bin/codex')]
  const onPath = (env.PATH ?? env.Path ?? '').split(win ? ';' : ':').filter(Boolean).flatMap(d => names.map(n => p.join(d, n)))
  return [...onPath, ...(places ?? usual)].find(f => exists(f)) ?? 'codex'
}

// How to start `bin`. Node will not spawn a .cmd without a shell, and cmd.exe would mangle the
// arguments, so npm's codex.cmd runs as `node <its codex.js>`; only a shim with no package next to
// it goes through the shell.
export function codexSpawn(bin: string, platform: NodeJS.Platform = process.platform, exists: (f: string) => boolean = existsSync, node = process.execPath) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(bin)) return { file: bin, args: [] as string[], shell: false }
  const js = win32.join(win32.dirname(bin), 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  return exists(js) ? { file: node, args: [js], shell: false } : { file: bin, args: [] as string[], shell: true }
}

// The classifier: one ephemeral, read-only `codex exec` with no tools to speak of. Its whole process
// group is killed at the time limit, so nothing is left running.
// codex from npm starts with `#!/usr/bin/env node`, so the child needs node's folder on PATH too.
export function childPath(env: NodeJS.ProcessEnv = process.env, node = process.execPath) {
  const dirs = [dirname(node), dirname(codexBin(env)), ...(env.PATH ?? '').split(delimiter)].filter(d => d && d !== '.')
  return [...new Set(dirs)].join(delimiter)
}

// The classifier's own base instructions, in place of Codex's long coding-agent prompt.
const INSTRUCTIONS = 'You are a classifier. Answer with JSON only, matching the output schema. Do not call tools.\n'

// What the light run turns off: the tools and the developer notes a classifier never uses. Each
// costs input tokens on every call (measured on codex 0.166: 22.9k tokens, 7.5 s with the plain
// args; 11.7k, 4.0 s with these). A Codex that does not know one of them fails at once, and the
// runner falls back to the plain args.
const OFF_FEATURES = ['multi_agent', 'apps', 'plugins', 'hooks', 'browser_use', 'computer_use', 'in_app_browser', 'image_generation', 'goals', 'tool_suggest', 'skill_search', 'shell_tool', 'unified_exec', 'view_image', 'sleep_tool']
const OFF_NOTES = ['include_permissions_instructions', 'include_environment_context', 'include_apps_instructions', 'include_skills_usage_instructions', 'include_plugin_usage_instructions', 'include_apps_usage_instructions', 'include_collaboration_mode_instructions']

// The `codex exec` arguments. light: without the user's config.toml (MCP servers, plugins, apps,
// rules) and the tools above; plain: today's config with only our own MCP server off.
export function classifierArgs(o: { model: string; effort: string }, t: { file: string; out: string; dir: string; instructions: string }, light: boolean) {
  const head = ['exec', '-m', o.model, '-c', `model_reasoning_effort=${o.effort}`]
  const tail = ['--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '--output-schema', t.file, '-o', t.out, '-C', t.dir, '-']
  if (!light) return [...head, '-c', 'mcp_servers.prompt_router.enabled=false', ...tail]
  return [
    ...head,
    '--ignore-user-config',
    '--ignore-rules',
    '-c', `model_instructions_file=${JSON.stringify(t.instructions)}`,
    '-c', 'web_search="disabled"',
    ...OFF_FEATURES.flatMap(f => ['--disable', f]),
    ...OFF_NOTES.flatMap(k => ['-c', `${k}=false`]),
    ...tail,
  ]
}

// A config.toml that sets its own provider, endpoint or login store: the light run would drop it (it
// skips the user config), so the classifier keeps the plain args there.
export function needsUserConfig(toml: string) {
  return /^\s*(model_provider|openai_base_url|chatgpt_base_url|cli_auth_credentials_store|forced_login_method|forced_chatgpt_workspace_id)\s*=|^\s*\[model_providers[.\]]/m.test(toml)
}

// A Codex too old or too new for a light flag stops before any model call with one of these.
const FLAG_ERROR = /unknown feature|unexpected argument|unrecognized|invalid value|unknown variant/i

type Run = { code: number | null; stdout: string; stderr: string }

function runCodex(args: string[], prompt: string, timeoutMs: number): Promise<Run> {
  const run = codexSpawn(codexBin())
  // Its own process group, killed whole at the time limit; Windows has no groups (and a detached
  // child there gets a console window).
  const win = process.platform === 'win32'
  const child = spawn(run.file, [...run.args, ...args], { env: { ...process.env, PATH: childPath(), PROMPT_ROUTER_INNER: '1' }, stdio: ['pipe', 'pipe', 'pipe'], detached: !win, windowsHide: true, shell: run.shell })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', d => (stdout = (stdout + d).slice(-200_000)))
  child.stderr.on('data', d => (stderr = (stderr + d).slice(-4000)))
  child.stdin.on('error', () => {})
  child.stdin.end(prompt)
  return new Promise<Run>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        process.kill(-(child.pid as number), 'SIGKILL')
      } catch {
        child.kill('SIGKILL')
      }
      reject(new Error(`classifier timed out after ${timeoutMs} ms`))
    }, timeoutMs)
    child.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
    child.on('exit', c => {
      clearTimeout(timer)
      resolve({ code: c, stdout, stderr })
    })
  })
}

export const codexRunner: Runner = async (prompt, o) => {
  const t = { ...schemaFile(), instructions: '' }
  t.instructions = join(t.dir, 'instructions.md')
  try {
    await writeFile(t.file, JSON.stringify(SCHEMA))
    await writeFile(t.instructions, INSTRUCTIONS)
    let toml = ''
    try {
      toml = await readFile(paths(codexHome()).config, 'utf8')
    } catch {
      // No config.toml.
    }
    const started = Date.now()
    let r = await runCodex(classifierArgs(o, t, !needsUserConfig(toml)), prompt, o.timeoutMs)
    if (r.code !== 0 && !r.stdout.trim() && FLAG_ERROR.test(r.stderr) && !needsUserConfig(toml)) r = await runCodex(classifierArgs(o, t, false), prompt, Math.max(1000, o.timeoutMs - (Date.now() - started)))
    const { code, stdout, stderr } = r
    const usage = classifierUsage(stdout)
    if (usage) o.onUsage?.(usage)
    let answer = ''
    try {
      answer = await readFile(t.out, 'utf8')
    } catch {
      // From the event stream below.
    }
    if (!answer.trim()) {
      for (const l of stdout.split('\n')) {
        try {
          const e = JSON.parse(l)
          if (e?.item?.type === 'agent_message' && typeof e.item.text === 'string') answer = e.item.text
        } catch {
          // Not an event.
        }
      }
    }
    if (!answer.trim()) {
      const err = [...stdout.split('\n')].map(l => {
        try {
          const e = JSON.parse(l)
          return e?.type === 'error' || e?.type === 'turn.failed' ? (e.message ?? e.error?.message ?? '') : ''
        } catch {
          return ''
        }
      }).filter(Boolean).at(-1)
      throw new Error(`classifier gave no answer (exit ${code}): ${clip(err || stderr, 300)}`)
    }
    return answer
  } finally {
    await rm(t.dir, { recursive: true, force: true }).catch(() => {})
  }
}

// The line the user sees when the agent is to ask where the prompt runs.
function suggests(o: Options, effortOf: (slug: string, l: Level) => string, p: Pick) {
  const slug = o.models[p.model]
  return `Prompt Router: suggests ${p.where === 'session' ? 'a new session' : 'a subagent'} on ${slug} · ${effortOf(slug, p.effort)}${p.why ? ` (${p.why})` : ''}`
}

function out(context: string, system?: string): Output {
  return { hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: context }, ...(system ? { systemMessage: system } : {}) }
}

async function routerCommand(home: string, o: Options, arg: string, cur: { model: string; now: Level | '' }): Promise<string> {
  const a = arg.trim().toLowerCase()
  if (a === 'stats') {
    // compareWith names a tier: compared with that tier's Codex model at its OpenAI list price.
    const t = compareTarget(o.cfg.compareWith)
    return statsReport(readStats(home), Date.now(), t && { ...t, model: o.models[t.model] }, t ? TIER_OF[t.model] : undefined)
  }
  if (a === 'off' || a === 'on') {
    const enabled = a === 'on'
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(await readFile(paths(home).options, 'utf8'))
    } catch (err) {
      // No options file yet makes a new one; otherwise never replace the user's options with {enabled} alone.
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        await log(home, `router ${a}`, err)
        return `Prompt Router could not read ${paths(home).options}, so it is left as it is. Fix the file, then try /router ${a} again.`
      }
    }
    await mkdir(home, { recursive: true })
    await writeFile(paths(home).options, `${JSON.stringify({ ...raw, enabled }, null, 2)}\n`)
    return enabled ? 'Prompt Router is on.' : 'Prompt Router is off. Turn it back on with /router on.'
  }
  return [
    `Prompt Router is ${o.enabled ? 'on' : 'off'} (classifier ${o.models[o.cfg.classifier]}, effort mode ${o.cfg.effortDetection}, model mode ${o.cfg.firstChatDetection}).`,
    `This chat runs on ${cur.model || 'an unknown model'}, effort ${cur.now ? NAMES[cur.now] : 'unknown'}.`,
    `Options: ${o.source}.`,
    ...describeOptions(shownOptions(o.raw), fromTiers(CODEX_DEFAULTS) as Record<string, string>).map(l => `  ${tierLine(l)}`),
    'Commands: /router off, /router on.',
  ].join('\n')
}

// Each chat's open subagent offer (the decision's time stamp, until the Stop hook sees spawn_agent or
// another offer replaces it) and when it was last active. The hook is a new process per prompt, so
// this lives in a small file next to the stats log; chats idle for a day are dropped.
// last: the hook's answer to the chat's newest classified prompt, so MCP `route` can hand it out
// again instead of classifying the same prompt twice.
type ChatTask = { end: number; offer?: number; last?: { key: string; ts: number; note: string } }

export async function readTasks(home: string, now: number): Promise<Record<string, ChatTask>> {
  try {
    const all = JSON.parse(await readFile(paths(home).tasks, 'utf8')) as Record<string, ChatTask>
    return Object.fromEntries(Object.entries(all).filter(([, t]) => t && now - t.end < 86_400_000))
  } catch {
    return {}
  }
}

// Saves one chat's task. Other chats' hooks run in their own processes, so the file is read again
// right before the write and only this chat's entry changes; the new file is written aside and
// renamed over the old one, so no reader ever sees half of it.
async function saveTask(home: string, chat: string, task: ChatTask | undefined, now: number) {
  const file = paths(home).tasks
  const tmp = `${file}.${process.pid}.tmp`
  try {
    await mkdir(join(home, 'log'), { recursive: true })
    const tasks = await readTasks(home, now)
    if (task) tasks[chat] = task
    else delete tasks[chat]
    await writeFile(tmp, JSON.stringify(tasks))
    await rename(tmp, file)
  } catch (err) {
    await rm(tmp, { force: true }).catch(() => {})
    await log(home, 'tasks', err)
  }
}

// The note of a prompt the router checked and left as it is (keep, nothing to switch, or a classifier
// failure). It is there so the agent does not call MCP `route` for the prompt again (AGENTS.md).
export const CHECKED = '[Prompt Router: checked, nothing to switch. Answer the prompt as usual; if it answers a question you asked, act on that answer.]'

// How long the hook's answer stands for MCP `route` on the same prompt.
export const REUSE_MS = 120_000

// The hook's answer for this prompt from the last REUSE_MS: in this chat, or in any chat when the
// chat is not known. Compared by promptKey, whatever form the key takes.
export async function recentAnswer(home: string, chat: string, prompt: string, now: number): Promise<string | null> {
  const key = promptKey(typed(prompt))
  if (!key) return null
  const tasks = await readTasks(home, now)
  const found = (chat ? [tasks[chat]] : Object.values(tasks)).map(t => t?.last).filter(l => !!l && l.key === key && now - l.ts >= 0 && now - l.ts < REUSE_MS).sort((a, b) => b!.ts - a!.ts)[0]
  return found?.note ?? null
}

// Works out the hook's answer for one prompt; null = the prompt goes on untouched (the router is
// off, a slash command, no prompt). Once the classifier was asked, there is always a note: the
// router's, or CHECKED.
export async function handle(input: Input, deps: Deps = {}): Promise<Output | null> {
  const home = deps.codexHome ?? codexHome()
  const ran = { on: false, key: '', ts: 0 }
  let r: Output | null
  try {
    r = await classify(input, deps, home, ran)
  } catch (err) {
    if (!ran.on) throw err
    await log(home, 'classifier', err)
    r = null
  }
  if (!ran.on) return r
  const res = r ?? out(CHECKED)
  const chat = input.session_id ?? ''
  const t = (await readTasks(home, ran.ts))[chat] ?? { end: ran.ts }
  await saveTask(home, chat, { ...t, last: { key: ran.key, ts: ran.ts, note: res.hookSpecificOutput?.additionalContext ?? CHECKED } }, ran.ts)
  return res
}

async function classify(input: Input, deps: Deps, home: string, ran: { on: boolean; key: string; ts: number }): Promise<Output | null> {
  const o = await loadOptions(home)
  // The client has no spawn_agent: a subagent pick stays here, as with subagentSuggestions off.
  if (deps.noSubagent) o.cfg = { ...o.cfg, subagentSuggestions: 'off' }
  const classifier = o.models[o.cfg.classifier]
  const text = typed(String(input.prompt ?? ''))
  if (!text) return null
  const h = await readHistory(input.transcript_path)
  const defaults = await configDefaults(home)
  const model = (typeof input.model === 'string' && input.model) || h.model || defaults.model
  const now = asLevel(h.effort || defaults.effort)
  const cur = { model, now }

  const m = /^\/router(?:\s+(.*))?$/s.exec(text)
  if (m) {
    const status = await routerCommand(home, o, m[1] ?? '', cur)
    return out(statusNote(status), status)
  }
  if (!o.enabled || text.startsWith('/') || isAppRequest(text)) return null
  // "yes", "option 2", "díky": nothing to route, no classifier call. The hook still answers (CHECKED),
  // so the agent does not ask route instead.
  const key = promptKey(text)
  if (quickReply(text) || isQuestionReply(text)) {
    Object.assign(ran, { on: true, key, ts: deps.now ?? Date.now() })
    return null
  }

  const levels = await supported(home)
  const effortOf = (slug: string, l: Level) => effortFor(o.efforts, levels, slug, l)
  const ctx: NoteCtx = { cfg: o.cfg, models: o.models, effortOf, noSubagent: deps.noSubagent }
  // Fable only when the chat runs on its model or Codex lists it.
  const avail: Model[] = mappedModel(o.models, model) === 'fable' || levels.has(o.models.fable) ? [...ALL_MODELS] : [...BASE_MODELS]
  const users = [...h.users]
  // The rollout may already hold this prompt; the classifier sees it once, as the new one.
  if (users.at(-1) === text) users.pop()
  const all = [...users, text]
  // Mid-chat, a here prompt that fits another model is offered to a subagent on it (the chat's own
  // model never changes: that would break its prompt cache), so the classifier names that model.
  const curClass = mappedModel(o.models, model)
  const hereModel = !deps.noSubagent && !!curClass
  const c: Chat = { first: all[0] ?? '', recent: all.slice(-4, -1), reply: h.reply, model, now, tokens: h.tokens, window: h.window, conf: o.cfg, isFirst: h.isFirst, hereModel, models: avail }
  const runner = deps.runner ?? codexRunner
  let usage: Usage | null = null
  Object.assign(ran, { on: true, key, ts: deps.now ?? Date.now() })
  const reply = await runner(pickPrompt(text, c), { model: classifier, effort: effortOf(classifier, 'low'), timeoutMs: o.timeoutMs, onUsage: u => (usage = u) })
  // One stats record per routed prompt. Codex cannot switch itself: "applied" means the router's
  // line was given without a question (auto); whether the user then switched shows in the turns.
  const from = { model, effort: now }
  const ts = deps.now ?? Date.now()
  const chat = input.session_id ?? ''
  const follows = parseFollows(reply)
  const redo = isRedo(text)
  const tasks = await readTasks(home, ts)
  tasks[chat] = { ...tasks[chat], end: ts }
  const decide = async (where: Decision['where'], to: Decision['to'], outcome: Decision['outcome'] = 'applied') => {
    const d: Decision = { kind: 'decision', ts, platform: 'codex', chat, where, from, to, ...(follows ? { follows } : {}), outcome, key, ...(usage ? { classifier: { model: classifier, usage } } : {}), ...(redo ? { redo: true as const } : {}) }
    await appendStats(home, d).catch(err => log(home, 'stats', err))
    const t = tasks[chat]!
    if (where !== 'keep') t.offer = where === 'subagent' ? ts : undefined
    await saveTask(home, chat, t, ts)
  }
  const keep = async () => {
    await decide('keep', from)
    return null
  }
  const parsed = parsePick(reply, avail)
  if (!parsed && !/"where"\s*:\s*"keep"/.test(reply)) await log(home, 'parse', 'reply could not be parsed')
  // Once per chat, so the log shows what the hook really goes by.
  if (h.isFirst) await log(home, 'effective options', `${o.source} | ${tierLine(optionsLine(shownOptions(o.raw), fromTiers(CODEX_DEFAULTS) as Record<string, string>))}`)
  let p: Pick | null = parsed && preferSession(allowed(parsed, o.cfg), h, o.cfg)
  await log(home, 'pick', `${clip(text, 60)} | now ${model || '?'} ${now || '?'} ${h.tokens ?? '?'} tok | first ${h.isFirst} | ${clip(reply, 200)}`)
  // The first prompt of a chat has nothing to leave: only its model and effort count.
  if (p && h.isFirst) p = { ...p, where: 'here', first: { now: mappedModel(o.models, model) } }
  // Mid-chat, a here prompt that fits another model is offered to a subagent on it.
  const other = !!p && p.where === 'here' && hereModel && !h.isFirst && p.model !== curClass && o.cfg.midChatModelDetection !== 'off'
  const routed = p && other ? { ...p, other: { now: curClass as Model } } : p
  // A prompt typed over a running turn (steer) belongs to that work.
  const midTurn = h.openTurns.some(t => t !== input.turn_id)
  // A here prompt: what would change, and whether the router leaves it as it is anyway (typed over a
  // running turn, or the pick maps to the chat's own Codex setting).
  const start = p?.first?.now
  const changeModel = !!p && !!start && p.model !== start && o.cfg.firstChatDetection !== 'off'
  const changeEffort = !!p && p.effort !== now && o.cfg.effortDetection !== 'off'
  const slug = p && changeModel ? o.models[p.model] : model
  const level: Level = p && changeEffort ? p.effort : now || p?.effort || 'medium' // 'medium': no pick, unused
  // Mapped to the same Codex setting: nothing to switch.
  const sameSetting = slug === model && !!now && effortOf(slug, level) === effortOf(model, now)
  const idle = p?.where === 'here' && (midTurn || !model || (!other && ((!changeModel && !changeEffort) || sameSetting)))
  if (!p || !routed) return keep()

  if (p.where === 'here') {
    if (idle) return keep()
    if (other) {
      // Mapped to the same Codex effort: Stay here just goes on.
      const effort = p.effort !== now && !(now && effortOf(model, p.effort) === effortOf(model, now))
      if (o.cfg.midChatModelDetection === 'ask' && o.cfg.subagentSuggestions === 'auto') {
        await decide('subagent', { model: o.models[p.model], effort: p.effort }, 'applied')
        return out(`[${runAgentNote(ctx, p, model)}]`, o.cfg.notifications === 'on' ? runAgentLine(ctx, p) : undefined)
      }
      await decide('subagent', { model: o.models[p.model], effort: p.effort }, o.cfg.midChatModelDetection === 'auto' ? 'applied' : 'asked')
      return out(`[${(o.cfg.midChatModelDetection === 'auto' ? otherAutoNote : otherNote)(ctx, p, cur, effort)}]`, suggests(o, effortOf, p))
    }
    // Codex cannot be switched from here: the same line both ways, auto goes on, ask asks first.
    const asks = (changeModel && o.cfg.firstChatDetection === 'ask') || (changeEffort && o.cfg.effortDetection === 'ask')
    const sys = line(ctx, slug, level, p.why)
    await decide('here', { model: slug, effort: level }, asks ? 'asked' : 'applied')
    if (asks) return out(`[${switchNote(ctx, p, cur, changeModel ? { from: model } : null, changeEffort ? { now } : null)}]`, sys)
    // notifications off: the agent still gives the line, but no system message comes with it.
    return out(`[${autoNote(ctx, slug, level, p)}]`, o.cfg.notifications === 'on' ? sys : undefined)
  }
  if (p.where === 'subagent' && o.cfg.subagentSuggestions === 'auto') {
    await decide('subagent', { model: o.models[p.model], effort: p.effort }, 'applied')
    return out(`[${runAgentNote(ctx, p)}]`, o.cfg.notifications === 'on' ? runAgentLine(ctx, p) : undefined)
  }
  await decide(p.where, { model: o.models[p.model], effort: p.effort }, 'asked')
  return out(`[${askNote(ctx, p, cur, midTurn)}]`, suggests(o, effortOf, p))
}

// A main turn that called spawn_agent after the router offered (or ran) a subagent: the offer was taken.
async function noteSpawn(home: string, input: Input, now: number) {
  const chat = input.session_id ?? ''
  const task = (await readTasks(home, now))[chat]
  if (!task) return
  task.end = now
  const offer = task.offer
  const text = offer !== undefined && input.transcript_path ? await readFile(input.transcript_path, 'utf8').catch(() => '') : ''
  if (offer !== undefined && spawnedAgent(text)) {
    await appendStats(home, { kind: 'accept', ts: now, platform: 'codex', chat, decision: offer }, now)
    delete task.offer
  }
  await saveTask(home, chat, task, now)
}

// Stop / SubagentStop: the finished turn's tokens from the rollout, for the statistics. The
// baseline is the model the chat started on; for a subagent, the main chat's current model.
export async function handleStop(input: Input, deps: { codexHome?: string; now?: number } = {}) {
  const home = deps.codexHome ?? codexHome()
  if (input.hook_event_name !== 'SubagentStop') await noteSpawn(home, input, deps.now ?? Date.now())
  const read = async (f: string | null | undefined) => (f ? turnUsage(await readFile(f, 'utf8')) : null)
  const sub = input.hook_event_name === 'SubagentStop' && !!input.agent_transcript_path
  const t = await read(sub ? input.agent_transcript_path : input.transcript_path).catch(() => null)
  if (!t?.model) return
  const parent = sub ? await read(input.transcript_path).catch(() => null) : null
  const baseline = sub ? parent?.model || t.baseline : t.baseline
  const rec: Turn = { kind: 'turn', ts: deps.now ?? Date.now(), platform: 'codex', chat: input.session_id ?? '', ...(sub && input.agent_id ? { agentId: input.agent_id } : {}), model: t.model, baseline, ...(t.usage ? { usage: t.usage } : {}) }
  await appendStats(home, rec, deps.now)
}

async function readStdin() {
  let s = ''
  for await (const chunk of process.stdin) s += chunk
  return s
}

export async function main() {
  // The classifier's own run, and anything else the router starts.
  if (process.env.PROMPT_ROUTER_INNER) return
  const home = codexHome()
  try {
    const input = JSON.parse(await readStdin()) as Input
    if (input.hook_event_name === 'Stop' || input.hook_event_name === 'SubagentStop') return await handleStop(input, { codexHome: home })
    if (input.hook_event_name && input.hook_event_name !== 'UserPromptSubmit') return
    const r = await handle(input, { codexHome: home })
    if (r) process.stdout.write(JSON.stringify(r))
  } catch (err) {
    await log(home, 'hook', err)
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // No process.exit: stdout must drain (a pipe is async on macOS).
  main().finally(() => {
    process.exitCode = 0
  })
}
