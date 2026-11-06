import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { routerPlugin } from '../prompt-router.ts'

// A stand-in for zod: every call chains, so tool args can be declared without the package.
const z: any = new Proxy(function () {}, { get: () => z, apply: () => z })
export const tool: any = Object.assign((def: unknown) => def, { schema: z })

export const PICK = {
  here: '{"where": "here", "model": "opus", "effort": "low", "why": "small follow-up"}',
  same: '{"where": "here", "model": "opus", "effort": "medium", "why": "fits"}',
  keep: '{"where": "keep", "model": "keep", "effort": "keep", "why": "approval"}',
  subagent: '{"where": "subagent", "model": "haiku", "effort": "low", "why": "just run the tests"}',
  session: '{"where": "session", "model": "sonnet", "effort": "medium", "why": "unrelated feature"}',
  first: '{"where": "here", "model": "sonnet", "effort": "low", "why": "mechanical rename"}',
}

export type Call = { name: string; args: any }

// A client that records every call. `reply` is what the classifier answers (a string, an Error to
// throw, or 'hang' to never answer). `classifierInfo` goes on the classifier's reply info (tokens, cost).
export function mockClient(o: { reply?: string | Error | 'hang'; history?: Record<string, any[]>; parents?: Record<string, string>; busy?: string[]; providers?: any[]; classifierInfo?: Record<string, unknown> } = {}) {
  const calls: Call[] = []
  let n = 0
  const rec = (name: string, fn: (args: any) => any = () => ({ data: true })) => async (args: any) => {
    calls.push({ name, args })
    return fn(args)
  }
  const client = {
    reply: o.reply ?? PICK.same,
    session: {
      messages: rec('session.messages', a => ({ data: o.history?.[a.path.id] ?? [] })),
      create: rec('session.create', () => ({ data: { id: `scratch-${++n}` } })),
      prompt: rec('session.prompt', () => {
        const r = client.reply
        if (r instanceof Error) throw r
        if (r === 'hang') return new Promise(() => {})
        return { data: { info: { role: 'assistant', ...o.classifierInfo }, parts: [{ type: 'text', text: r }] } }
      }),
      promptAsync: rec('session.promptAsync'),
      delete: rec('session.delete'),
      abort: rec('session.abort'),
      get: rec('session.get', a => ({ data: { id: a.path.id, parentID: o.parents?.[a.path.id] } })),
      status: rec('session.status', () => ({ data: Object.fromEntries((o.busy ?? []).map(id => [id, { type: 'busy' }])) })),
    },
    tui: { showToast: rec('tui.showToast') },
    app: { log: rec('app.log') },
    config: { providers: rec('config.providers', () => ({ data: { providers: o.providers ?? [{ id: 'anthropic', models: { 'claude-opus-5-5': {}, 'claude-sonnet-5-5': {}, 'claude-haiku-5-5': {} } }], default: {} } })) },
  }
  return { client, calls }
}

export function tmp(prefix = 'pr-oc-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

// The control-group draw for the routing tests: never held back, so no prompt lands in it by chance;
// the trial tests pass their own.
export const never = () => false

export async function setup(o: Parameters<typeof mockClient>[0] = {}, options: Record<string, unknown> = {}) {
  const { client, calls } = mockClient(o)
  const dir = tmp()
  const hooks: any = await routerPlugin(tool)({ client }, { stateDir: dir, optionsFile: join(dir, 'none.json'), timeoutMs: 200, draw: never, ...options })
  const config: any = {}
  await hooks.config(config)
  return { hooks, client, calls, dir, config }
}

// One prompt typed in a chat, the way OpenCode calls chat.message.
export async function send(hooks: any, sid: string, text: string, o: { model?: string; variant?: string; agent?: string; parts?: any[] } = {}) {
  const [providerID, modelID] = (o.model ?? 'anthropic/claude-opus-5-5').split('/')
  const output = {
    message: { id: 'msg', sessionID: sid, role: 'user', agent: o.agent ?? 'build', model: { providerID, modelID }, time: { created: 0 } } as any,
    parts: o.parts ?? [{ id: 'prt', sessionID: sid, messageID: 'msg', type: 'text', text }],
  }
  await hooks['chat.message']({ sessionID: sid, agent: o.agent ?? 'build', model: { providerID, modelID }, messageID: 'msg', variant: o.variant ?? 'medium' }, output)
  return output
}

export const said = (out: { parts: any[] }) => out.parts.map(p => p.text).join('\n')
export const named = (calls: Call[], name: string) => calls.filter(c => c.name === name)

// A chat that already has a reply, so the prompt is not the first one.
export const ongoing = (sid: string) => ({
  [sid]: [
    { info: { role: 'user' }, parts: [{ type: 'text', text: 'fix the login bug' }] },
    { info: { role: 'assistant', tokens: { input: 40_000, output: 1000, cache: { read: 0, write: 0 } } }, parts: [{ type: 'text', text: 'Found it in auth.ts.' }] },
  ],
})
