<div align="center">

# 🧭 Prompt Router

**Every prompt goes to the right place: this chat, a subagent or a fresh session, with the right model and effort.**

![version](https://img.shields.io/badge/version-0.5.0-blue)
![Claude Code](https://img.shields.io/badge/Claude_Code-mod-d97757)
![license](https://img.shields.io/badge/license-MIT-green)
![tests](https://img.shields.io/badge/unit_tests-37%20passing-brightgreen)

</div>

---

## ✨ Why

Long chats get expensive: every reply re-reads the whole context. Big models on small tasks waste money, and small models on hard tasks waste time. Prompt Router makes one cheap classifier call per prompt and tells Claude where the prompt belongs and what it needs, before any work starts.

- 🔀 **Where:** this chat, a subagent, or a new session with a clean context
- 🧠 **Model:** Haiku, Sonnet, Opus, or Fable for the rare hardest cases
- 🎚️ **Effort:** low, medium, high, xhigh or max
- 🙋 **You decide:** every change is offered in a dialog unless you switch it to `auto`

## 👀 What you see

When a prompt belongs elsewhere, Claude asks before it starts:

```
Prompt Router
Where should this go? It is an unrelated feature, so a fresh session fits.

  › New session (Sonnet · medium)
    Subagent (Haiku · low)
    Do it here (Low)
    Do it here (keep Medium)
```

When the prompt stays here but needs another effort, you get a Switch / Keep as is dialog, or with `effortMode: auto` just a toast:

```
Effort: Low (was Medium), small follow-up to the last fix
```

Approvals ("yes", "go on", "option 2"), slash commands and prompts where nothing needs to change pass through untouched. The first prompt of a chat stays in the chat, but the router checks whether the selected model fits the task (Opus picked for a rename, Haiku for debugging) and offers a better one.

## 📦 Install

```
/plugin marketplace add Viktorooos/prompt-router
/plugin install prompt-router@prompt-router
```

## ⚙️ Configuration

| Option | What it does | Default |
| --- | --- | --- |
| `project` | What your chats are about, in a few words | empty (a software project) |
| `rules` | Your own routing rules, appended to the classifier prompt; they win over the built-in ones | empty |
| `language` | Language of the reason and of the questions Claude asks | `auto` (the language of each prompt) |
| `classifier` | Model that makes the routing call: `sonnet`, `haiku` (cheaper, less accurate) or `opus` (most accurate, slowest and most expensive) | `sonnet` |
| `effortMode` | `ask`: Claude asks in a dialog before the effort changes; `auto`: sets it by itself | `ask` |
| `modelMode` | First prompt of a new chat: `ask` asks before switching; `auto` switches by itself; `off` never touches the model | `ask` |

Set them in `/plugin` → prompt-router → Configure, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "prompt-router": {
    "options": {
      "project": "a React web app and a React Native mobile app for sharing recipes",
      "rules": "Database migrations: opus, high. Copy changes on the marketing site: haiku, low.",
      "language": "English",
      "effortMode": "auto"
    }
  }
}
```

<details>
<summary><b>How the dialogs and switching work</b></summary>

- A session, a subagent, a model or an effort change is always offered in one dialog unless the mode is `auto`.
- When a new session or a subagent is offered, "Do it here" carries the suggested effort too: with `effortMode: ask` you get "Do it here (Low)" and "Do it here (keep Medium)", with `auto` just "Do it here (Low)".
- After Switch or "Do it here (…)", Claude changes this chat's model or effort through the mod's own `switch` tool (Claude Code's session tools refuse the chat they run in). It refuses a model this chat is not offered and says what it skipped; if it fails, Claude tells you the `/model` or `/effort` command to run.
- A prompt typed while a turn is running keeps the model and effort.
- In a chat over 60k tokens, an unrelated task, even a trivial one, is offered a new session.
- Where the effort setting cannot be changed, the router puts the level on each request until you move the effort picker yourself.

</details>

## 🗺️ How the routing works

| Where | When |
| --- | --- |
| **keep** | An approval or an answer to Claude's question. Nothing changes. |
| **here** | Builds on what this chat already read or changed, is trivial, or the chat is still small. |
| **subagent** | A self-contained search, read, build or test run whose short result is needed here. |
| **session** | Unrelated to this chat, or long mechanical work better done with a fresh context. |

| Model | For |
| --- | --- |
| **Haiku** | Running, reading, searching, short answers |
| **Sonnet** | Mechanical edits by an existing pattern |
| **Opus** | New logic, debugging, review, anything risky |
| **Fable** | Rare, 2.5× the price of Opus: a new architecture across several layers with no clear solution, a hard concurrency or security problem, a bug two fixes already failed to solve, a deep analysis where a wrong conclusion costs a lot. Never for an everyday feature, a review, payments or a migration with a known approach. Offered only when your model picker lists it. |

| Effort | For |
| --- | --- |
| **low** | Simple work |
| **medium** | The default |
| **high** | Where a hidden mistake costs money, data or trust |
| **xhigh** | Long critical work you hand off (overnight, over the weekend) |
| **max** | Only when you ask for the maximum, or a one-off irreversible step with a very high cost of a mistake (production data, a live security incident) |

Words like "important", "carefully" or "do it properly" do not raise the effort beyond high.

## 💬 Commands

- `/router` shows the status, the model and effort of this chat, and whether the router holds the effort.
- `/router off` and `/router on` turn it off and on (remembered across sessions).

## 💰 Cost

One small classifier call per prompt (Sonnet, Haiku or Opus, low effort, at most 150 output tokens). It sees the new prompt, the chat's first and last few prompts, the start of Claude's last reply, and the current model, effort and context size.

## 🧪 Tests

- **Unit tests** with canned classifier replies:
  ```
  claude plugin test plugins/prompt-router
  ```
- **Live eval** of the classifier (123 cases, incl. the Fable / xhigh / max boundaries). In a session with the mod loaded, ask Claude to run the `mcp__prompt-router__test` tool with `file` = absolute path of `plugins/prompt-router/test/cases.json`, `runs` = 3 and `out` = a TSV path, then:
  ```
  python3 -I plugins/prompt-router/test/eval.py <out.tsv>
  ```
  Cases can override `project`, `rules`, `language`, `classifier` and `models` (the models on offer, e.g. without `fable`), and `template` takes a classifier prompt file, so the rules can be tuned without reloading the mod. `eval.py` also lists cases that waver between runs.

| Classifier | Last eval |
| --- | --- |
| Sonnet (3 runs) | 369 / 369 |
| Opus | 123 / 123 |
| Haiku | 114 / 123 |

## 🔌 Disable

`/router off` for a while, or `/plugin` → prompt-router → Disable, or `claude plugin uninstall prompt-router@prompt-router`.

> [!NOTE]
> This mod overlaps with the Effort Optimizer mod: both set effort per prompt. Use one of them, not both.

## 📄 License

MIT, see [LICENSE](LICENSE).
