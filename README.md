<div align="center">

# 🧭 Prompt Router

**The right place, the right model and the right effort for every prompt, decided before the agent starts working.**

![version](https://img.shields.io/badge/version-0.6.0-blue?style=flat-square)
![unit tests](https://img.shields.io/badge/unit_tests-115_passing-brightgreen?style=flat-square)
![eval](https://img.shields.io/badge/eval-123_cases-8a63d2?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
<br>
![Claude Code](https://img.shields.io/badge/Claude_Code-mod-d97757?style=flat-square)
![Codex](https://img.shields.io/badge/Codex-CLI_+_desktop-10a37f?style=flat-square)
![OpenCode](https://img.shields.io/badge/OpenCode-plugin-4b5563?style=flat-square)

<sub>Unit tests: Claude Code 47 · Codex 41 · OpenCode 27</sub>

[How it works](#how-it-works) •
[Quick start](#quick-start) •
[Compare](#compare) •
[Concepts](#concepts) •
[Claude Code](#claude-code) •
[Codex](#codex) •
[OpenCode](#opencode) •
[FAQ](#faq) •
[Development](#development) •
[Changelog](#changelog)

</div>

---

> Every reply in a long chat re-reads the whole context. Opus on a rename burns money. Haiku on a race condition burns time.

Prompt Router makes **one small classifier call per prompt**. Before any work starts, it tells the agent where the prompt belongs and which model and effort it needs. You stay in control: every change is offered first, unless you tell it to just do it.

<table>
<tr>
<td width="25%" align="center">🔀<br><b>Where</b><br><sub>this chat, a subagent or a new session</sub></td>
<td width="25%" align="center">🧠<br><b>Model</b><br><sub>small, mid, big, or the top one for the rare hardest cases</sub></td>
<td width="25%" align="center">🎚️<br><b>Effort</b><br><sub>low, medium, high, xhigh, max</sub></td>
<td width="25%" align="center">🙋<br><b>You decide</b><br><sub>a question by default, or <code>auto</code></sub></td>
</tr>
</table>

<a id="how-it-works"></a>
## 🧩 How it works

```mermaid
flowchart LR
    P([Your prompt]) --> C{Classifier<br/>one small call}
    C -->|approval, answer| K[keep<br/>nothing changes]
    C -->|builds on this chat| H[here<br/>maybe new effort/model]
    C -->|self-contained read,<br/>search, build, tests| S[subagent<br/>short result back]
    C -->|unrelated, or long<br/>mechanical work| N[new session<br/>fresh context]
    H --> M{mode}
    S --> M
    N --> M
    M -->|ask| Q[You pick]
    M -->|auto| A[Applied + notice]
    Q --> X[Platform action]
    A --> X
    X --- CC["🟠 Claude Code<br/>switch tool · Agent · start_session"]
    X --- CX["⚫ Codex<br/>/model line · spawn_agent · codex command"]
    X --- OC["🔵 OpenCode<br/>per-message hold · task · router_session"]
```

The classifier sees:
- the new prompt (only the text you typed),
- the chat's first and last few prompts,
- the start of the agent's last reply,
- the current model, effort and context size.

When a prompt does not belong in this chat, the agent asks before it starts (here in Claude Code):

```
╭─ Prompt Router ─────────────────────────────────────────────────────╮
│ Where should this go? It is an unrelated feature, so a fresh        │
│ session fits.                                                       │
│                                                                     │
│   › New session (Sonnet · medium)      ← recommended                │
│     Subagent (Haiku · low)                                          │
│     Do it here (Low)                                                │
│     Do it here (keep Medium)                                        │
╰─────────────────────────────────────────────────────────────────────╯
```

When the prompt stays here but needs more or less thinking, you get **Switch / Keep as is**. With `effortMode: auto` it just switches and tells you:

```
Effort: Low (was Medium), small follow-up to the last fix
```

On a new chat's **first prompt** it also checks the model: Opus picked for a rename? Haiku for debugging? It offers the switch (or makes it, with `modelMode: auto`).

Approvals (`yes`, `go on`, `option 2`), answers to the agent's questions, slash commands and prompts where nothing needs to change pass through untouched.

> [!NOTE]
> **Architecture.** [`plugins/prompt-router/core/router.ts`](plugins/prompt-router/core/router.ts) holds the shared logic: the classifier prompt, parsing its reply, the routing rules. [`hooks/register.tsx`](plugins/prompt-router/hooks/register.tsx) (Claude Code), [`adapters/codex/`](adapters/codex) and [`adapters/opencode/`](adapters/opencode) only wire it to each platform.

<a id="quick-start"></a>
## 🚀 Quick start

| Agent | Install | Then | Full guide |
| --- | --- | --- | --- |
| 🟠 **Claude Code** | `/plugin marketplace add Viktorooos/auto-model-router`<br>`/plugin install prompt-router@prompt-router` | Open a new chat | [Claude Code](#claude-code) |
| ⚫ **Codex** | `git clone https://github.com/Viktorooos/auto-model-router.git`<br>`node auto-model-router/adapters/codex/install.ts` | `codex` → `/hooks` → trust **"Routing..."**; restart the desktop app | [Codex](#codex) |
| 🔵 **OpenCode** | `git clone https://github.com/Viktorooos/auto-model-router.git`<br>`node auto-model-router/adapters/opencode/install.ts` | Restart OpenCode | [OpenCode](#opencode) |

<a id="compare"></a>
## 📊 Feature comparison

The decisions are the same everywhere. What each platform lets a plugin do differs.

| | 🟠 [Claude Code](#claude-code) | ⚫ [Codex](#codex) | 🔵 [OpenCode](#opencode) |
| --- | --- | --- | --- |
| **Runs as** | a mod (plugin) | `UserPromptSubmit` hook (CLI) + MCP tool `route` (desktop) | a plugin |
| **Covers** | desktop app, CLI, VS Code, Remote Control | Codex CLI and the ChatGPT desktop app (shared `~/.codex`) | CLI / TUI and desktop |
| **Switches effort** (`auto`) | ✅ | ❌ shows a `/model <model> <effort>` line to run | ✅ per-message hold; can change mid-turn |
| **Switches model** (`auto`) | ✅ | ❌ same `/model` line | ✅ from the next message |
| **Ask mode** | ✅ dialog | ⚠️ the agent asks in a text message | ✅ question tool (text if missing) |
| **Subagent** | ✅ Agent tool with model and effort | ✅ `spawn_agent` with `model` and `reasoning_effort` | ✅ `task` with a `router-<model>` subagent |
| **New session** | ✅ `start_session` in the app; ⚠️ a `claude …` command elsewhere | ⚠️ a `codex -m …` command to run | ✅ `router_session` tool (fallback: an `opencode` command) |
| **Model check on first prompt** | ✅ | ⚠️ as a suggestion | ✅ |
| **Notice** (`auto`) | toast | system message + `/model` line | toast |
| **`/router` command** | ✅ | ⚠️ typed as a prompt; the TUI may take it as unknown | ✅ config command + toast |
| **Default classifier** | Sonnet | `gpt-6-luna` (class `haiku`) | `anthropic/claude-sonnet-5-5` |
| **Options live in** | `~/.claude/settings.json` (`pluginConfigs`) or `/plugin` | `~/.codex/prompt-router.json` | `~/.config/opencode/prompt-router.json` or `opencode.json` |
| **Status** | used daily | unit-tested; hook run with the real classifier | ⚠️ unit-tested only |

<a id="concepts"></a>
## 🧠 Concepts

Shared by all three platforms.

### Decisions

| | When |
| --- | --- |
| **keep** | An approval or an answer to the agent's question. Nothing changes. |
| **here** | Builds on what this chat already read or changed, is trivial, or the chat is still small. |
| **subagent** | A self-contained search, read, build or test run whose short result is needed here. |
| **session** | Unrelated to this chat, or long mechanical work better done with a fresh context. In a chat over **60k tokens**, even a trivial unrelated task goes here. |

### Models

The router thinks in four classes. Each platform maps them to its own models (Codex and OpenCode let you change the mapping).

| Class | For | Claude price (in / out per 1M) | Codex default | OpenCode default |
| --- | --- | --- | --- | --- |
| **Haiku** | Running, reading, searching, short answers | $0.10 / $0.50 | `gpt-6-luna` | `anthropic/claude-haiku-5-5` |
| **Sonnet** | Mechanical edits by an existing pattern | $2 / $10 | `gpt-6.1-terra` | `anthropic/claude-sonnet-5-5` |
| **Opus** | New logic, debugging, review, anything risky | $4 / $20 | `gpt-6.1-sol` | `anthropic/claude-opus-5-5` |
| **Fable** | Only where Opus at high effort is likely not enough | $10 / $50 | `gpt-6-astra` | `anthropic/claude-fable-5-1` |

<a id="fable"></a>
<details>
<summary><b>When Fable is offered</b></summary>

Fable is rare on purpose.

- ✅ A new architecture across several layers with no clear solution.
- ✅ A hard concurrency or security problem whose reach is unknown.
- ✅ A bug two fixes already failed to solve.
- ✅ A deep analysis where a wrong conclusion costs a lot.
- ❌ Never for an everyday feature (however big), a code review, payments or a migration with a known approach.

It is offered only when your platform has it:
- Claude Code: your model picker lists it.
- Codex: it is in `~/.codex/models_cache.json`, or the chat already runs on it.
- OpenCode: a provider lists `models.fable`, or the chat runs on it.

</details>

### Effort

| | For |
| --- | --- |
| **low** | Simple work |
| **medium** | The default |
| **high** | Where a hidden mistake costs money, data or trust |
| **xhigh** | Long critical work you hand off (overnight, over the weekend) |
| **max** | Only when you ask for the maximum, or a one-off irreversible step with a very high cost of a mistake (production data, a live security incident) |

Words like *important*, *carefully* or *do it properly* never raise it beyond **high** on their own.

<a id="options"></a>
### Options

The same keys on every platform. Where they live is in each platform's section.

| Option | What it does | Default |
| --- | --- | --- |
| `project` | What your chats are about, in a few words | empty (a software project) |
| `rules` | Your own routing rules; they win over the built-in ones | empty |
| `language` | Language of the reason and of the questions the agent asks | `auto` (each prompt's language) |
| `classifier` | Model class that makes the call: `sonnet`, `haiku` (cheaper, less accurate) or `opus` (most accurate, most expensive) | `sonnet` (Codex: `haiku`) |
| `effortMode` | `ask`: a question before the effort changes · `auto`: just do it | `ask` |
| `modelMode` | New chat's first prompt: `ask` · `auto` · `off` (never touch the model) | `ask` |

> [!TIP]
> Want no questions about effort or model at all? Set both `effortMode` and `modelMode` to `auto`. "Where should this go?" is still asked, since moving work to another session is always your call.

### Your own rules

`rules` is plain text appended to the classifier's prompt, and it wins over the built-in rules. Write it like a note to a colleague:

```
Database migrations: opus, high.
Translating finished Compose screens to SwiftUI: sonnet, medium.
Payments, vouchers, auth: opus, high.
Copy changes on the marketing site: haiku, low.
```

Use the class names (`haiku`, `sonnet`, `opus`, `fable`) on every platform. Codex and OpenCode map them to their models.

### Accuracy and cost

Last live eval: **123 cases**, including the Fable / xhigh / max boundaries. How to run it: [Development](#development).

| Classifier | Result |
| --- | --- |
| Sonnet, 3 runs | ✅ 369 / 369 |
| Opus | ✅ 123 / 123 |
| Haiku | ⚠️ 114 / 123 (none of the misses raised a tier) |

One classifier call per prompt: low effort, at most 150 output tokens, on the model you pick in `classifier`. With the default Sonnet in Claude Code, that is a fraction of a cent per prompt. In Codex it runs on your ChatGPT plan and adds about 3–4 s before each prompt. The savings come from not running a 200k-token chat on a question that needed a fresh one.

---

<a id="claude-code"></a>
## 🟠 Claude Code

### Requirements

Claude Code with mod (plugin) support: the desktop app, the terminal CLI, VS Code or Remote Control.

### Install

```
/plugin marketplace add Viktorooos/auto-model-router
/plugin install prompt-router@prompt-router
```

Open a new chat and type as usual. Optionally set `project` so its calls fit your work.

### Options

Set the [options](#options) in `/plugin` → prompt-router → Configure, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "prompt-router@prompt-router": {
    "options": {
      "project": "a React web app and a React Native mobile app for sharing recipes, Node.js backend",
      "rules": "Database migrations: opus, high. Copy changes on the marketing site: haiku, low.",
      "language": "English",
      "effortMode": "auto",
      "modelMode": "auto"
    }
  }
}
```

> [!IMPORTANT]
> Options are read when a session starts. After a change, open a **new chat**.

| Command | What it does |
| --- | --- |
| `/router` | Status, this chat's model and effort, and whether the router holds the effort |
| `/router off` | Turn it off (remembered across sessions) |
| `/router on` | Turn it back on |

### Differences

Claude Code is the reference platform. Notes per client:

- In the desktop app, **New session** uses `start_session`. Where the chat cannot start a session itself (terminal, VS Code), you get a `claude --model … --effort …` command to run in a new terminal.
- `claude -p` and Agent SDK runs pass untouched: their flags already chose the model and effort.

<details>
<summary><b>How switching works under the hood</b></summary>

- After **Switch** or **Do it here (…)**, Claude changes this chat's model or effort through the mod's own `switch` tool, because Claude Code's session tools refuse the chat they run in.
- `switch` refuses a model this chat is not offered (e.g. Fable when your picker does not list it) and says what it skipped. If it fails, Claude tells you the `/model` or `/effort` command to run.
- Where the effort setting cannot be changed, the router puts the level on each request until you move the effort picker yourself.
- A prompt typed while a turn is running keeps the model and effort.

</details>

### Uninstall

`/router off` for a while · `/plugin` → prompt-router → Disable · or:

```bash
claude plugin uninstall prompt-router@prompt-router
```

---

<a id="codex"></a>
## ⚫ Codex

The Codex CLI and the ChatGPT desktop app share `~/.codex`, so one install covers both.

### Requirements

- Codex **0.166+** (CLI), logged in. The classifier runs on your ChatGPT login, no API key.
- Node **26+** (the hook runs TypeScript directly).
- A clone of this repo. The hook runs from it, so keep it where it is.

### Install

```bash
git clone https://github.com/Viktorooos/auto-model-router.git
node auto-model-router/adapters/codex/install.ts
```

Then **trust the hook once**: run `codex`, type `/hooks`, trust **"Routing..."**, and start a new session.

<details>
<summary><b>What the installer changes</b></summary>

All in `~/.codex` (`$CODEX_HOME` is respected), each file after a backup:

| File | Change |
| --- | --- |
| `hooks.json` | Merges a `UserPromptSubmit` hook (`node <repo>/adapters/codex/hook.ts`), keeping your other hooks. Backup: `hooks.json.bak-prompt-router-<time>`. |
| `prompt-router.json` | Written with the defaults when there is none. |
| `config.toml` | A `prompt_router` MCP server (`node <repo>/adapters/codex/mcp.ts`, tool `route`, approved without a prompt), between marker comments. |
| `AGENTS.md` | A short rule, between marker comments: call `route` with the prompt first, and skip the call when the hook's note is already there (the CLI). |

</details>

> [!IMPORTANT]
> Codex runs a new or changed hook only after you trust it. Trust it again after every update that changes the hook command (for example after moving the repo and installing again).

**ChatGPT desktop app.** It runs no `UserPromptSubmit` hooks (tested with 0.166). Instead it uses the MCP tool `route` plus the `AGENTS.md` rule. `route` runs the same code as the hook and returns the same note. Restart the desktop app after installing. The cost is one tool call per prompt (3–4 s), and the model may now and then skip the rule.

### Options

`~/.codex/prompt-router.json`: the [shared keys](#options) plus the Codex ones.

<details>
<summary><b>Default file and Codex-only keys</b></summary>

```json
{
  "classifier": "haiku",
  "effortMode": "ask",
  "modelMode": "ask",
  "project": "",
  "rules": "",
  "language": "auto",
  "enabled": true,
  "timeoutMs": 20000,
  "models": { "haiku": "gpt-6-luna", "sonnet": "gpt-6.1-terra", "opus": "gpt-6.1-sol", "fable": "gpt-6-astra" },
  "efforts": { "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" }
}
```

| Key | What it does |
| --- | --- |
| `models` | The Codex model for each router class |
| `efforts` | The Codex reasoning effort for each router level; a model that does not take a level (per `models_cache.json`) gets the nearest lower one |
| `enabled` | `/router off` and `/router on` write it |
| `timeoutMs` | The classifier's time limit |

</details>

The classifier is a read-only `codex exec` on the `classifier` class (`gpt-6-luna`) at low effort: about **3–4 s per prompt**. Log: `~/.codex/log/prompt-router.log`.

### Differences

> [!WARNING]
> Codex cannot switch a running chat's model or effort from a hook (tested: a running session does not re-read `config.toml` either).
> - **auto**: you get one line, `Prompt Router: for this, switch with /model <model> <effort>` (also as a system message), and the agent carries on at the current setting.
> - **ask**: the agent asks in a text message, with the options as a numbered list. On **Switch** you get the same `/model` line; it applies from your next prompt.

- **New session** gives you a command to run in a new terminal: `codex -m <model> -c model_reasoning_effort=<effort> "<task>"`.
- **Subagent** is `spawn_agent` with `model` and `reasoning_effort`. Without that tool the agent says so and does it here.
- **Fable** (`gpt-6-astra`) is offered only when it is in `~/.codex/models_cache.json` or the chat already runs on it.
- **`/router`** typed as a prompt may be taken by the TUI as an unknown command (not verified). You can also edit `enabled` instead.

### Uninstall

```bash
node auto-model-router/adapters/codex/install.ts --uninstall
```

Removes only the router's entry from `hooks.json`, the MCP server block from `config.toml` and the rule from `AGENTS.md` (each after a backup). Your options file stays.

---

<a id="opencode"></a>
## 🔵 OpenCode

For the OpenCode CLI / TUI and desktop.

> [!WARNING]
> The OpenCode adapter is **unit-tested only** (27 tests with a mock client). It has not been run against a real OpenCode yet.

### Requirements

- OpenCode with the V1 plugin API (`@opencode-ai/plugin` 1.19.x).
- `@opencode-ai/plugin` available in `~/.config/opencode` (OpenCode installs it there).
- A clone of this repo. The shim loads the plugin from it, so keep it where it is.

### Install

```bash
git clone https://github.com/Viktorooos/auto-model-router.git
node auto-model-router/adapters/opencode/install.ts
```

Restart OpenCode to load it. The installer writes:
- a shim, `~/.config/opencode/plugins/prompt-router.ts`, that re-exports the plugin from the repo. A file it would overwrite is kept as `prompt-router.ts.bak-<time>`.
- `~/.config/opencode/prompt-router.json` with the defaults, when there is none.

### Options

The [shared keys](#options) plus the OpenCode ones, in **one** of two places:

1. **`~/.config/opencode/prompt-router.json`** (default). The shim in `plugins/` is auto-loaded, and OpenCode passes no options to auto-loaded plugins.
2. **`opencode.json`**. Move the shim out of `plugins/` (else it loads twice) and list it with its options. These then win and the JSON file is not read.

<details>
<summary><b>Example files and OpenCode-only keys</b></summary>

`~/.config/opencode/prompt-router.json`:

```json
{
  "classifier": "sonnet",
  "effortMode": "ask",
  "modelMode": "ask",
  "project": "",
  "rules": "",
  "language": "auto",
  "models": { "haiku": "anthropic/claude-haiku-5-5", "sonnet": "anthropic/claude-sonnet-5-5", "opus": "anthropic/claude-opus-5-5", "fable": "anthropic/claude-fable-5-1" },
  "variants": { "low": "low", "medium": "medium", "high": "high", "xhigh": "xhigh", "max": "max" }
}
```

`opencode.json`:

```json
"plugin": [["file:///Users/<you>/.config/opencode/prompt-router.ts", { "effortMode": "auto", "timeoutMs": 20000 }]]
```

| Key | What it does |
| --- | --- |
| `models` | The `provider/model` for each router class |
| `variants` | The model variant (`provider.<p>.models.<m>.variants.<name>`) for each router level; `""` uses the model's default |
| `timeoutMs` | The classifier's time limit (plugin options only; default 20000) |

</details>

`/router off` / `on` is kept in `~/.config/opencode/prompt-router/state.json`, next to the log `prompt-router.log` (also sent to OpenCode's own log). The classifier runs in a throwaway session with no tools, deleted afterwards.

### Differences

- **A switch is a per-message hold.** A plugin cannot move the picker. The router puts the variant (and model) on each message until you move the picker yourself; the picker in the UI does not move.
- **Effort** can change mid-turn (through `chat.params`). The **model** changes only from the next message.
- **Subagents** `router-haiku`, `router-sonnet`, `router-opus` and `router-fable` are added through the config hook. The agent calls `task` with one of them, and the router sets its effort.
- **New sessions** start through the `router_session` tool (open them with `/sessions`). If it fails, you get an `opencode --model … --prompt …` command.
- **`/router`** is a config command: the agent answers with the status, plus a toast.
- **Fable** is offered only when a provider lists `models.fable` or the chat runs on it.

### Uninstall

```bash
node auto-model-router/adapters/opencode/install.ts --uninstall
```

Removes the shim (only if it is the router's) and puts back the newest file it replaced. Your options file stays.

---

<a id="faq"></a>
## ❓ FAQ

<details>
<summary><b>It asks me even though I set <code>auto</code>.</b></summary>

- Options are read when a session starts, so open a new chat.
- In Claude Code, put them under the full id `prompt-router@prompt-router` in `pluginConfigs`. An entry under plain `prompt-router` is used only when there is no full-id entry, and `/router` tells you to rename it.
- Check that no second copy of the mod runs (`claude plugin list`, and any dev copy under `~/.claude/dev-mods/`). A copy without your options falls back to `ask`.
- In Codex, `auto` still cannot switch the chat; you get the `/model` line instead of a question.

</details>

<details>
<summary><b>Why didn't it suggest a new session when I changed topic?</b></summary>

Questions and opinions about what this chat is already doing stay here: the answer is short and builds on the context. Once the topic turns into a new piece of work, the router offers a session.

</details>

<details>
<summary><b>It never offers Fable.</b></summary>

Fable is offered only when your platform has it, and only for the rare cases in [When Fable is offered](#fable). Everyday features, reviews and known migrations go to Opus.

</details>

<details>
<summary><b>Codex runs nothing after the install.</b></summary>

Trust the hook: `codex` → `/hooks` → trust "Routing...", then start a new session. Errors go to `~/.codex/log/prompt-router.log`. In the desktop app, restart it so it picks up the MCP server.

</details>

<details>
<summary><b>Can I use it with the Effort Optimizer mod?</b></summary>

Use one of them, not both: they both set effort per prompt.

</details>

<a id="development"></a>
## 🧪 Development

### Unit tests

Canned classifier replies, no model calls. From the repo root:

```bash
claude plugin test plugins/prompt-router       # Claude Code mod: 47
claude plugin validate plugins/prompt-router   # manifest and options check
node --test adapters/codex/test/               # Codex: 41
node --test adapters/opencode/test/            # OpenCode: 27 (mock client)
```

### Live eval

Shared by all platforms. In a Claude Code session with the mod loaded, ask Claude to run the `mcp__prompt-router__test` tool with:
- `file` = the absolute path of `plugins/prompt-router/test/cases.json`
- `runs` = `3`
- `out` = a TSV path

Then:

```bash
python3 -I plugins/prompt-router/test/eval.py <out.tsv>
```

Cases can override `project`, `rules`, `language`, `classifier` and `models` (e.g. without `fable`). `template` takes a classifier prompt file, so you can tune the rules without reloading the mod. `eval.py` also lists cases that waver between runs.

### Where things live

| File | What lives there |
| --- | --- |
| [`core/router.ts`](plugins/prompt-router/core/router.ts) | Shared by all platforms: the classifier prompt (`TEMPLATE`, `FABLE_RULE`), parsing, the routing rules |
| [`hooks/register.tsx`](plugins/prompt-router/hooks/register.tsx) | Claude Code wiring: the dialogs, the `switch` tool, `/router` |
| [`adapters/codex/`](adapters/codex) | `install.ts`, `hook.ts` (CLI hook), `mcp.ts` (desktop `route` tool) |
| [`adapters/opencode/`](adapters/opencode) | `install.ts`, `prompt-router.ts` (the plugin) |
| [`test/router.test.ts`](plugins/prompt-router/test/router.test.ts) | Unit tests with canned classifier replies |
| [`test/cases.json`](plugins/prompt-router/test/cases.json) + [`expected.json`](plugins/prompt-router/test/expected.json) | Live eval cases and the right answers |
| [`.claude-plugin/plugin.json`](plugins/prompt-router/.claude-plugin/plugin.json) | Version and option definitions |

> [!TIP]
> Keep the classifier prompt in flat one-line bullets. Nested bullets inside a rule shifted Sonnet's calls on unrelated cases in the eval.

<a id="changelog"></a>
## 📜 Changelog

| Version | Changes |
| --- | --- |
| **0.6.0** | Codex and OpenCode adapters (`adapters/`), the router logic moved to a shared `core/router.ts` |
| **0.5.1** | Options under the short key `prompt-router` are read (with a hint to rename it); the classifier sees only the typed text (the app's reminder blocks are stripped); `start_session` is offered only where it exists, the terminal gets a `claude --model … --effort …` command |
| **0.5.0** | Fable, xhigh and max with narrow rules; switching through the mod's own `switch` tool |
| **0.4.1** | Asks before changing model or effort; unrelated tasks in big chats go to a new session |
| **0.3.2** | Checks the model on a new chat's first prompt; eval of the whole router |
| **0.2.0** | First version: routes each prompt to this chat, a subagent or a new session |

## 📄 License

[MIT](LICENSE) © 2026 Viktor Kadeřábek
