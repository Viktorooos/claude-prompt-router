import type { ConfigRow, EngineInterface, PromptSubmitInput, Register, SessionMessage } from 'claude-code'

import type { Level } from '../types'

const NAME = 'prompt-router'
const OVERRIDE = { plugin: 'prompt-router', key: 'override' } as const
const MODEL_HOLD = { plugin: 'prompt-router', key: 'model' } as const
const TEST_TOOL = `mcp__${NAME}__test`
const SWITCH_TOOL = `mcp__${NAME}__switch`
const LEVELS: readonly Level[] = ['low', 'medium', 'high', 'xhigh', 'max']
const NAMES: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'Extra high', max: 'Max' }
const SHORT: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' }
const MODELS = { haiku: 'claude-haiku-5-5', sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1' } as const
const MODEL_NAMES = { haiku: 'Haiku', sonnet: 'Sonnet', opus: 'Opus', fable: 'Fable' } as const
// Always offered; Fable only when the model setting lists it (or the chat runs on it).
const BASE_MODELS: readonly Model[] = ['haiku', 'sonnet', 'opus']
const ALL_MODELS = Object.keys(MODELS) as Model[]
const ACCENT = '#d97757'

type Where = 'here' | 'subagent' | 'session'
type Config = { project: string; rules: string; language: string; classifier: 'sonnet' | 'haiku' | 'opus'; effortMode: 'auto' | 'ask'; modelMode: 'auto' | 'ask' | 'off' }
type Model = keyof typeof MODELS
type Pick = { where: Where; model: Model; effort: Level; why: string; first?: { now: Model | '' } }

let home = ''
let cfg: Config = { project: '', rules: '', language: 'auto', classifier: 'sonnet', effortMode: 'ask', modelMode: 'ask' }
let enabled = true
// The options as the engine passed them, and a line for /router when they came from elsewhere.
let given: Record<string, unknown> = {}
let cfgNote = ''
// The level the main chat's last request ran at, and its model.
let seen: Level | '' = ''
let seenModel = ''
// The level for the rest of this turn only (a dispatch to a subagent or session runs at low).
let turnLevel: Level | null = null
// The level the mod puts on requests, and the picker level it saw when it took over.
let hold: { level: Level; base: string } | null = null
let lastEffort = ''
// The model the mod puts on main-chat requests when the model setting could not be changed,
// and the model the engine named when it took over.
let modelHold: { model: Model; base: string } | null = null

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

// A model id or alias the router knows, or '' (e.g. a custom or non-Claude model).
function knownModel(v: unknown): Model | '' {
  const t = typeof v === 'string' ? v.toLowerCase() : ''
  return ALL_MODELS.find(m => t.includes(m)) ?? ''
}

// A model the router may offer: an unknown or unavailable one falls back to Opus.
function asModel(v: unknown, models: readonly Model[] = ALL_MODELS): Model {
  const m = knownModel(v)
  return m && models.includes(m) ? m : 'opus'
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

function isModelRow(r: ConfigRow) {
  return /model/i.test(`${r.key} ${r.label}`) && !/effort|subagent|classifier/i.test(`${r.key} ${r.label}`) && r.kind === 'choice'
}

// Switches the chat's model setting; when no setting takes it, the mod names the model on every
// main-chat request until the person picks another one.
async function applyModel($: EngineInterface, model: Model) {
  try {
    const row = (await $.config.list()).find(isModelRow)
    const opts = row?.options ?? []
    const option = opts.find(o => o.toLowerCase() === model) ?? opts.find(o => knownModel(o) === model && !/\[/.test(o))
    if (row && option && !row.isLocked) {
      const r = await $.config.set({ key: row.key, value: option })
      if (!r.deny) {
        modelHold = null
        await $.state.set(MODEL_HOLD, null)
        seenModel = MODELS[model]
        return
      }
      await log($, 'set model', r.deny)
    }
  } catch (err) {
    await log($, 'set model', err)
  }
  modelHold = { model, base: '' }
  seenModel = MODELS[model]
  await $.state.set(MODEL_HOLD, model)
  redraw($)
}

// What the person typed: the app puts its own blocks (<system-reminder>…) before it, at times
// tens of thousands of characters, which would push the prompt out of what the classifier reads.
function typed(text: string) {
  return text.replace(/<system-reminder>[\s\S]*?(?:<\/system-reminder>|$)/g, '').trim()
}

function clip(s: string, n: number) {
  const t = s.replace(/\s+/g, ' ').trim()
  return t.length > n ? `${t.slice(0, n)}…` : t
}

// What the classifier sees of the chat. The test tool fills it by hand.
type Chat = { first: string; recent: string[]; reply: string; model: string; now: Level | ''; tokens: number | undefined; conf: Config; isFirst?: boolean; models: readonly Model[] }

function chatOf(messages: readonly SessionMessage[], now: Level | '', tokens: number | undefined, model: string, models: readonly Model[]): Chat {
  const users = messages.filter(m => m.role === 'user').map(m => typed(m.text)).filter(Boolean)
  return {
    first: users[0] ?? '',
    recent: users.slice(-4, -1),
    reply: [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? '',
    model,
    now,
    tokens,
    conf: cfg,
    isFirst: !messages.some(m => m.role === 'assistant'),
    models,
  }
}

// The classifier prompt. {{name}} slots are filled per prompt; the test tool can swap the whole
// template for a file, so the rules can be tuned without reloading the mod.
const TEMPLATE = `You route one prompt in a Claude Code chat about {{project}}. Decide where it should run, on which model and at which effort. Prompts can be in any language.

WHERE
- keep: the prompt only approves, answers a question or says to go on (yes, ok, go on, do it, option 2, or the same in another language). Answer keep for all three fields.
- here: it builds on what this chat already read, found, decided or changed (a follow-up, a fix of what was just found, the next iteration, a question about it). Also here when the chat is still small (under 30k tokens) and the right model is the current one.
- Also here for anything trivial that takes one short answer (a greeting, a quick fact, a one-line question) when it relates to this chat or the chat is under 60k tokens: starting a subagent or a session costs more than answering it. In a bigger chat every reply re-reads the whole context, so an unrelated task, even a trivial one, goes to session. A greeting or small talk is not a task and stays here.
- subagent: a self-contained lookup, search, read of something big, build or run whose short answer is needed here, and that needs none of this chat's context.
- session: unrelated to this chat (a new topic, another feature, a task that ends in its own branch or PR, or anything unrelated at all once the chat is over 60k tokens), or long mechanical work better done with a fresh context on a cheaper model. Pick session only when you are fairly sure; if unsure, here.

{{model_head}}
- haiku: anything that takes one short answer and no code changes, except a greeting or opener with no task yet, which keeps the current model (a short message or email, a translation, a quick fact, a regex or one command); running builds, lint or tests; reading and summarizing; searching the codebase.
- sonnet: mechanical edits by an existing pattern (strings, renames, porting finished code to another platform), clicking through an app, writing summaries.
- opus: new logic, architecture, debugging, code review, anything risky (money, user data, security, auth, rewriting git history, force pushes, deleting data or anything else hard to undo). Also opus when the work is open-ended or its size is unclear.{{fable}}

EFFORT
- low: simple, mechanical or rule-following work, a greeting, a short message or a quick answer, or work the person will iterate on with Claude.
- medium: everyday work with a clear definition of done, including writing tests. The default. If unsure, medium.
- high: a hidden mistake would cost money, data or trust: hunting bugs, reviewing, checking work, payment, data or security logic, architecture decisions.
- xhigh: only a long, hard, critical job the person hands off and walks away from.
- max: only when the person explicitly asks for the maximum effort or thinking, or for a one-off irreversible step with a very high cost of a mistake (production data, a live security incident) where time does not matter. Never for everyday work, a feature or a review, however important. "Do it properly" or "be careful" is not max.
A task being long does not make it high. Words like important, critical, carefully, properly or take your time do not raise the effort beyond high on their own; only handing off a long job (xhigh) or the max cases above do.
Examples: reviewing payment code = opus, high (not xhigh, not max). A big feature on iOS and Android with a known design = opus, medium or high. A database migration done the usual way = medium or high. A one-off script that rewrites production data and cannot be undone, checked with all the care possible = max.{{rules}}

The chat now: model {{model}}, effort {{effort}}, context {{tokens}}.

First prompt of this chat (its topic):
<first>{{first}}</first>

Recent prompts:
<recent>
{{recent}}
</recent>

Claude's last reply (start):
<reply>{{reply}}</reply>

The new prompt:
<prompt>
{{prompt}}
</prompt>

Reply with JSON only: {"where": "keep|here|subagent|session", "model": "{{models}}", "effort": "low|medium|high|xhigh|max", "why": "the reason in under 12 plain words, in {{lang}}"}`

const MODEL_HEAD_FIRST = 'MODEL (this is the FIRST prompt of a new chat: pick the model the whole chat should run on, by the rules below; for a greeting or an opener with no task yet, answer the current model)'
const MODEL_HEAD = 'MODEL (for subagent or session; for here use the current one)'
const FABLE_RULE = `
- fable: rare, 2.5 times the price of opus; only where opus at high effort is likely not enough: a new architecture across several layers (shared code plus iOS and Android, or backend plus clients) with no clear solution yet; a hard concurrency or race problem, or a security hole whose reach across several services is still unknown; a bug that two or more fixes already failed to solve; a deep analysis of a whole large system (many services) where a wrong conclusion costs a lot of money or data. Not fable (opus instead): an everyday feature, however big or important; a code review of a given module, also of payments or security code; payments, auth or a migration with a known approach or an official guide; anything mechanical; a question about architecture. A single failed fix is not two.`

function pickPrompt(text: string, c: Chat, template = TEMPLATE) {
  const conf = c.conf
  const slots: Record<string, string> = {
    project: conf.project.trim() || 'a software project',
    model_head: c.isFirst && conf.modelMode !== 'off' ? MODEL_HEAD_FIRST : MODEL_HEAD,
    models: c.models.join('|'),
    fable: c.models.includes('fable') ? FABLE_RULE : '',
    rules: conf.rules.trim() ? `\n\nPROJECT RULES (they take precedence over the rules above)\n${conf.rules.trim()}` : '',
    model: c.model || 'unknown',
    effort: c.now || 'unknown',
    tokens: c.tokens ? `${Math.round(c.tokens / 1000)}k tokens` : 'unknown',
    first: clip(c.first, 400) || '(none)',
    recent: c.recent.map(t => `- ${clip(t, 200)}`).join('\n') || '(none)',
    reply: clip(c.reply, 600) || '(none)',
    prompt: text.slice(0, 4000),
    lang: conf.language && conf.language.toLowerCase() !== 'auto' ? conf.language : 'the language of the new prompt',
  }
  // One pass, so a slot's value that holds {{...}} (a prompt about templates) stays as written.
  return template.replace(/\{\{(\w+)\}\}/g, (m, k: string) => slots[k] ?? m)
}

// Reads each field on its own, so a reply with stray characters after the JSON still counts.
function field(text: string, name: string) {
  return new RegExp(`"${name}"\\s*:\\s*"([^"]*)"`).exec(text)?.[1] ?? ''
}

function parsePick(text: string, models: readonly Model[] = ALL_MODELS): Pick | null {
  const w = field(text, 'where')
  const where = w === 'here' || w === 'subagent' || w === 'session' ? w : null
  const effort = asLevel(field(text, 'effort'))
  if (!where || !effort) return null
  const why = clip(field(text, 'why').replace(/\s*[—–]\s*/g, ', '), 90)
  return { where, model: asModel(field(text, 'model'), models), effort, why }
}

function classify($: EngineInterface, text: string, c: Chat, template?: string) {
  return $.model.complete({ model: MODELS[c.conf.classifier], prompt: pickPrompt(text, c, template), maxTokens: 150, effort: 'low', timeoutMs: 20_000 })
}

// One test case for the classifier: a prompt and the chat it arrives in.
type Case = { id?: string; prompt: string; isFirst?: boolean; models?: string[]; classifier?: string; project?: string; rules?: string; language?: string; first?: string; recent?: string[]; reply?: string; model?: string; effort?: string; tokens?: number }

async function runCase($: EngineInterface, k: Case, template?: string) {
  const c: Chat = {
    first: k.first ?? '',
    recent: k.recent ?? [],
    reply: k.reply ?? '',
    model: k.model ?? 'claude-opus-5-5',
    now: asLevel(k.effort ?? 'medium'),
    tokens: k.tokens,
    conf: {
      ...cfg,
      project: k.project ?? cfg.project,
      rules: k.rules ?? cfg.rules,
      language: k.language ?? cfg.language,
      classifier: k.classifier === 'haiku' || k.classifier === 'sonnet' || k.classifier === 'opus' ? k.classifier : cfg.classifier,
    },
    isFirst: k.isFirst ?? false,
    models: k.models ? ALL_MODELS.filter(m => k.models?.includes(m)) : ALL_MODELS,
  }
  try {
    const r = await classify($, k.prompt, c, template)
    if (!r.isAnswered) return `${k.id ?? '?'}\tERROR ${r.reason}`
    const p = parsePick(r.text, c.models)
    if (!p) return `${k.id ?? '?'}\t${/"where"\s*:\s*"keep"/.test(r.text) ? 'keep' : `UNPARSED ${clip(r.text, 120)}`}`
    return `${k.id ?? '?'}\t${p.where}\t${p.model}\t${p.effort}\t${p.why}`
  } catch (err) {
    return `${k.id ?? '?'}\tERROR ${err instanceof Error ? err.message : String(err)}`
  }
}

// The model the chat runs on before its first request: the session's, else the model setting.
async function chatModel($: EngineInterface) {
  try {
    const m = await $.session.model()
    if (knownModel(m)) return m
  } catch {
    // Try the setting.
  }
  try {
    const row = (await $.config.list()).find(isModelRow)
    return typeof row?.value === 'string' ? row.value : ''
  } catch {
    return ''
  }
}

// The models the router may offer this chat.
async function availableModels($: EngineInterface, model: string): Promise<Model[]> {
  if (knownModel(model) === 'fable') return ALL_MODELS
  try {
    const row = (await $.config.list()).find(isModelRow)
    if (row?.options?.some(o => knownModel(o) === 'fable')) return ALL_MODELS
  } catch {
    // The base models.
  }
  return [...BASE_MODELS]
}

async function pick($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null> {
  const messages = await $.session.messages()
  let tokens: number | undefined
  try {
    tokens = (await $.session.usage()).context.tokens
  } catch {
    tokens = undefined
  }
  const model = seenModel || (await chatModel($))
  const models = await availableModels($, model)
  const r = await classify($, text, chatOf(messages, now, tokens, model, models))
  if (!r.isAnswered) throw new Error(`pick failed: ${r.reason}`)
  const p = parsePick(r.text, models)
  if (!p && !/"where"\s*:\s*"keep"/.test(r.text)) await log($, 'parse', 'reply could not be parsed')
  const isFirst = !messages.some(m => m.role === 'assistant')
  await log($, 'pick', `${clip(text, 60)} | now ${model || '?'} ${now || '?'} ${tokens ?? '?'} tok | first ${isFirst} | ${clip(r.text, 200)}`)
  // The first prompt of a chat has nothing to leave: only its model and effort count.
  if (p && isFirst) return { ...p, where: 'here', first: { now: knownModel(model) } }
  return p
}

function userLang() {
  return cfg.language && cfg.language.toLowerCase() !== 'auto' ? cfg.language : "the user's language (the language of this prompt)"
}

// The chat's own model and effort change through the mod's tool: set_session_model and
// set_session_effort refuse the session they run in.
function switchCall(to: { model?: Model; effort?: Level }) {
  const args = JSON.stringify({ ...(to.model ? { model: to.model } : {}), ...(to.effort ? { effort: to.effort } : {}) })
  const slash = [to.model ? `/model ${to.model}` : '', to.effort ? `/effort ${to.effort}` : ''].filter(Boolean).join(' and ')
  return `call the ${SWITCH_TOOL} tool with ${args} (load it with ToolSearch "select:${SWITCH_TOOL}" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run ${slash})`
}

// Here keeps its own effort choice: a lower effort fits a task even when it stays in this chat.
function askNote(p: Pick, now: Level | '', midTurn = false, inApp = true) {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  const where = p.where === 'session' ? 'a new session' : 'a subagent'
  const session = `"New session (${label})"`
  const agent = `"Subagent (${label})"`
  const effort = !midTurn && p.effort !== now
  const switchHere = `"Do it here (${NAMES[p.effort]})"`
  const keepHere = now ? `"Do it here (keep ${NAMES[now]})"` : `"Do it here (keep the effort)"`
  const here = !effort ? `"Do it here"` : cfg.effortMode === 'ask' ? `${switchHere}, ${keepHere}` : switchHere
  const options = p.where === 'session' ? `${session}, ${agent}, ${here}` : `${agent}, ${here}`
  const hereThen = !effort
    ? 'Do it here = continue normally.'
    : cfg.effortMode === 'ask'
      ? `${switchHere} = ${switchCall({ effort: p.effort })}, then handle the prompt; ${keepHere} = continue normally.`
      : `${switchHere} = ${switchCall({ effort: p.effort })}, then handle the prompt.`
  return `Prompt Router suggests running this prompt in ${where} (${label})${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${now || 'unknown'}. Before doing anything, ask the user with the AskUserQuestion tool (header "Prompt Router", the question "Where should this go?" with the reason in one sentence) with the options ${options}, the recommended one first. Write the question and options in ${userLang()}. Then: ${sessionThen(p, inApp)} Subagent = call the Agent tool with model "${p.model}" and effort "${p.effort}" and have it return only a short result. ${hereThen}`
}

// start_session is the desktop app's; in a terminal or VS Code the person opens the session.
function sessionThen(p: Pick, inApp: boolean) {
  if (inApp) return `new session = call start_session right away with initiation "user_asked", context "fresh", model "${MODELS[p.model]}", effort "${p.effort}", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went.`
  return `new session = this client cannot start one, so give the user, in a bash code block, the command to run in a new terminal: claude --model ${MODELS[p.model]} --effort ${p.effort} "<the task from this message, with what it needs to know, in one line>", then stop here.`
}

// Whether this chat can start a session itself: the tool is listed, or the app draws (where it
// may be deferred and so missing from the list).
async function canStartSession($: EngineInterface) {
  try {
    if ((await $.tool.list()).some(t => /(^|__)start_session$/.test(t.name))) return true
  } catch {
    // Ask the surfaces.
  }
  try {
    return (await $.session.surfaces()).includes('desktop')
  } catch {
    return false
  }
}

// The person decides: one dialog for the model and effort changes the router would make.
function switchNote(p: Pick, model: { from: Model } | null, effort: { now: Level | '' } | null) {
  const parts = [
    model ? `model ${MODEL_NAMES[p.model]} instead of ${MODEL_NAMES[model.from]}` : '',
    effort ? `effort ${p.effort} instead of ${effort.now || 'unknown'}` : '',
  ].filter(Boolean)
  const label = [model ? MODEL_NAMES[p.model] : '', effort ? NAMES[p.effort] : ''].filter(Boolean).join(' · ')
  const how = switchCall({ model: model ? p.model : undefined, effort: effort ? p.effort : undefined })
  return `Prompt Router suggests ${parts.join(' and ')} for this prompt${p.why ? `, because: ${p.why}` : ''}. Before doing anything, ask the user with the AskUserQuestion tool (header "Prompt Router", the question "Switch?" with the reason in one sentence) with the options "Switch (${label})", "Keep as is", the recommended one first. Write the question and options in ${userLang()}. On Switch, ${how}, then handle the prompt; on Keep as is, handle the prompt normally.`
}

// Works out the prompt to send; the hook sends it, so a failure here never loses the prompt.
async function decide($: EngineInterface, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (!enabled || e.command || e.isMeta) return e
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return e
  const text = typed(e.text)
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
    // A prompt typed over a running turn belongs to that work: its model and effort stay.
    if (e.turnId) return e
    const changes: string[] = []
    let askModel: { from: Model } | null = null
    let askEffort: { now: Level | '' } | null = null
    // A new chat: the model it starts on may not fit the task.
    const from = p.first?.now
    if (from && p.model !== from && cfg.modelMode !== 'off') {
      if (cfg.modelMode === 'ask') askModel = { from }
      else {
        await applyModel($, p.model)
        changes.push(`Model: ${MODEL_NAMES[p.model]} (was ${MODEL_NAMES[from]})`)
      }
    }
    if (p.effort !== now) {
      if (cfg.effortMode === 'ask') askEffort = { now }
      else {
        await applyLevel($, p.effort)
        changes.push(`Effort: ${NAMES[p.effort]}${now ? ` (was ${NAMES[now]})` : ''}`)
      }
    }
    if (changes.length) {
      try {
        await $.ui.toast(`${changes.join(', ')}${p.why ? `, ${p.why}` : ''}`)
      } catch {
        // The footer label still shows it.
      }
    }
    return askModel || askEffort ? { ...e, text: `${e.text}\n\n[${switchNote(p, askModel, askEffort)}]` } : e
  }
  // A mod's own dialog does not open at prompt time in the app, so Claude asks with the same options.
  // `context` does not reach the model for prompts from the app, so the note rides on the text.
  const inApp = p.where === 'session' ? await canStartSession($) : true
  return ({ ...e, text: `${e.text}\n\n[${askNote(p, now, !!e.turnId, inApp)}]` })
}

function str(v: unknown, fallback: string) {
  return typeof v === 'string' ? v : fallback
}

function toConfig(options: Record<string, unknown>): Config {
  return {
    project: str(options.project, ''),
    rules: str(options.rules, ''),
    language: str(options.language, 'auto').trim() || 'auto',
    classifier: options.classifier === 'haiku' || options.classifier === 'opus' ? options.classifier : 'sonnet',
    effortMode: options.effortMode === 'auto' ? 'auto' : 'ask',
    modelMode: options.modelMode === 'auto' ? 'auto' : options.modelMode === 'off' ? 'off' : 'ask',
  }
}

// The engine reads options only under the full id (prompt-router@<marketplace>), so options saved
// under the plain name were ignored without a word and the mod asked although they said auto.
// They count here unless a full-id entry exists, and /router says where they belong.
async function loadShortKey($: EngineInterface) {
  cfgNote = ''
  try {
    const all = (JSON.parse(String(await $.fs.read(`${home}/.claude/settings.json`))) as { pluginConfigs?: Record<string, { options?: unknown }> }).pluginConfigs ?? {}
    if (Object.keys(all).some(k => k.startsWith(`${NAME}@`))) return
    const opts = all[NAME]?.options
    if (!opts || typeof opts !== 'object') return
    // With no full-id entry the engine's values are only the defaults, so the saved ones win.
    cfg = toConfig({ ...given, ...(opts as Record<string, unknown>) })
    cfgNote = `Options come from "pluginConfigs" › "${NAME}" in ~/.claude/settings.json. Rename that key to "${NAME}@${NAME}", the name Claude Code reads them under.`
    await log($, 'options', cfgNote)
  } catch {
    // No settings file, or one that does not parse: the engine's options stand.
  }
}

export const register: Register = (on, options) => {
  given = { ...options }
  cfg = toConfig(given)
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    await loadShortKey($)
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
                isFirst: { type: 'boolean', description: 'The prompt opens a new chat (the model check runs)' },
                models: { type: 'array', items: { type: 'string' }, description: 'The models the router may offer (default: all, Fable included)' },
                classifier: { type: 'string', description: 'sonnet, haiku or opus, overriding the classifier option' },
              },
              required: ['prompt'],
            },
          },
          file: { type: 'string', description: 'Absolute path to a JSON array of cases, instead of cases' },
          template: { type: 'string', description: 'Absolute path to a classifier prompt template with {{slots}}, instead of the built-in one' },
          runs: { type: 'number', description: 'How many times to run the whole set (1-5)' },
          out: { type: 'string', description: 'Absolute path to write every raw result line to (TSV)' },
        },
      },
      isDeferred: true,
    })
    await $.tool.register({
      name: 'switch',
      description: "Prompt Router: switches this chat's model and/or effort after the user chose it in the Prompt Router dialog. Applies from the next request of this turn.",
      inputSchema: {
        type: 'object',
        properties: {
          model: { type: 'string', enum: [...ALL_MODELS] },
          effort: { type: 'string', enum: [...LEVELS] },
        },
      },
      isDeferred: true,
    })
    enabled = (await $.store.get('enabled')) !== false
    // A reload keeps $.state but not module variables: pick the held level back up.
    const kept = (await $.state.get(OVERRIDE)).value
    if (kept && enabled) hold = { level: kept, base: '' }
    const keptModel = (await $.state.get(MODEL_HOLD)).value
    if (keptModel && enabled) modelHold = { model: keptModel, base: '' }
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
    // The person picked another model: the mod lets go of the one it held.
    if (modelHold && !modelHold.base) modelHold = { ...modelHold, base: e.model }
    if (modelHold && e.model !== modelHold.base) {
      modelHold = null
      await $.state.set(MODEL_HOLD, null)
      redraw($)
    }
    const heldModel = enabled && modelHold ? MODELS[modelHold.model] : null
    seenModel = heldModel ?? e.model
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
    const step = heldModel && heldModel !== e.model ? { ...e, model: heldModel } : e
    if (!want || want === e.effort) return yield* next(step)
    return yield* next({ ...step, effort: want })
  })

  on('tool.call', { tool: SWITCH_TOOL }, async ($, e) => {
    const input = e as unknown as { model?: string; effort?: string }
    const known = knownModel(input.model)
    const model = known && (await availableModels($, await chatModel($))).includes(known) ? known : ''
    const level = asLevel(input.effort)
    if (model) await applyModel($, model)
    if (level) await applyLevel($, level)
    const done = [model ? `model ${MODEL_NAMES[model]}` : '', level ? `effort ${NAMES[level]}` : ''].filter(Boolean)
    const skipped = [
      input.model && !model ? `model ${JSON.stringify(input.model)} (not offered in this chat)` : '',
      input.effort && !level ? `effort ${JSON.stringify(input.effort)} (unknown)` : '',
    ].filter(Boolean)
    const parts = [
      done.length ? `Switched this chat to ${done.join(' and ')}.` : 'Nothing switched.',
      skipped.length ? `Not switched: ${skipped.join(', ')}.` : done.length ? '' : 'Give model and/or effort.',
    ]
    return { result: parts.filter(Boolean).join(' ') }
  })

  on('tool.call', { tool: TEST_TOOL }, async ($, e) => {
    const input = e as unknown as { cases?: Case[]; file?: string; template?: string; runs?: number; out?: string }
    const raw = input.file ? (JSON.parse(String(await $.fs.read(input.file))) as Case[]) : (input.cases ?? [])
    const cases = raw.slice(0, 200)
    const template = input.template ? String(await $.fs.read(input.template)) : undefined
    const runs = Math.min(Math.max(Math.round(input.runs ?? 1), 1), 5)
    const all: string[] = []
    for (let r = 0; r < runs; r++) {
      // Five at a time, so a big batch does not hit rate limits.
      for (let i = 0; i < cases.length; i += 5) {
        all.push(...(await Promise.all(cases.slice(i, i + 5).map(k => runCase($, k, template)))))
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
        modelHold = null
        await $.state.set(OVERRIDE, null)
        await $.state.set(MODEL_HOLD, null)
      }
      return { text: enabled ? 'Prompt Router is on.' : 'Prompt Router is off. Turn it back on with /router on.' }
    }
    const now = await currentLevel($)
    const { value } = await $.state.get(OVERRIDE)
    return {
      text: [
        `Prompt Router is ${enabled ? 'on' : 'off'} (classifier ${cfg.classifier}, effort mode ${cfg.effortMode}, model mode ${cfg.modelMode}).`,
        `This chat runs on ${seenModel || 'an unknown model so far'}${modelHold ? ' (held by the router)' : ''}, effort ${now ? NAMES[now] : 'unknown so far'}${value ? ` (held by the router: ${NAMES[value]})` : ''}.`,
        cfgNote,
        'Commands: /router off, /router on.',
      ].filter(Boolean).join('\n'),
    }
  })

  // The app's effort menu does not move, so the footer names the level the mod really sends.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!enabled) return next(e)
    const { value } = await $.state.get(OVERRIDE)
    const { value: model } = await $.state.get(MODEL_HOLD)
    if (!value && !model) return next(e)
    const label = [model ? MODEL_NAMES[model] : '', value ? `Effort ${SHORT[value]}` : ''].filter(Boolean).join(' · ')
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Text } = $.ui.resolve(e)
      return <Text color={ACCENT}>{label}</Text>
    }
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })
}
