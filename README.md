# Prompt Router

A Claude Code mod that decides, for every prompt, whether it belongs in this chat, a subagent or a new session, and which model and effort it needs.

## What you see

When a prompt belongs elsewhere, Claude asks before it starts:

```
Prompt Router
Where should this go? It is an unrelated feature, so a fresh session fits.

  › New session (Sonnet · medium)
    Subagent (Haiku · low)
    Do it here
```

When the prompt stays here but needs another effort, the router switches it and shows a toast:

```
Effort: Low (was Medium), small follow-up to the last fix
```

Approvals ("yes", "go on", "option 2"), slash commands and prompts where nothing needs to change pass through untouched. The first prompt of a chat only gets its effort set.

## Install

```
/plugin marketplace add ViktorKaderabek/prompt-router
/plugin install prompt-router@prompt-router
```

## Configuration

| Option | What it does | Default |
| --- | --- | --- |
| `project` | What your chats are about, in a few words | empty (a software project) |
| `rules` | Your own routing rules, appended to the classifier prompt; they win over the built-in ones | empty |
| `language` | Language of the reason and of the questions Claude asks | `auto` (the language of each prompt) |
| `classifier` | Model that makes the routing call: `sonnet` or `haiku` (cheaper, less accurate) | `sonnet` |
| `effortMode` | `auto` sets effort in this chat by itself; `ask` only has Claude offer `/effort <level>` | `auto` |

Example:

- **project:** `a React web app and a React Native mobile app for sharing recipes, Node.js backend`
- **rules:** `Database migrations: opus, high. Copy changes on the marketing site: haiku, low. Porting finished web screens to mobile: sonnet, medium.`
- **language:** `English`

Set them in `/plugin` → prompt-router → Configure, or in `~/.claude/settings.json`:

```json
"pluginConfigs": {
  "prompt-router": {
    "options": {
      "project": "a React web app and a React Native mobile app for sharing recipes",
      "rules": "Database migrations: opus, high.",
      "language": "English"
    }
  }
}
```

## Commands

- `/router` shows the status, the model and effort of this chat, and whether the router holds the effort.
- `/router off` and `/router on` turn it off and on (remembered across sessions).

## How the routing works

- **keep:** an approval or an answer to Claude's question. Nothing changes.
- **here:** builds on what this chat already read or changed, is trivial, or the chat is still small.
- **subagent:** a self-contained search, read, build or test run whose short result is needed here.
- **session:** unrelated to this chat, or long mechanical work better done with a fresh context.

Model: Haiku for running, reading and searching; Sonnet for mechanical edits by an existing pattern; Opus for new logic, debugging, review and anything risky. Effort: low for simple work, medium by default, high where a hidden mistake costs money, data or trust, xhigh only for long critical work you hand off.

Effort here is changed through the chat's effort setting. Where that setting cannot be changed, the router puts the level on each request until you move the effort picker yourself.

## Cost

One small classifier call per prompt (Sonnet or Haiku, low effort, at most 150 output tokens). It sees the new prompt, the chat's first and last few prompts, the start of Claude's last reply, and the current model, effort and context size.

## Tests

- Unit tests with canned classifier replies: `claude plugin test plugins/prompt-router`.
- Live classifier test: in a session with the mod loaded, ask Claude to run the `mcp__prompt-router__test` tool with `file` set to the absolute path of `plugins/prompt-router/test/cases.json`, `runs` 3 and `out` a TSV path. Then run `python3 -I plugins/prompt-router/test/eval.py <out.tsv>`. Cases can override `project`, `rules` and `language`.

## Disable

`/router off` for a while, or `/plugin` → prompt-router → Disable, or `claude plugin uninstall prompt-router@prompt-router`.

## Effort Optimizer

This mod overlaps with the Effort Optimizer mod: both set effort per prompt. Use one of them, not both.

## License

MIT, see [LICENSE](LICENSE).
