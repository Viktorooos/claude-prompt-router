export type Level = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

declare module 'claude-code' {
  interface PluginState {
    'prompt-router': {
      /** The effort the mod puts on every main-chat request when the effort setting could not be changed. */
      override: Level | null
      /** The model the mod names on every main-chat request when the model setting could not be changed. */
      model: 'haiku' | 'sonnet' | 'opus' | 'fable' | null
    }
  }
}
