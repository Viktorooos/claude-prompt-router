import type { Level } from '../../plugins/prompt-router/types/index.d.ts'
import { NAMES, userLang } from '../../plugins/prompt-router/core/router.ts'
import type { Config, Model, Pick } from '../../plugins/prompt-router/core/router.ts'
import { TIER_OF } from '../shared/tiers.ts'

// The notes the router puts on a prompt, the same as the Claude Code mod's (register.tsx), with
// OpenCode's tools: question (AskUserQuestion), task (Agent), router_switch and router_session.

export const SWITCH_TOOL = 'router_switch'
export const SESSION_TOOL = 'router_session'

// The subagent the router adds for each tier: OpenCode's task tool takes an agent, not a model.
export function agentFor(m: Model) {
  return `router-${TIER_OF[m]}`
}

// What the user sees for a tier: its model, without the provider.
export function modelName(models: Record<Model, string>, m: Model) {
  const id = models[m]
  return id.slice(id.indexOf('/') + 1) || TIER_OF[m]
}

export type NoteCtx = { cfg: Config; models: Record<Model, string>; variants: Record<Level, string> }

function ask(header: string, question: string) {
  return `ask the user with the question tool (header "${header}", the question "${question}" with the reason in one sentence; if the question tool is not available, ask in one short message and wait for the answer)`
}

// The chat's model and effort change through the plugin's tool: the agent cannot move the picker.
export function switchCall(ctx: NoteCtx, to: { model?: Model; effort?: Level }) {
  const args = JSON.stringify({ ...(to.model ? { model: TIER_OF[to.model] } : {}), ...(to.effort ? { effort: to.effort } : {}) })
  const by = [to.model ? `the model ${ctx.models[to.model]} with /models` : '', to.effort ? `the variant "${ctx.variants[to.effort] || to.effort}" in the variant picker` : ''].filter(Boolean).join(' and ')
  return `call the ${SWITCH_TOOL} tool with ${args} (if the tool fails, tell the user in one line to pick ${by})`
}

export function sessionThen(ctx: NoteCtx, p: Pick) {
  return `new session = call the ${SESSION_TOOL} tool right away with model "${TIER_OF[p.model]}", effort "${p.effort}", prompt = the task from this message with what it needs to know; here, say in one line where the work went (the user opens it with /sessions). If the tool fails, give the user, in a bash code block, the command to run in a new terminal: opencode --model ${ctx.models[p.model]} --prompt "<the task from this message, with what it needs to know, in one line>", then stop here.`
}

// Here keeps its own effort choice: a lower effort fits a task even when it stays in this chat.
export function askNote(ctx: NoteCtx, p: Pick, now: Level | '', midTurn = false) {
  const { cfg } = ctx
  const label = `${modelName(ctx.models, p.model)} · ${p.effort}`
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
      ? `${switchHere} = ${switchCall(ctx, { effort: p.effort })}, then handle the prompt; ${keepHere} = continue normally.`
      : `${switchHere} = ${switchCall(ctx, { effort: p.effort })}, then handle the prompt.`
  return `Prompt Router suggests running this prompt in ${where} (${label})${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${now || 'unknown'}. Before doing anything, ${ask('Prompt Router', 'Where should this go?')} with the options ${options}, the recommended one first. Write the question and options in ${userLang(cfg)}. Then: ${sessionThen(ctx, p)} Subagent = call the task tool with subagent_type "${agentFor(p.model)}" (it runs on ${ctx.models[p.model]}; the router sets effort "${p.effort}") and have it return only a short result. ${hereThen}`
}

// The person decides: one question for the model and effort changes the router would make.
export function switchNote(ctx: NoteCtx, p: Pick, model: { from: Model } | null, effort: { now: Level | '' } | null) {
  const parts = [
    model ? `model ${modelName(ctx.models, p.model)} instead of ${modelName(ctx.models, model.from)}` : '',
    effort ? `effort ${p.effort} instead of ${effort.now || 'unknown'}` : '',
  ].filter(Boolean)
  const label = [model ? modelName(ctx.models, p.model) : '', effort ? NAMES[p.effort] : ''].filter(Boolean).join(' · ')
  const how = switchCall(ctx, { model: model ? p.model : undefined, effort: effort ? p.effort : undefined })
  return `Prompt Router suggests ${parts.join(' and ')} for this prompt${p.why ? `, because: ${p.why}` : ''}. Before doing anything, ${ask('Prompt Router', 'Switch?')} with the options "Switch (${label})", "Keep as is", the recommended one first. Write the question and options in ${userLang(ctx.cfg)}. On Switch, ${how}, then handle the prompt; on Keep as is, handle the prompt normally.`
}
