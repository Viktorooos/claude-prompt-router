// Prompt Router for the ChatGPT desktop app: an MCP server with one tool, `route`.
// Where no UserPromptSubmit hook ran (the ChatGPT desktop), AGENTS.md asks the agent to call
// `route` with the prompt first. The answer is the hook's own note, from the same code. Where the
// hook did run (it always leaves a "[Prompt Router: ..." note once it classified), `route` hands
// back the hook's answer for the same prompt instead of classifying it a second time.
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { typed } from '../../plugins/prompt-router/core/router.ts'
import { CHECKED, codexHome, handle, isAppRequest, readHistory, recentAnswer } from './hook.ts'
import type { Deps } from './hook.ts'

const GO_ON = 'Prompt Router: nothing to switch. Answer the prompt now and do not mention the router.'

// Rollout folders of today and yesterday, newest files first.
async function recentRollouts(home: string) {
  const files: { f: string; t: number }[] = []
  for (const back of [0, 1]) {
    const d = new Date(Date.now() - back * 86_400_000)
    const dir = join(home, 'sessions', String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0'))
    let names: string[] = []
    try {
      names = await readdir(dir)
    } catch {
      continue
    }
    for (const n of names) {
      if (!n.endsWith('.jsonl')) continue
      const f = join(dir, n)
      try {
        files.push({ f, t: (await stat(f)).mtimeMs })
      } catch {
        // Gone meanwhile.
      }
    }
  }
  return files.sort((a, b) => b.t - a.t).slice(0, 20).map(x => x.f)
}

// The chat this prompt belongs to: the newest rollout whose last typed prompt is it.
export async function findTranscript(home: string, prompt: string): Promise<string | null> {
  const want = typed(prompt)
  if (!want) return null
  for (const f of await recentRollouts(home)) {
    const last = (await readHistory(f)).users.at(-1) ?? ''
    if (last === want || last.startsWith(want) || want.startsWith(last) && last.length > 20) return f
  }
  return null
}

// The text the agent gets back for one prompt.
export async function route(args: { prompt?: unknown }, deps: Deps = {}): Promise<string> {
  const home = deps.codexHome ?? codexHome()
  const prompt = typeof args.prompt === 'string' ? args.prompt : ''
  // The app's own requests to the model are no user prompts.
  if (isAppRequest(prompt)) return GO_ON
  try {
    const transcript = await findTranscript(home, prompt)
    const h = await readHistory(transcript)
    // The hook classified this prompt already (the desktop runs both): its answer, no second call.
    const known = await recentAnswer(home, h.id, prompt, deps.now ?? Date.now())
    if (known) return known === CHECKED ? GO_ON : known
    // The routed prompt's own turn is open already; it is not a running one. The desktop has no
    // spawn_agent, so a here prompt on another model only judges the effort, as before.
    const r = await handle({ session_id: h.id || undefined, prompt, transcript_path: transcript, turn_id: h.openTurns.at(-1), model: h.model || undefined }, { ...deps, codexHome: home, noSubagent: true })
    const note = r?.hookSpecificOutput?.additionalContext
    return !note || note === CHECKED ? GO_ON : note
  } catch {
    return GO_ON
  }
}

const TOOL = {
  name: 'route',
  title: 'Prompt Router',
  description:
    'Call first, once per user prompt, with the prompt exactly as typed. Returns which model and effort fit it and the one line to begin the reply with. Follow what it returns.',
  inputSchema: { type: 'object', properties: { prompt: { type: 'string', description: 'The user prompt, exactly as typed.' } }, required: ['prompt'] },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
}

type Msg = { jsonrpc?: string; id?: number | string; method?: string; params?: any }

async function answer(m: Msg, deps: Deps): Promise<unknown> {
  switch (m.method) {
    case 'initialize':
      return { protocolVersion: m.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'prompt-router', version: '0.8.0' } }
    case 'ping':
      return {}
    case 'tools/list':
      return { tools: [TOOL] }
    case 'tools/call':
      if (m.params?.name !== 'route') throw Object.assign(new Error(`unknown tool ${m.params?.name}`), { code: -32602 })
      return { content: [{ type: 'text', text: await route(m.params?.arguments ?? {}, deps) }] }
    default:
      throw Object.assign(new Error(`method not found: ${m.method}`), { code: -32601 })
  }
}

// Reads JSON-RPC lines, writes one answer per request (notifications get none).
export async function serve(lines: AsyncIterable<string> | Iterable<string>, write: (line: string) => void, deps: Deps = {}) {
  for await (const line of lines) {
    if (!line.trim()) continue
    let m: Msg
    try {
      m = JSON.parse(line)
    } catch {
      write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }))
      continue
    }
    if (m.id === undefined || m.id === null) continue
    try {
      write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: await answer(m, deps) }))
    } catch (err: any) {
      write(JSON.stringify({ jsonrpc: '2.0', id: m.id, error: { code: err?.code ?? -32603, message: String(err?.message ?? err) } }))
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  serve(createInterface({ input: process.stdin }), l => process.stdout.write(l + '\n'))
}
