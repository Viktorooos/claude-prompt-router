// The turn's routing flow with no engine: the pick made final, the notes appended to the prompt, what
// to change, toast and record. Claude Code's semantics (hooks/register.tsx decide()) with time, tool
// and model names passed in, so another host (OpenCode) can run the same flow.
import type { Level } from '../types'
import { DECIDE_OTHER, MODEL_NAMES, MODELS, NAMES, RUN_SUBAGENT, TOLD_OTHER, allowed, knownModel, preferSession, userLang } from './router.ts'
import type { Config, Model, Pick, Where } from './router.ts'
import type { Accept, Decision } from './stats.ts'

// The host's tool names and how it names models and efforts in the notes.
export type Names = {
  switchTool: string
  askTool: string
  sessionTool: string
  agentTool: string
  /** Shown to the person: "Haiku". */
  modelName: (m: Model) => string
  /** Handed to a new session: "claude-haiku-5-5". */
  modelId: (m: Model) => string
  /** Shown to the person: "Low". */
  effortOf: (l: Level) => string
  /** The host's own "call the switch tool …" (default: Claude Code's, below). */
  switchCall?: (to: { model?: Model; effort?: Level }) => string
  /** The host's own "new session = …" step (default: Claude Code's, below). */
  sessionThen?: (p: Pick, inApp: boolean) => string
  /** The host's own "call the … tool" for a subagent on p (default: the agent tool with model and effort). */
  agentCall?: (p: Pick) => string
}

export const CLAUDE_CODE_NAMES: Names = {
  switchTool: 'mcp__prompt-router__switch',
  askTool: 'AskUserQuestion',
  sessionTool: 'start_session',
  agentTool: 'Agent',
  modelName: m => MODEL_NAMES[m],
  modelId: m => MODELS[m],
  effortOf: l => NAMES[l],
}

export type Ctx = { cfg: Config; names: Names }

// The classifier's parsed pick made final: allowed models, a long chat's session, a first prompt that
// stays here, a prompt that stays here on another model than the chat's (`model`: the chat's model).
export function finalizePick(parsed: Pick | null, c: { cfg: Config; tokens: number | undefined; window: number | undefined; isFirst: boolean; model: string }): Pick | null {
  const p = parsed && preferSession(allowed(parsed, c.cfg), { tokens: c.tokens, window: c.window }, c.cfg)
  // The first prompt of a chat has nothing to leave: only its model and effort count.
  if (p && c.isFirst) return { ...p, where: 'here', first: { now: knownModel(c.model) } }
  const cur = knownModel(c.model)
  if (p?.where === 'here' && cur && p.model !== cur && c.cfg.midChatModelDetection !== 'off') return { ...p, other: { now: cur } }
  return p
}

// The chat's own model and effort change through the mod's tool.
export function switchCall(n: Ctx, to: { model?: Model; effort?: Level }) {
  if (n.names.switchCall) return n.names.switchCall(to)
  const tool = n.names.switchTool
  const args = JSON.stringify({ ...(to.model ? { model: to.model } : {}), ...(to.effort ? { effort: to.effort } : {}) })
  const slash = [to.model ? `/model ${to.model}` : '', to.effort ? `/effort ${to.effort}` : ''].filter(Boolean).join(' and ')
  return `call the ${tool} tool with ${args} (load it with ToolSearch "select:${tool}" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run ${slash})`
}

function hereChoice(n: Ctx, name: string, p: Pick, now: Level | '', effort: boolean) {
  const switchHere = `"${name} (${n.names.effortOf(p.effort)})"`
  const keepHere = now ? `"${name} (keep ${n.names.effortOf(now)})"` : `"${name} (keep the effort)"`
  if (!effort || n.cfg.effortDetection === 'off') return { options: `"${name}"`, then: `"${name}" = continue normally.` }
  if (n.cfg.effortDetection === 'ask') return { options: `${switchHere}, ${keepHere}`, then: `${switchHere} = ${switchCall(n, { effort: p.effort })}, then handle the prompt; ${keepHere} = continue normally.` }
  return { options: switchHere, then: `${switchHere} = ${switchCall(n, { effort: p.effort })}, then handle the prompt.` }
}

function askFirst(n: Ctx, options: string) {
  return `ACTION FIRST, before any other step: call the ${n.names.askTool} tool (header "Prompt Router", the question "Where should this go?" with the reason in one sentence) with the options ${options}, the recommended one first, written in ${userLang(n.cfg)}. Do not answer or start the task until the user has picked one.`
}

const label = (n: Ctx, p: Pick) => `${n.names.modelName(p.model)} · ${p.effort}`
const agentCall = (n: Ctx, p: Pick) => n.names.agentCall?.(p) ?? `call the ${n.names.agentTool} tool with model "${p.model}" and effort "${p.effort}"`
const cap = (s: string) => s[0].toUpperCase() + s.slice(1)
const because = (p: Pick) => (p.why ? `, because: ${p.why}` : '')

export function sessionThen(n: Ctx, p: Pick, inApp: boolean) {
  if (n.names.sessionThen) return n.names.sessionThen(p, inApp)
  if (inApp) return `new session = call ${n.names.sessionTool} right away with initiation "user_asked", context "fresh", model "${n.names.modelId(p.model)}", effort "${p.effort}", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went.`
  return `new session = this client cannot start one, so give the user, in a bash code block, the command to run in a new terminal: claude --model ${n.names.modelId(p.model)} --effort ${p.effort} "<the task from this message, with what it needs to know, in one line>", then stop here.`
}

export function askNote(n: Ctx, p: Pick, now: Level | '', midTurn = false, inApp = true) {
  const l = label(n, p)
  const where = p.where === 'session' ? 'a new session' : 'a subagent'
  const session = `"New session (${l})"`
  const agent = `"Subagent (${l})"`
  const here = hereChoice(n, 'Do it here', p, now, !midTurn && p.effort !== now)
  const options = p.where === 'session' ? `${session}, ${agent}, ${here.options}` : `${agent}, ${here.options}`
  return `${askFirst(n, options)} Prompt Router suggests running this prompt in ${where} (${l})${because(p)}. This chat currently runs at effort ${now || 'unknown'}. Then: ${sessionThen(n, p, inApp)} Subagent = ${agentCall(n, p)} and have it return only a short result. ${here.then}`
}

export function runAgentNote(n: Ctx, p: Pick, other?: Model) {
  const l = label(n, p)
  const head = other
    ? `Prompt Router: this prompt fits ${l} better than this chat's ${n.names.modelName(other)}`
    : `Prompt Router: run this prompt in a subagent (${l})`
  const brief = other ? '; it does not see this chat, so give it everything it needs from this chat in its prompt,' : ''
  return `${head}${because(p)}. ${RUN_SUBAGENT} ${cap(agentCall(n, p))}${brief} and have it return only a short result.${other ? " Never switch this chat's model for it." : ''}`
}

export function autoSessionNote(n: Ctx, p: Pick) {
  return `Prompt Router: this chat is long${because(p)}, so run this prompt in a new session (${label(n, p)}) without asking. Then: ${sessionThen(n, p, true)}`
}

export function otherNote(n: Ctx, p: Pick, from: Model, now: Level | '') {
  const l = label(n, p)
  const here = hereChoice(n, 'Stay here', p, now, p.effort !== now)
  return `${askFirst(n, `"Subagent (${l})", ${here.options}`)} Prompt Router: this prompt belongs to this chat but fits ${l} better than this chat's ${n.names.modelName(from)}${because(p)}. This chat currently runs at effort ${now || 'unknown'}. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Then: Subagent = ${agentCall(n, p)}; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. ${here.then}`
}

export function otherAutoNote(n: Ctx, p: Pick, from: Model, now: Level | '') {
  const l = label(n, p)
  const here = hereChoice(n, 'Stay here', p, now, p.effort !== now)
  const stay = n.cfg.effortDetection === 'off' || p.effort === now ? 'handle the prompt normally.'
    : n.cfg.effortDetection === 'ask' ? `ask the user only about the effort with the ${n.names.askTool} tool (header "Prompt Router", the question "Effort?" with the reason in one sentence) with the options ${here.options}, in ${userLang(n.cfg)}; ${here.then}`
    : `${switchCall(n, { effort: p.effort })}, then handle the prompt.`
  return `Prompt Router: this prompt belongs to this chat but fits ${l} better than this chat's ${n.names.modelName(from)}${because(p)}. This chat currently runs at effort ${now || 'unknown'}. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. ${DECIDE_OTHER} Subagent = ${agentCall(n, p)}; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. Here = ${stay} ${TOLD_OTHER}`
}

export function switchNote(n: Ctx, p: Pick, model: { from: Model } | null, effort: { now: Level | '' } | null) {
  const parts = [
    model ? `model ${n.names.modelName(p.model)} instead of ${n.names.modelName(model.from)}` : '',
    effort ? `effort ${p.effort} instead of ${effort.now || 'unknown'}` : '',
  ].filter(Boolean)
  const l = [model ? n.names.modelName(p.model) : '', effort ? n.names.effortOf(p.effort) : ''].filter(Boolean).join(' · ')
  const how = switchCall(n, { model: model ? p.model : undefined, effort: effort ? p.effort : undefined })
  return `Prompt Router suggests ${parts.join(' and ')} for this prompt${because(p)}. Before doing anything, ask the user with the ${n.names.askTool} tool (header "Prompt Router", the question "Switch?" with the reason in one sentence) with the options "Switch (${l})", "Keep as is", the recommended one first. Write the question and options in ${userLang(n.cfg)}. On Switch, ${how}, then handle the prompt; on Keep as is, handle the prompt normally.`
}

// What one routed prompt does. The host, in this order: applies `apply` (model, then effort), notes
// `decision` (its time stamp becomes the asked one's `ts` when `asked` is set), shows `toasts`, and
// appends `note` to the prompt as `\n\n[note]`.
export type Step = {
  note?: string
  apply: { model?: Model; effort?: Level }
  toasts: string[]
  decision?: { where: Decision['where']; to: Decision['to']; outcome: Decision['outcome']; p?: Pick }
  /** The offer the turn's end and a spawned subagent check (register.tsx lastAsked, without its ts). */
  asked?: { where: Where; model: Model }
}

// The route for a picked prompt. The host first skips quickReply(text) prompts (no classifier call);
// `p` is finalizePick's result (null: none), `from` the chat's model before the pick, `classified`
// whether the classifier answered, `midTurn` whether the prompt came over a running turn, `inApp`
// whether this chat can start a session itself (only read for a session).
export function route(n: Ctx, t: { p: Pick | null; now: Level | ''; from: string; classified: boolean; midTurn: boolean; inApp: boolean }): Step {
  const { p, now, from } = t
  const { cfg, names } = n
  const keep = { where: 'keep' as const, to: { model: from, effort: now }, outcome: 'applied' as const }
  if (!p) return t.classified ? { apply: {}, toasts: [], decision: keep } : { apply: {}, toasts: [] }
  const asked = (where: Where) => ({ decision: { where, to: { model: p.model, effort: p.effort }, outcome: 'asked' as const, p }, asked: { where, model: p.model } })
  const run = (note: string): Step => ({
    note,
    apply: {},
    toasts: cfg.notifications === 'on' ? [`Subagent: ${names.modelName(p.model)} · ${names.effortOf(p.effort)}${p.why ? `, ${p.why}` : ''}`] : [],
    decision: { where: 'subagent', to: { model: p.model, effort: p.effort }, outcome: 'applied', p },
    asked: { where: 'subagent', model: p.model },
  })

  if (p.where === 'here') {
    // A prompt typed over a running turn belongs to that work: its model and effort stay.
    if (t.midTurn) return { apply: {}, toasts: [], decision: keep }
    if (p.other && cfg.midChatModelDetection === 'ask' && cfg.subagentSuggestions === 'auto') return run(runAgentNote(n, p, p.other.now))
    if (p.other) return { note: (cfg.midChatModelDetection === 'auto' ? otherAutoNote : otherNote)(n, p, p.other.now, now), apply: {}, toasts: [], ...asked('subagent') }
    const apply: Step['apply'] = {}
    const changes: string[] = []
    let askModel: { from: Model } | null = null
    let askEffort: { now: Level | '' } | null = null
    // A new chat: the model it starts on may not fit the task.
    const first = p.first?.now
    if (first && p.model !== first && cfg.firstChatDetection !== 'off') {
      if (cfg.firstChatDetection === 'ask') askModel = { from: first }
      else {
        apply.model = p.model
        changes.push(`Model: ${names.modelName(p.model)} (was ${names.modelName(first)})`)
      }
    }
    if (p.effort !== now && cfg.effortDetection !== 'off') {
      if (cfg.effortDetection === 'ask') askEffort = { now }
      else {
        apply.effort = p.effort
        changes.push(`Effort: ${names.effortOf(p.effort)}${now ? ` (was ${names.effortOf(now)})` : ''}`)
      }
    }
    const toasts = changes.length && cfg.notifications === 'on' ? [`${changes.join(', ')}${p.why ? `, ${p.why}` : ''}`] : []
    if (askModel || askEffort) return { note: switchNote(n, p, askModel, askEffort), apply, toasts, ...asked('here') }
    const changed = { model: apply.model ?? from, effort: apply.effort ?? now }
    return { apply, toasts, decision: { where: 'here', to: changed, outcome: 'applied', p } }
  }
  if (p.where === 'subagent' && cfg.subagentSuggestions === 'auto') return run(runAgentNote(n, p))
  if (p.where === 'session' && p.long && cfg.sessionSuggestions === 'auto' && t.inApp) {
    return { note: autoSessionNote(n, p), apply: {}, toasts: [], decision: { where: 'session', to: { model: p.model, effort: p.effort }, outcome: 'applied', p }, asked: { where: 'session', model: p.model } }
  }
  return { note: askNote(n, p, now, t.midTurn, p.where !== 'session' || t.inApp), apply: {}, toasts: [], ...asked(p.where) }
}

// The record a decision writes to the stats log (field order as Claude Code writes it).
export type Noted = { ts: number; platform: string; chat: string; from: string; now: Level | ''; key?: string; follows?: Decision['follows']; classifier?: Decision['classifier']; session?: string; redo?: boolean }

export function decisionRecord(c: Noted, d: NonNullable<Step['decision']>): Decision {
  return { kind: 'decision', ts: c.ts, platform: c.platform, chat: c.chat, where: d.where, from: { model: c.from, effort: c.now }, to: d.to, ...(c.follows ? { follows: c.follows } : {}), outcome: d.outcome, ...(c.key ? { key: c.key } : {}), ...(c.classifier ? { classifier: c.classifier } : {}), ...(c.session ? { session: c.session } : {}), ...(c.redo ? { redo: true as const } : {}) }
}

// The person took the offer (`decision`: the asked decision's ts), or the turn ended without it.
export function acceptRecord(c: { ts: number; platform: string; chat: string; decision: number; declined?: boolean }): Accept {
  return { kind: 'accept', ts: c.ts, platform: c.platform, chat: c.chat, decision: c.decision, ...(c.declined ? { outcome: 'declined' as const } : {}) }
}

// A spawned subagent on the offered model takes a subagent offer.
export function spawnAccepts(asked: Step['asked'] | null, model: unknown) {
  return asked?.where === 'subagent' && knownModel(model) === asked.model
}

// The router's own question: the turn that showed it and ended with the offer still open declined it.
export function isRouterQuestion(n: Ctx, tool: string, input: unknown) {
  const qs = (input as { questions?: unknown } | null)?.questions
  return tool === n.names.askTool && Array.isArray(qs) && qs.some(q => (q as { header?: unknown })?.header === 'Prompt Router')
}

export function declinedAtEnd(asked: Step['asked'] | null, routerAsked: boolean) {
  return !!asked && routerAsked
}
