import type { ConfigRow, EngineInterface, PromptSubmitInput, Register, SessionMessage } from 'claude-code'

import type { Level } from '../types'

const OVERRIDE = { plugin: 'prompt-router', key: 'override' } as const
const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
const NAMES: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
const SHORT: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' }
const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5' } as const
const MODEL_NAMES = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus' } as const
const ACCENT = '#d97757'

type Where = 'here' | 'subagent' | 'session'
type Config = { project: string; rules: string; language: string; classifier: 'sonnet' | 'haiku'; effortMode: 'auto' | 'ask' }
type Model = keyof typeof MODELS
type Pick = { where: Where; model: Model; effort: Level; why: string }

let home = ''
let cfg: Config = { project: '', rules: '', language: 'auto', classifier: 'sonnet', effortMode: 'auto' }
let enabled = true
// The level the main chat's last request ran at, and its model.
let seen: Level | '' = ''
let seenModel = ''
// The level for the rest of this turn only (a dispatch to a subagent or session runs at low).
let turnLevel: Level | null = null
// The level the mod puts on requests, and the picker level it saw when it took over.
let hold: { level: Level; base: string } | null = null
let lastEffort = ''

async function log($: EngineInterface, what: string, err: unknown) {
  try {
    const path = `${home}/.claude/mods-logs/prompt-router.log`
    const old = (await $.fs.exists(path)) ? String(await $.fs.read(path)) : ''
    const msg = err instanceof Error ? err.message : String(err)
    await $.fs.write(path, `${old.slice(-20_000)}${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`)
  } catch {
    // Nowhere left to report it.
  }
}

function norm(s: string) {
  const t = s.toLowerCase().replace(/[^a-z]/g, '')
  return t === 'extrahigh' ? 'xhigh' : t
}

function asLevel(v: unknown): Level | '' {
  if (typeof v !== 'string') return ''
  const t = norm(v)
  return (LEVELS as readonly string[]).includes(t) ? (t as Level) : ''
}

function asModel(v: unknown): Model {
  const t = typeof v === 'string' ? v.toLowerCase() : ''
  return t.includes('haiku') ? 'haiku' : t.includes('sonnet') ? 'sonnet' : 'opus'
}

function isEffortRow(r: ConfigRow) {
  return /effort/i.test(`${r.key} ${r.label}`) && r.kind === 'choice' && (r.options ?? []).some(o => norm(o) === 'high')
}

async function currentLevel($: EngineInterface): Promise<Level | ''> {
  if (seen) return seen
  try {
    const row = (await $.config.list()).find(isEffortRow)
    return row ? asLevel(row.value) : ''
  } catch {
    return ''
  }
}

function redraw($: EngineInterface) {
  try {
    $.ui.invalidate('ui.render')
  } catch {
    // The next state change redraws anyway.
  }
}

// Sets the chat's effort setting; when no setting takes it, the mod puts the level on every request
// until the person moves the picker.
async function applyLevel($: EngineInterface, level: Level) {
  turnLevel = level
  try {
    const row = (await $.config.list()).find(isEffortRow)
    const option = row?.options?.find(o => norm(o) === level)
    if (row && option && !row.isLocked) {
      const r = await $.config.set({ key: row.key, value: option })
      if (!r.deny) {
        await $.state.set(OVERRIDE, null)
        return
      }
      await log($, 'set effort', r.deny)
    }
  } catch (err) {
    await log($, 'set effort', err)
  }
  hold = { level, base: lastEffort }
  await $.state.set(OVERRIDE, level)
  redraw($)
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// What the classifier sees of the chat. The test tool fills it by hand.
type Chat = { first: string; recent: string[]; reply: string; model: string; now: Level | ''; tokens: number | undefined; conf: Config }

function chatOf(messages: readonly SessionMessage[], now: Level | '', tokens: number | undefined): Chat {
  const users = messages.filter(m => m.role === 'user' && m.text.trim())
  return {
    first: users[0]?.text ?? '',
    recent: users.slice(-4, -1).map(m => m.text),
    reply: [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? '',
    model: seenModel,
    now,
    tokens,
    conf: cfg,
  }
}

function pickPrompt(text: string, c: Chat) {
  const { first, now, tokens } = c
  const recent = c.recent.map(t => `- ${clip(t, 200)}`).join('\n')
  const lastReply = c.reply
  const conf = c.conf
  const lang = conf.language && conf.language.toLowerCase() !== 'auto' ? conf.language : 'the language of the new prompt'
  const rules = conf.rules.trim() ? `\n\nPROJECT RULES (they take precedence over the rules above)\n${conf.rules.trim()}` : ''
  return `You route one prompt in a Claude Code chat about ${conf.project.trim() || 'a software project'}. Decide where it should run, on which model and at which effort. Prompts can be in any language.

WHERE
- keep: the prompt only approves, answers a question or says to go on (yes, ok, go on, do it, option 2, or the same in another language). Answer keep for all three fields.
- here: it builds on what this chat already read, found, decided or changed (a follow-up, a fix of what was just found, the next iteration, a question about it). Also here when the chat is still small (under 30k tokens) and the right model is the current one.
- Also here for anything trivial that takes one short answer (a greeting, a quick fact, a one-line question): starting a subagent or a session costs more than answering it.
- subagent: a self-contained lookup, search, read of something big, build or run whose short answer is needed here, and that needs none of this chat's context.
- session: unrelated to this chat (a new topic, another feature, a task that ends in its own branch or PR), or long mechanical work better done with a fresh context on a cheaper model. Pick session only when you are fairly sure; if unsure, here.

MODEL (for subagent or session; for here use the current one)
- haiku: running builds, lint or tests, reading and summarizing, searching the codebase.
- sonnet: mechanical edits by an existing pattern (strings, renames, porting finished code to another platform), clicking through an app, writing summaries.
- opus: new logic, architecture, debugging, code review, anything risky (money, user data, security, auth).

EFFORT
- low: simple, mechanical or rule-following work, or work the person will iterate on with Claude.
- medium: everyday work with a clear definition of done, including writing tests. The default. If unsure, medium.
- high: a hidden mistake would cost money, data or trust: hunting bugs, reviewing, checking work, payment, data or security logic, architecture decisions.
- xhigh: only a long, hard, critical job the person hands off and walks away from. Never max.
A task being long does not make it high.${rules}

The chat now: model ${c.model || 'unknown'}, effort ${now || 'unknown'}, context ${tokens ? `${Math.round(tokens / 1000)}k tokens` : 'unknown'}.

First prompt of this chat (its topic):
<first>${clip(first, 400) || '(none)'}</first>

Recent prompts:
<recent>
${recent || '(none)'}
</recent>

Claude's last reply (start):
<reply>${clip(lastReply, 600) || '(none)'}</reply>

The new prompt:
<prompt>
${text.slice(0, 4000)}
</prompt>

Reply with JSON only: {"where": "keep|here|subagent|session", "model": "haiku|sonnet|opus", "effort": "low|medium|high|xhigh", "why": "the reason in under 12 plain words, in ${lang}"}`
}

// Reads each field on its own, so a reply with stray characters after the JSON still counts.
function field(text: string, name: string) {
  return new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1] ?? ''
}

function parsePick(text: string): Pick | null {
  const w = field(text, 'where')
  const where = w === 'here' || w === 'subagent' || w === 'session' ? w : null
  const effort = asLevel(field(text, 'effort'))
  if (!where || !effort) return null
  const why = clip(field(text, 'why').replace(/\s*[—–]\s*/g, ', '), 90)
  return { where, model: asModel(field(text, 'model')), effort: effort === 'max' ? 'xhigh' : effort, why }
}

function classify($: EngineInterface, text: string, c: Chat) {
  return $.model.complete({ model: MODELS[c.conf.classifier], prompt: pickPrompt(text, c), maxTokens: 150, effort: 'low', timeoutMs: 20_000 })
}

// One test case for the classifier: a prompt and the chat it arrives in.
type Case = { id?: string; prompt: string; project?: string; rules?: string; language?: string; first?: string; recent?: string[]; reply?: string; model?: string; effort?: string; tokens?: number }

async function runCase($: EngineInterface, k: Case) {
  const c: Chat = {
    first: k.first ?? '',
    recent: k.recent ?? [],
    reply: k.reply ?? '',
    model: k.model ?? 'claude-opus-5-5',
    now: asLevel(k.effort ?? 'medium'),
    tokens: k.tokens,
    conf: { ...cfg, project: k.project ?? cfg.project, rules: k.rules ?? cfg.rules, language: k.language ?? cfg.language },
  }
  try {
    const r = await classify($, k.prompt, c)
    if (!r.isAnswered) return `${k.id ?? '?'}\tERROR ${r.reason}`
    const p = parsePick(r.text)
    if (!p) return `${k.id ?? '?'}\t${/"where"\s*:\s*"keep"/.test(r.text) ? 'keep' : `UNPARSED ${clip(r.text, 120)}`}`
    return `${k.id ?? '?'}\t${p.where}\t${p.model}\t${p.effort}\t${p.why}`
  } catch (err) {
    return `${k.id ?? '?'}\tERROR ${err instanceof Error ? err.message : String(err)}`
  }
}

async function pick($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null> {
  const messages = await $.session.messages()
  let tokens: number | undefined
  try {
    tokens = (await $.session.usage()).context.tokens
  } catch {
    tokens = undefined
  }
  const r = await classify($, text, chatOf(messages, now, tokens))
  if (!r.isAnswered) throw new Error(`pick failed: ${r.reason}`)
  const p = parsePick(r.text)
  if (!p && !/"where"\s*:\s*"keep"/.test(r.text)) await log($, 'parse', 'reply could not be parsed')
  const isFirst = !messages.some(m => m.role === 'assistant')
  await log($, 'pick', `${clip(text, 60)} | now ${seenModel || '?'} ${now || '?'} ${tokens ?? '?'} tok | first ${isFirst} | ${clip(r.text, 200)}`)
  // The first prompt of a chat has nothing to leave: only its effort counts.
  if (p && isFirst) return { ...p, where: 'here' }
  return p
}

function userLang() {
  return cfg.language && cfg.language.toLowerCase() !== 'auto' ? cfg.language : "the user's language (the language of this prompt)"
}

function askNote(p: Pick, now: Level | '') {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  const where = p.where === 'session' ? 'a new session' : 'a subagent'
  const session = `"New session (${label})"`
  const agent = `"Subagent (${label})"`
  const here = `"Do it here"`
  const options = p.where === 'session' ? `${session}, ${agent}, ${here}` : `${agent}, ${here}`
  return `Prompt Router suggests running this prompt in ${where} (${label})${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${now || 'unknown'}. Before doing anything, ask the user with the AskUserQuestion tool (header "Prompt Router", the question "Where should this go?" with the reason in one sentence) with the options ${options}, the recommended one first. Write the question and options in ${userLang()}. Then: new session = call start_session right away with initiation "user_asked", context "fresh", model "${MODELS[p.model]}", effort "${p.effort}", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model "${p.model}" and effort "${p.effort}" and have it return only a short result. Do it here = continue normally.`
}

function effortNote(p: Pick, now: Level | '') {
  return `Prompt Router suggests effort ${p.effort} for this prompt (now ${now || 'unknown'})${p.why ? `, because: ${p.why}` : ''}. Start your reply with one short line in ${userLang()} offering the switch with /effort ${p.effort}, then handle the prompt normally.`
}

// Works out the prompt to send; the hook sends it, so a failure here never loses the prompt.
async function decide($: EngineInterface, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (!enabled || e.command || e.isMeta) return e
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return e
  const text = e.text.trim()
  if (!text || text.startsWith('/')) return e
  turnLevel = null
  const now = await currentLevel($)
  let p: Pick | null = null
  try {
    await $.ui.status('prompt router…')
    p = await pick($, text, now)
  } catch (err) {
    await log($, 'pick', err)
  } finally {
    try {
      await $.ui.status(undefined)
    } catch {
      // Nothing to clear.
    }
  }
  if (!p) return e

  if (p.where === 'here') {
    // Effort alone is set by itself: a question would cost a turn on every prompt.
    if (p.effort !== now) {
      if (cfg.effortMode === 'ask') return { ...e, text: `${e.text}\n\n[${effortNote(p, now)}]` }
      await applyLevel($, p.effort)
      try {
        await $.ui.toast(`Effort: ${NAMES[p.effort]}${now ? ` (was ${NAMES[now]})` : ''}${p.why ? `, ${p.why}` : ''}`)
      } catch {
        // The footer label still shows it.
      }
    }
    return e
  }
  // A mod's own dialog does not open at prompt time in the app, so Claude asks with the same options.
  // `context` does not reach the model for prompts from the app, so the note rides on the text.
  return ({ ...e, text: `${e.text}\n\n[${askNote(p, now)}]` })
}

function str(v: unknown, fallback: string) {
  return typeof v === 'string' ? v : fallback
}

export const register: Register = (on, options) => {
  cfg = {
    project: str(options.project, ''),
    rules: str(options.rules, ''),
    language: str(options.language, 'auto').trim() || 'auto',
    classifier: options.classifier === 'haiku' ? 'haiku' : 'sonnet',
    effortMode: options.effortMode === 'ask' ? 'ask' : 'auto',
  }
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    await $.command.register({ name: 'router', description: 'Prompt Router: status, or off / on', argumentHint: '[off|on]' })
    await $.tool.register({
      name: 'test',
      description: 'Test the Prompt Router classifier: runs each case through the same model call as a live prompt and returns one line per case (id, where, model, effort, why).',
      inputSchema: {
        type: 'object',
        properties: {
          cases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                prompt: { type: 'string' },
                first: { type: 'string', description: 'First prompt of the chat' },
                recent: { type: 'array', items: { type: 'string' } },
                reply: { type: 'string', description: "Start of Claude's last reply" },
                model: { type: 'string' },
                effort: { type: 'string' },
                tokens: { type: 'number' },
                project: { type: 'string', description: 'Overrides the project option for this case' },
                rules: { type: 'string', description: 'Overrides the rules option for this case' },
                language: { type: 'string', description: 'Overrides the language option for this case' },
              },
              required: ['prompt'],
            },
          },
          file: { type: 'string', description: 'Absolute path to a JSON array of cases, instead of cases' },
          runs: { type: 'number', description: 'How many times to run the whole set (1-5)' },
          out: { type: 'string', description: 'Absolute path to write every raw result line to (TSV)' },
        },
      },
      isDeferred: true,
    })
    enabled = (await $.store.get('enabled')) !== false
    // A reload keeps $.state but not module variables: pick the held level back up.
    const kept = (await $.state.get(OVERRIDE)).value
    if (kept && enabled) hold = { level: kept, base: '' }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    let out = e
    try {
      out = await decide($, e)
    } catch (err) {
      await log($, 'prompt.submit', err)
    }
    return next(out)
  })


  // Every main-chat request: note its level and model, and put the chosen level on it.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId !== undefined || typeof e.effort !== 'string') return yield* next(e)
    lastEffort = e.effort
    seenModel = e.model
    // The picker moved (by hand, or /effort): the mod lets go.
    // Taken before the mod saw a request (e.g. right after a reload): this request's level is the base.
    if (hold && !hold.base) hold = { ...hold, base: e.effort }
    if (hold && e.effort !== hold.base) {
      hold = null
      await $.state.set(OVERRIDE, null)
      redraw($)
    }
    const held = enabled && hold ? hold.level : null
    seen = held ?? (asLevel(e.effort) || seen)
    const want = turnLevel ?? held
    if (!want || want === e.effort) return yield* next(e)
    return yield* next({ ...e, effort: want })
  })

  on('tool.call', { tool: 'mcp__prompt-router__test' }, async ($, e) => {
    const input = e as unknown as { cases?: Case[]; file?: string; runs?: number; out?: string }
    const raw = input.file ? (JSON.parse(String(await $.fs.read(input.file))) as Case[]) : (input.cases ?? [])
    const cases = raw.slice(0, 60)
    const runs = Math.min(Math.max(Math.round(input.runs ?? 1), 1), 5)
    const all: string[] = []
    for (let r = 0; r < runs; r++) {
      // Five at a time, so a big batch does not hit rate limits.
      for (let i = 0; i < cases.length; i += 5) {
        all.push(...(await Promise.all(cases.slice(i, i + 5).map(k => runCase($, k)))))
      }
    }
    if (input.out) await $.fs.write(input.out, `${all.join('\n')}\n`)
    // One line per case: each distinct answer and how often it came.
    const byId = new Map<string, Map<string, number>>()
    for (const line of all) {
      const [id = '?', ...rest] = line.split('\t')
      const key = rest.slice(0, 3).join(' ')
      const m = byId.get(id) ?? new Map<string, number>()
      m.set(key, (m.get(key) ?? 0) + 1)
      byId.set(id, m)
    }
    return { result: [...byId].map(([id, m]) => `${id}: ${[...m].map(([k, n]) => `${k} ×${n}`).join(' | ')}`).join('\n') }
  })

  on('command.run', { command: 'router' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'off' || arg === 'on') {
      enabled = arg === 'on'
      await $.store.set('enabled', enabled)
      if (!enabled) {
        hold = null
        turnLevel = null
        await $.state.set(OVERRIDE, null)
      }
      return { text: enabled ? 'Prompt Router is on.' : 'Prompt Router is off. Turn it back on with /router on.' }
    }
    const now = await currentLevel($)
    const { value } = await $.state.get(OVERRIDE)
    return {
      text: [
        `Prompt Router is ${enabled ? 'on' : 'off'} (classifier ${cfg.classifier}, effort mode ${cfg.effortMode}).`,
        `This chat runs on ${seenModel || 'an unknown model so far'}, effort ${now ? NAMES[now] : 'unknown so far'}${value ? ` (held by the router: ${NAMES[value]})` : ''}.`,
        'Commands: /router off, /router on.',
      ].join('\n'),
    }
  })

  // The app's effort menu does not move, so the footer names the level the mod really sends.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!enabled) return next(e)
    const { value } = await $.state.get(OVERRIDE)
    if (!value) return next(e)
    const label = `Effort ${SHORT[value]}`
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Text } = $.ui.resolve(e)
      return <Text color={ACCENT}>{label}</Text>
    }
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })
}
