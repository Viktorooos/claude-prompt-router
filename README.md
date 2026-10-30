<div align="center">

# 🧭 Prompt Router

### The right place, the right model, the right effort, for every prompt.

A [Claude Code](https://claude.com/claude-code) mod that looks at each prompt before Claude starts working<br>
and decides whether it belongs in **this chat**, a **subagent** or a **fresh session**, and which **model** and **effort** it needs.

![version](https://img.shields.io/badge/version-0.5.0-blue?style=flat-square)
![Claude Code](https://img.shields.io/badge/Claude_Code-mod-d97757?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![unit tests](https://img.shields.io/badge/unit_tests-47_passing-brightgreen?style=flat-square)
![eval](https://img.shields.io/badge/eval-123_cases-8a63d2?style=flat-square)

[Quick start](#-quick-start) •
[What it does](#-what-it-does) •
[How it decides](#-how-it-decides) •
[Configuration](#%EF%B8%8F-configuration) •
[Customizing](#%EF%B8%8F-customizing) •
[FAQ](#-faq)

</div>

---

## 💡 Why

> Every reply in a long chat re-reads the whole context. Opus on a rename burns money. Haiku on a race condition burns time.

Prompt Router makes **one small classifier call per prompt** and tells Claude, before any work starts, where the prompt belongs and what it needs. You stay in control: every change is offered in a dialog, unless you tell it to just do it.

<table>
<tr>
<td width="25%" align="center">🔀<br><b>Where</b><br><sub>this chat, a subagent or a new session</sub></td>
<td width="25%" align="center">🧠<br><b>Model</b><br><sub>Haiku, Sonnet, Opus, or Fable for the rare hardest cases</sub></td>
<td width="25%" align="center">🎚️<br><b>Effort</b><br><sub>low, medium, high, xhigh, max</sub></td>
<td width="25%" align="center">🙋<br><b>You decide</b><br><sub>a dialog by default, or <code>auto</code></sub></td>
</tr>
</table>

## 🚀 Quick start

```
/plugin marketplace add Viktorooos/prompt-router
/plugin install prompt-router@prompt-router
```

That's it. Open a new chat and type as usual. Optionally tell the router what your project is (see [Configuration](#%EF%B8%8F-configuration)) so its calls fit your work.

## 👀 What it does

### 1. Sends unrelated or heavy work elsewhere

When a prompt does not belong in this chat, Claude asks before it starts:

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

### 2. Tunes the effort of this chat

When the prompt stays here but needs more or less thinking, you get **Switch / Keep as is**, or, with `effortMode: auto`, it just switches and tells you:

```
Effort: Low (was Medium), small follow-up to the last fix
```

### 3. Checks the model on a new chat's first prompt

Opus picked for a rename? Haiku for debugging? On the first prompt the router checks whether the selected model fits and offers (or, with `modelMode: auto`, makes) the switch.

### 4. Stays out of the way

Approvals (`yes`, `go on`, `option 2`), answers to Claude's questions, slash commands and prompts where nothing needs to change pass through untouched.

## 🧩 How it decides

```mermaid
flowchart LR
    P([Your prompt]) --> C{Classifier<br/>one small call}
    C -->|approval, answer| K[keep<br/>nothing changes]
    C -->|builds on this chat| H[here<br/>maybe new effort]
    C -->|self-contained read,<br/>search, build, tests| S[subagent<br/>short result back]
    C -->|unrelated, or long<br/>mechanical work| N[new session<br/>fresh context]
    H --> D{mode}
    S --> D
    N --> D
    D -->|ask| Q[Dialog:<br/>you pick]
    D -->|auto| A[Applied +<br/>toast]
```

The classifier sees the new prompt, the chat's first and last few prompts, the start of Claude's last reply, and the current model, effort and context size.

<details open>
<summary><b>🔀 Where</b></summary>

| | When |
| --- | --- |
| **keep** | An approval or an answer to Claude's question. Nothing changes. |
| **here** | Builds on what this chat already read or changed, is trivial, or the chat is still small. |
| **subagent** | A self-contained search, read, build or test run whose short result is needed here. |
| **session** | Unrelated to this chat, or long mechanical work better done with a fresh context. In a chat over **60k tokens**, even a trivial unrelated task goes here. |

</details>

<details open>
<summary><b>🧠 Model</b></summary>

| | For | Price (in / out per 1M) |
| --- | --- | --- |
| **Haiku** | Running, reading, searching, short answers | $0.10 / $0.50 |
| **Sonnet** | Mechanical edits by an existing pattern | $2 / $10 |
| **Opus** | New logic, debugging, review, anything risky | $4 / $20 |
| **Fable** | Only where Opus at high effort is likely not enough | $10 / $50 |

**Fable** is rare on purpose. ✅ A new architecture across several layers with no clear solution, a hard concurrency or security problem whose reach is unknown, a bug two fixes already failed to solve, a deep analysis where a wrong conclusion costs a lot. ❌ Never for an everyday feature (however big), a code review, payments or a migration with a known approach. It is offered only when your model picker lists it.

</details>

<details open>
<summary><b>🎚️ Effort</b></summary>

| | For |
| --- | --- |
| **low** | Simple work |
| **medium** | The default |
| **high** | Where a hidden mistake costs money, data or trust |
| **xhigh** | Long critical work you hand off (overnight, over the weekend) |
| **max** | Only when you ask for the maximum, or a one-off irreversible step with a very high cost of a mistake (production data, a live security incident) |

Words like *important*, *carefully* or *do it properly* never raise it beyond **high** on their own.

</details>

## ⚙️ Configuration

| Option | What it does | Default |
| --- | --- | --- |
| `project` | What your chats are about, in a few words | empty (a software project) |
| `rules` | Your own routing rules; they win over the built-in ones | empty |
| `language` | Language of the reason and of the questions Claude asks | `auto` (each prompt's language) |
| `classifier` | Model that makes the call: `sonnet`, `haiku` (cheaper, less accurate) or `opus` (most accurate, most expensive) | `sonnet` |
| `effortMode` | `ask`: a dialog before the effort changes · `auto`: just do it | `ask` |
| `modelMode` | New chat's first prompt: `ask` · `auto` · `off` (never touch the model) | `ask` |

**Where to set them:** `/plugin` → prompt-router → Configure, or `~/.claude/settings.json`:

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
> Options are read when a session starts. After a change, open a **new chat** to see it.

> [!TIP]
> Want no questions about effort or model at all? Set both `effortMode` and `modelMode` to `auto`. "Where should this go?" is still asked, since moving work to another session is always your call.

> [!NOTE]
> **Clients.** The desktop app, the terminal CLI, VS Code and Remote Control all run it. Where the chat cannot start a session itself (terminal, VS Code), "New session" gives you a `claude --model … --effort …` command to run in a new terminal. `claude -p` and Agent SDK runs pass untouched: their flags already chose the model and effort.

## 🛠️ Customizing

### Your own rules

`rules` is plain text appended to the classifier's prompt, and it wins over the built-in rules. Write it like a note to a colleague:

```
Database migrations: opus, high.
Translating finished Compose screens to SwiftUI: sonnet, medium.
Payments, vouchers, auth: opus, high.
Copy changes on the marketing site: haiku, low.
```

### Commands

| Command | What it does |
| --- | --- |
| `/router` | Status, this chat's model and effort, and whether the router holds the effort |
| `/router off` | Turn it off (remembered across sessions) |
| `/router on` | Turn it back on |

### Changing the mod itself

| File | What lives there |
| --- | --- |
| [`hooks/register.tsx`](plugins/prompt-router/hooks/register.tsx) | Everything: the classifier prompt (`TEMPLATE`, `FABLE_RULE`), the dialogs, the `switch` tool |
| [`test/router.test.ts`](plugins/prompt-router/test/router.test.ts) | Unit tests with canned classifier replies |
| [`test/cases.json`](plugins/prompt-router/test/cases.json) + [`expected.json`](plugins/prompt-router/test/expected.json) | Live eval cases and the right answers |
| [`.claude-plugin/plugin.json`](plugins/prompt-router/.claude-plugin/plugin.json) | Version and option definitions |

> [!TIP]
> Keep the classifier prompt in flat one-line bullets. Nested bullets inside a rule shifted Sonnet's calls on unrelated cases in the eval.

<details>
<summary><b>How switching works under the hood</b></summary>

- After **Switch** or **Do it here (…)**, Claude changes this chat's model or effort through the mod's own `switch` tool, because Claude Code's session tools refuse the chat they run in.
- `switch` refuses a model this chat is not offered (e.g. Fable when your picker does not list it) and says what it skipped. If it fails, Claude tells you the `/model` or `/effort` command to run.
- Where the effort setting cannot be changed, the router puts the level on each request until you move the effort picker yourself.
- A prompt typed while a turn is running keeps the model and effort.

</details>

## 🧪 Tests

**Unit tests** (canned classifier replies, no model calls):

```bash
claude plugin test plugins/prompt-router
```

**Live eval** of the classifier: in a session with the mod loaded, ask Claude to run the `mcp__prompt-router__test` tool with `file` = the absolute path of `plugins/prompt-router/test/cases.json`, `runs` = `3` and `out` = a TSV path, then:

```bash
python3 -I plugins/prompt-router/test/eval.py <out.tsv>
```

Cases can override `project`, `rules`, `language`, `classifier` and `models` (e.g. without `fable`), and `template` takes a classifier prompt file, so you can tune the rules without reloading the mod. `eval.py` also lists cases that waver between runs.

| Classifier | Last eval (123 cases, incl. Fable / xhigh / max boundaries) |
| --- | --- |
| Sonnet, 3 runs | ✅ 369 / 369 |
| Opus | ✅ 123 / 123 |
| Haiku | ⚠️ 114 / 123 (none of the misses raised a tier) |

## 💰 Cost

One small classifier call per prompt: low effort, at most 150 output tokens, on the model you pick in `classifier`. With the default Sonnet, that is a fraction of a cent per prompt. The savings come from not running a 200k-token chat on a question that needed a fresh one.

## ❓ FAQ

<details>
<summary><b>It asks me even though I set <code>auto</code>.</b></summary>

Options are read when a session starts, so open a new chat. Check that the entry under `pluginConfigs` uses the full id `prompt-router@prompt-router`: under plain `prompt-router` it is ignored. Also check that no second copy of the mod runs (`claude plugin list`, and any dev copy under `~/.claude/dev-mods/`), since a copy without your options falls back to `ask`.

</details>

<details>
<summary><b>Why didn't it suggest a new session when I changed topic?</b></summary>

Questions and opinions about what this chat is already doing stay here: the answer is short and builds on the context. Once the topic turns into a new piece of work, the router offers a session.

</details>

<details>
<summary><b>It never offers Fable.</b></summary>

Fable is offered only when your model picker lists it, and only for the rare cases above. Everyday features, reviews and known migrations go to Opus.

</details>

<details>
<summary><b>Can I use it with the Effort Optimizer mod?</b></summary>

Use one of them, not both: they both set effort per prompt.

</details>

## 🔌 Disable

`/router off` for a while · `/plugin` → prompt-router → Disable · or `claude plugin uninstall prompt-router@prompt-router`.

## 📄 License

[MIT](LICENSE) © 2026 Viktor Kadeřábek
