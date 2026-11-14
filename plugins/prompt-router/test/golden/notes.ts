// Golden snapshot, written by write.mjs. Do not edit by hand.
export default {
  "ask-here-first-model-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router suggests model Haiku instead of Opus and effort low instead of medium for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (Haiku · Low)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"model\":\"haiku\",\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /model haiku and /effort low), then handle the prompt; on Keep as is, handle the prompt normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-first-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router suggests effort high instead of medium for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (High)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"effort\":\"high\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort high), then handle the prompt; on Keep as is, handle the prompt normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-first-model": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router suggests model Sonnet instead of Opus for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (Sonnet)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"model\":\"sonnet\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /model sonnet), then handle the prompt; on Keep as is, handle the prompt normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router suggests effort low instead of medium for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (Low)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt; on Keep as is, handle the prompt normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-same": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-other-model": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Haiku · low)\", \"Stay here (Low)\", \"Stay here (keep Medium)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router: this prompt belongs to this chat but fits Haiku · low better than this chat's Opus, because: fits the task. This chat currently runs at effort medium. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Then: Subagent = call the Agent tool with model \"haiku\" and effort \"low\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. \"Stay here (Low)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt; \"Stay here (keep Medium)\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-other-model-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Sonnet · medium)\", \"Stay here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router: this prompt belongs to this chat but fits Sonnet · medium better than this chat's Opus, because: fits the task. This chat currently runs at effort medium. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Then: Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. \"Stay here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-max": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router suggests effort max instead of medium for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (Max)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"effort\":\"max\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort max), then handle the prompt; on Keep as is, handle the prompt normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-here-mid-turn": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "ask-keep": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "ask-subagent": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Haiku · low)\", \"Do it here (Low)\", \"Do it here (keep Medium)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Haiku · low), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-haiku-5-5\", effort \"low\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"haiku\" and effort \"low\" and have it return only a short result. \"Do it here (Low)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt; \"Do it here (keep Medium)\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-subagent-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-subagent-on-fable": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Opus · high)\", \"Do it here (High)\", \"Do it here (keep Medium)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Opus · high), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-opus-5-5\", effort \"high\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"opus\" and effort \"high\" and have it return only a short result. \"Do it here (High)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"high\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort high), then handle the prompt; \"Do it here (keep Medium)\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-session": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-session-mid-turn": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-session-terminal": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = this client cannot start one, so give the user, in a bash code block, the command to run in a new terminal: claude --model claude-sonnet-5-5 --effort medium \"<the task from this message, with what it needs to know, in one line>\", then stop here. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "ask-session-long": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Opus · medium)\", \"Subagent (Opus · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Opus · medium), because: fits the task, chat at 75% of context. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-opus-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"opus\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-here-first-model-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Model: Haiku (was Opus), Effort: Low (was Medium), fits the task"
    ],
    "sets": [
      "haiku",
      "low"
    ]
  },
  "auto-here-first-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Effort: High (was Medium), fits the task"
    ],
    "sets": [
      "high"
    ]
  },
  "auto-here-first-model": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Model: Sonnet (was Opus), fits the task"
    ],
    "sets": [
      "sonnet"
    ]
  },
  "auto-here-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Effort: Low (was Medium), fits the task"
    ],
    "sets": [
      "low"
    ]
  },
  "auto-here-same": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-here-other-model": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: this prompt belongs to this chat but fits Haiku · low better than this chat's Opus, because: fits the task. This chat currently runs at effort medium. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Do not ask the user; decide yourself: use the subagent only when it is worth it: a larger self-contained piece of work that needs the other model (for example hard design or debugging on a weaker chat model, or long mechanical work on a strong one); a quick question, a short answer or a short message stays here. Subagent = call the Agent tool with model \"haiku\" and effort \"low\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. Here = call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt. Afterwards, tell the user in one sentence what you chose (the subagent or here) and why.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-here-other-model-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: this prompt belongs to this chat but fits Sonnet · medium better than this chat's Opus, because: fits the task. This chat currently runs at effort medium. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Do not ask the user; decide yourself: use the subagent only when it is worth it: a larger self-contained piece of work that needs the other model (for example hard design or debugging on a weaker chat model, or long mechanical work on a strong one); a quick question, a short answer or a short message stays here. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. Here = handle the prompt normally. Afterwards, tell the user in one sentence what you chose (the subagent or here) and why.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-here-max": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Effort: Max (was Medium), fits the task"
    ],
    "sets": [
      "max"
    ]
  },
  "auto-here-mid-turn": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-keep": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-subagent": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: run this prompt in a subagent (Haiku · low), because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"haiku\" and effort \"low\" and have it return only a short result.]"
      ]
    ],
    "toasts": [
      "Subagent: Haiku · Low, fits the task"
    ],
    "sets": []
  },
  "auto-subagent-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: run this prompt in a subagent (Sonnet · medium), because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result.]"
      ]
    ],
    "toasts": [
      "Subagent: Sonnet · Medium, fits the task"
    ],
    "sets": []
  },
  "auto-subagent-on-fable": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: run this prompt in a subagent (Opus · high), because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"opus\" and effort \"high\" and have it return only a short result.]"
      ]
    ],
    "toasts": [
      "Subagent: Opus · High, fits the task"
    ],
    "sets": []
  },
  "auto-session": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-session-mid-turn": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-session-terminal": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = this client cannot start one, so give the user, in a bash code block, the command to run in a new terminal: claude --model claude-sonnet-5-5 --effort medium \"<the task from this message, with what it needs to know, in one line>\", then stop here. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-session-long": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Opus · medium)\", \"Subagent (Opus · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Opus · medium), because: fits the task, chat at 75% of context. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-opus-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"opus\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-here-first-model-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Model: Haiku (was Opus), Effort: Low (was Medium), fits the task"
    ],
    "sets": [
      "haiku",
      "low"
    ]
  },
  "auto-mid-ask-here-first-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Effort: High (was Medium), fits the task"
    ],
    "sets": [
      "high"
    ]
  },
  "auto-mid-ask-here-first-model": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Model: Sonnet (was Opus), fits the task"
    ],
    "sets": [
      "sonnet"
    ]
  },
  "auto-mid-ask-here-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Effort: Low (was Medium), fits the task"
    ],
    "sets": [
      "low"
    ]
  },
  "auto-mid-ask-here-same": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-here-other-model": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: this prompt fits Haiku · low better than this chat's Opus, because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"haiku\" and effort \"low\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. Never switch this chat's model for it.]"
      ]
    ],
    "toasts": [
      "Subagent: Haiku · Low, fits the task"
    ],
    "sets": []
  },
  "auto-mid-ask-here-other-model-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: this prompt fits Sonnet · medium better than this chat's Opus, because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"sonnet\" and effort \"medium\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. Never switch this chat's model for it.]"
      ]
    ],
    "toasts": [
      "Subagent: Sonnet · Medium, fits the task"
    ],
    "sets": []
  },
  "auto-mid-ask-here-max": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [
      "Effort: Max (was Medium), fits the task"
    ],
    "sets": [
      "max"
    ]
  },
  "auto-mid-ask-here-mid-turn": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-keep": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-subagent": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: run this prompt in a subagent (Haiku · low), because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"haiku\" and effort \"low\" and have it return only a short result.]"
      ]
    ],
    "toasts": [
      "Subagent: Haiku · Low, fits the task"
    ],
    "sets": []
  },
  "auto-mid-ask-subagent-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: run this prompt in a subagent (Sonnet · medium), because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result.]"
      ]
    ],
    "toasts": [
      "Subagent: Sonnet · Medium, fits the task"
    ],
    "sets": []
  },
  "auto-mid-ask-subagent-on-fable": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[Prompt Router: run this prompt in a subagent (Opus · high), because: fits the task. Do not ask the user where it should go: start the subagent right away. Before it, tell the user in one sentence, in their language, that Prompt Router sent this to a subagent on that model and why. Call the Agent tool with model \"opus\" and effort \"high\" and have it return only a short result.]"
      ]
    ],
    "toasts": [
      "Subagent: Opus · High, fits the task"
    ],
    "sets": []
  },
  "auto-mid-ask-session": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-session-mid-turn": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-session-terminal": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = this client cannot start one, so give the user, in a bash code block, the command to run in a new terminal: claude --model claude-sonnet-5-5 --effort medium \"<the task from this message, with what it needs to know, in one line>\", then stop here. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-mid-ask-session-long": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Opus · medium)\", \"Subagent (Opus · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Opus · medium), because: fits the task, chat at 75% of context. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-opus-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"opus\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-first-model-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-first-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-first-model": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-same": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-other-model": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-other-model-same-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-max": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-here-mid-turn": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-keep": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-subagent": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-subagent-same-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-subagent-on-fable": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-session": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-session-mid-turn": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-session-terminal": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "off-session-long": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-here-first-model-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": [
      "haiku",
      "low"
    ]
  },
  "auto-quiet-here-first-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": [
      "high"
    ]
  },
  "auto-quiet-here-first-model": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": [
      "sonnet"
    ]
  },
  "auto-quiet-here-effort": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": [
      "low"
    ]
  },
  "auto-quiet-here-same": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-here-other-model": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Haiku · low)\", \"Stay here (Low)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router: this prompt belongs to this chat but fits Haiku · low better than this chat's Opus, because: fits the task. This chat currently runs at effort medium. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Then: Subagent = call the Agent tool with model \"haiku\" and effort \"low\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. \"Stay here (Low)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-here-other-model-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Sonnet · medium)\", \"Stay here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router: this prompt belongs to this chat but fits Sonnet · medium better than this chat's Opus, because: fits the task. This chat currently runs at effort medium. Switching this chat's model would break its prompt cache, so never switch this chat's model for it. Then: Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\"; it does not see this chat, so give it everything it needs from this chat in its prompt, and have it return only a short result. \"Stay here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-here-max": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": [
      "max"
    ]
  },
  "auto-quiet-here-mid-turn": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-keep": {
    "sent": [
      "run the whole test suite and tell me what fails"
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-subagent": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Haiku · low)\", \"Do it here (Low)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Haiku · low), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-haiku-5-5\", effort \"low\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"haiku\" and effort \"low\" and have it return only a short result. \"Do it here (Low)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-subagent-same-effort": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-subagent-on-fable": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Opus · high)\", \"Do it here (High)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Opus · high), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-opus-5-5\", effort \"high\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"opus\" and effort \"high\" and have it return only a short result. \"Do it here (High)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"high\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort high), then handle the prompt.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-session": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-session-mid-turn": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-session-terminal": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = this client cannot start one, so give the user, in a bash code block, the command to run in a new terminal: claude --model claude-sonnet-5-5 --effort medium \"<the task from this message, with what it needs to know, in one line>\", then stop here. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  },
  "auto-quiet-session-long": {
    "sent": [
      [
        "run the whole test suite and tell me what fails",
        "",
        "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Opus · medium)\", \"Subagent (Opus · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Opus · medium), because: fits the task, chat at 75% of context. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-opus-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"opus\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
      ]
    ],
    "toasts": [],
    "sets": []
  }
} as Record<string, unknown>
