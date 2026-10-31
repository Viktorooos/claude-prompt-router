// Prompt Router for OpenCode (V1 plugin API, @opencode-ai/plugin 1.19).
//
// The same router as the Claude Code mod (plugins/prompt-router/hooks/register.tsx): for each prompt
// typed in a main chat a small model picks where it runs (keep / here / subagent / session), the
// model and the effort. The logic lives in core/router.ts; this file only wires it to OpenCode.
//
// Install: `node adapters/opencode/install.ts` writes ~/.config/opencode/plugins/prompt-router.ts,
// a shim that passes `tool` from @opencode-ai/plugin (installed by OpenCode in its config dir) to
// routerPlugin below. `--uninstall` removes it and puts back what it replaced.
//
// Options, read like the mod's toConfig (project, rules, language, classifier, effortDetection,
// firstChatDetection, midChatModelDetection, subagentSuggestions, sessionSuggestions, notifications;
// the 0.7 effortMode and modelMode still count) plus the mapping to OpenCode models and variants:
//   - ~/.config/opencode/prompt-router.json (install.ts creates it with the defaults). The shim in
//     plugins/ is auto-loaded, and OpenCode passes no options to auto-loaded plugins.
//   - or opencode.json: move the shim out of plugins/ (else it loads twice) and list it there,
//     "plugin": [["file:///Users/<you>/.config/opencode/prompt-router.ts", { ...options }]];
//     options given this way win and the JSON file is not read.
//   { "classifier": "sonnet", "effortDetection": "auto", "firstChatDetection": "ask", "project": "",
//     "rules": "", "language": "auto", "notifications": "on",
//     "models": { "haiku": "anthropic/claude-haiku-5-5", "sonnet": "anthropic/claude-sonnet-5-5",
//                 "opus": "anthropic/claude-opus-5-5", "fable": "anthropic/claude-fable-5-1" },
//     "variants": { "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" } }
// Effort is the model variant (provider.<p>.models.<m>.variants.<name>); a level mapped to "" uses
// the model's default.

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'

import type { Level } from '../../plugins/prompt-router/types/index.d.ts'
import { ALL_MODELS, BASE_MODELS, LEVELS, MODEL_NAMES, NAMES, allowed, asLevel, clip, describeOptions, knownModel, optionsLine, parsePick, pickPrompt, toConfig, typed } from '../../plugins/prompt-router/core/router.ts'
import type { Chat, Config, Model, Pick } from '../../plugins/prompt-router/core/router.ts'
import { SESSION_TOOL, SWITCH_TOOL, agentFor, askNote, otherAutoNote, otherNote, switchNote } from './notes.ts'
import type { NoteCtx } from './notes.ts'

// `tool` from @opencode-ai/plugin: the shim hands it in, since the repo has no node_modules.
type ToolFn = ((def: { description: string; args: Record<string, unknown>; execute(args: any, ctx: { sessionID: string }): Promise<unknown> }) => unknown) & { schema: any }
// OpenCode's client (createOpencodeClient), used through a few methods.
type Client = any

export const DEFAULT_MODELS: Record<Model, string> = { haiku: 'anthropic/claude-haiku-5-5', sonnet: 'anthropic/claude-sonnet-5-5', opus: 'anthropic/claude-opus-5-5', fable: 'anthropic/claude-fable-5-1' }

type ChatState = {
  // The level and model the chat's last message ran at.
  seen: Level | ''
  seenModel: string
  // The level for the rest of this turn only.
  turnLevel: Level | null
  // The level / model the router puts on messages, and the picker value it saw when it took over.
  hold: { level: Level; base: string | null } | null
  modelHold: { model: Model; base: string | null } | null
  // What the picker sent with the last message.
  cur: { model: string; variant: string }
  last: Pick | null
}

type Part = { type: string; text?: string; synthetic?: boolean }
type Msg = { info: { role: string; tokens?: { input?: number; output?: number; cache?: { read?: number; write?: number } }; error?: unknown }; parts: Part[] }

function unwrap<T = any>(res: any): T {
  if (res && typeof res === 'object' && 'error' in res && res.error) throw new Error(typeof res.error === 'string' ? res.error : JSON.stringify(res.error))
  return (res && typeof res === 'object' && 'data' in res ? res.data : res) as T
}

function split(id: string) {
  const i = id.indexOf('/')
  return i < 0 ? { providerID: '', modelID: id } : { providerID: id.slice(0, i), modelID: id.slice(i + 1) }
}

function strMap<K extends string>(keys: readonly K[], v: unknown, base: Record<K, string>): Record<K, string> {
  const out = { ...base }
  if (v && typeof v === 'object') for (const k of keys) if (typeof (v as Record<string, unknown>)[k] === 'string') out[k] = (v as Record<K, string>)[k]
  return out
}

const NOTE = /\n\n\[Prompt Router [\s\S]*\]\s*$/

export function routerPlugin(tool: ToolFn) {
  return async (input: { client: Client }, options?: Record<string, unknown>) => {
    const client = input.client
    const home = process.env.HOME || homedir()
    const opts0 = options ?? {}
    const dir = typeof opts0.stateDir === 'string' ? opts0.stateDir : `${home}/.config/opencode/prompt-router`
    const optionsFile = typeof opts0.optionsFile === 'string' ? opts0.optionsFile : `${home}/.config/opencode/prompt-router.json`
    const timeoutMs = typeof opts0.timeoutMs === 'number' ? opts0.timeoutMs : 20_000

    let given: Record<string, unknown> = { ...opts0 }
    let source = 'plugin options'
    if (!Object.keys(opts0).some(k => k !== 'stateDir' && k !== 'optionsFile' && k !== 'timeoutMs')) {
      try {
        given = { ...JSON.parse(await readFile(optionsFile, 'utf8')), ...opts0 }
        source = optionsFile
      } catch {
        source = 'defaults'
      }
    }
    const cfg: Config = toConfig(given)
    const models = strMap(ALL_MODELS, given.models, DEFAULT_MODELS)
    const variants = strMap(LEVELS, given.variants, Object.fromEntries(LEVELS.map(l => [l, l])) as Record<Level, string>)
    const ctx: NoteCtx = { cfg, models, variants }

    let enabled = true
    try {
      enabled = JSON.parse(await readFile(`${dir}/state.json`, 'utf8')).enabled !== false
    } catch {
      // On by default.
    }

    const chats = new Map<string, ChatState>()
    // Sessions the router itself made (classifier calls, started sessions): never routed.
    const scratch = new Set<string>()
    const started = new Set<string>()
    const children = new Map<string, boolean>()
    // Sessions whose next message comes from a slash command.
    const commands = new Set<string>()
    // The effort for the next task call on each router subagent.
    const subEffort = new Map<string, Level>()
    let providerCfg: Record<string, any> = {}
    let fableListed: boolean | undefined

    async function log(what: string, err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      try {
        await client.app.log({ body: { service: 'prompt-router', level: err instanceof Error ? 'error' : 'info', message: `${what}: ${msg}` } })
      } catch {
        // The file below still has it.
      }
      try {
        const path = `${dir}/prompt-router.log`
        let old = ''
        try {
          old = await readFile(path, 'utf8')
        } catch {
          // A new log.
        }
        await mkdir(dir, { recursive: true })
        await writeFile(path, `${old.slice(-20_000)}${new Date().toISOString()} ${what}: ${msg}\n`)
      } catch {
        // Nowhere left to report it.
      }
    }

    async function toast(message: string) {
      try {
        await client.tui.showToast({ body: { title: 'Prompt Router', message, variant: 'info' } })
      } catch {
        // No TUI (opencode run, the server alone).
      }
    }

    // Once per load, so the log shows what this copy of the plugin really goes by.
    await log('effective options', `${source} | ${optionsLine(given)}`)

    function chat(sid: string) {
      let st = chats.get(sid)
      if (!st) {
        st = { seen: '', seenModel: '', turnLevel: null, hold: null, modelHold: null, cur: { model: '', variant: '' }, last: null }
        chats.set(sid, st)
      }
      return st
    }

    const variantOf = (l: Level) => variants[l] ?? l
    function levelOf(v: string): Level | '' {
      return (LEVELS.find(l => variants[l] && variants[l] === v) ?? '') || asLevel(v)
    }
    // The router's name for an OpenCode model id: by the mapping, else by its name.
    function routerModel(id: string): Model | '' {
      return ALL_MODELS.find(m => models[m] === id || split(models[m]).modelID === id) ?? knownModel(id)
    }

    function setModel(output: { message: any }, id: string) {
      const msg = output.message
      msg.model = { ...msg.model, ...split(id) }
    }
    // The variant rides on the message: newer servers read message.model.variant, older ones message.variant.
    function setVariant(output: { message: any }, v: string) {
      const msg = output.message
      msg.variant = v || undefined
      msg.model = { ...msg.model, variant: v || undefined }
    }

    // What the picker sent: the person moved it, so the router lets go of what it held.
    function observe(st: ChatState, i: { model?: { providerID: string; modelID: string }; variant?: string }) {
      st.cur = { model: i.model ? `${i.model.providerID}/${i.model.modelID}` : st.cur.model, variant: i.variant ?? '' }
      if (st.modelHold && st.modelHold.base === null) st.modelHold.base = st.cur.model
      if (st.modelHold && st.cur.model !== st.modelHold.base) st.modelHold = null
      st.seenModel = st.modelHold ? models[st.modelHold.model] : st.cur.model
      if (st.hold && st.hold.base === null) st.hold.base = st.cur.variant
      if (st.hold && st.cur.variant !== st.hold.base) st.hold = null
      st.seen = st.hold?.level ?? (levelOf(st.cur.variant) || st.seen)
    }

    // Puts the held model and the level on this message.
    function apply(st: ChatState, output: { message: any }) {
      if (st.modelHold) setModel(output, models[st.modelHold.model])
      const want = st.turnLevel ?? st.hold?.level ?? null
      if (want && variantOf(want) !== st.cur.variant) setVariant(output, variantOf(want))
    }

    // The picker cannot be moved from a plugin, so the router holds the level until the person moves it.
    function applyLevel(st: ChatState, level: Level) {
      st.turnLevel = level
      st.hold = { level, base: st.cur.variant }
      st.seen = level
    }
    function applyModel(st: ChatState, model: Model) {
      st.modelHold = { model, base: st.cur.model }
      st.seenModel = models[model]
    }

    async function save() {
      try {
        await mkdir(dir, { recursive: true })
        await writeFile(`${dir}/state.json`, JSON.stringify({ enabled }))
      } catch (err) {
        await log('state', err)
      }
    }

    async function isChild(sid: string) {
      if (children.has(sid)) return children.get(sid) as boolean
      let child = false
      try {
        child = !!unwrap<{ parentID?: string }>(await client.session.get({ path: { id: sid } }))?.parentID
      } catch {
        return false
      }
      children.set(sid, child)
      return child
    }

    async function isBusy(sid: string) {
      try {
        return unwrap<Record<string, { type: string }>>(await client.session.status())?.[sid]?.type === 'busy'
      } catch {
        return false
      }
    }

    // The models the router may offer: Fable only when the chat runs on it or a provider lists it.
    async function availableModels(model: string): Promise<Model[]> {
      if (routerModel(model) === 'fable') return [...ALL_MODELS]
      if (fableListed === undefined) {
        try {
          const { providerID, modelID } = split(models.fable)
          const r = unwrap<{ providers: { id: string; models?: Record<string, unknown> }[] }>(await client.config.providers())
          fableListed = r.providers.some(p => p.id === providerID && !!p.models && modelID in p.models)
        } catch {
          return [...BASE_MODELS]
        }
      }
      return fableListed ? [...ALL_MODELS] : [...BASE_MODELS]
    }

    function textOf(parts: readonly Part[]) {
      return parts
        .filter(p => p.type === 'text' && !p.synthetic && typeof p.text === 'string')
        .map(p => p.text as string)
        .join('\n')
    }

    // What the classifier sees of the chat. OpenCode lists the history without this prompt, so it is added.
    function chatOf(messages: readonly Msg[], text: string, now: Level | '', tokens: number | undefined, model: string, avail: readonly Model[]): Chat {
      const users = [...messages.filter(m => m.info.role === 'user').map(m => typed(textOf(m.parts).replace(NOTE, ''))).filter(Boolean), text]
      return {
        first: users[0] ?? '',
        recent: users.slice(-4, -1),
        reply: [...messages].reverse().map(m => (m.info.role === 'assistant' ? textOf(m.parts) : '')).find(t => t.trim()) ?? '',
        model,
        now,
        tokens,
        conf: cfg,
        isFirst: !messages.some(m => m.info.role === 'assistant'),
        hereModel: true,
        models: avail,
      }
    }

    // One classifier call in a throwaway session, deleted afterwards.
    async function classify(text: string, c: Chat) {
      const created = unwrap<{ id: string }>(await client.session.create({ body: { title: 'Prompt Router classifier' } }))
      const id = created.id
      scratch.add(id)
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        const call = client.session.prompt({
          path: { id },
          body: { model: split(models[c.conf.classifier]), variant: variantOf('low') || undefined, tools: { '*': false }, parts: [{ type: 'text', text: pickPrompt(text, c) }] },
        })
        const late = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`classifier timed out after ${timeoutMs} ms`)), timeoutMs)
        })
        let res: unknown
        try {
          res = await Promise.race([call, late])
        } catch (err) {
          try {
            await client.session.abort({ path: { id } })
          } catch {
            // Deleted below anyway.
          }
          throw err
        }
        const data = unwrap<Msg>(res)
        if (data?.info?.error) throw new Error(`classifier: ${JSON.stringify(data.info.error)}`)
        return textOf(data?.parts ?? [])
      } finally {
        clearTimeout(timer)
        try {
          await client.session.delete({ path: { id } })
        } catch (err) {
          await log('delete classifier session', err)
        }
      }
    }

    async function pick(sid: string, st: ChatState, text: string, now: Level | ''): Promise<Pick | null> {
      const messages = unwrap<Msg[]>(await client.session.messages({ path: { id: sid } })) ?? []
      const t = [...messages].reverse().find(m => m.info.role === 'assistant' && m.info.tokens)?.info.tokens
      const tokens = t ? (t.input ?? 0) + (t.output ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0) || undefined : undefined
      const model = st.seenModel
      const avail = await availableModels(model)
      const c = chatOf(messages, text, now, tokens, model, avail)
      const reply = await classify(text, c)
      const parsed = parsePick(reply, avail)
      if (!parsed && !/"where"\s*:\s*"keep"/.test(reply)) await log('parse', 'reply could not be parsed')
      const p = parsed && allowed(parsed, cfg)
      await log('pick', `${clip(text, 60)} | now ${model || '?'} ${now || '?'} ${tokens ?? '?'} tok | first ${c.isFirst} | ${clip(reply, 200)}`)
      // The first prompt of a chat has nothing to leave: only its model and effort count.
      if (p && c.isFirst) return { ...p, where: 'here', first: { now: routerModel(model) } }
      const cur = routerModel(model)
      if (p?.where === 'here' && cur && p.model !== cur && cfg.midChatModelDetection !== 'off') return { ...p, other: { now: cur } }
      return p
    }

    function addNote(parts: Part[], note: string) {
      const part = [...parts].reverse().find(p => p.type === 'text' && !p.synthetic)
      if (part) part.text = `${part.text ?? ''}\n\n[${note}]`
    }

    // Works out the note for the prompt; a failure here never loses the prompt.
    async function decide(sid: string, st: ChatState, parts: Part[]) {
      const text = typed(textOf(parts))
      if (!text || text.startsWith('/')) return
      st.turnLevel = null
      const now = st.seen
      let p: Pick | null = null
      try {
        p = await pick(sid, st, text, now)
      } catch (err) {
        await log('pick', err)
      }
      if (!p) return
      st.last = p
      const midTurn = await isBusy(sid)

      if (p.where === 'here') {
        // A prompt typed over a running turn belongs to that work: its model and effort stay.
        if (midTurn) return
        // Another model than the chat's: ask before anything is applied, the chat's model stays.
        if (p.other) return addNote(parts, (cfg.midChatModelDetection === 'auto' ? otherAutoNote : otherNote)(ctx, p, p.other.now, now))
        const changes: string[] = []
        let askModel: { from: Model } | null = null
        let askEffort: { now: Level | '' } | null = null
        // A new chat: the model it starts on may not fit the task.
        const from = p.first?.now
        if (from && p.model !== from && cfg.firstChatDetection !== 'off') {
          if (cfg.firstChatDetection === 'ask') askModel = { from }
          else {
            applyModel(st, p.model)
            changes.push(`Model: ${MODEL_NAMES[p.model]} (was ${MODEL_NAMES[from]})`)
          }
        }
        if (p.effort !== now && cfg.effortDetection !== 'off') {
          if (cfg.effortDetection === 'ask') askEffort = { now }
          else {
            applyLevel(st, p.effort)
            changes.push(`Effort: ${NAMES[p.effort]}${now ? ` (was ${NAMES[now]})` : ''}`)
          }
        }
        if (changes.length && cfg.notifications === 'on') await toast(`${changes.join(', ')}${p.why ? `, ${p.why}` : ''}`)
        if (askModel || askEffort) addNote(parts, switchNote(ctx, p, askModel, askEffort))
        return
      }
      addNote(parts, askNote(ctx, p, now, midTurn))
    }

    async function routerCommand(args: string, sid: string) {
      const arg = args.trim().toLowerCase()
      if (arg === 'off' || arg === 'on') {
        enabled = arg === 'on'
        await save()
        if (!enabled) {
          for (const st of chats.values()) {
            st.hold = null
            st.turnLevel = null
            st.modelHold = null
          }
        }
        return enabled ? 'Prompt Router is on.' : 'Prompt Router is off. Turn it back on with /router on.'
      }
      const st = chats.get(sid)
      const now = st?.seen ?? ''
      return [
        `Prompt Router is ${enabled ? 'on' : 'off'} (classifier ${cfg.classifier}, effort mode ${cfg.effortDetection}, model mode ${cfg.firstChatDetection}).`,
        `This chat runs on ${st?.seenModel || 'an unknown model so far'}${st?.modelHold ? ' (held by the router)' : ''}, effort ${now ? NAMES[now] : 'unknown so far'}${st?.hold ? ` (held by the router: ${NAMES[st.hold.level]})` : ''}.`,
        `Options: ${source}.`,
        ...describeOptions(given).map(l => `  ${l}`),
        'Commands: /router off, /router on.',
      ].join('\n')
    }

    // A plugin command cannot answer by itself: the agent repeats the status.
    function reply(parts: Part[], text: string) {
      const msg = `[Prompt Router] Reply with exactly the text below and nothing else; call no tools.\n\n${text}`
      const i = parts.findIndex(p => p.type === 'text')
      if (i < 0) parts.push({ type: 'text', text: msg })
      else {
        parts[i].text = msg
        for (let j = parts.length - 1; j > i; j--) if (parts[j].type === 'text') parts.splice(j, 1)
      }
    }

    const s = tool.schema
    return {
      config: async (config: any) => {
        config.command ??= {}
        config.command.router ??= { template: 'Prompt Router $ARGUMENTS', description: 'Prompt Router: status, or off / on' }
        config.agent ??= {}
        for (const m of ALL_MODELS) {
          config.agent[agentFor(m)] ??= { mode: 'subagent', model: models[m], description: `Prompt Router: runs a task the router dispatched, on ${MODEL_NAMES[m]}. Returns a short result.` }
        }
        providerCfg = config.provider ?? {}
      },

      'chat.message': async (i: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string }; variant?: string }, output: { message: any; parts: Part[] }) => {
        try {
          const sid = i.sessionID
          if (scratch.has(sid) || started.has(sid)) return
          if (await isChild(sid)) {
            // A router subagent: its effort comes from the pick that sent it.
            const level = i.agent ? subEffort.get(i.agent) : undefined
            if (enabled && level) {
              subEffort.delete(i.agent as string)
              setVariant(output, variantOf(level))
            }
            return
          }
          const st = chat(sid)
          observe(st, i)
          const command = commands.delete(sid)
          const text = typed(textOf(output.parts))
          const m = /^\/router(?:\s+(.*))?$/s.exec(text)
          if (!command && m) {
            const status = await routerCommand(m[1] ?? '', sid)
            reply(output.parts, status)
            await toast(status)
          } else if (!command && enabled) await decide(sid, st, output.parts)
          if (enabled) apply(st, output)
        } catch (err) {
          await log('chat.message', err)
        }
      },

      'command.execute.before': async (i: { command: string; sessionID: string; arguments: string }, output: { parts: Part[] }) => {
        commands.add(i.sessionID)
        if (i.command !== 'router') return
        try {
          const status = await routerCommand(i.arguments ?? '', i.sessionID)
          reply(output.parts, status)
          await toast(status)
        } catch (err) {
          await log('router', err)
        }
      },

      // Every LLM call of a main chat: a level switched mid-turn applies from the next request.
      'chat.params': async (i: { sessionID: string; model: any; message: any }, output: { options: Record<string, unknown> }) => {
        if (!enabled || scratch.has(i.sessionID)) return
        const st = chats.get(i.sessionID)
        const want = st ? (st.turnLevel ?? st.hold?.level ?? null) : null
        if (!want) return
        const name = variantOf(want)
        const has = i.message?.model?.variant ?? i.message?.variant ?? ''
        if (!name || name === has) return
        const id = { providerID: i.model?.providerID ?? '', modelID: i.model?.id ?? '' }
        const opts = i.model?.variants?.[name] ?? providerCfg[id.providerID]?.models?.[id.modelID]?.variants?.[name]
        if (!opts || typeof opts !== 'object') return
        const { disabled: _, ...rest } = opts as Record<string, unknown>
        Object.assign(output.options, rest)
      },

      'tool.execute.before': async (i: { tool: string; sessionID: string }, output: { args: any }) => {
        const agent = output?.args?.subagent_type
        if (i.tool !== 'task' || typeof agent !== 'string' || !agent.startsWith('router-')) return
        const level = chats.get(i.sessionID)?.last?.effort
        if (level) subEffort.set(agent, level)
      },

      tool: {
        [SWITCH_TOOL]: tool({
          description: "Prompt Router: switches this chat's model and/or effort after the user chose it in the Prompt Router question. The effort applies from the next request of this turn, the model from the next message.",
          args: { model: s.string().optional().describe(ALL_MODELS.join(', ')), effort: s.string().optional().describe(LEVELS.join(', ')) },
          async execute(args: { model?: string; effort?: string }, tc: { sessionID: string }) {
            const st = chat(tc.sessionID)
            const known = knownModel(args.model)
            const model = known && (await availableModels(st.seenModel)).includes(known) ? known : ''
            const level = asLevel(args.effort)
            if (model) applyModel(st, model)
            if (level) applyLevel(st, level)
            const done = [model ? `model ${MODEL_NAMES[model]}` : '', level ? `effort ${NAMES[level]}` : ''].filter(Boolean)
            const skipped = [
              args.model && !model ? `model ${JSON.stringify(args.model)} (not offered in this chat)` : '',
              args.effort && !level ? `effort ${JSON.stringify(args.effort)} (unknown)` : '',
            ].filter(Boolean)
            return [
              done.length ? `Switched this chat to ${done.join(' and ')}.` : 'Nothing switched.',
              skipped.length ? `Not switched: ${skipped.join(', ')}.` : done.length ? '' : 'Give model and/or effort.',
              model ? 'The model applies from the next message; this turn stays on its model.' : '',
            ]
              .filter(Boolean)
              .join(' ')
          },
        }),
        [SESSION_TOOL]: tool({
          description: 'Prompt Router: starts a new OpenCode session with the given model and effort and sends it the task. Use only after the user chose "New session" in the Prompt Router question.',
          args: { model: s.string().describe(ALL_MODELS.join(', ')), effort: s.string().describe(LEVELS.join(', ')), prompt: s.string().describe('The task, with what it needs to know'), title: s.string().optional() },
          async execute(args: { model: string; effort: string; prompt: string; title?: string }) {
            const known = knownModel(args.model)
            const model: Model = known || 'opus'
            const level = asLevel(args.effort) || 'medium'
            const title = args.title?.trim() || clip(args.prompt, 50)
            const created = unwrap<{ id: string }>(await client.session.create({ body: { title } }))
            started.add(created.id)
            unwrap(await client.session.promptAsync({ path: { id: created.id }, body: { model: split(models[model]), variant: variantOf(level) || undefined, parts: [{ type: 'text', text: args.prompt }] } }))
            return `Started a new session "${title}" (${created.id}) on ${models[model]} at effort ${NAMES[level]}. The user opens it with /sessions.`
          },
        }),
      },
    }
  }
}
