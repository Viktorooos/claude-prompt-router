# Revize a polish Prompt Routeru (2026-11-05)

Větev `integrate/all` (přímo, bez nové větve). UI panelu dělá jiná session – na vzhled panelu (`register.tsx` od `ui.render`, `panel.ts`) nesahat.

## Rozhodnutí
- Dlouhý chat (nad `newSessionAt`): nová session se nabízí u **každého** promptu, který by zůstal tady (chování Claude Code). Testy a komentáře, které čekají jen novou práci, se srovnají.
- Úspora proti `compareWith` (např. opus-medium) přeceňuje **všechny** tahy včetně subagentů, které router nenabídl. Nechává se, jen se to popíše v README.
- Ceny v `core/prices.ts` sedí s oficiálním ceníkem (ověřeno v claude-api skillu). Haiku nad 100K promptu má vyšší sazbu – vědomě vynecháno (komentář v souboru).

## Kroky
- [x] Claude Code: klasifikátor neviděl poslední předchozí prompt (`register.tsx` chatOf). Test + oprava.
- [x] Jádro: `namesSetting` chytá české tvary (opusem, sonnetu); komentáře k `newSessionAt` podle rozhodnutí.
- [x] Statistiky (`core/stats.ts`): eskalace měřená proti kontrolní skupině s vyšším nastavením (README říká odhad); NaN u neznámého effortu; tah s `usd` na neznámém modelu počítaný dvakrát.
- [x] Codex adaptér: schéma výstupu bez `follows`/`note`; desktop bez subagentů stále nabízí subagenta; `chat: ''` v desktopu; `/router off` s rozbitým souborem; test `newSessionAt`.
- [x] OpenCode adaptér: session spuštěná přes `router_session` už se nikdy neroutuje; `compareWith` ignorován; jiný `where` v logu u nabídky jiného modelu; test `newSessionAt`.
- [x] README: řádek `newSessionAt`, počty testů, rozpor „Effort changes are counts only“, popis úspory u nerouteovaných subagentů.
- [x] Všechny testy zelené: CC 190, Codex 95, shared 6, OpenCode 69 (2026-11-05).

## Na později (nedělá se teď)
- OpenCode: tah prvního promptu session z `router_session`, který doběhne až po druhém promptu, se počítá pod novou session. `started` a `firstPrompt` by šly sloučit do jedné Map.
- Codex desktop čte rollout dvakrát na prompt (`mcp.ts` route + `handle`).
- `namesSetting` má seznam modelů zvlášť od `ALL_MODELS`; `knownEffort` by šel nahradit normalizací v `parseLog`.
- Statistiky: tah s `usd` na neceněném modelu (a tah na neznámém výchozím modelu) se počítá jako oceněný i neoceněný. Oprava mění test „a model with no price claims no saving…“ (`unpricedTurns` 2 → 1) a význam `unpricedTurns`, proto čeká na rozhodnutí.
- OpenCode: patička tabulky statistik neříká, s čím se srovnává (`compareWith`).
- Adaptéry nezapisují `follows`, `key` ani `accept` → v Codexu/OpenCode se nepočítá přepracování ani přijaté nabídky.
- Statistiky: kontrolní třída ignoruje výchozí model/effort (`here:<model>`); náklad kontrolní epizody zahrnuje i routované navazující prompty; bilance bere jen první rozhodnutí epizody.
- Nainstalovaný mod je cache 0.9.0 a liší se od repa – po dokončení přeinstalovat.

## Jak ověřit
Z kořene repa: `claude plugin test plugins/prompt-router`, `node --test adapters/codex/test/`, `node --test adapters/shared/test/`, `node --test adapters/opencode/test/`.
