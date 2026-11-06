import type { Level } from '../../plugins/prompt-router/types/index.d.ts'
import { DECIDE_OTHER, NAMES, RUN_SUBAGENT, TOLD_OTHER } from '../../plugins/prompt-router/core/router.ts'
import type { Config, Model, Pick } from '../../plugins/prompt-router/core/router.ts'
import { userLang } from '../../plugins/prompt-router/core/router.ts'

// The notes the router puts on a prompt, the same decisions as the Claude Code mod's (register.tsx),
// worded for Codex: a hook cannot switch a running session's model or effort (and Codex does not
// re-read config.toml between turns), so a switch is a `/model <model> <effort>` line for the user.
// Codex has no AskUserQuestion outside Plan mode, so the agent asks in text; its subagent tool is
// spawn_agent; a new session is a `codex` command for a new terminal.

export const SUBAGENT_TOOL = 'spawn_agent'

// noSubagent: the client has no spawn_agent (the ChatGPT desktop), so no Subagent option is offered.
export type NoteCtx = { cfg: Config; models: Record<Model, string>; effortOf: (slug: string, l: Level) => string; noSubagent?: boolean }

// The slash command that puts this chat on a model and effort.
export function slash(ctx: NoteCtx, slug: string, l: Level) {
  return `/model ${slug} ${ctx.effortOf(slug, l)}`
}

// The one line the user sees (systemMessage) and the agent starts its reply with.
export function line(ctx: NoteCtx, slug: string, l: Level, why: string) {
  return `Prompt Router: for this, switch with \`${slash(ctx, slug, l)}\`${why ? ` (${why})` : ''}`
}

// The desktop app has a question tool that shows the options as buttons; the CLI gets a numbered list.
function ask(question: string) {
  return `ask the user: if you have a request_user_input or request_user_input_async tool, call it (title starting with "Prompt Router:", the question "${question}" with the reason in one sentence, the options as choices, the recommended one first); otherwise write one short message (start it with "Prompt Router:", the question "${question}" with the reason in one sentence, the options as a numbered list, the recommended one first). Wait for the answer`
}

export function sessionCommand(ctx: NoteCtx, p: Pick) {
  const slug = ctx.models[p.model]
  return `codex -m ${slug} -c model_reasoning_effort=${ctx.effortOf(slug, p.effort)} "<the task from this message, with what it needs to know, in one line>"`
}

// The "do it here" options: here keeps its own effort choice, a lower effort fits a task even
// when it stays in this chat. Without an effort change the option just goes on.
function hereChoice(ctx: NoteCtx, name: string, p: Pick, cur: { model: string; now: Level | '' }, effort: boolean) {
  const switchHere = `"${name} (${NAMES[p.effort]})"`
  const keepHere = cur.now ? `"${name} (keep ${NAMES[cur.now]})"` : `"${name} (keep the effort)"`
  if (!effort || ctx.cfg.effortDetection === 'off') return { options: `"${name}"`, then: `"${name}" = continue normally.` }
  const switchLine = `give the user the line "${line(ctx, cur.model, p.effort, '')}" (this chat cannot be switched from inside it), then handle the prompt at the current setting`
  if (ctx.cfg.effortDetection === 'ask') return { options: `${switchHere}, ${keepHere}`, then: `${switchHere} = ${switchLine}; ${keepHere} = continue normally.` }
  return { options: switchHere, then: `${switchHere} = ${switchLine}.` }
}

function subagentCall(ctx: NoteCtx, p: Pick, brief = '') {
  const slug = ctx.models[p.model]
  return `call the ${SUBAGENT_TOOL} tool with model "${slug}" and reasoning_effort "${ctx.effortOf(slug, p.effort)}"${brief} and have it return only a short result; if this session has no ${SUBAGENT_TOOL} tool, say so in one line and do it here.`
}

function label(ctx: NoteCtx, p: Pick) {
  const slug = ctx.models[p.model]
  return `${slug} · ${ctx.effortOf(slug, p.effort)}`
}

export function askNote(ctx: NoteCtx, p: Pick, cur: { model: string; now: Level | '' }, midTurn = false) {
  const { cfg } = ctx
  const l = label(ctx, p)
  const where = p.where === 'session' ? 'a new session' : 'a subagent'
  const session = `"New session (${l})"`
  // The Codex desktop has no spawn_agent: no subagent option there.
  const agent = ctx.noSubagent ? '' : `"Subagent (${l})"`
  const here = hereChoice(ctx, 'Do it here', p, cur, !midTurn && p.effort !== cur.now && !!cur.model)
  const options = [p.where === 'session' ? session : '', agent, here.options].filter(Boolean).join(', ')
  return `Prompt Router suggests running this prompt in ${where} (${l})${p.why ? `, because: ${p.why}` : ''}. This chat currently runs on ${cur.model || 'an unknown model'} at effort ${cur.now || 'unknown'}. Before doing anything, ${ask('Where should this go?')} with the options ${options}. Write the question and options in ${userLang(cfg)}. Then: New session = give the user, in a bash code block, the command to run in a new terminal: ${sessionCommand(ctx, p)}, then stop here.${agent && ` Subagent = ${subagentCall(ctx, p)}`} ${here.then}`
}

// A prompt that stays here but fits another model: a subagent on that model, or here on the chat's
// model with only the effort judged again. The chat's model never changes mid-chat.
export function otherNote(ctx: NoteCtx, p: Pick, cur: { model: string; now: Level | '' }, effort: boolean) {
  const l = label(ctx, p)
  const here = hereChoice(ctx, 'Stay here', p, cur, effort)
  return `Prompt Router: this prompt belongs to this chat but fits ${l} better than this chat's ${cur.model}${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${cur.now || 'unknown'}. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Before doing anything, ${ask('Where should this go?')} with the options "Subagent (${l})", ${here.options}. Write the question and options in ${userLang(ctx.cfg)}. Then: Subagent = ${subagentCall(ctx, p, '; it does not see this chat, so give it everything it needs from this chat in its message,')} ${here.then}`
}

// midChatModelDetection auto: no "Where should this go?"; staying here judges the effort as
// effortDetection says (auto names the switch line, ask asks only about it, off leaves it).
export function otherAutoNote(ctx: NoteCtx, p: Pick, cur: { model: string; now: Level | '' }, effort: boolean) {
  const l = label(ctx, p)
  const here = hereChoice(ctx, 'Stay here', p, cur, effort)
  const stay = !effort || ctx.cfg.effortDetection === 'off' ? 'handle the prompt normally.'
    : ctx.cfg.effortDetection === 'ask' ? `${ask('Effort?')} about the effort only, with the options ${here.options}, in ${userLang(ctx.cfg)}; ${here.then}`
    : `give the user the line "${line(ctx, cur.model, p.effort, '')}" (this chat cannot be switched from inside it), then handle the prompt at the current setting.`
  return `Prompt Router: this prompt belongs to this chat but fits ${l} better than this chat's ${cur.model}${p.why ? `, because: ${p.why}` : ''}. This chat currently runs at effort ${cur.now || 'unknown'}. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. ${DECIDE_OTHER} Subagent = ${subagentCall(ctx, p, '; it does not see this chat, so give it everything it needs from this chat in its message,')} Here = ${stay} ${TOLD_OTHER}`
}

// subagentSuggestions auto: the subagent starts at once, no "Where should this go?". `other` is the
// chat's model when the prompt belongs to this chat but fits another model (the subagent does not see the chat).
export function runAgentNote(ctx: NoteCtx, p: Pick, other?: string) {
  const l = label(ctx, p)
  const head = other ? `Prompt Router: this prompt fits ${l} better than this chat's ${other}` : `Prompt Router: run this prompt in a subagent (${l})`
  const brief = other ? '; it does not see this chat, so give it everything it needs from this chat in its message,' : ''
  return `${head}${p.why ? `, because: ${p.why}` : ''}. ${RUN_SUBAGENT} Then ${subagentCall(ctx, p, brief)}`
}

// The system line for a subagent the router started by itself.
export function runAgentLine(ctx: NoteCtx, p: Pick) {
  return `Prompt Router: subagent ${label(ctx, p)}${p.why ? ` (${p.why})` : ''}`
}

// Mode auto: Codex cannot switch the chat, so the agent names the switch in one line and goes on.
export function autoNote(ctx: NoteCtx, slug: string, l: Level, p: Pick) {
  return `Prompt Router: this prompt fits ${slug} at effort ${ctx.effortOf(slug, l)} better than the current setting${p.why ? `, because: ${p.why}` : ''}. Begin your reply with exactly this one line: ${line(ctx, slug, l, p.why)}. Then handle the prompt right away at the current setting; do not ask about it and do not mention it again.`
}

// Mode ask: one question for the model and effort changes the router would make.
export function switchNote(ctx: NoteCtx, p: Pick, cur: { model: string; now: Level | '' }, model: { from: string } | null, effort: { now: Level | '' } | null) {
  const slug = model ? ctx.models[p.model] : cur.model
  const l = effort ? p.effort : (cur.now || p.effort)
  const parts = [
    model ? `model ${slug} instead of ${model.from}` : '',
    effort ? `effort ${ctx.effortOf(slug, p.effort)} instead of ${effort.now || 'unknown'}` : '',
  ].filter(Boolean)
  const label = [model ? slug : '', effort ? NAMES[p.effort] : ''].filter(Boolean).join(' · ')
  return `Prompt Router suggests ${parts.join(' and ')} for this prompt${p.why ? `, because: ${p.why}` : ''}. Before doing anything, ${ask('Switch?')} with the options "Switch (${label})", "Keep as is", the recommended one first. Write the question and options in ${userLang(ctx.cfg)}. On Switch, give the user the line "${line(ctx, slug, l, '')}" (this chat cannot be switched from inside it; the switch applies from the next prompt), then handle the prompt; on Keep as is, handle the prompt normally.`
}

// /router: the hook cannot answer by itself, so the agent repeats the status.
export function statusNote(text: string) {
  return `[Prompt Router] The user typed /router. Reply with exactly the text below and nothing else; call no tools.\n\n${text}`
}
