import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { handle } from '../hook.ts'
import type { Input } from '../hook.ts'

export const FIXTURE = fileURLToPath(new URL('./fixtures/rollout.jsonl', import.meta.url))

export const PICK = {
  here: '{"where": "here", "model": "opus", "effort": "low", "why": "small follow-up"}',
  same: '{"where": "here", "model": "opus", "effort": "medium", "why": "fits"}',
  keep: '{"where": "keep", "model": "keep", "effort": "keep", "why": "approval"}',
  subagent: '{"where": "subagent", "model": "haiku", "effort": "low", "why": "just run the tests"}',
  session: '{"where": "session", "model": "sonnet", "effort": "medium", "why": "unrelated feature"}',
  first: '{"where": "here", "model": "sonnet", "effort": "low", "why": "mechanical rename"}',
}

export function tmp(prefix = 'pr-cx-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

// A CODEX_HOME with the given options and config.toml.
export function home(options?: Record<string, unknown>, toml = 'model = "gpt-6.1-sol"\nmodel_reasoning_effort = "medium"\n\n[desktop]\nmodel = "nope"\n') {
  const h = tmp()
  if (options) writeFileSync(join(h, 'prompt-router.json'), JSON.stringify(options))
  writeFileSync(join(h, 'config.toml'), toml)
  return h
}

// The control-group draw for the routing tests: never held back, so no prompt lands in it by chance;
// the trial tests pass their own.
export const never = () => false

// Runs one prompt through the hook with a classifier that answers `reply` (or throws an Error).
export async function send(prompt: string, o: { reply?: string | Error; options?: Record<string, unknown>; transcript?: string | null; model?: string; turn?: string; codexHome?: string; session?: string; now?: number; draw?: (seed: string, pct: number) => boolean } = {}) {
  const calls: { prompt: string; model: string; effort: string; timeoutMs: number }[] = []
  const h = o.codexHome ?? home(o.options)
  const input: Input = { session_id: o.session ?? 's1', transcript_path: o.transcript === undefined ? FIXTURE : o.transcript, cwd: '/work', hook_event_name: 'UserPromptSubmit', model: o.model ?? 'gpt-6.1-sol', turn_id: o.turn ?? 't2', prompt, permission_mode: 'default' }
  const r = await handle(input, {
    codexHome: h,
    now: o.now,
    draw: o.draw ?? never,
    runner: async (p, x) => {
      calls.push({ prompt: p, ...x })
      const reply = o.reply ?? PICK.same
      if (reply instanceof Error) throw reply
      return reply
    },
  })
  return { r, calls, home: h, context: r?.hookSpecificOutput?.additionalContext ?? '', system: r?.systemMessage ?? '' }
}
