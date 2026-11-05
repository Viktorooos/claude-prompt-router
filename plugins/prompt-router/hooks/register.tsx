import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, PromptSubmitInput, Register, SessionMessage } from 'claude-code'

import type { LastDecision, Level } from '../types'
import { ALL_MODELS, BASE_MODELS, DECIDE_OTHER, DEFAULT_WINDOW, above, compactWindow, inHoldout, namesSetting, LEVELS, MODEL_NAMES, MODELS, NAMES, RUN_SUBAGENT, SWITCHES, allowed, asLevel, compareTarget, preferSession, clip, describeOptions, knownModel, norm, optionsLine, parseFollows, parsePick, pickPrompt, TOLD_OTHER, toConfig, typed, userLang } from '../core/router.ts'
import type { Chat, Config, Follows, Model, Pick, Switch, Where } from '../core/router.ts'
import { usageOf } from '../core/prices.ts'
import type { Usage } from '../core/prices.ts'
import { REFERENCE, accuracyText, balance, balanceParts, balances, byDay, compareLabel, isReference, isRough, modelTable, parseLog, rotate, sampleNote, signed, statsHtml, statsText, summarize, timeText, usd } from '../core/stats.ts'
import { TONES, TONE_THEME, WHERE_LABEL, ago, barText, kTokens, partBarSvg, pulseSvg, ringSvg, sparkSvg, sparkText, tone } from '../core/panel.ts'
import type { Balance, Balances, Decision, Entry, Report } from '../core/stats.ts'

const NAME = 'prompt-router'
const OVERRIDE = { plugin: 'prompt-router', key: 'override' } as const
const MODEL_HOLD = { plugin: 'prompt-router', key: 'model' } as const
const TEST_TOOL = `mcp__${NAME}__test`
const SWITCH_TOOL = `mcp__${NAME}__switch`
const SHORT: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' }
const ACCENT = '#d97757'
const PANE = 'prompt-router'
const PANE_TITLE = 'Prompt Router'
// Change the tag when LastDecision's fields change: a value an older copy stored then reads as none.
const LAST = atom({ plugin: 'prompt-router', key: 'last' } as const, null, { shape: 'last-1' })

let home = ''
let cfg: Config = toConfig({})
let enabled = true
// The options as the engine passed them, the options the mod goes by, and a line for /router when
// they came from elsewhere.
let given: Record<string, unknown> = {}
let opts: Record<string, unknown> = {}
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
// Stats: records not written yet, this chat's id, the model the chat would run on without the router
// and the one the router put on the model setting, the last classifier call's tokens, the last
// decision that asked the user, the router's subagents (their baseline), and today's footer line.
let pending: Entry[] = []
let chatId = ''
let baseline = ''
let routed = ''
// The same for effort: the person's own level, the level the router set, and the last main-chat request's.
let effortBase = ''
let routedLevel = ''
let stepEffort: { effort: Level | ''; base: Level | '' } | null = null
let lastClassifier: { model: string; usage: Usage; ms?: number } | null = null
// What the classifier read of the prompt it just judged, for the decision record.
let lastFollows: Follows | undefined
let lastAsked: { ts: number; where: Where; model: Model } | null = null
// A subagent the router sent work to: the main chat's model, and the main chat's context then.
const routedAgents = new Map<string, { base: string; context: number }>()
// Requests (turn steps) each routed subagent made, for what it spared the main chat.
const agentSteps = new Map<string, number>()
// The model of the main chat's last finished turn, to tell a turn the router switched models on.
let lastTurnModel = ''
// The person moved the picker above the model or effort the router set, since the last main-chat turn.
let manualUp = false
// openPane on: the pane was opened (and placed, or retried on the first prompt) this session.
let paneOpened = false
// The period the pane's savings show (a pane button picks it).
let panePeriod: 'today' | 'week' | 'total' = 'week'

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
  if (!routedLevel) effortBase = lastEffort || effortBase
  routedLevel = level
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
  if (!routed) baseline = seenModel || (await chatModel($)) || baseline
  routed = MODELS[model]
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

function chatOf(messages: readonly SessionMessage[], now: Level | '', tokens: number | undefined, window: number | undefined, model: string, models: readonly Model[]): Chat {
  const users = messages.filter(m => m.role === 'user').map(m => typed(m.text)).filter(Boolean)
  return {
    first: users[0] ?? '',
    recent: users.slice(-4, -1),
    reply: [...messages].reverse().find(m => m.role === 'assistant' && m.text.trim())?.text ?? '',
    model,
    now,
    tokens,
    window,
    conf: cfg,
    isFirst: !messages.some(m => m.role === 'assistant'),
    hereModel: true,
    models,
  }
}

function classify($: EngineInterface, text: string, c: Chat, template?: string) {
  return $.model.complete({ model: MODELS[c.conf.classifier], prompt: pickPrompt(text, c, template), maxTokens: 150, effort: 'low', timeoutMs: 20_000 })
}

// One test case for the classifier: a prompt and the chat it arrives in.
type Case = { id?: string; prompt: string; isFirst?: boolean; hereModel?: boolean; models?: string[]; classifier?: string; project?: string; rules?: string; language?: string; first?: string; recent?: string[]; reply?: string; model?: string; effort?: string; tokens?: number; window?: number }

async function runCase($: EngineInterface, k: Case, template?: string) {
  const c: Chat = {
    first: k.first ?? '',
    recent: k.recent ?? [],
    reply: k.reply ?? '',
    model: k.model ?? 'claude-opus-5-5',
    now: asLevel(k.effort ?? 'medium'),
    tokens: k.tokens,
    window: k.window,
    conf: {
      ...cfg,
      project: k.project ?? cfg.project,
      rules: k.rules ?? cfg.rules,
      language: k.language ?? cfg.language,
      classifier: k.classifier === 'haiku' || k.classifier === 'sonnet' || k.classifier === 'opus' ? k.classifier : cfg.classifier,
    },
    isFirst: k.isFirst ?? false,
    hereModel: k.hereModel ?? false,
    models: k.models ? ALL_MODELS.filter(m => k.models?.includes(m)) : ALL_MODELS,
  }
  try {
    const r = await classify($, k.prompt, c, template)
    if (!r.isAnswered) return `${k.id ?? '?'}\tERROR ${r.reason}`
    const p = parsePick(r.text, c.models)
    if (!p) return `${k.id ?? '?'}\t${/"where"\s*:\s*"keep"/.test(r.text) ? 'keep' : `UNPARSED ${clip(r.text, 120)}`}`
    // The context rule runs too, so a case can check new work in a long chat.
    const q = preferSession(p, c, c.conf)
    return `${k.id ?? '?'}\t${q.where}\t${q.model}\t${q.effort}\t${q.why}`
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

let pickedFrom = ''
// The chat's context at the last pick, for the pane.
let lastCtx: { tokens: number | null; window: number | null } = { tokens: null, window: null }
let compactEnv: { pct?: unknown; window?: unknown } | null = null

// The model's window cut to where Claude Code compacts the chat (the environment is read once).
async function usableWindow($: EngineInterface, window: number | undefined): Promise<number | undefined> {
  if (!compactEnv) {
    try {
      compactEnv = { pct: await $.env.get('CLAUDE_AUTOCOMPACT_PCT_OVERRIDE'), window: await $.env.get('CLAUDE_CODE_AUTO_COMPACT_WINDOW') }
    } catch {
      compactEnv = {}
    }
  }
  return compactWindow(window, compactEnv)
}

async function pick($: EngineInterface, text: string, now: Level | ''): Promise<Pick | null> {
  const messages = await $.session.messages()
  let tokens: number | undefined
  let window: number | undefined
  try {
    const ctx = (await $.session.usage()).context
    tokens = ctx.tokens
    window = await usableWindow($, ctx.window)
  } catch {
    tokens = undefined
  }
  lastCtx = { tokens: tokens ?? null, window: window ?? null }
  const model = seenModel || (await chatModel($))
  const models = await availableModels($, model)
  const began = await $.clock.now()
  const r = await classify($, text, chatOf(messages, now, tokens, window, model, models))
  const ms = Math.max(0, (await $.clock.now()) - began)
  if (!r.isAnswered) throw new Error(`pick failed: ${r.reason}`)
  const used = usageOf(r.usage)
  lastClassifier = used ? { model: MODELS[cfg.classifier], usage: used, ms } : null
  pickedFrom = knownModel(model) || model
  if (!baseline) baseline = model
  const parsed = parsePick(r.text, models)
  lastFollows = parseFollows(r.text)
  if (!parsed && !/"where"\s*:\s*"keep"/.test(r.text)) await log($, 'parse', 'reply could not be parsed')
  const p = parsed && preferSession(allowed(parsed, cfg), { tokens, window }, cfg)
  const isFirst = !messages.some(m => m.role === 'assistant')
  await log($, 'pick', `${clip(text, 60)} | now ${model || '?'} ${now || '?'} ${tokens ?? '?'} tok | first ${isFirst} | ${clip(r.text, 200)}`)
  // The first prompt of a chat has nothing to leave: only its model and effort count.
  if (p && isFirst) return { ...p, where: 'here', first: { now: knownModel(model) } }
  const cur = knownModel(model)
  if (p?.where === 'here' && cur && p.model !== cur && cfg.midChatModelDetection !== 'off') return { ...p, other: { now: cur } }
  return p
}

// The chat's own model and effort change through the mod's tool: set_session_model and
// set_session_effort refuse the session they run in.
function switchCall(to: { model?: Model; effort?: Level }) {
  const args = JSON.stringify({ ...(to.model ? { model: to.model } : {}), ...(to.effort ? { effort: to.effort } : {}) })
  const slash = [to.model ? `/model ${to.model}` : '', to.effort ? `/effort ${to.effort}` : ''].filter(Boolean).join(' and ')
  return `call the ${SWITCH_TOOL} tool with ${args} (load it with ToolSearch "select:${SWITCH_TOOL}" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run ${slash})`
}

// The "do it here" options: here keeps its own effort choice, a lower effort fits a task even
// when it stays in this chat. Without an effort change the option just goes on.
function hereChoice(name: string, p: Pick, now: Level | '', effort: boolean) {
  const switchHere = `"${name} (${NAMES[p.effort]})"`
  const keepHere = now ? `"${name} (keep ${NAMES[now]})"` : `"${name} (keep the effort)"`
  if (!effort || cfg.effortDetection === 'off') return { options: `"${name}"`, then: `"${name}" = continue normally.` }
  if (cfg.effortDetection === 'ask') return { options: `${switchHere}, ${keepHere}`, then: `${switchHere} = ${switchCall({ effort: p.effort })}, then handle the prompt; ${keepHere} = continue normally.` }
  return { options: switchHere, then: `${switchHere} = ${switchCall({ effort: p.effort })}, then handle the prompt.` }
}

// The question leads the note: a note that opens with the reason reads as a status line, and a model
// in a long chat can skip the trailing part of it.
function askFirst(options: string) {
  return `ACTION FIRST, before any other step: call the AskUserQuestion tool (header "Prompt Router", the question "Where should this go?" with the reason in one sentence) with the options ${options}, the recommended one first, written in ${userLang(cfg)}. Do not answer or start the task until the user has picked one.`
}

function askNote(p: Pick, now: Level | '', midTurn = false, inApp = true) {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  const where = p.where === 'session' ? 'a new session' : 'a subagent'
  const session = `"New session (${label})"`
  const agent = `"Subagent (${label})"`
  const here = hereChoice('Do it here', p, now, !midTurn && p.effort !== now)
  const options = p.where === 'session' ? `${session}, ${agent}, ${here.options}` : `${agent}, ${here.options}`
  return `${askFirst(options)} Prompt Router suggests running this prompt in ${where} (${label})${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${now || 'unknown'}. Then: ${sessionThen(p, inApp)} Subagent = call the Agent tool with model "${p.model}" and effort "${p.effort}" and have it return only a short result. ${here.then}`
}

// subagentSuggestions auto: the subagent starts at once, no "Where should this go?". `other` is the
// chat's model when the prompt belongs to this chat but fits another model (the subagent does not see the chat).
function runAgentNote(p: Pick, other?: Model) {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  const head = other
    ? `Prompt Router: this prompt fits ${label} better than this chat's ${MODEL_NAMES[other]}`
    : `Prompt Router: run this prompt in a subagent (${label})`
  const brief = other ? '; it does not see this chat, so give it everything it needs from this chat in its prompt,' : ''
  return `${head}${p.why ? `, because: ${p.why}` : ''}. ${RUN_SUBAGENT} Call the Agent tool with model "${p.model}" and effort "${p.effort}"${brief} and have it return only a short result.${other ? " Never switch this chat's model for it." : ''}`
}

// A prompt that stays here but fits another model: a subagent on that model, or here on the chat's
// model with only the effort judged again. The chat's model never changes mid-chat.
function otherNote(p: Pick, from: Model, now: Level | '') {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  const here = hereChoice('Stay here', p, now, p.effort !== now)
  return `${askFirst(`"Subagent (${label})", ${here.options}`)} Prompt Router: this prompt belongs to this chat but fits ${label} better than this chat's ${MODEL_NAMES[from]}${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${now || 'unknown'}. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Then: Subagent = call the Agent tool with model "${p.model}" and effort "${p.effort}"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. ${here.then}`
}

// midChatModelDetection auto: no "Where should this go?"; staying here judges the effort as
// effortDetection says (auto switches it, ask asks only about it, off leaves it).
function otherAutoNote(p: Pick, from: Model, now: Level | '') {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  const here = hereChoice('Stay here', p, now, p.effort !== now)
  const stay = cfg.effortDetection === 'off' || p.effort === now ? 'handle the prompt normally.'
    : cfg.effortDetection === 'ask' ? `ask the user only about the effort with the AskUserQuestion tool (header "Prompt Router", the question "Effort?" with the reason in one sentence) with the options ${here.options}, in ${userLang(cfg)}; ${here.then}`
    : `${switchCall({ effort: p.effort })}, then handle the prompt.`
  return `Prompt Router: this prompt belongs to this chat but fits ${label} better than this chat's ${MODEL_NAMES[from]}${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${now || 'unknown'}. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. ${DECIDE_OTHER} Subagent = call the Agent tool with model "${p.model}" and effort "${p.effort}"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. Here = ${stay} ${TOLD_OTHER}`
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
  return `Prompt Router suggests ${parts.join(' and ')} for this prompt${p.why ? `, because: ${p.why}` : ''}. Before doing anything, ask the user with the AskUserQuestion tool (header "Prompt Router", the question "Switch?" with the reason in one sentence) with the options "Switch (${label})", "Keep as is", the recommended one first. Write the question and options in ${userLang(cfg)}. On Switch, ${how}, then handle the prompt; on Keep as is, handle the prompt normally.`
}

const statsPath = () => `${home}/.claude/mods-logs/prompt-router-stats.jsonl`

// The prompt's text in a form that repeats when the same question comes again (case and spaces ignored).
let lastPromptKey = ''
const promptKey = (text: string) => text.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 200)

// Notes one routing decision (with what the classifier cost); returns its time stamp. Every result of
// decide() passes here once, so the pane's last decision is written here too.
async function noteDecision($: EngineInterface, where: Decision['where'], to: Decision['to'], outcome: Decision['outcome'], now: Level | '', p?: Pick, wanted?: Decision['to']) {
  const ts = await $.clock.now()
  if (cfg.stats === 'on') {
    pending.push({ kind: 'decision', ts, platform: 'claude-code', chat: chatId, where, from: { model: pickedFrom, effort: now }, to, ...(lastFollows ? { follows: lastFollows } : {}), outcome, ...(lastPromptKey ? { key: lastPromptKey } : {}), ...(lastClassifier ? { classifier: lastClassifier } : {}), ...(wanted ? { holdout: true as const, wanted } : {}) })
  }
  lastClassifier = null
  lastFollows = undefined
  const last: LastDecision = { where: p?.other ? 'other' : where, outcome: outcome === 'asked' ? 'asked' : 'applied', model: to.model, effort: to.effort, why: p?.why ?? '', ts, ...lastCtx }
  try {
    // Readers of the atom (the pane) draw again.
    await update($, LAST, () => last)
  } catch (err) {
    await log($, 'pane', err)
  }
  return ts
}

async function noteAsked($: EngineInterface, where: Where, p: Pick, now: Level | '') {
  lastAsked = { ts: await noteDecision($, where, { model: p.model, effort: p.effort }, 'asked', now, p), where, model: p.model }
}

// A subagent the router starts with no question (subagentSuggestions auto): applied, and remembered
// like an asked one so its turns get the main chat's baseline when it spawns.
async function noteRun($: EngineInterface, p: Pick, now: Level | '') {
  lastAsked = { ts: await noteDecision($, 'subagent', { model: p.model, effort: p.effort }, 'applied', now, p), where: 'subagent', model: p.model }
  if (cfg.notifications !== 'on') return
  try {
    await $.ui.toast(`Subagent: ${MODEL_NAMES[p.model]} · ${NAMES[p.effort]}${p.why ? `, ${p.why}` : ''}`)
  } catch {
    // The agent says it in one line.
  }
}

async function noteAccept($: EngineInterface) {
  if (!lastAsked) return
  if (cfg.stats === 'on') pending.push({ kind: 'accept', ts: await $.clock.now(), platform: 'claude-code', chat: chatId, decision: lastAsked.ts })
  lastAsked = null
}

async function readStats($: EngineInterface) {
  try {
    return String(await $.fs.read(statsPath()))
  } catch {
    return ''
  }
}

// Writes the pending records (the log trimmed to 90 days / 5 MB) and refreshes the footer line.
async function flush($: EngineInterface) {
  if (cfg.stats !== 'on' || !pending.length) return
  const add = pending.map(r => `${JSON.stringify(r)}\n`).join('')
  pending = []
  try {
    const now = await $.clock.now()
    const text = rotate((await readStats($)) + add, now)
    await $.fs.write(statsPath(), text)
  } catch (err) {
    await log($, 'stats', err)
  }
}

// The control group for the savings stats: a prompt the router would only move lower (never to xhigh
// or max, never one that names a model or effort) keeps its setting for holdoutPct % of prompts.
async function holdsOut($: EngineInterface, text: string, p: Pick, now: Level | '') {
  const from = p.first?.now
  const model = !!from && p.model !== from && cfg.firstChatDetection !== 'off'
  const effort = p.effort !== now && cfg.effortDetection !== 'off'
  if (!model && !effort) return false
  if ((model && !above(from, p.model)) || (effort && !above(now, p.effort))) return false
  if (p.effort === 'xhigh' || p.effort === 'max' || namesSetting(text)) return false
  return inHoldout(`${chatId}:${await $.clock.now()}:${lastPromptKey}`, Number(cfg.holdoutPct))
}

// Works out the prompt to send; the hook sends it, so a failure here never loses the prompt.
async function decide($: EngineInterface, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (!enabled || e.command || e.isMeta) return e
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return e
  const text = typed(e.text)
  if (!text || text.startsWith('/')) return e
  lastPromptKey = promptKey(text)
  turnLevel = null
  lastAsked = null
  lastClassifier = null
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
  if (!p) {
    if (lastClassifier) await noteDecision($, 'keep', { model: pickedFrom, effort: now }, 'applied', now)
    return e
  }

  if (p.where === 'here') {
    // A prompt typed over a running turn belongs to that work: its model and effort stay.
    if (e.turnId) {
      await noteDecision($, 'keep', { model: pickedFrom, effort: now }, 'applied', now)
      return e
    }
    if (p.other && cfg.midChatModelDetection === 'ask' && cfg.subagentSuggestions === 'auto') {
      await noteRun($, p, now)
      return { ...e, text: `${e.text}\n\n[${runAgentNote(p, p.other.now)}]` }
    }
    if (p.other) await noteAsked($, 'subagent', p, now)
    if (p.other) return { ...e, text: `${e.text}\n\n[${(cfg.midChatModelDetection === 'auto' ? otherAutoNote : otherNote)(p, p.other.now, now)}]` }
    if (await holdsOut($, text, p, now)) {
      await noteDecision($, 'keep', { model: pickedFrom, effort: now }, 'applied', now, p, { model: p.model, effort: p.effort })
      return e
    }
    const changes: string[] = []
    let askModel: { from: Model } | null = null
    let askEffort: { now: Level | '' } | null = null
    // A new chat: the model it starts on may not fit the task.
    const from = p.first?.now
    if (from && p.model !== from && cfg.firstChatDetection !== 'off') {
      if (cfg.firstChatDetection === 'ask') askModel = { from }
      else {
        await applyModel($, p.model)
        changes.push(`Model: ${MODEL_NAMES[p.model]} (was ${MODEL_NAMES[from]})`)
      }
    }
    if (p.effort !== now && cfg.effortDetection !== 'off') {
      if (cfg.effortDetection === 'ask') askEffort = { now }
      else {
        await applyLevel($, p.effort)
        changes.push(`Effort: ${NAMES[p.effort]}${now ? ` (was ${NAMES[now]})` : ''}`)
      }
    }
    if (changes.length && cfg.notifications === 'on') {
      try {
        await $.ui.toast(`${changes.join(', ')}${p.why ? `, ${p.why}` : ''}`)
      } catch {
        // The footer label still shows it.
      }
    }
    const changed = { model: askModel || !changes.some(c => c.startsWith('Model')) ? pickedFrom : p.model, effort: askEffort || !changes.some(c => c.startsWith('Effort')) ? now : p.effort }
    if (askModel || askEffort) await noteAsked($, 'here', p, now)
    else await noteDecision($, 'here', changed, 'applied', now, p)
    return askModel || askEffort ? { ...e, text: `${e.text}\n\n[${switchNote(p, askModel, askEffort)}]` } : e
  }
  if (p.where === 'subagent' && cfg.subagentSuggestions === 'auto') {
    await noteRun($, p, now)
    return { ...e, text: `${e.text}\n\n[${runAgentNote(p)}]` }
  }
  await noteAsked($, p.where, p, now)
  // A mod's own dialog does not open at prompt time in the app, so Claude asks with the same options.
  // `context` does not reach the model for prompts from the app, so the note rides on the text.
  const inApp = p.where === 'session' ? await canStartSession($) : true
  return ({ ...e, text: `${e.text}\n\n[${askNote(p, now, !!e.turnId, inApp)}]` })
}

// /router on|off and the pane's switch: stored for the next sessions, and a held level or model let go.
async function setEnabled($: EngineInterface, on: boolean) {
  enabled = on
  await $.store.set('enabled', enabled)
  if (!enabled) {
    hold = null
    turnLevel = null
    modelHold = null
    await $.state.set(OVERRIDE, null)
    await $.state.set(MODEL_HOLD, null)
  }
  redraw($)
}

// The switches the pane offers, in the order a press steps through them (newSessionAt from low to off).
const PANE_SWITCHES = [
  { key: 'effortDetection', label: 'Effort detection', values: SWITCHES.effortDetection },
  { key: 'midChatModelDetection', label: 'Mid-chat model', values: SWITCHES.midChatModelDetection },
  { key: 'sessionSuggestions', label: 'Session suggestions', values: SWITCHES.sessionSuggestions },
  { key: 'newSessionAt', label: 'New session at', values: ['40%', '50%', '60%', '70%', 'off'] },
] as const satisfies readonly { key: Switch; label: string; values: readonly string[] }[]

// Saves one option as /config does (settings.json pluginConfigs, through the engine), and goes by it now.
async function saveOption($: EngineInterface, k: Switch, value: string) {
  try {
    const row = (await $.config.list()).find(r => r.key === `${NAME}.${k}` || (r.provider?.plugin === NAME && r.key.endsWith(`.${k}`)))
    const r = await $.config.set({ key: row?.key ?? `${NAME}.${k}`, value })
    if (r.deny) {
      await log($, 'save option', `${k}: ${r.deny}`)
      return
    }
  } catch (err) {
    await log($, 'save option', err)
    return
  }
  opts = { ...opts, [k]: value }
  cfg = toConfig(opts)
  redraw($)
}

// The engine reads options only under the full id (prompt-router@<marketplace>), so options saved
// under the plain name were ignored without a word and the mod asked although they said auto.
// They count here unless a full-id entry exists, and /router says where they belong.
// The engine fills in the manifest defaults, so a switch at its default value may just be unset:
// it gives way to its 0.7 key (effortMode, modelMode) unless settings.json names it.
async function loadOptions($: EngineInterface) {
  cfgNote = ''
  let saved: Record<string, unknown> = {}
  try {
    const all = (JSON.parse(String(await $.fs.read(`${home}/.claude/settings.json`))) as { pluginConfigs?: Record<string, { options?: unknown }> }).pluginConfigs ?? {}
    const full = Object.keys(all).find(k => k.startsWith(`${NAME}@`))
    const entry = all[full ?? NAME]?.options
    if (entry && typeof entry === 'object') {
      saved = entry as Record<string, unknown>
      if (!full) cfgNote = `Options come from "pluginConfigs" › "${NAME}" in ~/.claude/settings.json. Rename that key to "${NAME}@${NAME}", the name Claude Code reads them under.`
    }
  } catch {
    // No settings file, or one that does not parse: the engine's options stand.
  }
  opts = { ...given, ...saved }
  for (const k of Object.keys(SWITCHES) as Switch[]) {
    if (!(k in saved) && opts[k] === SWITCHES[k][0]) delete opts[k]
  }
  cfg = toConfig(opts)
  if (cfgNote) await log($, 'options', cfgNote)
  // Once per session, so the log shows what this copy of the mod really goes by.
  await log($, 'effective options', `${$.plugin.root} | ${optionsLine(opts)}`)
}

// What the pane draws, read fresh on every draw (the atom read subscribes it to the next decision).
async function paneData($: EngineInterface) {
  const now = await $.clock.now()
  const last = await read($, LAST)
  let tokens = last?.tokens ?? null
  let window = last?.window ?? null
  try {
    const ctx = (await $.session.usage()).context
    if (ctx.tokens) {
      tokens = ctx.tokens
      window = (await usableWindow($, ctx.window)) ?? window
    }
  } catch {
    // The last decision's numbers stand.
  }
  const win = window && window > 0 ? window : DEFAULT_WINDOW
  const share = tokens ? (tokens / win) * 100 : null
  const at = cfg.sessionSuggestions === 'off' ? 0 : Number.parseInt(cfg.newSessionAt, 10) || 0
  const model = knownModel(seenModel || (await chatModel($)))
  const effort = await currentLevel($)
  let savings: { report: Report; days: ReturnType<typeof byDay>; balance: Balances } | null = null
  if (cfg.stats === 'on') {
    const records = [...parseLog(await readStats($)), ...pending]
    const c = compareTarget(cfg.compareWith)
    savings = { report: summarize(records, now, c), days: byDay(records, now, 14, c), balance: balances(records, now) }
  }
  return { now, last, tokens, window: win, share, at, tone: tone(share, at), header: `${model ? MODEL_NAMES[model] : 'Model unknown'} · ${effort ? NAMES[effort] : 'effort unknown'}`, savings }
}

// openPane on: opens the pane unasked at the session's start (placed from 144 terminal columns,
// 110 once the person has opened it), and once more on the first prompt, which counts as asked.
async function openPaneUnasked($: EngineInterface, onPrompt: boolean) {
  if (cfg.openPane !== 'on' || paneOpened) return
  try {
    if ((await $.ui.panes()).some(x => x.id === PANE && x.isPlaced)) {
      paneOpened = true
      return
    }
    const r = await $.ui.open({ id: PANE, title: PANE_TITLE })
    if (r.isPlaced || onPrompt) paneOpened = true
  } catch (err) {
    await log($, 'open pane', err)
  }
}

export const register: Register = (on, options) => {
  given = { ...options }
  opts = given
  cfg = toConfig(given)
  on('session.start', async ($, e, next) => {
    home = $.plugin.root.split('/.claude/')[0] ?? ''
    chatId = `${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}`
    pending = []
    baseline = ''
    routed = ''
    effortBase = ''
    routedLevel = ''
    stepEffort = null
    lastAsked = null
    lastClassifier = null
    routedAgents.clear()
    agentSteps.clear()
    lastTurnModel = ''
    manualUp = false
    await loadOptions($)
    await $.command.register({ name: 'router', description: 'Prompt Router: status, off / on, stats, or the panel', argumentHint: '[off|on|stats|panel]' })
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
                window: { type: 'number', description: "The model's context window in tokens (default 200000)" },
                project: { type: 'string', description: 'Overrides the project option for this case' },
                rules: { type: 'string', description: 'Overrides the rules option for this case' },
                language: { type: 'string', description: 'Overrides the language option for this case' },
                isFirst: { type: 'boolean', description: 'The prompt opens a new chat (the model check runs)' },
                hereModel: { type: 'boolean', description: 'Mid-chat in Claude Code: here also names the model the task needs (default false)' },
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
    paneOpened = false
    await openPaneUnasked($, false)
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await openPaneUnasked($, true)
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
    if (e.agentId !== undefined && routedAgents.has(e.agentId)) agentSteps.set(e.agentId, (agentSteps.get(e.agentId) ?? 0) + 1)
    if (e.agentId !== undefined || typeof e.effort !== 'string') return yield* next(e)
    lastEffort = e.effort
    if (!hold && !(routedLevel && e.effort === routedLevel)) {
      if (routedLevel && above(e.effort, routedLevel)) manualUp = true
      routedLevel = ''
      effortBase = e.effort
    }
    // Without the router the chat runs on the person's own pick; a model the router set keeps the old one.
    if (!modelHold && !(routed && knownModel(e.model) === knownModel(routed))) {
      if (routed && above(e.model, routed)) manualUp = true
      routed = ''
      baseline = e.model
    }
    // The person picked another model: the mod lets go of the one it held.
    if (modelHold && !modelHold.base) modelHold = { ...modelHold, base: e.model }
    if (modelHold && e.model !== modelHold.base) {
      if (above(e.model, modelHold.model)) manualUp = true
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
      if (above(e.effort, hold.level)) manualUp = true
      hold = null
      await $.state.set(OVERRIDE, null)
      redraw($)
    }
    const held = enabled && hold ? hold.level : null
    seen = held ?? (asLevel(e.effort) || seen)
    const want = turnLevel ?? held
    stepEffort = { effort: asLevel(want ?? e.effort), base: asLevel(effortBase) }
    const step = heldModel && heldModel !== e.model ? { ...e, model: heldModel } : e
    if (!want || want === e.effort) return yield* next(step)
    return yield* next({ ...step, effort: want })
  })

  // A subagent on the model the router offered: the user took the offer, and its turns are priced
  // against the main chat's model. Other subagents count at their own price.
  on('agent.spawn', async ($, e, next) => {
    const r = await next(e)
    try {
      if (enabled && lastAsked?.where === 'subagent' && 'model' in r && knownModel(r.model) === lastAsked.model) {
        if (r.agentId) {
          let context = 0
          try {
            context = (await $.session.usage()).context.tokens ?? 0
          } catch {
            // Unknown context: the subagent is priced by its own tokens alone.
          }
          routedAgents.set(r.agentId, { base: baseline || seenModel, context })
        }
        await noteAccept($)
      }
    } catch (err) {
      await log($, 'stats', err)
    }
    return r
  })

  // Each finished turn (main chat or subagent): its tokens and the model it would have run on.
  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (!enabled || cfg.stats !== 'on') return r
    try {
      const usage = usageOf(r.usage)
      const model = r.usage?.model ?? (e.agentId ? '' : seenModel)
      const agent = e.agentId ? routedAgents.get(e.agentId) : undefined
      const base = e.agentId ? (agent?.base ?? model) : baseline || model
      const requests = e.agentId ? (agentSteps.get(e.agentId) ?? 0) : 0
      if (e.agentId) agentSteps.delete(e.agentId)
      // The router moved this chat to another model since the last turn (not the person's own switch).
      const switched = !e.agentId && !!lastTurnModel && !!model && model !== lastTurnModel && model !== base
      if (!e.agentId && model) lastTurnModel = model
      const manual = !e.agentId && manualUp
      if (!e.agentId) manualUp = false
      pending.push({
        kind: 'turn', ts: await $.clock.now(), platform: 'claude-code', chat: chatId, ...(e.agentId ? { agentId: e.agentId } : {}), model, baseline: base, ...(usage ? { usage } : {}),
        ...(typeof e.durationMs === 'number' ? { durationMs: e.durationMs } : {}),
        ...(manual ? { manual: true } : {}),
        ...(agent?.context && requests ? { mainContext: agent.context, requests } : {}),
        ...(switched ? { switched: true } : {}),
        ...(!e.agentId && stepEffort?.effort && stepEffort.base ? { effort: stepEffort.effort, baseEffort: stepEffort.base } : {}),
      })
      await flush($)
    } catch (err) {
      await log($, 'stats', err)
    }
    return r
  })

  on('tool.call', { tool: SWITCH_TOOL }, async ($, e) => {
    const input = e as unknown as { model?: string; effort?: string }
    const known = knownModel(input.model)
    const model = known && (await availableModels($, await chatModel($))).includes(known) ? known : ''
    const level = asLevel(input.effort)
    if (model) await applyModel($, model)
    if (level) await applyLevel($, level)
    if (model || level) await noteAccept($)
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
      await setEnabled($, arg === 'on')
      return { text: enabled ? 'Prompt Router is on.' : 'Prompt Router is off. Turn it back on with /router on.' }
    }
    if (arg === 'panel' || arg === 'pane') {
      const r = await $.ui.open({ id: PANE, title: PANE_TITLE })
      return { text: r.isPlaced ? 'Prompt Router pane opened.' : `The Prompt Router pane could not open${r.reason ? `: ${r.reason}` : ''}.` }
    }
    if (arg === 'stats') {
      if (cfg.stats !== 'on') return { text: 'Prompt Router stats are off (option stats). Turn them on with "stats": "on".' }
      await flush($)
      const now = await $.clock.now()
      const records = parseLog(await readStats($))
      const c = compareTarget(cfg.compareWith)
      const report = summarize(records, now, c)
      const perTask = balance(records)
      const page = `${home}/.claude/mods-logs/prompt-router-stats.html`
      let link = ''
      try {
        await $.fs.write(page, statsHtml(report, byDay(records, now, 30, c), c, perTask))
        link = `\n\nWith a graph of the last 30 days: file://${page}`
      } catch (err) {
        await log($, 'stats page', err)
      }
      return { text: `${statsText(report, c, perTask)}${link}` }
    }
    const now = await currentLevel($)
    const { value } = await $.state.get(OVERRIDE)
    return {
      text: [
        `Prompt Router is ${enabled ? 'on' : 'off'} (classifier ${cfg.classifier}, effort mode ${cfg.effortDetection}, model mode ${cfg.firstChatDetection}).`,
        `This chat runs on ${seenModel || 'an unknown model so far'}${modelHold ? ' (held by the router)' : ''}, effort ${now ? NAMES[now] : 'unknown so far'}${value ? ` (held by the router: ${NAMES[value]})` : ''}.`,
        'Options (value and where it came from):',
        ...describeOptions(opts).map(l => `  ${l}`),
        cfgNote,
        'Commands: /router off, /router on, /router stats.',
        'The pane beside the chat: /router panel.',
      ].filter(Boolean).join('\n'),
    }
  })

  // The pane beside the chat: context, the last decision, the savings and the main switches.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const d = await paneData($)
    const press = (k: 'enabled' | Switch) => async () => {
      if (k === 'enabled') return setEnabled($, !enabled)
      const sw = PANE_SWITCHES.find(x => x.key === k)
      if (!sw) return
      const vals: readonly string[] = sw.values
      await saveOption($, k, vals[(vals.indexOf(cfg[k]) + 1) % vals.length] ?? vals[0]!)
    }
    const switches = [{ key: 'enabled' as const, label: 'Router', value: enabled ? 'on' : 'off' }, ...PANE_SWITCHES.map(x => ({ key: x.key, label: x.label, value: String(cfg[x.key]) }))]
    const where = d.last ? WHERE_LABEL[d.last.where] : null
    const lm = d.last ? knownModel(d.last.model) : ''
    const lastModel = d.last ? `${lm ? MODEL_NAMES[lm] : d.last.model || '?'} · ${d.last.effort ? NAMES[d.last.effort] : '?'}` : ''
    const age = d.last ? d.now - d.last.ts : Infinity
    const ctxLine = d.tokens ? `${kTokens(d.tokens)} of ${kTokens(d.window)} tokens` : 'Context not known yet'
    const atLine = d.at ? `New session at ${d.at}%` : 'New-session rule off'

    const s = d.savings?.report[panePeriod] ?? null
    const b: Balance | null = d.savings?.balance[panePeriod] ?? null
    const pickPeriod = (k: typeof panePeriod) => async () => {
      panePeriod = k
      redraw($)
    }
    const money = (v: number) => (Math.abs(v) < 0.005 ? 'none' : v > 0 ? 'up' : 'down')
    const MONEY_COLOR = { up: TONES.calm[0], down: TONES.over[0], none: undefined }
    const balanceColor = s ? MONEY_COLOR[money(s.balanceUsd)] : undefined
    const c = compareTarget(cfg.compareWith)
    const showReference = !isReference(c)
    const verdict = !s || s.withoutUsd <= 0
      ? 'No priced work in this period yet.'
      : `${s.balanceUsd >= 0.005 ? 'saved' : s.balanceUsd <= -0.005 ? 'lost' : 'even'} · ${Math.round(Math.abs(s.balancePct))} % of ${usd(s.withoutUsd)}, what the work would have cost ${c ? `on ${compareLabel(c)}` : 'without the router'}`
    const perPrompt = s && s.prompts ? `$${(s.classifierUsd / s.prompts).toFixed(3)}` : '$0'
    const activity = s ? `${s.prompts} prompts · ${s.modelChanges} model changes · effort ↓${s.effortDown} ↑${s.effortUp} · ${s.subagents} subagents · ${s.sessions} new sessions` : ''
    const NOTE = 'An estimate from list prices. Effort is a guess (output tokens weighted per level). Full table: /router stats.'

    // The terminal's bill for the picked period (fixed columns, so label left and value right lines
    // up): what it would have cost, what it cost, and where the difference came from (the parts add
    // up to the balance). The desktop pane stacks the same figures instead.
    const billView = (Box: any, Text: any) => {
      if (!s) return null
      const row = (key: string, label: string, text: string, o: { dim?: boolean; bold?: boolean; color?: string } = {}) => (
        <Box key={key} flexDirection="row" justifyContent="space-between">
          <Text dimColor={o.dim} bold={o.bold}>{label}</Text>
          <Text dimColor={o.dim} bold={o.bold} color={o.color}>{text}</Text>
        </Box>
      )
      const parts = [
        ['cheaper', 'Cheaper model', s.savedUsd],
        ['stronger', 'Stronger model', -s.extraUsd],
        ['effort', 'Effort (estimate)', s.effortUsd],
        ['classifier', 'Classifier', -s.classifierUsd],
      ] as const
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            {row('without', 'Without the router', usd(s.withoutUsd))}
            {row('with', 'With the router', usd(s.actualUsd + s.classifierUsd))}
            {row('work', '  the work', usd(s.actualUsd), { dim: true })}
            {row('cls', s.prompts ? `  classifier · ${s.prompts} prompts × ${perPrompt}` : '  classifier', usd(s.classifierUsd), { dim: true })}
          </Box>
          <Box flexDirection="column">
            <Text dimColor>Where the difference came from</Text>
            {parts.map(([k, label, v]) => row(`part-${k}`, `  ${label}`, money(v) === 'none' ? '$0.00' : signed(v), { dim: money(v) === 'none', color: MONEY_COLOR[money(v)] }))}
            {row('balance', c ? `Balance vs. ${compareLabel(c)}` : 'Balance', signed(s.balanceUsd), { bold: true, color: balanceColor })}
          </Box>
          <Box flexDirection="column">
            {row('accuracy', s.routed ? `Accuracy (estimate) · ${s.rework} re-work of ${s.routed} routed` : 'Accuracy (estimate)', s.accuracyPct === null ? '–' : `${Math.round(s.accuracyPct)} %`, { bold: true })}
            {showReference ? row('reference', `Vs. always ${REFERENCE.model} ${REFERENCE.effort}`, signed(s.vsReferenceUsd), { color: MONEY_COLOR[money(s.vsReferenceUsd)] }) : null}
            {row('perturn', s.pricedTurns ? `Cost per turn · ${s.pricedTurns} turns` : 'Cost per turn', usd(s.perTurnUsd), { dim: true })}
          </Box>
        </Box>
      )
    }
    // The balance per task against the control group: money and time first, then the parts, the
    // accuracy and the models (both surfaces, stacked rows that fit a narrow pane).
    const taskView = (Box: any, Text: any) => {
      if (!b) return null
      const t = modelTable(b)
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text dimColor>Per task, against the control group</Text>
            <Text bold color={MONEY_COLOR[money(b.usd.value)]}>{`${isRough(b) ? '~' : ''}${signed(b.usd.value)} · ${b.timed ? timeText(b.minutes.value) : 'time not measured yet'}`}</Text>
            <Text dimColor>{sampleNote(b)}</Text>
          </Box>
          <Box flexDirection="column">
            {balanceParts(b).map(([k, label, v]) => (
              <Box key={`task-${k}`} flexDirection="row" justifyContent="space-between">
                <Text dimColor={money(v) === 'none'}>{`  ${label}`}</Text>
                <Text dimColor={money(v) === 'none'} color={MONEY_COLOR[money(v)]}>{money(v) === 'none' ? '$0.00' : signed(v)}</Text>
              </Box>
            ))}
            <Box flexDirection="row" justifyContent="space-between">
              <Text>Accuracy</Text>
              <Text bold>{accuracyText(b)}</Text>
            </Box>
          </Box>
          {t.length > 1 ? (
            <Box flexDirection="column">
              {t.slice(1).map(r => (
                <Text key={`model-${r[0]}`} dimColor>{`${r[0]}: ${r[1]} tasks, ${r[2]} control · ${r[3]}/task · re-work ${r[4]} · ${r[5]} min/task`}</Text>
              ))}
            </Box>
          ) : null}
        </Box>
      )
    }
    const PERIODS = [['today', 'Today'], ['week', '7 days'], ['total', 'Total']] as const

    if (e.surface === 'terminal') {
      const { Box, Text, Button } = $.ui.resolve(e)
      const cells = Math.max(8, Math.min(24, (e.props.bodyColumns ?? 40) - 8))
      return (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="column">
            <Text bold>{`Prompt Router · ${enabled ? 'on' : 'off'}`}</Text>
            <Text>{d.header}</Text>
            <Text color={TONE_THEME[d.tone]}>{`${barText(d.share, d.at, cells)} ${d.share == null ? '–' : `${Math.round(d.share)}%`}`}</Text>
            <Text dimColor>{`${ctxLine} · ${atLine}`}</Text>
          </Box>
          <Box flexDirection="column">
            <Text dimColor>{d.last ? `${age < 60_000 ? '● ' : ''}Last decision · ${ago(age)}` : 'Last decision'}</Text>
            {d.last && where ? (
              <Box flexDirection="column">
                <Text bold>{`${where.glyph} ${where.text}${d.last.outcome === 'asked' ? ' (asked)' : ''}`}</Text>
                <Text>{lastModel}</Text>
                {d.last.why ? <Text dimColor>{d.last.why}</Text> : null}
              </Box>
            ) : (
              <Text dimColor>No decision yet. The router's call on your next prompt shows here.</Text>
            )}
          </Box>
          {d.savings && s ? (
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="row" gap={1}>
                <Text dimColor>Savings</Text>
                {PERIODS.map(([k, label]) => (
                  <Button key={`period-${k}`} plain label={k === panePeriod ? `[${label}]` : label} onPress={pickPeriod(k)} />
                ))}
              </Box>
              <Box flexDirection="column">
                <Text bold color={balanceColor}>{signed(s.balanceUsd)}</Text>
                <Text dimColor>{verdict}</Text>
              </Box>
              {billView(Box, Text)}
              {taskView(Box, Text)}
              <Box flexDirection="column">
                <Text color="claude">{sparkText(d.savings.days.map(x => x.balanceUsd))}</Text>
                <Text dimColor>balance per day, last 14 days</Text>
              </Box>
              <Text dimColor>{activity}</Text>
              <Text dimColor>{NOTE}</Text>
            </Box>
          ) : (
            <Text dimColor>Stats are off (option stats).</Text>
          )}
          <Box flexDirection="column">
            <Text dimColor>Switches</Text>
            {switches.map((x, i) => (
              <Button key={`toggle-${x.key}`} hotkey={String(i + 1)} plain label={`${x.label}: ${x.value}`} onPress={press(x.key)} />
            ))}
          </Box>
        </Box>
      )
    }

    const { Box, Text, Button, Svg } = $.ui.resolve(e)
    const px = Math.max(220, Math.min(460, (e.props.bodyColumns ?? 40) * 7))
    const accent = TONES[d.tone][0]
    return (
      <Box flexDirection="column" gap={2} padding={1}>
        <Box flexDirection="row" gap={2} alignItems="center">
          <Svg source={ringSvg(d.share, d.at)} alt={`Context ${d.share == null ? 'unknown' : `${Math.round(d.share)}%`}${d.at ? `, new session at ${d.at}%` : ''}`} width={104} height={104} isInteractive />
          <Box flexDirection="column" gap={1}>
            <Text dimColor>{`PROMPT ROUTER · ${enabled ? 'ON' : 'OFF'}`}</Text>
            <Text bold>{d.header}</Text>
            <Text dimColor>{ctxLine}</Text>
            <Text color={accent}>{atLine}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" gap={1} borderStyle="round" padding={1}>
          <Box flexDirection="row" justifyContent="space-between" alignItems="center">
            <Box flexDirection="row" gap={1} alignItems="center">
              {d.last ? <Svg source={pulseSvg(age)} alt={age < 60_000 ? 'Fresh decision' : 'Decision'} width={18} height={18} isInteractive /> : null}
              <Text dimColor>LAST DECISION</Text>
            </Box>
            {d.last ? <Text dimColor>{ago(age)}</Text> : null}
          </Box>
          {d.last && where ? (
            <Box flexDirection="column" gap={1}>
              <Text bold>{`${where.glyph}  ${where.text}`}</Text>
              <Text>{`${lastModel}${d.last.outcome === 'asked' ? ' · asked you' : ''}`}</Text>
              {d.last.why ? <Text dimColor>{`“${d.last.why}”`}</Text> : null}
            </Box>
          ) : (
            <Text dimColor>No decision yet. The router's call on your next prompt shows here.</Text>
          )}
        </Box>
        {d.savings && s ? (
          <Box flexDirection="column" gap={2} borderStyle="round" padding={1}>
            {/* Title, then the period switch on its own row: three short buttons always fit. */}
            <Box flexDirection="column" gap={1}>
              <Text dimColor>SAVINGS</Text>
              <Box flexDirection="row" gap={1}>
                {PERIODS.map(([k, label]) => (
                  <Button key={`period-${k}`} label={label} variant={k === panePeriod ? 'primary' : 'secondary'} onPress={pickPeriod(k)} />
                ))}
              </Box>
            </Box>
            {/* The one number to read first. */}
            <Box flexDirection="column">
              <Text dimColor>Balance</Text>
              <Text bold color={balanceColor}>{signed(s.balanceUsd)}</Text>
              <Text dimColor>{verdict}</Text>
            </Box>
            {/* Everything below is stacked, label above value, so nothing wraps into its neighbour. */}
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="column">
                <Text dimColor>Without the router</Text>
                <Text bold>{usd(s.withoutUsd)}</Text>
              </Box>
              <Box flexDirection="column">
                <Text dimColor>With the router</Text>
                <Text bold>{usd(s.actualUsd + s.classifierUsd)}</Text>
                <Text dimColor>{`the work ${usd(s.actualUsd)} + classifier ${usd(s.classifierUsd)}`}</Text>
              </Box>
            </Box>
            {(() => {
              // The parts add up to the balance: a bar scaled to the largest one, then its signed value.
              const parts = [
                ['cheaper', 'Cheaper model', s.savedUsd],
                ['stronger', 'Stronger model', -s.extraUsd],
                ['effort', 'Effort (estimate)', s.effortUsd],
                ['classifier', 'Classifier', -s.classifierUsd],
              ] as const
              const top = Math.max(0.005, ...parts.map(p => Math.abs(p[2])))
              const bar = Math.max(80, px - 110)
              return (
                <Box flexDirection="column" gap={1}>
                  <Text dimColor>Where the difference came from</Text>
                  {parts.map(([k, label, v]) => {
                    const m = money(v)
                    const text = m === 'none' ? '$0.00' : signed(v)
                    return (
                      <Box key={`part-${k}`} flexDirection="column">
                        <Text>{label}</Text>
                        <Box flexDirection="row" gap={1} alignItems="center">
                          <Svg source={partBarSvg(Math.abs(v) / top, MONEY_COLOR[m] ?? TONES.idle[0], bar, 8)} alt={`${label}: ${text}`} width={bar} height={8} />
                          <Text bold={m !== 'none'} dimColor={m === 'none'} color={MONEY_COLOR[m]}>{text}</Text>
                        </Box>
                        {k === 'classifier' ? <Text dimColor>{s.prompts ? `${s.prompts} prompts × ${perPrompt} per prompt` : 'No prompts classified yet'}</Text> : null}
                      </Box>
                    )
                  })}
                </Box>
              )
            })()}
            {taskView(Box, Text)}
            <Box flexDirection="column" gap={1}>
              {showReference ? (
                <Box flexDirection="column">
                  <Text dimColor>{`Vs. always ${REFERENCE.model} ${REFERENCE.effort}`}</Text>
                  <Text bold color={MONEY_COLOR[money(s.vsReferenceUsd)]}>{signed(s.vsReferenceUsd)}</Text>
                </Box>
              ) : null}
              <Box flexDirection="column">
                <Text dimColor>{s.pricedTurns ? `Cost per turn · ${s.pricedTurns} turns` : 'Cost per turn'}</Text>
                <Text>{usd(s.perTurnUsd)}</Text>
              </Box>
            </Box>
            <Box flexDirection="column" gap={1}>
              <Svg source={sparkSvg(d.savings.days.map(x => x.balanceUsd), d.savings.days.map(x => `${x.day}: ${signed(x.balanceUsd)}`), px, 64)} alt={`Balance per day, last 14 days: ${d.savings.days.map(x => signed(x.balanceUsd)).join(', ')}`} width={px} height={64} isInteractive />
              <Text dimColor>Balance per day, last 14 days</Text>
            </Box>
            <Text dimColor>{activity}</Text>
            <Text dimColor>{NOTE}</Text>
          </Box>
        ) : (
          <Text dimColor>Stats are off (option stats).</Text>
        )}
        <Box flexDirection="column" gap={1}>
          <Text dimColor>SWITCHES</Text>
          {switches.map(x => (
            <Box flexDirection="row" justifyContent="space-between" alignItems="center">
              <Text>{x.label}</Text>
              <Button key={`toggle-${x.key}`} label={x.value} variant={x.key === 'enabled' && !enabled ? 'primary' : 'secondary'} onPress={press(x.key)} />
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // The app's effort menu does not move, so the footer names the level the mod really sends.
  on('ui.render', { component: 'SessionMode' }, async ($, e, next) => {
    if (!enabled || cfg.notifications === 'off') return next(e)
    const { value } = await $.state.get(OVERRIDE)
    const { value: model } = await $.state.get(MODEL_HOLD)
    // Only what the router holds: its model and its effort. The saving is in the pane.
    if (!value && !model) return next(e)
    const label = [model ? MODEL_NAMES[model] : '', value ? `Effort ${SHORT[value]}` : ''].filter(Boolean).join(' · ')
    if (e.surface === 'desktop' || e.surface === 'vscode') {
      const { Text } = $.ui.resolve(e)
      return <Text color={ACCENT}>{label}</Text>
    }
    return next({ ...e, props: { ...e.props, modes: [...e.props.modes, label] } })
  })
}
