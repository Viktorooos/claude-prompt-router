import type { Level } from '../../plugins/prompt-router/types/index.d.ts'
import { NAMES } from '../../plugins/prompt-router/core/router.ts'
import type { Model } from '../../plugins/prompt-router/core/router.ts'
import type { Names } from '../../plugins/prompt-router/core/flow.ts'
import { TIER_OF } from '../shared/tiers.ts'

// OpenCode's names for the shared notes (core/flow.ts): question (AskUserQuestion), task (Agent),
// router_switch and router_session.

export const SWITCH_TOOL = 'router_switch'
export const SESSION_TOOL = 'router_session'
export const STATS_TOOL = 'router_stats'

// The subagent the router adds for each tier: OpenCode's task tool takes an agent, not a model.
export function agentFor(m: Model) {
  return `router-${TIER_OF[m]}`
}

// What the user sees for a tier: its model, without the provider.
export function modelName(models: Record<Model, string>, m: Model) {
  const id = models[m]
  return id.slice(id.indexOf('/') + 1) || TIER_OF[m]
}

// The names core/flow.ts writes OpenCode's notes with: tiers for the tools, the user's model ids.
export function openCodeNames(models: Record<Model, string>, variants: Record<Level, string>): Names {
  return {
    switchTool: SWITCH_TOOL,
    askTool: 'question',
    sessionTool: SESSION_TOOL,
    agentTool: 'task',
    modelName: m => modelName(models, m),
    modelId: m => models[m],
    effortOf: l => NAMES[l],
    // The agent cannot move the picker: the plugin's tool switches, else the person does.
    switchCall: to => {
      const args = JSON.stringify({ ...(to.model ? { model: TIER_OF[to.model] } : {}), ...(to.effort ? { effort: to.effort } : {}) })
      const by = [to.model ? `the model ${models[to.model]} with /models` : '', to.effort ? `the variant "${variants[to.effort] || to.effort}" in the variant picker` : ''].filter(Boolean).join(' and ')
      return `call the ${SWITCH_TOOL} tool with ${args} (if the tool fails, tell the user in one line to pick ${by})`
    },
    sessionThen: p => `new session = call the ${SESSION_TOOL} tool right away with model "${TIER_OF[p.model]}", effort "${p.effort}", prompt = the task from this message with what it needs to know; here, say in one line where the work went (the user opens it with /sessions). If the tool fails, give the user, in a bash code block, the command to run in a new terminal: opencode --model ${models[p.model]} --prompt "<the task from this message, with what it needs to know, in one line>", then stop here.`,
    // The task tool takes an agent, not a model: one per tier, its effort set by the router.
    agentCall: p => `call the task tool with subagent_type "${agentFor(p.model)}" (it runs on ${models[p.model]}; the router sets effort "${p.effort}")`,
  }
}
