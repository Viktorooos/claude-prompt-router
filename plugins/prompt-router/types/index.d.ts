export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** The router's last call, as the pane shows it. other: a subagent on another model than the chat's. */
export type LastDecision = {
  where: 'here' | 'subagent' | 'session' | 'keep' | 'other'
  outcome: 'applied' | 'asked'
  model: string
  effort: Level | ''
  why: string
  /** The model and effort the prompt had before the call; absent on calls noted by older versions. */
  from?: { model: string; effort: Level | '' }
  ts: number
  /** The chat's context when the call was made; null when the engine did not say. */
  tokens: number | null
  window: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'prompt-router': {
      /** The effort the mod puts on every main-chat request when the effort setting could not be changed. */
      override: Level | null
      /** The model the mod names on every main-chat request when the model setting could not be changed. */
      model: 'haiku' | 'sonnet' | 'opus' | 'fable' | null
      /** The last routing decision, for the pane. */
      last: Shaped<LastDecision | null>
      /** The pane's open folds, kept across the reload that saving an option causes. */
      paneOpen: string[] | null
    }
  }
}
