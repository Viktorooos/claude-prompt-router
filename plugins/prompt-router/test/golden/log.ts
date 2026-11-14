// Golden snapshot, written by write.mjs. Do not edit by hand.
export default {
  "writes": [
    {
      "path": "/home/u/.claude/mods-logs/prompt-router.log",
      "text": [
        "2026-11-10T12:00:00.000Z effective options: <plugin-root> | project=\"\" rules=\"\" language=auto classifier=sonnet effortDetection=ask firstChatDetection=ask midChatModelDetection=ask subagentSuggestions=ask sessionSuggestions=ask newSessionAt=50% notifications=on stats=on openPane=off compareWith=first savingsIn=limit",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router.log",
      "text": [
        "2026-11-10T12:00:00.000Z effective options: <plugin-root> | project=\"\" rules=\"\" language=auto classifier=sonnet effortDetection=ask firstChatDetection=ask midChatModelDetection=ask subagentSuggestions=ask sessionSuggestions=ask newSessionAt=50% notifications=on stats=on openPane=off compareWith=first savingsIn=limit",
        "2026-11-10T12:00:00.000Z pick: what does this regex match | now claude-opus-5-5 medium 85000 tok | first true | {\"where\":\"here\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router-stats.jsonl",
      "text": [
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"5d88254c5989f63b\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router.log",
      "text": [
        "2026-11-10T12:00:00.000Z effective options: <plugin-root> | project=\"\" rules=\"\" language=auto classifier=sonnet effortDetection=ask firstChatDetection=ask midChatModelDetection=ask subagentSuggestions=ask sessionSuggestions=ask newSessionAt=50% notifications=on stats=on openPane=off compareWith=first savingsIn=limit",
        "2026-11-10T12:00:00.000Z pick: what does this regex match | now claude-opus-5-5 medium 85000 tok | first true | {\"where\":\"here\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: run the whole test suite and tell me what fails | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"subagent\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router-stats.jsonl",
      "text": [
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"5d88254c5989f63b\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"subagent\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"220c9e639ff8305d\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"accept\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"decision\":1794312000000}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"agentId\":\"a1\",\"model\":\"claude-haiku-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"routedAgent\":true}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router-stats.jsonl",
      "text": [
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"5d88254c5989f63b\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"subagent\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"220c9e639ff8305d\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"accept\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"decision\":1794312000000}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"agentId\":\"a1\",\"model\":\"claude-haiku-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"routedAgent\":true}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router.log",
      "text": [
        "2026-11-10T12:00:00.000Z effective options: <plugin-root> | project=\"\" rules=\"\" language=auto classifier=sonnet effortDetection=ask firstChatDetection=ask midChatModelDetection=ask subagentSuggestions=ask sessionSuggestions=ask newSessionAt=50% notifications=on stats=on openPane=off compareWith=first savingsIn=limit",
        "2026-11-10T12:00:00.000Z pick: what does this regex match | now claude-opus-5-5 medium 85000 tok | first true | {\"where\":\"here\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: run the whole test suite and tell me what fails | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"subagent\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: go on with the next file | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"keep\",\"model\":\"keep\",\"effort\":\"keep\",\"why\":\"fits the task\"}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router-stats.jsonl",
      "text": [
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"5d88254c5989f63b\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"subagent\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"220c9e639ff8305d\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"accept\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"decision\":1794312000000}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"agentId\":\"a1\",\"model\":\"claude-haiku-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"routedAgent\":true}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"keep\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"opus\",\"effort\":\"medium\"},\"outcome\":\"applied\",\"key\":\"30398bb032516a76\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router.log",
      "text": [
        "2026-11-10T12:00:00.000Z effective options: <plugin-root> | project=\"\" rules=\"\" language=auto classifier=sonnet effortDetection=ask firstChatDetection=ask midChatModelDetection=ask subagentSuggestions=ask sessionSuggestions=ask newSessionAt=50% notifications=on stats=on openPane=off compareWith=first savingsIn=limit",
        "2026-11-10T12:00:00.000Z pick: what does this regex match | now claude-opus-5-5 medium 85000 tok | first true | {\"where\":\"here\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: run the whole test suite and tell me what fails | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"subagent\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: go on with the next file | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"keep\",\"model\":\"keep\",\"effort\":\"keep\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: now redesign the cache layer | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"here\",\"model\":\"opus\",\"effort\":\"high\",\"why\":\"fits the task\"}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router-stats.jsonl",
      "text": [
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"5d88254c5989f63b\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"subagent\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"220c9e639ff8305d\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"accept\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"decision\":1794312000000}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"agentId\":\"a1\",\"model\":\"claude-haiku-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"routedAgent\":true}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"keep\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"opus\",\"effort\":\"medium\"},\"outcome\":\"applied\",\"key\":\"30398bb032516a76\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"opus\",\"effort\":\"high\"},\"outcome\":\"asked\",\"key\":\"682aaa29d90caed0\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router.log",
      "text": [
        "2026-11-10T12:00:00.000Z effective options: <plugin-root> | project=\"\" rules=\"\" language=auto classifier=sonnet effortDetection=ask firstChatDetection=ask midChatModelDetection=ask subagentSuggestions=ask sessionSuggestions=ask newSessionAt=50% notifications=on stats=on openPane=off compareWith=first savingsIn=limit",
        "2026-11-10T12:00:00.000Z pick: what does this regex match | now claude-opus-5-5 medium 85000 tok | first true | {\"where\":\"here\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: run the whole test suite and tell me what fails | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"subagent\",\"model\":\"haiku\",\"effort\":\"low\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: go on with the next file | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"keep\",\"model\":\"keep\",\"effort\":\"keep\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: now redesign the cache layer | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"here\",\"model\":\"opus\",\"effort\":\"high\",\"why\":\"fits the task\"}",
        "2026-11-10T12:00:00.000Z pick: now build the shopping list feature | now claude-opus-5-5 medium 85000 tok | first false | {\"where\":\"session\",\"model\":\"sonnet\",\"effort\":\"medium\",\"why\":\"fits the task\"}",
        ""
      ]
    },
    {
      "path": "/home/u/.claude/mods-logs/prompt-router-stats.jsonl",
      "text": [
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"5d88254c5989f63b\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"subagent\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"haiku\",\"effort\":\"low\"},\"outcome\":\"asked\",\"key\":\"220c9e639ff8305d\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"accept\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"decision\":1794312000000}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"agentId\":\"a1\",\"model\":\"claude-haiku-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"routedAgent\":true}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"keep\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"opus\",\"effort\":\"medium\"},\"outcome\":\"applied\",\"key\":\"30398bb032516a76\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"here\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"opus\",\"effort\":\"high\"},\"outcome\":\"asked\",\"key\":\"682aaa29d90caed0\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        "{\"kind\":\"decision\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"where\":\"session\",\"from\":{\"model\":\"opus\",\"effort\":\"medium\"},\"to\":{\"model\":\"sonnet\",\"effort\":\"medium\"},\"outcome\":\"asked\",\"key\":\"9ba37c805fcbb029\",\"classifier\":{\"model\":\"claude-sonnet-5-5\",\"usage\":{\"input\":1,\"output\":1,\"cacheRead\":0,\"cacheWrite\":0},\"ms\":0}}",
        "{\"kind\":\"turn\",\"ts\":1794312000000,\"platform\":\"claude-code\",\"chat\":\"<chat>\",\"model\":\"claude-opus-5-5\",\"baseline\":\"claude-opus-5-5\",\"usage\":{\"input\":1000,\"output\":2000,\"cacheRead\":30000,\"cacheWrite\":500},\"durationMs\":4000,\"week\":{\"pct\":20,\"resets\":\"2026-11-16T08:00:00Z\"}}",
        ""
      ]
    }
  ],
  "sent": [
    [
      "what does this regex match",
      "",
      "[Prompt Router suggests model Haiku instead of Opus and effort low instead of medium for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (Haiku · Low)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"model\":\"haiku\",\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /model haiku and /effort low), then handle the prompt; on Keep as is, handle the prompt normally.]"
    ],
    [
      "run the whole test suite and tell me what fails",
      "",
      "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"Subagent (Haiku · low)\", \"Do it here (Low)\", \"Do it here (keep Medium)\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a subagent (Haiku · low), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-haiku-5-5\", effort \"low\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"haiku\" and effort \"low\" and have it return only a short result. \"Do it here (Low)\" = call the mcp__prompt-router__switch tool with {\"effort\":\"low\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort low), then handle the prompt; \"Do it here (keep Medium)\" = continue normally.]"
    ],
    "ok, go on",
    "go on with the next file",
    [
      "now redesign the cache layer",
      "",
      "[Prompt Router suggests effort high instead of medium for this prompt, because: fits the task. Before doing anything, ask the user with the AskUserQuestion tool (header \"Prompt Router\", the question \"Switch?\" with the reason in one sentence) with the options \"Switch (High)\", \"Keep as is\", the recommended one first. Write the question and options in the user's language (the language of this prompt). On Switch, call the mcp__prompt-router__switch tool with {\"effort\":\"high\"} (load it with ToolSearch \"select:mcp__prompt-router__switch\" if it is not loaded; never set_session_model or set_session_effort, which refuse this chat; if the tool fails, tell the user in one line to run /effort high), then handle the prompt; on Keep as is, handle the prompt normally.]"
    ],
    [
      "now build the shopping list feature",
      "",
      "[ACTION FIRST, before any other step: call the AskUserQuestion tool (header \"Prompt Router\", the question \"Where should this go?\" with the reason in one sentence) with the options \"New session (Sonnet · medium)\", \"Subagent (Sonnet · medium)\", \"Do it here\", the recommended one first, written in the user's language (the language of this prompt). Do not answer or start the task until the user has picked one. Prompt Router suggests running this prompt in a new session (Sonnet · medium), because: fits the task. This chat currently runs at effort medium. Then: new session = call start_session right away with initiation \"user_asked\", context \"fresh\", model \"claude-sonnet-5-5\", effort \"medium\", use_worktree true only when the task changes code, prompt = the task from this message, background = what it needs to know; here, say in one line where the work went. Subagent = call the Agent tool with model \"sonnet\" and effort \"medium\" and have it return only a short result. \"Do it here\" = continue normally.]"
    ]
  ],
  "toasts": {
    "toasts": [],
    "sets": []
  }
} as Record<string, unknown>
