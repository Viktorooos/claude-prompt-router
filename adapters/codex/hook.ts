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
// Any failure prints nothing: the prompt goes on untouched, and the reason goes to
// ~/.codex/log/prompt-router.log.
//
// Options: ~/.codex/prompt-router.json (install.ts writes the defaults), read like the mod's toConfig
// (project, rules, language, classifier, effortDetection, firstChatDetection, midChatModelDetection,
// subagentSuggestions, sessionSuggestions, notifications; the 0.7 effortMode and modelMode still count) plus:
//   "models": { "haiku": "gpt-6-luna", "sonnet": "gpt-6.1-terra", "opus": "gpt-6.1-sol", "fable": "gpt-6-astra" },
//   "efforts": { "low": "low", ... "max": "max" }   the Codex effort for each router level
//   "enabled": true                                  /router off|on writes it
//   "timeoutMs": 20000                               the classifier's time limit

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync } from 'node:fs'
import { appendFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Level } from '../../plugins/prompt-router/types/index.d.ts'
import { ALL_MODELS, BASE_MODELS, LEVELS, NAMES, allowed, asLevel, clip, describeOptions, optionsLine, parsePick, pickPrompt, toConfig, typed } from '../../plugins/prompt-router/core/router.ts'
import type { Chat, Config, Model, Pick } from '../../plugins/prompt-router/core/router.ts'
import { askNote, autoNote, line, otherAutoNote, otherNote, statusNote, switchNote } from './notes.ts'
import type { NoteCtx } from './notes.ts'

export const DEFAULT_MODELS: Record<Model, string> = { haiku: 'gpt-6-luna', sonnet: 'gpt-6.1-terra', opus: 'gpt-6.1-sol', fable: 'gpt-6-astra' }

// The Codex classifier defaults to the haiku class (gpt-6-luna): the shared default is sonnet.
const CODEX_DEFAULTS = { classifier: 'haiku' }

export type Input = { session_id?: string; transcript_path?: string | null; cwd?: string; hook_event_name?: string; model?: string; turn_id?: string; prompt?: string; permission_mode?: string }
export type Output = { hookSpecificOutput?: { hookEventName: 'UserPromptSubmit'; additionalContext: string }; systemMessage?: string }
// Runs the classifier: the prompt in, the model's reply text out (throws on failure or timeout).
export type Runner = (prompt: string, o: { model: string; effort: string; timeoutMs: number }) => Promise<string>
// noSubagent: the client has no spawn_agent (the ChatGPT desktop through mcp.ts), so a here prompt
// that fits another model is not offered to a subagent.
export type Deps = { codexHome?: string; runner?: Runner; noSubagent?: boolean }

export function codexHome() {
  return process.env.CODEX_HOME || join(process.env.HOME || homedir(), '.codex')
}

export function paths(home: string) {
  return { hooks: join(home, 'hooks.json'), options: join(home, 'prompt-router.json'), config: join(home, 'config.toml'), cache: join(home, 'models_cache.json'), log: join(home, 'log', 'prompt-router.log') }
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
  const cfg = toConfig({ ...CODEX_DEFAULTS, ...raw })
  return {
    raw,
    source,
    cfg,
    models: strMap(ALL_MODELS, raw.models, DEFAULT_MODELS),
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

export type History = { users: string[]; reply: string; isFirst: boolean; model: string; effort: string; tokens: number | undefined; openTurns: string[] }

const INJECTED = /^\s*(<[a-z_]+[\s>/]|<\/[a-z_]+>|# AGENTS\.md instructions|\[Prompt Router|Codex could not read)/

function textParts(content: unknown) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map(c => (c && typeof c === 'object' && typeof (c as { text?: unknown }).text === 'string' ? (c as { text: string }).text : ''))
    .filter(t => t && !INJECTED.test(t))
    .join('\n')
}

// The chat so far, from the rollout JSONL. Its format is not a stable interface: anything that does
// not read is skipped, and a missing file is an empty chat.
export async function readHistory(path: string | null | undefined): Promise<History> {
  const h: History = { users: [], reply: '', isFirst: true, model: '', effort: '', tokens: undefined, openTurns: [] }
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
      if (j.type === 'turn_context') {
        if (typeof p.model === 'string') h.model = p.model
        const e = typeof p.effort === 'string' ? p.effort : p.collaboration_mode?.settings?.reasoning_effort
        if (typeof e === 'string') h.effort = e
      } else if (j.type === 'event_msg') {
        if (p.type === 'user_message' && typeof p.message === 'string') events.push(p.message)
        else if (p.type === 'agent_message' && typeof p.message === 'string' && p.message.trim()) {
          h.reply = p.message
          h.isFirst = false
        } else if (p.type === 'token_count' && p.info?.last_token_usage) h.tokens = Number(p.info.last_token_usage.total_tokens) || h.tokens
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
  h.users = (events.length ? events : items).map(typed).filter(Boolean)
  h.openTurns = [...open]
  return h
}

// The router class of a Codex model: by the mapping, else none (an unmapped model is not switched).
function routerModel(models: Record<Model, string>, slug: string): Model | '' {
  return ALL_MODELS.find(m => models[m] === slug) ?? ''
}

function schemaFile() {
  const dir = mkdtempSync(join(tmpdir(), 'prompt-router-'))
  return { dir, file: join(dir, 'schema.json'), out: join(dir, 'last.txt') }
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['where', 'model', 'effort', 'why'],
  properties: { where: { type: 'string', enum: ['keep', 'here', 'subagent', 'session'] }, model: { type: 'string' }, effort: { type: 'string' }, why: { type: 'string' } },
}

// The codex binary. The desktop app runs hooks with the short PATH of a Dock app (no Homebrew bin),
// so a bare `codex` is not found there: look in the usual places too.
export function codexBin(env: NodeJS.ProcessEnv = process.env, places = ['/opt/homebrew/bin/codex', '/usr/local/bin/codex', join(homedir(), '.local/bin/codex')]) {
  if (env.PROMPT_ROUTER_CODEX) return env.PROMPT_ROUTER_CODEX
  const onPath = (env.PATH ?? '').split(delimiter).filter(Boolean).map(d => join(d, 'codex'))
  return [...onPath, ...places].find(p => existsSync(p)) ?? 'codex'
}

// The classifier: one ephemeral, read-only `codex exec` with no tools to speak of. Its whole process
// group is killed at the time limit, so nothing is left running.
// codex from npm starts with `#!/usr/bin/env node`, so the child needs node's folder on PATH too.
export function childPath(env: NodeJS.ProcessEnv = process.env, node = process.execPath) {
  const dirs = [dirname(node), dirname(codexBin(env)), ...(env.PATH ?? '').split(delimiter)].filter(d => d && d !== '.')
  return [...new Set(dirs)].join(delimiter)
}

export const codexRunner: Runner = async (prompt, o) => {
  const t = schemaFile()
  try {
    await writeFile(t.file, JSON.stringify(SCHEMA))
    const args = ['exec', '-m', o.model, '-c', `model_reasoning_effort=${o.effort}`, '-c', 'mcp_servers.prompt_router.enabled=false', '--ephemeral', '--skip-git-repo-check', '-s', 'read-only', '--json', '--output-schema', t.file, '-o', t.out, '-C', t.dir, '-']
    const child = spawn(codexBin(), args, { env: { ...process.env, PATH: childPath(), PROMPT_ROUTER_INNER: '1' }, stdio: ['pipe', 'pipe', 'pipe'], detached: true })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', d => (stdout = (stdout + d).slice(-200_000)))
    child.stderr.on('data', d => (stderr = (stderr + d).slice(-4000)))
    child.stdin.on('error', () => {})
    child.stdin.end(prompt)
    const code = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-(child.pid as number), 'SIGKILL')
        } catch {
          child.kill('SIGKILL')
        }
        reject(new Error(`classifier timed out after ${o.timeoutMs} ms`))
      }, o.timeoutMs)
      child.on('error', err => {
        clearTimeout(timer)
        reject(err)
      })
      child.on('exit', c => {
        clearTimeout(timer)
        resolve(c)
      })
    })
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
  if (a === 'off' || a === 'on') {
    const enabled = a === 'on'
    let raw: Record<string, unknown> = {}
    try {
      raw = JSON.parse(await readFile(paths(home).options, 'utf8'))
    } catch {
      raw = {}
    }
    await mkdir(home, { recursive: true })
    await writeFile(paths(home).options, `${JSON.stringify({ ...raw, enabled }, null, 2)}\n`)
    return enabled ? 'Prompt Router is on.' : 'Prompt Router is off. Turn it back on with /router on.'
  }
  return [
    `Prompt Router is ${o.enabled ? 'on' : 'off'} (classifier ${o.models[o.cfg.classifier]}, effort mode ${o.cfg.effortDetection}, model mode ${o.cfg.firstChatDetection}).`,
    `This chat runs on ${cur.model || 'an unknown model'}, effort ${cur.now ? NAMES[cur.now] : 'unknown'}.`,
    `Options: ${o.source}.`,
    ...describeOptions(o.raw, CODEX_DEFAULTS).map(l => `  ${l}`),
    'Commands: /router off, /router on.',
  ].join('\n')
}

// Works out the hook's answer for one prompt; null = the prompt goes on untouched.
export async function handle(input: Input, deps: Deps = {}): Promise<Output | null> {
  const home = deps.codexHome ?? codexHome()
  const o = await loadOptions(home)
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
  if (!o.enabled || text.startsWith('/')) return null

  const levels = await supported(home)
  const effortOf = (slug: string, l: Level) => effortFor(o.efforts, levels, slug, l)
  const ctx: NoteCtx = { cfg: o.cfg, models: o.models, effortOf }
  // Fable only when the chat runs on its model or Codex lists it.
  const avail: Model[] = routerModel(o.models, model) === 'fable' || levels.has(o.models.fable) ? [...ALL_MODELS] : [...BASE_MODELS]
  const users = [...h.users]
  // The rollout may already hold this prompt; the classifier sees it once, as the new one.
  if (users.at(-1) === text) users.pop()
  const all = [...users, text]
  // Mid-chat, a here prompt that fits another model is offered to a subagent on it (the chat's own
  // model never changes: that would break its prompt cache), so the classifier names that model.
  const curClass = routerModel(o.models, model)
  const hereModel = !deps.noSubagent && !!curClass
  const c: Chat = { first: all[0] ?? '', recent: all.slice(-4, -1), reply: h.reply, model, now, tokens: h.tokens, conf: o.cfg, isFirst: h.isFirst, hereModel, models: avail }
  const runner = deps.runner ?? codexRunner
  const reply = await runner(pickPrompt(text, c), { model: classifier, effort: effortOf(classifier, 'low'), timeoutMs: o.timeoutMs })
  const parsed = parsePick(reply, avail)
  if (!parsed && !/"where"\s*:\s*"keep"/.test(reply)) await log(home, 'parse', 'reply could not be parsed')
  // Once per chat, so the log shows what the hook really goes by.
  if (h.isFirst) await log(home, 'effective options', `${o.source} | ${optionsLine(o.raw, CODEX_DEFAULTS)}`)
  let p: Pick | null = parsed && allowed(parsed, o.cfg)
  await log(home, 'pick', `${clip(text, 60)} | now ${model || '?'} ${now || '?'} ${h.tokens ?? '?'} tok | first ${h.isFirst} | ${clip(reply, 200)}`)
  if (!p) return null
  // The first prompt of a chat has nothing to leave: only its model and effort count.
  if (h.isFirst) p = { ...p, where: 'here', first: { now: routerModel(o.models, model) } }
  // A prompt typed over a running turn (steer) belongs to that work.
  const midTurn = h.openTurns.some(t => t !== input.turn_id)

  if (p.where === 'here') {
    if (midTurn || !model) return null
    if (hereModel && !h.isFirst && p.model !== curClass && o.cfg.midChatModelDetection !== 'off') {
      // Mapped to the same Codex effort: Stay here just goes on.
      const effort = p.effort !== now && !(now && effortOf(model, p.effort) === effortOf(model, now))
      return out(`[${(o.cfg.midChatModelDetection === 'auto' ? otherAutoNote : otherNote)(ctx, p, cur, effort)}]`, suggests(o, effortOf, p))
    }
    const from = p.first?.now
    const changeModel = !!from && p.model !== from && o.cfg.firstChatDetection !== 'off'
    const changeEffort = p.effort !== now && o.cfg.effortDetection !== 'off'
    if (!changeModel && !changeEffort) return null
    const slug = changeModel ? o.models[p.model] : model
    const level = changeEffort ? p.effort : (now || p.effort)
    // Mapped to the same Codex setting: nothing to switch.
    if (slug === model && now && effortOf(slug, level) === effortOf(model, now)) return null
    // Codex cannot be switched from here: the same line both ways, auto goes on, ask asks first.
    const asks = (changeModel && o.cfg.firstChatDetection === 'ask') || (changeEffort && o.cfg.effortDetection === 'ask')
    const sys = line(ctx, slug, level, p.why)
    if (asks) return out(`[${switchNote(ctx, p, cur, changeModel ? { from: model } : null, changeEffort ? { now } : null)}]`, sys)
    // notifications off: the agent still gives the line, but no system message comes with it.
    return out(`[${autoNote(ctx, slug, level, p)}]`, o.cfg.notifications === 'on' ? sys : undefined)
  }
  return out(`[${askNote(ctx, p, cur, midTurn)}]`, suggests(o, effortOf, p))
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
