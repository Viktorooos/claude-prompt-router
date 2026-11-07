import { atom, read, update } from 'claude-code'
import type { ConfigRow, EngineInterface, PromptSubmitInput, Register, SessionMessage } from 'claude-code'

import type { LastDecision, Level } from '../types'
import { ALL_MODELS, BASE_MODELS, claudeDir, quickReply, DECIDE_OTHER, DEFAULT_WINDOW, above, compactWindow, isRedo, promptKey, LEVELS, MODEL_NAMES, MODELS, NAMES, RUN_SUBAGENT, SWITCHES, CLASSIFIERS, OPTIONS, allowed, asLevel, compareTarget, preferSession, clip, describeOptions, knownModel, norm, optionsLine, parseFollows, parsePick, pickPrompt, TOLD_OTHER, toConfig, typed, userLang } from '../core/router.ts'
import type { Chat, Config, Follows, Model, Option, Pick, Switch, Where } from '../core/router.ts'
import { cacheCosts, cost, usageOf } from '../core/prices.ts'
import type { Usage } from '../core/prices.ts'
import { Pending, REFERENCE, withTranscripts, accuracyText, historyCompare, balance, balanceParts, balances, byDay, compareLabel, glance, limitRate, isReference, isRough, modelTable, parseLog, rotate, signed, statsHtml, statsText, summarize, usd } from '../core/stats.ts'
import { CACHE_TONE, TONES, cacheCells, cacheClock, TONE_THEME, TTL_NAME, WHERE_LABEL, ago, barText, cacheBarSvg, cacheTime, cacheView, clockTime, dayLabel, bigNumberSvg, contextBarSvg, costBarSvg, dotSvg, itemSvg, kTokens, ringSvg, ruleSvg, sparkSvg, sparkText, splitBarSvg, splitBarText, stackSvg, tileSvg, tone, VIOLETS } from '../core/panel.ts'
import type { CacheView, CardIcon } from '../core/panel.ts'
import type { Balance, Balances, Compare, Decision, Entry, History, Report, Turn, UsageScan } from '../core/stats.ts'

const NAME = 'prompt-router'
const OVERRIDE = { plugin: 'prompt-router', key: 'override' } as const
const MODEL_HOLD = { plugin: 'prompt-router', key: 'model' } as const
const TEST_TOOL = `mcp__${NAME}__test`
const SWITCH_TOOL = `mcp__${NAME}__switch`
const SHORT: Record<Level, string> = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' }
const ACCENT = '#d97757'
// The pane's other card colours: the saving's green and the Details violet, both mid tones that read
// on light and dark.
const GREEN = '#2fb67c'
const VIOLET = '#8b7cf6'
// The settings' groups: models and effort, the session.
const BLUE = '#5b9cf6'
const TEAL = '#36b3a8'
const PANE = 'prompt-router'
// The day chart's height in pixels on the desktop.
const SPARK_PX = 76
const PANE_TITLE = 'Prompt Router'
// Change the tag when LastDecision's fields change: a value an older copy stored then reads as none.
const LAST = atom({ plugin: 'prompt-router', key: 'last' } as const, null, { shape: 'last-1' })
// The chat's prompt cache for the Cache card; in $.state, so a reload (saving an option) keeps it.
const CACHE = atom({ plugin: 'prompt-router', key: 'cache' } as const, null, { shape: 'cache-1' })
// What the last main-chat reply cost, for the This chat card: the session's /cost total when the prompt
// went in subtracted from it when the reply ended, so its subagents and the classifier count too.
const SPEND = atom({ plugin: 'prompt-router', key: 'spend' } as const, null, { shape: 'spend-1' })
// The session's /cost total as the current prompt went in (null: not known).
let spendBase: number | null = null
async function sessionUsd($: EngineInterface): Promise<number | null> {
  try {
    const total = (await $.session.usage()).cost?.usd
    return typeof total === 'number' ? total : null
  } catch {
    return null
  }
}
// The session's folder and transcript (found on the first reply), the ticker that counts the cache
// down every second, the card's label as last shown, and the terminal's countdown Raster as drawn
// (its card name and width; null: the pane draws no Raster to repaint).
let sessionCwd = ''
let transcriptFile = ''
let cacheTicker: { cancel: () => void } | null = null
let drawnCache = ''
let drawnClock: { state: CacheView['state']; name: string; columns: number; cells: number } | null = null
// A redraw the ticker asked for only to move the countdown: the pane reuses the savings it read last
// (under a minute old, nothing new pending) instead of reading the whole stats log every second.
let tickOnly = false
let savingsMemo: { at: number; pending: number; value: unknown } | null = null

// Claude Code's config folder (~/.claude or CLAUDE_CONFIG_DIR), known from session.start on.
let configDir = ''
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
const pending = new Pending<Entry>()
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

// Adds text to a log beside other sessions' writes: scripts/append.mjs appends under a lock, so
// parallel sessions keep each other's lines. Without Node, the old whole-file rewrite (one write at
// a time here; a parallel session's write can still be lost).
let rewriting: Promise<unknown> = Promise.resolve()
async function appendLog($: EngineInterface, path: string, text: string, mode: 'stats' | 'tail') {
  try {
    const r = await $.process.run(['node', `${$.plugin.root}/scripts/append.mjs`, path, mode], { stdin: text, timeoutMs: 15_000 })
    if (r.exitCode === 0) return
  } catch {
    // No Node: rewrite below.
  }
  const run = rewriting.then(async () => {
    let old = ''
    try {
      old = String(await $.fs.read(path))
    } catch {
      // No log yet.
    }
    await $.fs.write(path, mode === 'tail' ? `${old.slice(-20_000)}${text}` : rotate(old + text, await $.clock.now()))
  })
  rewriting = run.catch(() => {})
  await run
}

async function log($: EngineInterface, what: string, err: unknown) {
  // Before session.start there is no folder to write to (not /mods-logs at the root).
  if (!configDir) return
  try {
    const msg = err instanceof Error ? err.message : String(err)
    await appendLog($, `${configDir}/mods-logs/prompt-router.log`, `${new Date(await $.clock.now()).toISOString()} ${what}: ${msg}\n`, 'tail')
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

// The pane draws still: the app puts an image back on every hover, press and focus, and an animated
// drawing replayed each time.
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

// The engine hands the hook a prompt before it enters the session, so the transcript holds only the
// earlier prompts; the new one is added last, so `recent` keeps the latest earlier prompt.
function chatOf(messages: readonly SessionMessage[], text: string, now: Level | '', tokens: number | undefined, window: number | undefined, model: string, models: readonly Model[]): Chat {
  const users = messages.filter(m => m.role === 'user').map(m => typed(m.text)).filter(Boolean)
  // Should the transcript already hold it, the classifier still sees it once, as the new prompt.
  if (users.at(-1) === text) users.pop()
  users.push(text)
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
  const r = await classify($, text, chatOf(messages, text, now, tokens, window, model, models))
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

// sessionSuggestions auto: the chat is long, so the task goes to a new session with no question.
function autoSessionNote(p: Pick) {
  const label = `${MODEL_NAMES[p.model]} · ${p.effort}`
  return `Prompt Router: this chat is long${p.why ? `, because: ${p.why}` : ''}, so run this prompt in a new session (${label}) without asking. Then: ${sessionThen(p, true)}`
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

const statsPath = () => `${configDir}/mods-logs/prompt-router-stats.jsonl`

// compareWith history: the token mix of the sessions from before the router, counted once by
// scripts/history-scan.mjs in the background and kept beside the stats log (it never changes).
const historyPath = () => `${configDir}/mods-logs/prompt-router-history.json`
let history: History | null = null
let historyComputing = false

const compareNow = (): Compare => (cfg.compareWith === 'history' ? historyCompare(history, historyComputing) : compareTarget(cfg.compareWith))

async function readHistory($: EngineInterface): Promise<History | null> {
  try {
    const h = JSON.parse(String(await $.fs.read(historyPath()))) as History
    return h && typeof h.tokens === 'object' ? h : null
  } catch {
    return null
  }
}

// /router stats only: the tokens of cut-off turns (no usage in the log) from their chats' transcripts,
// by scripts/usage-scan.mjs. Only the sessions that have such a turn are read.
const usagePath = () => `${configDir}/mods-logs/prompt-router-usage.json`

async function fillFromTranscripts($: EngineInterface, records: Entry[]): Promise<Entry[]> {
  const cut = new Set(records.flatMap(r => (r.kind === 'turn' && !r.agentId && !r.usage ? [r.chat] : [])))
  const ids = [...new Set(records.flatMap(r => (r.kind === 'decision' && r.session && cut.has(r.chat) ? [r.session] : [])))]
  if (!ids.length) return records
  try {
    const scan = $.process.spawn({ argv: ['node', `${$.plugin.root}/scripts/usage-scan.mjs`, `${configDir}/projects`, usagePath(), ...ids] })
    for await (const _ of scan) void _
  } catch (err) {
    // The last scan's result still holds the older sessions.
    await log($, 'usage scan', err)
  }
  try {
    const out = JSON.parse(String(await $.fs.read(usagePath()))) as { scans?: UsageScan[] }
    return withTranscripts(records, Array.isArray(out.scans) ? out.scans : [])
  } catch {
    return records
  }
}

async function loadHistory($: EngineInterface) {
  if (cfg.compareWith !== 'history' || history || historyComputing) return
  history = await readHistory($)
  if (history || historyComputing) return
  historyComputing = true
  // Not awaited: the scan must not hold the prompt or the session's start.
  void (async () => {
    try {
      const scan = $.process.spawn({ argv: ['node', `${$.plugin.root}/scripts/history-scan.mjs`, `${configDir}/projects`, statsPath(), historyPath()] })
      for await (const _ of scan) void _
      history = await readHistory($)
    } catch (err) {
      await log($, 'history', err)
    } finally {
      historyComputing = false
      redraw($)
    }
  })()
}

// The last prompt's key (promptKey): the same question again goes on with its task.
let lastPromptKey = ''
// The prompt's own words say the last answer failed (isRedo); the chat's transcript id; whether this
// turn showed the router's question (AskUserQuestion with the header "Prompt Router").
let lastRedo = false
let sessionId = ''
let routerAsked = false

// Notes one routing decision (with what the classifier cost); returns its time stamp. Every result of
// decide() passes here once, so the pane's last decision is written here too.
async function noteDecision($: EngineInterface, where: Decision['where'], to: Decision['to'], outcome: Decision['outcome'], now: Level | '', p?: Pick) {
  const ts = await $.clock.now()
  if (cfg.stats === 'on') {
    pending.push({ kind: 'decision', ts, platform: 'claude-code', chat: chatId, where, from: { model: pickedFrom, effort: now }, to, ...(lastFollows ? { follows: lastFollows } : {}), outcome, ...(lastPromptKey ? { key: lastPromptKey } : {}), ...(lastClassifier ? { classifier: lastClassifier } : {}), ...(sessionId ? { session: sessionId } : {}), ...(lastRedo ? { redo: true as const } : {}) })
  }
  lastClassifier = null
  lastFollows = undefined
  const last: LastDecision = { where: p?.other ? 'other' : where, outcome: outcome === 'asked' ? 'asked' : 'applied', model: to.model, effort: to.effort, why: p?.why ?? '', from: { model: pickedFrom, effort: now }, ts, ...lastCtx }
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

// Appends the pending records (the log trimmed to 90 days / 5 MB); they stay pending until written.
async function flush($: EngineInterface) {
  if (cfg.stats !== 'on' || !pending.items.length || !configDir) return
  try {
    await pending.flush(batch => appendLog($, statsPath(), batch.map(r => `${JSON.stringify(r)}\n`).join(''), 'stats'))
  } catch (err) {
    await log($, 'stats', err)
  }
}

// A tool call that did not run: denied, or an error result (at the top or in `result`).
function failed(r: unknown) {
  if (!r || typeof r !== 'object') return false
  const o = r as { deny?: unknown; isError?: unknown; result?: { isError?: unknown } | null }
  return 'deny' in o || !!o.isError || !!(o.result && typeof o.result === 'object' && o.result.isError)
}

// Works out the prompt to send; the hook sends it, so a failure here never loses the prompt.
async function decide($: EngineInterface, e: PromptSubmitInput): Promise<PromptSubmitInput> {
  if (!enabled || e.command || e.isMeta) return e
  if (e.origin.kind !== 'composer' && e.origin.kind !== 'bridge') return e
  const text = typed(e.text)
  if (!text || text.startsWith('/')) return e
  lastPromptKey = promptKey(text)
  lastRedo = isRedo(text)
  routerAsked = false
  turnLevel = null
  lastAsked = null
  lastClassifier = null
  // "yes", "option 2", "díky": nothing to route, no classifier call.
  if (quickReply(text)) return e
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
  const inApp = p.where === 'session' ? await canStartSession($) : true
  if (p.where === 'session' && p.long && cfg.sessionSuggestions === 'auto' && inApp) {
    lastAsked = { ts: await noteDecision($, 'session', { model: p.model, effort: p.effort }, 'applied', now, p), where: 'session', model: p.model }
    return { ...e, text: `${e.text}\n\n[${autoSessionNote(p)}]` }
  }
  await noteAsked($, p.where, p, now)
  // A mod's own dialog does not open at prompt time in the app, so Claude asks with the same options.
  // `context` does not reach the model for prompts from the app, so the note rides on the text.
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

// The pane's settings: every option with a fixed set of values (SWITCHES and the classifier) as a
// button that steps to the next value, compareWith as two buttons (model, effort) read from its values,
// and the free-text options as fields. New options show up by themselves; LABELS only names them.
const LABELS: Record<Option, string> = {
  project: 'Project',
  rules: 'Extra rules',
  language: 'Language',
  classifier: 'Classifier model',
  effortDetection: 'Effort detection',
  firstChatDetection: 'First-chat model',
  midChatModelDetection: 'Mid-chat model',
  subagentSuggestions: 'Subagent suggestions',
  sessionSuggestions: 'Session suggestions',
  newSessionAt: 'New session at',
  notifications: 'Notifications',
  stats: 'Savings stats',
  openPane: 'Open pane by itself',
  compareWith: 'Compare with',
}

// The order a press steps through: numbers from low to high with off last (40%, 50% … off), any
// other list as it stands (its default first).
function stepOrder(values: readonly string[]): readonly string[] {
  const at = (v: string) => (v === 'off' ? Infinity : Number.parseFloat(v))
  return values.every(v => !Number.isNaN(at(v))) ? [...values].sort((a, b) => at(a) - at(b)) : values
}

const CHOICES = [
  ...(Object.keys(SWITCHES) as Switch[]).filter(k => k !== 'compareWith').map(k => ({ key: k as Option, values: stepOrder(SWITCHES[k]) })),
  { key: 'classifier' as Option, values: CLASSIFIERS as readonly string[] },
]
// The value the pane marks "Recommended" for each setting, by the setting's key. The only place that names them:
// the defaults of the config schema, except the classifier (Haiku is cheaper) and the savings baseline (history).
const RECOMMENDED: Record<string, string> = {
  enabled: 'on',
  firstChatDetection: 'ask',
  midChatModelDetection: 'ask',
  effortDetection: 'ask',
  subagentSuggestions: 'ask',
  newSessionAt: '50%',
  notifications: 'on',
  classifier: 'haiku',
  compareModel: 'history',
  compareEffort: 'medium',
  openPane: 'off',
}
const TEXT_OPTIONS = OPTIONS.filter(k => !(k in SWITCHES) && k !== 'classifier')

// compareWith split in two: its models (with `first`) and its efforts, in LEVELS order.
const COMPARE_MODELS = [...new Set(SWITCHES.compareWith.map(v => v.split('-')[0]!))]
const COMPARE_EFFORTS = LEVELS.filter(l => SWITCHES.compareWith.some(v => v.endsWith(`-${l}`)))

function nextCompare(part: 'model' | 'effort'): string {
  const [m = 'first', l = ''] = cfg.compareWith.split('-')
  const step = <T,>(list: readonly T[], v: T) => list[(list.indexOf(v) + 1) % list.length]!
  const model = part === 'model' ? step(COMPARE_MODELS, m) : m
  const effort = part === 'effort' ? step(COMPARE_EFFORTS, l as Level) : l || COMPARE_EFFORTS.find(x => x === 'medium') || COMPARE_EFFORTS[0]!
  const v = model === 'first' || model === 'history' ? model : `${model}-${effort}`
  return (SWITCHES.compareWith as readonly string[]).includes(v) ? v : SWITCHES.compareWith.find(x => x.startsWith(`${model}-`)) ?? SWITCHES.compareWith[0]
}

// Where settings.json keeps the mod's options: the entry loadOptions reads them from.
function optionsEntry(all: Record<string, unknown>) {
  return Object.keys(all).find(k => k.startsWith(`${NAME}@`)) ?? (NAME in all ? NAME : `${NAME}@${NAME}`)
}

// Saves one option as /config does (settings.json pluginConfigs, through the engine), and goes by it now.
// The desktop app lists no /config rows for an installed mod, so there the option goes straight into
// settings.json, read just before the write so nothing else in the file is lost.
async function saveOption($: EngineInterface, k: Option, value: string) {
  try {
    const ours = (p = '') => p === NAME || p.startsWith(`${NAME}@`)
    const row = (await $.config.list()).find(r => r.key === `${NAME}.${k}` || (ours(r.provider?.plugin) && r.key.endsWith(`.${k}`)))
    if (row) {
      const r = await $.config.set({ key: row.key, value })
      if (r.deny) {
        await log($, 'save option', `${k}: ${r.deny}`)
        return
      }
    } else {
      const path = `${configDir}/settings.json`
      const text = String(await $.fs.read(path).catch(() => '{}')) || '{}'
      const file = JSON.parse(text) as { pluginConfigs?: Record<string, { options?: Record<string, unknown> }> }
      const all = (file.pluginConfigs ??= {})
      const id = optionsEntry(all)
      const entry = (all[id] ??= {})
      entry.options = { ...entry.options, [k]: value }
      await $.fs.write(path, `${JSON.stringify(file, null, 2)}\n`)
    }
  } catch (err) {
    await log($, 'save option', `${k}: ${err}`)
    return
  }
  opts = { ...opts, [k]: value }
  cfg = toConfig(opts)
  void loadHistory($)
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
    const all = (JSON.parse(String(await $.fs.read(`${configDir}/settings.json`))) as { pluginConfigs?: Record<string, { options?: unknown }> }).pluginConfigs ?? {}
    const full = Object.keys(all).find(k => k.startsWith(`${NAME}@`))
    const entry = all[optionsEntry(all)]?.options
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
  void loadHistory($)
  if (cfgNote) await log($, 'options', cfgNote)
  // Once per session, so the log shows what this copy of the mod really goes by.
  await log($, 'effective options', `${$.plugin.root} | ${optionsLine(opts)}`)
}

// The chat's last request read or wrote its prompt cache: when (the transcript's time of the last
// reply when it falls in this turn, else now) and for how long (the transcript's newest cache write,
// else the last one known). scripts/cache-ttl.mjs reads the transcript's tail.
async function markCache($: EngineInterface, model: string, durationMs: number | undefined) {
  const end = await $.clock.now()
  let found: { ttl?: unknown; ts?: unknown; file?: unknown } = {}
  if (configDir && sessionId) {
    const script = `${$.plugin.root}/scripts/cache-ttl.mjs`
    try {
      const r = await $.process.run(transcriptFile ? ['node', script, transcriptFile] : ['node', script, `${configDir}/projects`, sessionId, sessionCwd], { timeoutMs: 5_000 })
      found = JSON.parse(r.stdout || '{}') as typeof found
      if (typeof found.file === 'string') transcriptFile = found.file
    } catch (err) {
      await log($, 'cache', err)
    }
  }
  const from = end - (typeof durationMs === 'number' ? durationMs : 10 * 60_000) - 1_000
  const at = typeof found.ts === 'number' && found.ts >= from && found.ts <= end ? found.ts : end
  const prev = await read($, CACHE)
  const ttl = found.ttl === '1h' || found.ttl === '5m' ? found.ttl : (prev?.ttl ?? null)
  await update($, CACHE, () => ({ at, ttl, model }))
}

// The card's state and time as one label: the ticker redraws only when it changes (once a minute
// while the cache counts down, never once it lapsed).
// What the card shows of the cache, to the second: a change is what the ticker moves on.
const cacheLabel = (v: CacheView) => `${v.state}|${cacheClock(v) || cacheTime(v)}`
// The terminal countdown Raster's key, the address $.ui.blit repaints.
const CLOCK_KEY = 'cache-clock'


// What the pane draws, read fresh on every draw (the atom read subscribes it to the next decision).
async function paneData($: EngineInterface) {
  const now = await $.clock.now()
  const last = await read($, LAST)
  let tokens = last?.tokens ?? null
  let window = last?.window ?? null
  let sessionCost: number | null = null
  try {
    const u = await $.session.usage()
    if (typeof u.cost?.usd === 'number') sessionCost = u.cost.usd
    const ctx = u.context
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
  let savings: { report: Report; days: ReturnType<typeof byDay>; balance: Balances; perPct: number | null } | null = null
  const quick = tickOnly
  tickOnly = false
  if (cfg.stats === 'on') {
    const memo = savingsMemo
    if (quick && memo && now - memo.at < 60_000 && memo.pending === pending.items.length) savings = memo.value as typeof savings
    else {
      const records = [...parseLog(await readStats($)), ...pending.items]
      const c = compareNow()
      savings = { report: summarize(records, now, c), days: byDay(records, now, 14, c), balance: balances(records, now), perPct: limitRate(records) }
      savingsMemo = { at: now, pending: pending.items.length, value: savings }
    }
  }
  const mark = await read($, CACHE)
  const view = cacheView(mark, model, now)
  const cache = { mark, view, costs: cacheCosts(tokens, model || mark?.model, view.ttl) }
  const spend = { last: (await read($, SPEND))?.usd ?? null, session: sessionCost }
  return { now, last, tokens, window: win, share, at, cache, spend, model, tone: tone(share, at), header: `${model ? MODEL_NAMES[model] : 'Model unknown'} · ${effort ? NAMES[effort] : 'effort unknown'}`, savings }
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

async function findConfigDir($: EngineInterface): Promise<string> {
  const get = async (read: () => Promise<string | undefined>) => {
    try {
      return (await read()) ?? ''
    } catch {
      return ''
    }
  }
  return claudeDir({
    configDir: await get(() => $.env.get('CLAUDE_CONFIG_DIR')),
    home: await get(() => $.env.get('HOME')),
    userProfile: await get(() => $.env.get('USERPROFILE')),
    pluginRoot: $.plugin.root,
  })
}

export const register: Register = (on, options) => {
  given = { ...options }
  opts = given
  cfg = toConfig(given)
  on('session.start', async ($, e, next) => {
    configDir = await findConfigDir($)
    chatId = `${await $.clock.now()}-${Math.random().toString(36).slice(2, 8)}`
    try {
      sessionId = String((await $.session.id()) ?? '')
    } catch {
      sessionId = ''
    }
    sessionCwd = typeof e.cwd === 'string' ? e.cwd : ''
    transcriptFile = ''
    drawnCache = ''
    drawnClock = null
    cacheTicker?.cancel()
    cacheTicker = null
    // Every second, apart from anything else the pane does: the terminal repaints just the countdown
    // Raster in place; elsewhere (no in-place swap for an Svg) the pane redraws, reusing the savings
    // it read, only when the shown second or state changed. Once it lapsed nothing changes, so no
    // redraw. Until the pane has drawn the card there is nothing to move on.
    const tick = async () => {
      if (!drawnCache) return
      // The same model paneData goes by, so the ticker's label matches the one drawn.
      const v = cacheView(await read($, CACHE), knownModel(seenModel || (await chatModel($))), await $.clock.now())
      const label = cacheLabel(v)
      if (label === drawnCache) return
      const r = drawnClock
      if (r && r.state === v.state) {
        const done = await $.ui.blit({ requestId: PANE, key: CLOCK_KEY, cells: cacheCells(v, r.name, r.columns, r.cells), columns: r.columns, rows: 2 }).catch(() => ({ deny: 'failed' }))
        if (!done.deny) {
          drawnCache = label
          return
        }
      }
      drawnCache = label
      tickOnly = true
      redraw($)
    }
    try {
      cacheTicker = $.clock.every(1_000, () => tick().catch(() => {}))
    } catch {
      // No timers here: the card moves on with each reply.
    }
    pending.items = []
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
    // Before the classifier runs, so the reply's cost includes it.
    spendBase = await sessionUsd($)
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
    // The reply's cost: what the session's total grew by since the prompt went in; without a total, the
    // turn's own usage at list price. Noting it redraws the pane.
    if (!e.agentId) {
      const total = await sessionUsd($)
      const own = cost(usageOf(r.usage) ?? {}, r.usage?.model ?? seenModel)
      const reply = total != null && spendBase != null ? Math.max(0, total - spendBase) : own
      spendBase = null
      if (reply != null) await update($, SPEND, () => ({ usd: reply })).catch(() => {})
    }
    // A main-chat turn that sent a request read or wrote the chat's cache. Noting it redraws the
    // pane (the drawing reads it), alongside the stats below; any other main turn redraws here.
    const marking = !e.agentId && r.usage
      ? markCache($, r.usage.model ?? seenModel, e.durationMs).catch(async err => {
        redraw($)
        await log($, 'cache', err)
      })
      : null
    if (!e.agentId && !marking) redraw($)
    if (!enabled || cfg.stats !== 'on') {
      await marking
      return r
    }
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
      // The router asked and the turn ended with no switch, subagent or session: the person kept their setting.
      if (!e.agentId && routerAsked && lastAsked) {
        pending.push({ kind: 'accept', ts: await $.clock.now(), platform: 'claude-code', chat: chatId, decision: lastAsked.ts, outcome: 'declined' })
        lastAsked = null
      }
      if (!e.agentId) routerAsked = false
      const manual = !e.agentId && manualUp
      if (!e.agentId) manualUp = false
      // The weekly limit's fill after a main-chat turn: what the person's plan really spent (limitRate).
      let week: Turn['week']
      if (!e.agentId) {
        try {
          const w = (await $.session.usage()).rateLimits.find(x => x.kind === 'seven_day')
          if (w) week = { pct: w.percentUsed, ...(w.resetsAt ? { resets: w.resetsAt } : {}) }
        } catch {
          // No reading: the turn goes without one.
        }
      }
      pending.push({
        kind: 'turn', ts: await $.clock.now(), platform: 'claude-code', chat: chatId, ...(e.agentId ? { agentId: e.agentId } : {}), model, baseline: base, ...(usage ? { usage } : {}),
        ...(typeof e.durationMs === 'number' ? { durationMs: e.durationMs } : {}),
        ...(manual ? { manual: true } : {}),
        ...(agent?.context && requests ? { mainContext: agent.context, requests } : {}),
        ...(switched ? { switched: true } : {}),
        ...(week ? { week } : {}),
        ...(!e.agentId && stepEffort?.effort && stepEffort.base ? { effort: stepEffort.effort, baseEffort: stepEffort.base } : {}),
      })
      await flush($)
    } catch (err) {
      await log($, 'stats', err)
    }
    await marking
    return r
  })

  // The router's question was shown, or a session started (an offered session counts as taken).
  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    try {
      const a = e as { tool?: unknown; questions?: unknown }
      const name = String(a.tool ?? '')
      if (name === 'AskUserQuestion' && Array.isArray(a.questions) && a.questions.some(q => (q as { header?: unknown })?.header === 'Prompt Router')) routerAsked = true
      if (/(^|__)start_session$/.test(name) && !failed(r) && lastAsked?.where === 'session') await noteAccept($)
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
      await loadHistory($)
      const records = await fillFromTranscripts($, parseLog(await readStats($)))
      const c = compareNow()
      const report = summarize(records, now, c)
      const perTask = balance(records)
      const page = `${configDir}/mods-logs/prompt-router-stats.html`
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
        ...(cfg.stats === 'on' ? [`Savings compared with ${compareLabel(compareNow())}${cfg.compareWith === 'history' && !history ? (historyComputing ? ' (history still being counted)' : ' (no history from before the router)') : ''}.`] : []),
        'Commands: /router off, /router on, /router stats.',
        'The pane beside the chat: /router panel.',
      ].filter(Boolean).join('\n'),
    }
  })

  // The pane beside the chat, kept to what people look for: how much the router saved, this chat's
  // context and when it asks for a new session, and the settings, each with one line on what it does.
  // The rest (the strict balance, accuracy, the models) is under Details, always open.
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const d = await paneData($)
    const term = e.surface === 'terminal'
    const report = d.savings?.report[panePeriod] ?? null
    const { Box, Text, Button, Svg, Select, Raster } = $.ui.resolve(e) as any
    const cols = e.props.bodyColumns ?? 40
    const px = Math.max(220, Math.min(460, cols * 7))
    const cells = Math.max(8, Math.min(24, cols - 8))
    // A narrow pane puts each setting's control under its name instead of beside it.
    const narrow = cols < 34
    const pickPeriod = (k: typeof panePeriod) => async () => {
      if (panePeriod === k) return
      panePeriod = k
      redraw($)
    }
    const s = d.savings?.report[panePeriod] ?? null
    const b: Balance | null = d.savings?.balance[panePeriod] ?? null
    const c = compareNow()
    const money = (v: number) => (Math.abs(v) < 0.005 ? 'none' : v > 0 ? 'up' : 'down')
    const MONEY_COLOR = { up: TONES.calm[0], down: TONES.over[0], none: undefined }

    const title = (key: string, t: string) => <Text key={key} dimColor>{term ? t : t.toUpperCase()}</Text>
    const row = (key: string, label: string, value: string, o: { dim?: boolean; bold?: boolean; color?: string } = {}) => (
      <Box key={key} flexDirection="row" justifyContent="space-between">
        <Text dimColor={o.dim}>{label}</Text>
        <Text dimColor={o.dim} bold={o.bold} color={o.color}>{value}</Text>
      </Box>
    )
    // On the app surfaces each section is a card: a soft rounded outline, room inside, no rule between cards.
    const section = (key: string, ...children: unknown[]) => (term
      ? <Box key={key} flexDirection="column" gap={0}>{children}</Box>
      : (
        <Box key={key} flexDirection="column" gap={1} borderStyle="round" borderDimColor paddingX={narrow ? 1 : 2} paddingY={1}>
          {children}
        </Box>
      ))
    // A hairline between sections (strong) and between settings (faint); the terminal leaves the gap.
    const rule = (key: string, strong = true) => (term ? null : <Svg key={key} source={ruleSvg(px, strong)} alt="" height={1} />)
    // A card's heading on the app surfaces: the icon on its tile, the name in the app's heading type, a
    // footnote under it, and anything given on the right (a button), centred on both lines.
    const head = (key: string, icon: CardIcon | null, color: string, name: string, sub: string, o: { right?: unknown; strong?: boolean; alt?: string } = {}) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={2}>
        {icon ? <Box flexShrink={0}><Svg source={tileSvg(icon, color, o.strong)} alt={o.alt ?? name} width={36} height={36} /></Box> : null}
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text bold>{name}</Text>
          {sub ? <Text dimColor wrap="wrap">{sub}</Text> : null}
        </Box>
        {o.right ? <Box flexShrink={0}>{o.right}</Box> : null}
      </Box>
    )
    // A row's left side on the app surfaces: its icon on an outlined tile, the name in bold over one dim line.
    const item = (key: string, icon: CardIcon, color: string, live: boolean, name: string, what: string, nameColor?: string) => (
      <Box key={key} flexDirection="row" alignItems="center" gap={2} flexGrow={1} flexShrink={1} minWidth={0}>
        <Box flexShrink={0}><Svg source={itemSvg(icon, color, live)} alt={name} width={32} height={32} /></Box>
        <Box flexDirection="column" flexGrow={1} flexShrink={1} minWidth={0}>
          <Text bold color={nameColor} dimColor={!live}>{name}</Text>
          {what ? <Text dimColor>{what}</Text> : null}
        </Box>
      </Box>
    )
    // A card: one soft outline, the same inset everywhere, air between its parts.
    const card = (key: string, children: unknown[], o: { borderColor?: string; tint?: string } = {}) => (
      <Box key={key} flexDirection="column" gap={2} borderStyle="round" borderColor={o.borderColor} borderDimColor={!o.borderColor} backgroundColor={o.tint} paddingX={narrow ? 1 : 2} paddingY={1}>
        {children}
      </Box>
    )
    // A block that used to fold: always open, under a plain heading (the terminal) or an icon heading.
    const block = (id: string, label: string, sub: string, icon: CardIcon, color: string, body: () => unknown, inline = false) => {
      if (term) {
        const wrap = inline ? (key: string, ...c: unknown[]) => <Box key={key} flexDirection="column" gap={0}>{c}</Box> : section
        return wrap(id, title(`${id}-title`, label), body())
      }
      return card(id, [head(`${id}-head`, icon, color, label, sub, { strong: true }), body()], { borderColor: color })
    }

    const PERIODS = [['today', 'Today'], ['week', '7 days'], ['total', 'Total']] as const
    const tabs = d.savings ? (
      <Box key="tabs" flexDirection="row" gap={1}>
        {PERIODS.map(([k, label]) => (term
          ? <Button key={`period-${k}`} plain label={k === panePeriod ? `[${label}]` : label} onPress={pickPeriod(k)} />
          : <Button key={`period-${k}`} label={label} variant={k === panePeriod ? 'primary' : 'secondary'} onPress={pickPeriod(k)} />))}
      </Box>
    ) : null

    // You saved: the work's cost without the router (everything on the compareWith model) less its cost with it.
    const against = c ? `running every prompt on ${compareLabel(c)}` : "keeping each chat's first model"
    const withUsd = s ? s.actualUsd + s.classifierUsd : 0
    // Too little data: no priced turn, or less than a cent of work, where both figures would read $0.00 and the percent is noise.
    const few = !!s && (s.pricedTurns === 0 || s.withoutUsd < 0.01)
    const down = !few && !!s && money(s.balanceUsd) === 'down'
    const savedWord = few ? 'Not enough data yet' : down ? 'The router cost more' : 'You saved'
    const savedSub = few ? 'Use the router for a few prompts and the saving shows here.' : down ? `than ${against}` : `compared with ${against}`
    // Why it cost more: stronger picks outweighed the cheaper ones, or the classifier ate the saving.
    const why = !down || !s ? null : s.actualUsd > s.withoutUsd
      ? 'Stronger models cost more than the cheaper ones saved. Raising the bar for a stronger model in Model & effort lowers it.'
      : 'The classifier cost more than routing saved. It pays off over longer tasks.'
    const savedText = s ? (money(s.balanceUsd) === 'none' ? '$0.00' : usd(Math.abs(s.balanceUsd))) : ''
    const savedColor = money(s?.balanceUsd ?? 0) === 'up' ? GREEN : MONEY_COLOR[money(s?.balanceUsd ?? 0)] ?? TONES.idle[0]
    const savedPct = s && s.withoutUsd > 0 ? Math.round((Math.abs(s.balanceUsd) / s.withoutUsd) * 100) : 0
    const days = d.savings?.days.slice(panePeriod === 'week' ? -7 : -14) ?? []
    const trend = days.some(x => Math.abs(x.balanceUsd) >= 0.005) && panePeriod !== 'today'
    // The chart's readout: each day's net and what it was made of, shown while the day is hovered.
    const dayWord = (v: number) => (v < 0 ? 'cost' : 'saved')
    const dayValues = days.map(x => x.balanceUsd)
    const dayPoints = days.map(x => ({
      value: x.balanceUsd,
      head: `${dayLabel(x.day)}: ${dayWord(x.balanceUsd)} ${usd(Math.abs(x.balanceUsd))}`,
      detail: x.prompts ? `${usd(x.actualUsd + x.classifierUsd)} with router · ${usd(x.withoutUsd)} without · ${x.prompts} prompt${x.prompts === 1 ? '' : 's'}` : 'No prompts that day',
    }))
    const daySum = days.reduce((a, x) => a + x.balanceUsd, 0)
    const best = days.reduce<(typeof days)[number] | null>((a, x) => (!a || x.balanceUsd > a.balanceUsd ? x : a), null)
    const dayIdle = {
      head: `${days.length} days: ${dayWord(daySum)} ${usd(Math.abs(daySum))}`,
      detail: best && best.balanceUsd >= 0.005 ? `Best ${dayLabel(best.day)}, ${usd(best.balanceUsd)} · point at a day for its numbers` : 'Point at a day for its numbers',
    }
    const stat = (key: string, label: string, value: string, color?: string) => (
      <Box key={key} flexDirection="column" flexGrow={1}>
        <Text dimColor>{label}</Text>
        <Text bold color={color}>{value}</Text>
      </Box>
    )
    const saved = !s ? null : term ? section('saved',
      tabs,
      title('saved-title', savedWord),
      few
        ? <Text key="saved-none" dimColor>{savedSub}</Text>
        : (
          <Box key="saved-v" flexDirection="column">
            <Text bold color={MONEY_COLOR[money(s.balanceUsd)]}>{savedText}</Text>
            <Text dimColor>{savedSub}</Text>
            {why ? <Text dimColor>{why}</Text> : null}
          </Box>
        ),
      !few ? (
        <Box key="saved-vs" flexDirection={narrow ? 'column' : 'row'} gap={narrow ? 0 : 3}>
          <Box flexDirection="column"><Text dimColor>Without router</Text><Text>{usd(s.withoutUsd)}</Text></Box>
          <Box flexDirection="column"><Text dimColor>With router</Text><Text>{usd(withUsd)}</Text></Box>
        </Box>
      ) : null,
    ) : card('saved', [
      head('saved-head', 'coin', savedColor, savedWord, savedSub, { strong: true }),
      tabs,
      few
        ? null
        : (
          <Box key="saved-v" flexDirection="column" gap={1}>
            <Box flexDirection="row" alignItems="center" gap={2}>
              <Box flexGrow={1} flexShrink={1} minWidth={0}>
                <Svg source={bigNumberSvg(savedText, savedColor, px, 44)} alt={`${savedWord}: ${savedText}`} height={56} />
              </Box>
              {savedPct ? <Box flexShrink={0}><Text bold color={savedColor}>{`${savedPct} % ${money(s.balanceUsd) === 'down' ? 'more' : 'less'}`}</Text></Box> : null}
            </Box>
            <Svg source={costBarSvg(withUsd, s.withoutUsd)} alt={`With router ${usd(withUsd)} of ${usd(s.withoutUsd)} without`} height={10} />
            {why ? <Text dimColor>{why}</Text> : null}
          </Box>
        ),
      !few ? (
        <Box key="saved-vs" flexDirection="row" gap={3}>
          {stat('saved-without', 'Without router', usd(s.withoutUsd))}
          {stat('saved-with', 'With router', usd(withUsd), savedColor)}
        </Box>
      ) : null,
      trend ? (
        <Box key="saved-trend" flexDirection="column" gap={0} width="100%">
          <Text dimColor>{`Saved per day, last ${days.length} days`}</Text>
          {/* The period's readout stays; a hovered day's numbers show in the two rows kept for them
              below it. A hover can reveal or recolor but not hide (a transparent color does not
              apply), so the day's numbers cannot take the period's place. */}
          <Text bold>{dayIdle.head}</Text>
          <Text dimColor>{dayIdle.detail}</Text>
          <Box key="spark-read" height={2} flexDirection="column">
            {dayPoints.map((p, i) => (
              <Box key={`spark-read-${i}`} position="absolute" top={0} left={0} flexDirection="column" display="none" hover={{ scope: `spark-day-${i}`, display: 'flex' }}>
                <Text bold>{p.head}</Text>
                <Text dimColor>{p.detail}</Text>
              </Box>
            ))}
          </Box>
          {/* One column per day in the flow, each its slice of the line as a plain image and a hover
              area of its own: the pane does the hover, no sandboxed frame. An absolute Box takes no
              pointer of its own (it counts as its parent's), so the columns cannot sit in one. A
              column's hover carries a transparent background besides its scope: with the scope
              alone the group never lit in the desktop app. */}
          <Box key="spark-cols" flexDirection="row" width="100%">
            {dayPoints.map((p, i) => (
              <Box key={`spark-col-${i}`} width={0} flexGrow={1} hover={{ scope: `spark-day-${i}`, backgroundColor: '#00000000' }}>
                <Svg source={sparkSvg(dayValues, i, SPARK_PX, savedColor)} alt={p.head} height={SPARK_PX} />
                <Box position="absolute" top={0} left={0} width="100%" display="none" hover={{ scope: `spark-day-${i}`, display: 'flex' }}>
                  <Svg source={sparkSvg(dayValues, i, SPARK_PX, savedColor, true)} alt={p.head} height={SPARK_PX} />
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      ) : null,
    ], { tint: `${savedColor}0d` })

    // The prompt cache: whether the next message still reads this chat's context from it, so the
    // person sees whether going on here is cheap. Green while warm, amber in its last fifth, red once
    // it lapsed or the chat moved to another model, grey before the first reply.
    const cv = d.cache.view
    drawnCache = cacheLabel(cv)
    const live = cv.state !== 'none'
    const cTone = CACHE_TONE[cv.state]
    const cColor = TONES[cTone][0]
    const cc = d.cache.costs
    const tok = d.tokens ? `${kTokens(d.tokens)} tokens` : 'context'
    const lastAt = d.cache.mark ? clockTime(d.cache.mark.at) : ''
    const lapse = d.cache.mark ? clockTime(d.cache.mark.at + cv.ttlMs) : ''
    const rewrite = `the next message writes the ${tok} again${cc ? ` (${usd(cc.cold)})` : ''}`
    const was = knownModel(d.cache.mark?.model)
    const [cacheName, cacheSub] = (() => {
      switch (cv.state) {
        case 'none': return ['No cache yet', 'The first reply caches this chat; later messages read it for a fraction of the price.']
        case 'warm': return ['Continue here', `The next message reads this chat's ${tok} from the cache${cc ? `: ${usd(cc.warm)} instead of ${usd(cc.cold)}` : ''}.`]
        case 'soon': return ['Reply soon to keep the cache', `It lapses at ${lapse}. After that ${rewrite}.`]
        default: return cv.moved
          ? ['The cache starts over', `This chat now runs on ${d.model ? MODEL_NAMES[d.model] : 'another model'}, the cache was on ${was ? MODEL_NAMES[was] : 'another'}: ${rewrite}.`]
          : ['Cache expired', `It lapsed at ${lapse}. ${rewrite[0]!.toUpperCase()}${rewrite.slice(1)}; for a new topic a new session starts smaller.`]
      }
    })()
    const cTime = cacheTime(cv)
    const cClock = cacheClock(cv)
    const cKind = `${TTL_NAME[cv.ttl]} cache${d.cache.mark?.ttl ? '' : ' (assumed)'}`
    // The terminal draws the live countdown as one Raster the ticker repaints every second in place;
    // without Raster here it is Text, and the ticker redraws the pane instead.
    const clockCols = Math.max(cells, Math.min(cols, 60))
    const counting = cv.state === 'warm' || cv.state === 'soon'
    drawnClock = term && counting && Raster ? { state: cv.state, name: cacheName, columns: clockCols, cells } : null
    const cacheCard = term ? section('cache',
      title('cache-title', 'Cache'),
      <Box key="cache-v" flexDirection="column">
        {drawnClock
          ? <Raster key={CLOCK_KEY} cells={cacheCells(cv, cacheName, clockCols, cells)} columns={clockCols} rows={2} />
          : (
            <Box flexDirection="column">
              <Text bold color={TONE_THEME[cTone]}>{counting ? `${cacheName} · ${cClock} left` : live ? `${cacheName} · ${cTime}` : cacheName}</Text>
              {live ? <Text color={TONE_THEME[cTone]}>{barText(cv.share * 100, 20, cells)}</Text> : null}
            </Box>
          )}
        <Text dimColor wrap="wrap">{cacheSub}</Text>
        {live ? <Text dimColor>{`${cKind} · last reply ${lastAt}`}</Text> : null}
      </Box>,
    ) : !live ? card('cache', [head('cache-head', 'clock', cColor, cacheName, cacheSub)]) : card('cache', [
      // The countdown sits on the heading's right in tabular figures, so the seconds do not jostle the
      // line; the bar under it empties towards the tick where "soon" starts.
      head('cache-head', 'clock', cColor, cacheName, cacheSub, {
        strong: true,
        right: counting ? (
          <Box flexDirection="column" alignItems="flex-end">
            <Svg source={bigNumberSvg(cClock, cColor, 96, 30)} alt={`Cache ${cTime}`} width={cClock.length > 4 ? 92 : 76} height={38} />
            <Text dimColor>left</Text>
          </Box>
        ) : undefined,
      }),
      <Box key="cache-v" flexDirection="column" gap={0}>
        {counting ? <Svg source={cacheBarSvg(cv, 8)} alt={`Cache ${cTime}`} height={14} /> : null}
        <Box flexDirection="row" justifyContent="space-between" gap={2}>
          <Text dimColor>{`Last reply ${lastAt}`}</Text>
          <Text dimColor>{cKind}</Text>
        </Box>
      </Box>,
      cc ? (
        <Box key="cache-cost" flexDirection="row" gap={3}>
          {stat('cache-warm', 'Next message, cache warm', usd(cc.warm), counting ? cColor : undefined)}
          {stat('cache-cold', 'Once it lapsed', usd(cc.cold), counting ? undefined : cColor)}
        </Box>
      ) : null,
      <Text key="cache-foot" dimColor wrap="wrap">{`Every message starts the ${cv.ttl === '1h' ? 'hour' : '5 minutes'} again · list prices`}</Text>,
    ], { borderColor: cColor, tint: `${cColor}0d` })

    // What you got: the context subagents kept out of the chat, the cheaper picks, the plan limit.
    const nums = s ? glance(s, d.window, d.savings?.perPct ?? null) : []
    const numbers = !nums.length ? null : term ? section('numbers',
      title('numbers-title', 'What you got'),
      ...nums.map(n => (
        <Box key={`num-${n.key}`} flexDirection="column">
          {row(`num-${n.key}-row`, n.label, n.value, { bold: true })}
          <Text dimColor>{n.sub}</Text>
        </Box>
      )),
    ) : card('numbers', [
      head('numbers-head', 'spark', TEAL, 'What you got', 'From the log, same period as above'),
      <Box key="numbers-grid" flexDirection="row" flexWrap="wrap" gap={1}>
        {nums.map(n => (
          <Box key={`num-${n.key}`} flexDirection="column" width={narrow ? '100%' : '48%'} flexGrow={1} borderStyle="round" borderColor={`${TEAL}38`} backgroundColor={`${TEAL}0f`} paddingX={1}>
            <Text dimColor>{n.label}</Text>
            <Text bold>{n.value}</Text>
            <Text dimColor wrap="wrap">{n.sub}</Text>
          </Box>
        ))}
      </Box>,
    ])

    // This chat: its context against the share where the router asks for a new session.
    const ctxRight = d.tokens ? `${kTokens(d.tokens)} of ${kTokens(d.window)} tokens` : 'context not known yet'
    const used = d.share == null ? '' : `${Math.round(d.share)} % used`
    const asks = d.at ? `asks for a new session at ${d.at} % (${kTokens((d.window * d.at) / 100)})` : 'never asks for a new session'
    // What the last reply and the whole session cost, as /cost counts it (subagents and the classifier
    // included); before the first reply, nothing.
    const lastUsd = d.spend.last == null ? '–' : usd(d.spend.last)
    const sessionUsdText = d.spend.session == null ? '–' : usd(d.spend.session)
    const spendRow = d.spend.last != null || !!d.spend.session
    const chat = term ? section('chat',
      title('chat-title', 'This chat'),
      <Box key="ctx" flexDirection="column">
        {row('ctx-head', d.header, ctxRight, { dim: false })}
        <Text color={TONE_THEME[d.tone]}>{`${barText(d.share, d.at, cells)} ${d.share == null ? '–' : `${Math.round(d.share)}%`}`}</Text>
        <Text dimColor>{[used, asks].filter(Boolean).join(' · ')}</Text>
        {spendRow ? row('chat-cost', `Last reply ${lastUsd}`, `This session ${sessionUsdText}`, { dim: true }) : null}
      </Box>,
    ) : card('chat', [
      head('chat-head', 'gauge', TONES[d.tone][0], 'This chat', d.header),
      <Box key="ctx" flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between" alignItems="center" gap={2}>
          <Box flexGrow={1} flexShrink={1} minWidth={0}>
            <Svg source={bigNumberSvg(d.share == null ? '–' : `${Math.round(d.share)} %`, TONES[d.tone][0], px, 30)} alt={used || 'Context unknown'} height={38} />
          </Box>
          <Box flexShrink={0}><Text dimColor>{ctxRight}</Text></Box>
        </Box>
        <Svg source={contextBarSvg(d.share, d.at, px, 10)} alt={`Context ${d.share == null ? 'unknown' : `${Math.round(d.share)}%`}${d.at ? `, new session at ${d.at}%` : ''}`} height={16} />
        <Text dimColor>{`${asks[0]!.toUpperCase()}${asks.slice(1)}. ${d.at ? 'The tick on the bar marks it.' : ''}`.trim()}</Text>
      </Box>,
      spendRow ? (
        <Box key="chat-cost" flexDirection="row" gap={3}>
          {stat('chat-last', 'Last reply', lastUsd)}
          {stat('chat-session', 'This session', sessionUsdText)}
        </Box>
      ) : null,
    ])

    // Settings: a name, its values as buttons (the chosen one highlighted) and one line on what it does.
    // The terminal gets one button per setting that steps to the next value.
    type Setting = { key: string; icon: CardIcon; name: string; what: string; values: readonly (readonly [string, string])[]; now: () => string; pick: (v: string) => Promise<void> }
    const same = (vals: readonly string[]) => vals.map(v => [v, v] as const)
    const opt = (k: Option, icon: CardIcon, name: string, what: string, values = same(CHOICES.find(x => x.key === k)?.values ?? [])): Setting =>
      ({ key: k, icon, name, what, values, now: () => String(cfg[k]), pick: v => saveOption($, k, v) })
    const cm = cfg.compareWith.split('-')[0] ?? 'first'
    const compareValue = (m: string, l: string) => {
      const v = m === 'first' || m === 'history' ? m : `${m}-${l || 'medium'}`
      return (SWITCHES.compareWith as readonly string[]).includes(v) ? v : SWITCHES.compareWith.find(x => x.startsWith(`${m}-`)) ?? SWITCHES.compareWith[0]
    }
    const main: Setting[] = [
      { key: 'enabled', icon: 'route', name: 'Router', what: 'Picks the cheapest model and effort that can handle each prompt.', values: same(['on', 'off']), now: () => (enabled ? 'on' : 'off'), pick: v => setEnabled($, v === 'on') },
      opt('firstChatDetection', 'spark', 'Model for a new chat', 'On your first prompt, suggests a better model. Ask: you confirm. Auto: it just switches.'),
      opt('midChatModelDetection', 'swap', 'Model mid-chat', 'When a later prompt needs a different model, offers to switch or to hand it to a subagent.'),
      opt('effortDetection', 'gauge', 'Effort', 'Raises or lowers the thinking effort to fit the prompt.'),
      opt('subagentSuggestions', 'branch', 'Subagents', 'Sends a side task to a cheaper subagent instead of switching this chat.'),
      {
        key: 'newSessionAt',
        icon: 'window',
        name: 'Start a new session at',
        what: 'Once the chat fills this much of its context, new work goes to a fresh session. Long chats get expensive. Ask or auto below.',
        values: same(['off', ...(CHOICES.find(x => x.key === 'newSessionAt')?.values ?? []).filter(v => v !== 'off')]),
        now: () => (cfg.sessionSuggestions === 'off' ? 'off' : cfg.newSessionAt),
        pick: async v => {
          if (v !== 'off' && cfg.sessionSuggestions === 'off') await saveOption($, 'sessionSuggestions', 'ask')
          await saveOption($, 'newSessionAt', v)
        },
      },
      opt('sessionSuggestions', 'window', 'New session: ask or auto', 'Ask: you confirm the new session. Auto: it starts by itself when the chat reaches the share. Off: never.'),
      opt('notifications', 'bell', 'Notifications', 'Shows a short note when the router changes something.'),
    ]
    const more: Setting[] = [
      opt('classifier', 'cpu', 'Decided by', 'The model that reads your prompt and decides. Haiku is cheaper, Sonnet more accurate.',
        same(CLASSIFIERS.filter(x => x !== 'opus' || cfg.classifier === 'opus'))),
      { key: 'compareModel', icon: 'scale', name: 'Savings compared with', what: 'What "You saved" is measured against.', values: COMPARE_MODELS.map(m => [m, m === 'first' ? 'first model' : m] as const), now: () => cfg.compareWith.split('-')[0] ?? 'first', pick: m => saveOption($, 'compareWith', compareValue(m, cfg.compareWith.split('-')[1] ?? '')) },
      ...(cm === 'first' || cm === 'history' ? [] : [{ key: 'compareEffort', icon: 'gauge', name: 'at effort', what: '', values: same(COMPARE_EFFORTS), now: () => cfg.compareWith.split('-')[1] ?? '', pick: (l: string) => saveOption($, 'compareWith', compareValue(cfg.compareWith.split('-')[0] ?? 'first', l)) }]),
      opt('openPane', 'pane', 'Open this pane on start', 'Opens this pane by itself when a session starts.'),
    ]
    const isSwitch = (x: Setting) => x.values.length === 2 && x.values.every(([v]) => v === 'on' || v === 'off')
    const setting = (x: Setting, i: number, color = ACCENT, bare = false) => {
      const current = x.now()
      const label = x.values.find(([v]) => v === current)?.[1] ?? current
      const rec = RECOMMENDED[x.key]
      const recLabel = x.values.find(([v]) => v === rec)?.[1]
      const what = [x.what, recLabel ? `Recommended: ${recLabel}.` : ''].filter(Boolean).join(' ')
      // Read again on the press: the pane may not have redrawn since the last one.
      const step = () => {
        const v = x.now()
        return x.pick(x.values[(x.values.findIndex(([y]) => y === v) + 1) % x.values.length]?.[0] ?? v)
      }
      if (term) {
        return (
          <Box key={`set-${x.key}`} flexDirection="column">
            <Button key={`toggle-${x.key}`} hotkey={i < 9 ? String(i + 1) : undefined} plain label={`${x.name}: ${label}`} onPress={step} />
            {what ? <Text dimColor>{what}</Text> : null}
          </Box>
        )
      }
      const control = isSwitch(x)
        // A switch: one press flips it; the key names the value it sets.
        ? <Button key={`toggle-${x.key}-${current === 'on' ? 'off' : 'on'}`} label={current === 'on' ? 'On' : 'Off'} variant={current === 'on' ? 'primary' : 'secondary'} onPress={() => x.pick(current === 'on' ? 'off' : 'on')} />
        : Select && (e.surface === 'desktop' || e.surface === 'vscode')
          // One native picker per setting; a value it cannot name still shows as the current one.
          ? <Select key={`pick-${x.key}`} value={current} options={[...x.values.map(([v, l]) => ({ value: v, label: v === rec ? `${l} (recommended)` : l })), ...(x.values.some(([v]) => v === current) ? [] : [{ value: current, label }])]} onSelect={(v: string) => x.pick(v)} />
          : (
            <Box flexDirection="row" gap={0}>
              {x.values.map(([v, l]) => <Button key={`toggle-${x.key}-${v}`} label={l} variant={v === current ? 'primary' : 'secondary'} dimColor={v !== current} onPress={() => x.pick(v)} />)}
            </Box>
          )
      // Each setting is a tile of its own inside the card, tinted and outlined in the card's colour: the
      // icon, the name and its line on the left, the control centred on both on the right, so the line
      // never runs under the control. A narrow pane puts the control under the words. The icon greys
      // when the setting is off, and every one but the switch itself while the router is off.
      const live = current !== 'off' && (enabled || x.key === 'enabled')
      if (bare) return control
      const tint = live ? color : TONES.idle[0]
      return (
        <Box key={`set-${x.key}`} flexDirection={narrow ? 'column' : 'row'} justifyContent="space-between" alignItems={narrow ? 'flex-start' : 'center'} gap={narrow ? 1 : 3} borderStyle="round" borderColor={`${tint}38`} backgroundColor={`${tint}0f`} paddingX={narrow ? 1 : 2} paddingY={1}>
          {item(`set-${x.key}-what`, x.icon, color, live, x.name, what)}
          <Box flexShrink={0}>{control}</Box>
        </Box>
      )
    }
    // More settings: in the terminal folded inside Settings; on the app surfaces a card of its own beside
    // Settings and Details, so every card has the same inset and the rows line up.
    const moreFold = block('more', 'More settings', `Classifier, savings baseline, auto-open`, 'sliders', ACCENT, () => (
      <Box key="more-body" flexDirection="column" gap={term ? 0 : 1}>
        {more.map((x, i) => setting(x, main.length + i))}
        {d.savings ? null : <Button key="stats-on" label="Turn the savings stats on" onPress={() => saveOption($, 'stats', 'on')} />}
      </Box>
    ), term)
    // On the app surfaces Settings is three cards, each in a colour of its own: the router's switch, the
    // model and effort choices, the session ones. Each has an icon heading with a line of its current values.
    const SETTING_GROUPS = [
      { key: 'model', name: 'Model & effort', icon: 'sliders' as CardIcon, color: BLUE, keys: ['firstChatDetection', 'midChatModelDetection', 'effortDetection', 'subagentSuggestions'] },
      { key: 'session', name: 'Session', icon: 'window' as CardIcon, color: TEAL, keys: ['newSessionAt', 'sessionSuggestions', 'notifications'] },
    ]
    const settingRows = main.flatMap((x, i) => [i ? rule(`rule-${x.key}`, false) : null, setting(x, i)])
    const valueOf = (x: Setting) => x.values.find(([v]) => v === x.now())?.[1] ?? x.now()
    const routerTile = () => {
      const sw = main[0]!
      return card('group-router', [
        head('router-head', 'route', ACCENT, 'Router', enabled ? 'Routing every prompt' : 'Off: nothing changes', { right: setting(sw, 0, ACCENT, true), strong: enabled }),
        <Text key="router-what" dimColor>{sw.what}</Text>,
      ], { borderColor: enabled ? ACCENT : undefined })
    }
    const groupTile = (g: (typeof SETTING_GROUPS)[number]) => {
      const rows = main.flatMap((x, i) => (g.keys.includes(x.key) ? [{ x, i }] : []))
      const sub = enabled ? rows.map(r => valueOf(r.x)).join(' · ') : 'Router off: nothing changes'
      return card(`group-${g.key}`, [
        head(`group-${g.key}-head`, g.icon, enabled ? g.color : TONES.idle[0], g.name, sub, { strong: enabled }),
        <Box key={`group-${g.key}-rows`} flexDirection="column" gap={1}>{rows.map(({ x, i }) => setting(x, i, g.color))}</Box>,
      ], { borderColor: enabled ? g.color : undefined })
    }
    const settings = term ? section('settings',
      title('settings-title', 'Settings'),
      ...settingRows,
      rule('rule-more', false),
      moreFold,
      cfgNote ? <Text key="cfg-note" dimColor>{cfgNote}</Text> : null,
    ) : [
      routerTile(),
      ...SETTING_GROUPS.map(groupTile),
      cfgNote ? <Text key="cfg-note" dimColor>{cfgNote}</Text> : null,
    ]

    // Details: the strict balance against your own setting, how often it was right, where tasks went.
    const t = b ? modelTable(b) : []
    const balanceWhat = "What the router added or saved on top of what you'd have picked yourself, the classifier included."
    const balanceName = `Router balance${isRough(b) ? ' (rough)' : ''}`
    const tasksText = t.slice(1).map(r => `${r[0]!.toLowerCase()} ${r[1]}`).join(' · ')
    // On the app surfaces Details opens on one tinted tile: the balance as a big figure in the colour of
    // its sign beside a ring of how often the router was right, with its 95 % range as a thin outer arc.
    // Under it where the tasks went: one bar parted by model, and a legend that reads as a small table.
    const allTasks = b ? b.byModel.reduce((a, r) => a + r.tasks, 0) : 0
    const byTasks = b ? [...b.byModel].sort((x, y) => y.tasks - x.tasks) : []
    const shade = (i: number) => VIOLETS[Math.min(i, VIOLETS.length - 1)]!
    const pctOf = (k: number) => `${allTasks ? Math.round((k / allTasks) * 100) : 0} %`
    const details = b ? block('details', 'Details', `Balance ${signed(b.usd)} · ${accuracyText(b).split(' (')[0]} right`, 'chart', VIOLET, () => (term
      ? (
        <Box key="details-body" flexDirection="column" gap={0}>
          <Box flexDirection="column">
            {row('balance', balanceName, signed(b.usd), { bold: true, color: MONEY_COLOR[money(b.usd)] })}
            <Text dimColor>{balanceWhat}</Text>
          </Box>
          {row('accuracy', 'Decisions right', accuracyText(b))}
          {t.length > 1 ? row('tasks', 'Tasks', tasksText) : null}
          <Text dimColor>Full table: /router stats.</Text>
        </Box>
      )
      : (
        <Box key="details-body" flexDirection="column" gap={2}>
          <Box key="details-hero" flexDirection="column" gap={1} borderStyle="round" borderColor={`${VIOLET}38`} backgroundColor={`${VIOLET}0f`} paddingX={narrow ? 1 : 2} paddingY={1}>
            <Box flexDirection="row" alignItems="center" gap={2}>
              <Box key="balance" flexDirection="column" gap={0} flexGrow={1} flexShrink={1} minWidth={0}>
                <Text dimColor>{balanceName}</Text>
                <Svg source={bigNumberSvg(signed(b.usd), MONEY_COLOR[money(b.usd)] ?? TONES.idle[0], px, 30)} alt={`${balanceName} ${signed(b.usd)}`} height={38} />
                <Text dimColor>vs. your own picks, classifier included</Text>
              </Box>
              <Box key="accuracy" flexShrink={0}>
                <Svg source={ringSvg(b.accuracy?.pct ?? null, b.accuracy?.low ?? null, b.accuracy?.high ?? null, VIOLET)} alt={b.accuracy ? `Decisions right: ${Math.round(b.accuracy.pct)} %` : 'Decisions right: not enough tasks yet'} width={88} height={88} />
              </Box>
            </Box>
            <Text dimColor>{b.accuracy ? `Decisions right · 95 %: ${Math.round(b.accuracy.low)}–${Math.round(b.accuracy.high)} %` : 'Decisions right · not enough tasks yet'}</Text>
          </Box>
          {byTasks.length ? (
            <Box key="tasks" flexDirection="column" gap={1}>
              <Box flexDirection="row" justifyContent="space-between" gap={2}>
                <Text>Where tasks went</Text>
                <Text dimColor>{`${allTasks} ${allTasks === 1 ? 'task' : 'tasks'}`}</Text>
              </Box>
              <Svg key="tasks-bar" source={stackSvg(byTasks.map((r, i) => ({ share: r.tasks, color: shade(i) })), 12, byTasks.map(r => `${r.model} ${pctOf(r.tasks)}`).join(', '))} alt={`Tasks: ${byTasks.map(r => `${r.model} ${pctOf(r.tasks)}`).join(', ')}`} height={12} />
              {byTasks.map((r, i) => (
                <Box key={`tasks-${r.model}`} flexDirection="row" alignItems="center" gap={1}>
                  <Box flexShrink={0}><Svg source={dotSvg(shade(i))} alt={`${r.model}: ${r.tasks} of ${allTasks} tasks`} width={10} height={10} /></Box>
                  <Box flexGrow={1} flexShrink={1} minWidth={0}><Text>{r.model}</Text></Box>
                  <Text dimColor>{`${r.tasks} ${r.tasks === 1 ? 'task' : 'tasks'} · ${usd(r.usdPerTask)}/task`}</Text>
                  <Box flexShrink={0} marginLeft={1}><Text bold>{pctOf(r.tasks)}</Text></Box>
                </Box>
              ))}
            </Box>
          ) : null}
          <Text dimColor>Full table: /router stats.</Text>
        </Box>
      ))) : null

    return (
      <Box flexDirection="column" gap={term ? 1 : narrow ? 1 : 2} padding={term ? 0 : 1}>
        {term ? <Text dimColor>{`Prompt Router · ${enabled ? 'on' : 'off'}`}</Text> : null}
        {saved ?? tabs}
        {term && (saved || tabs) ? rule('rule-cache') : null}
        {cacheCard}
        {term && numbers ? rule('rule-numbers') : null}
        {numbers}
        {term ? rule('rule-chat') : null}
        {chat}
        {d.savings ? null : <Text dimColor>Savings stats are off.</Text>}
        {term ? rule('rule-settings') : null}
        {settings}
        {term ? null : moreFold}
        {term && details ? rule('rule-details') : null}
        {details}
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
