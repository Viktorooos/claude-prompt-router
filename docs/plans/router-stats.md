# Statistika úspor a měření přesnosti routeru

Navazuje na 0.8.0 (main 005c893 + c57e57f přejmenování). Dvě části: A) kolik router ušetřil, B) jak dobře rozhoduje.

## A) Statistika úspor

### Co se dá spočítat poctivě
- **Model:** tokeny, které běžely na levnějším modelu, ocením cenou modelu, na kterém by běžely bez routeru (model, na kterém chat začal, nebo model hlavního chatu u subagenta). Úspora = cena bez routeru − skutečná cena.
- **Subagent:** práce subagenta na levnějším modelu + kontext hlavního chatu, který nenarostl (ten se ale odhaduje špatně → ukázat jen první část).
- **Effort:** kontrafaktuál neznáme (kolik by přemýšlel na high). Ukázat jen počet snížení/zvýšení, ne tokeny. Případně později odhad z průměru výstupních tokenů na úroveň.
- **Náklad routeru:** každé volání klasifikátoru (vstup + výstup, jeho model). Odečíst → **čistá úspora**. Bez toho by čísla lhala.
- **Zdražení:** když router zvolí silnější model, je to „investice“, ne úspora. Ukázat zvlášť, neschovávat.
- Vše je **odhad** podle ceníku v `core/prices.ts` (tokeny × cena za 1M, i cache read/write). Ceny jen tam, ať se dají aktualizovat.

### Data
- Událost na každé rozhodnutí: `{ts, platform, chat, where, from: model·effort, to: model·effort, applied|asked|declined, classifierTokens}`.
- Na konci tahu: spotřeba tahu z `turn.complete` `e.usage` (input, output, cache read/write, model; per tah). Subagent stejně, s `e.agentId`. `$.session.usage()` tokeny nemá (viz krok 1).
- Ukládání: JSONL `~/.claude/mods-logs/prompt-router-stats.jsonl` (Codex/OpenCode stejný formát ve své složce), rotace po 90 dnech nebo 5 MB.

### Zobrazení
- `/router stats`: tabulka Dnes / 7 dní / Celkem: promptů, změn modelu, změn effortu, subagentů, tokeny podle modelu, odhad úspory $, náklad klasifikátoru, **čistá úspora** a % z ceny bez routeru. Pod tím top 3 důvody úspor.
- Hezky: v Claude Code panel modu (pruh se sloupcovým grafem po dnech a čistou úsporou), pokud to API modu umí; jinak HTML stránka vygenerovaná `/router stats --html`. **Rozhodnuto (uživatel, změna): žádný panel (nad chatem je vidět jen jeden a uživatel má jiný). Místo toho krátká úspora ve štítku v patičce vedle model · effort (např. „Opus · medium · ušetřeno $1,20 dnes“, respektuje `notifications`) + `/router stats` vygeneruje HTML stránku s grafy a otevře ji; spouští se ručně, to nevadí.**
- Codex/OpenCode: textová tabulka (Codex přes systémovou zprávu / příkaz, OpenCode přes nástroj).

### Kroky (30–60 min)
✅ 1. Zjistit API: co přesně vrací `$.session.usage()` (per tah? kumulativně? cache tokeny?), co jde zjistit v Codex hooku a OpenCode pluginu. Výstup sem. Ověření: poznámka s poli.
   - Zjištěno (CC mod API, build 2.1.309):
     - `$.session.usage()` vrací jen `{ startedAt, context: { tokens?, window, percent? }, rateLimits[], cost?: { usd } }`. `context.tokens` = vstup posledního requestu (ne součet), `cost.usd` kumulativně za session. Tokeny po druzích ani model nemá → na statistiku nestačí.
     - Konec tahu: hook `turn.complete` má `e.usage?: TurnUsage` = `{ input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, model }`, součet všech requestů tahu (model posledního). Chybí při přerušení/chybě API. Jemněji `turn.step` (per request). `session.measure` po každém tahu tlačí `cost.usd` (delta $ za tah, ale jen celkově).
     - Subagent: `turn.complete` (i `turn.step`) slyší i tahy subagenta s `e.agentId` a vlastním `e.usage.model` → tokeny a model subagenta jdou zvlášť. `agent.spawn` dává `subagentType` a model (`next(e)` → `{ model }`), takže jde spárovat rozhodnutí routeru s agentem.
     - Panel: `$.ui.open({ id, title })` + hook `ui.render` na `{ component: 'Pane', requestId: id }`; data přes `atom`/`read`/`update` (redraw sám, hodnoty deklarovat v `types/index.d.ts`). Prvky: všude `Box`, `Text`, `Button`, `Markdown`; `Svg` na desktop/mobile/vscode (sloupcový graf), v terminálu ne (tam `Raster` nebo textové pruhy ▇). Otevření: `$.command.register` + `command.run` hook volá `$.ui.open` (vzor `examples/pane.tsx` ve skillu plugin-authoring). V terminálu se nevyžádaný pane ukáže až od 144 sloupců, vyžádaný vždy.
     - Klasifikátor: `classify()` volá `$.model.complete(...)`, výsledek má při `isAnswered` `usage: ModelUsage` (4 počty) → náklad klasifikátoru přesně, model = `MODELS[conf.classifier]`. Dnes se `r.usage` zahazuje.
   - Zjištěno (Codex 0.166): `UserPromptSubmit` payload tokeny nemá (jen `transcript_path`, `model`, `turn_id`). Rollout JSONL má `event_msg` `token_count` s `info.total_token_usage` (kumulativně) a `last_token_usage` (poslední request): `input_tokens, cached_input_tokens, cache_write_input_tokens, output_tokens, reasoning_output_tokens, total_tokens`; model z `turn_context`. Codex umí i hooky `Stop`/`SubagentStop` → na konci tahu přečíst rollout, spotřeba tahu = rozdíl `total_token_usage`. Klasifikátor je `codex exec --json`: stdout (už se zachytává, neparsuje) má událost `turn.completed` s `usage` → ověřit v kroku 5. Formát rolloutu není stabilní API.
   - Zjištěno (OpenCode): plugin dnes nemá hook `event`. Přidat `event` → `message.updated`, `info` asistenta má `modelID`, `providerID`, `cost` ($ od OpenCode), `tokens { input, output, reasoning, cache { read, write } }`, `sessionID`; subagent = session s `parentID` (už se zjišťuje přes `client.session.get`). Klasifikátor: `client.session.prompt` vrací `data.info` se `tokens` a `cost` → náklad přímo.
   - Blokery: žádné. Pozor: `turn.complete` bez `usage` u přerušených tahů (počítat jako neznámé).
✅ 2. `core/prices.ts` + `core/stats.ts` (čisté funkce: z událostí spočítat souhrn) + testy napřed. Ověření: unit testy.
   - Hotovo: `plugins/prompt-router/core/prices.ts` (`PRICES` haiku/sonnet/opus/fable z dokumentace Claude API 2026-10-06, cache write = 5min 1,25× input; dlouhý kontext Haiku >100K vynechán; `priceOf`, `cost`, `usageOf` z `turn.complete` `e.usage`), `core/stats.ts` (`summarize(records, now)` → `{today, week, total}`, `byDay(records, now, n)` pro graf, `parseLog(jsonl)`), testy `test/prices.test.ts`, `test/stats.test.ts`.
   - Formát záznamů (JSONL, jeden na řádek, `kind`):
     - `{kind:'decision', ts, platform, chat, where: here|subagent|session|keep, from:{model,effort}, to:{model,effort}, outcome: applied|asked|declined, classifier?:{model, usage, usd?}}`
     - `{kind:'turn', ts, platform, chat, agentId?, model, baseline, usage?, usd?}`; `usage` = `{input, output, cacheRead, cacheWrite}`, chybí u přerušeného tahu. `usd` = cena hlášená platformou (OpenCode `cost`), má přednost před ceníkem.
   - Pravidla výpočtu: úspora jen z ceníku na obou stranách (`baseline` vs. `model`); když jedna cena chybí → `unpricedTurns`, žádná úspora. Zdražení (`extraUsd`) zvlášť, do čisté úspory se nepočítá. `netUsd = savedUsd − classifierUsd`, `netPct` z `withoutUsd`. Effort jen počty (`effortDown/Up`), jen u `applied` + `where: here`. „Dnes“ = místní kalendářní den, „7 dní“ = posledních 7×24 h.
   - Pro krok 3: `baseline` musí zapsat platforma: model, na kterém chat začal (u subagenta model hlavního chatu); model z `e.usage.model`. Klasifikátor: z `classify()` vrátit `r.usage` (dnes se zahazuje) a zapsat do `decision.classifier` s `MODELS[conf.classifier]`. „Top 3 důvody úspor“ zatím nejsou: záznam nemá `why` a úspory jsou per tah, ne per rozhodnutí → buď přidat `why` do `decision` a tah spárovat s posledním rozhodnutím chatu, nebo z tabulky vypustit (rozhodnout v kroku 3).
3. Claude Code: zápis událostí (vč. `r.usage` klasifikátoru) a spotřeby tahu z hooku `turn.complete` (hlavní i subagent podle `agentId`) v `register.tsx`, `/router stats`. Ověření: testy + živě po pár promptech.
4. Panel modu: `$.ui.open` z `/router stats`, `ui.render` Pane, sloupcový graf po dnech přes `Svg` (desktop), v terminálu textové pruhy; data v `atom` + kontrakt `types/index.d.ts`. Ověření: screenshot.
5. Codex + OpenCode (samostatné sessions, nezávislé). Codex: nový hook `Stop` (+ `SubagentStop`) čte rozdíl `total_token_usage` z rolloutu, klasifikátor z `turn.completed` ve stdout `codex exec --json`. OpenCode: hook `event` na `message.updated` (tokens + cost), klasifikátor z `data.info`. Ověření: jejich testy.
   - ✅ OpenCode: `adapters/opencode/stats.ts` (zápis `prompt-router-stats.jsonl` ve `stateDir`, rotace: při načtení pluginu zahodí záznamy starší 90 dní, nad 5 MB ořízne nejstarší na 4 MB; `statsTable()` Dnes / 7 dní / Celkem). V `prompt-router.ts`: `decision` na každý prompt, který prošel klasifikátorem (`keep` i u schválení a nečitelné odpovědi, protože klasifikátor stál), `classifier: {model: models[classifier], usage, usd}`; hook `event` → `message.updated` zapíše dokončenou zprávu asistenta jednou (podle `info.id`). Nástroj `router_stats` a `/router stats`. Testy `adapters/opencode/test/stats.test.ts`.
     - Rozhodnutí: OpenCode hlásí `cost: 0`, když cenu nezná (i u předplatného) → `usd` se zapíše jen při `cost > 0`, jinak rozhoduje ceník. Zpráva bez tokenů (přerušená) = bez `usage`.
     - Rozhodnutí (odchylka od „model, na kterém chat začal“): `baseline` hlavního chatu = model v pickeru, jen dokud router drží jiný model (`modelHold.base`); když člověk model přepne sám, úspora se nepřipisuje. Subagent: `baseline` = model hlavního chatu jen u agentů `router-*` (`info.agent ?? info.mode`) a u sessions spuštěných `router_session`; jiní subagenti (např. `explore` na Haiku od uživatele) mají `baseline` = vlastní model.
     - `outcome`: `applied` = co platí po promptu (i bez změny), `asked` = poznámka s otázkou (switch, subagent, session, jiný model). Přijetí nabídky (`router_switch`, task `router-*`) se nezapisuje zvlášť, aby se prompty nepočítaly dvakrát → v OpenCode bude `subagents`/`sessions` 0 a effort v režimu ask se nepočítá; úspora tokenů ze subagenta se ale počítá z tahů. Řešit v kroku 6, případně v `stats.ts` (např. `outcome: 'accepted'` bez `prompts++`).
     - Známé limity z review: ořez logu (čtení a přepis) nemá zámek, takže při dvou instancích OpenCode se stejným `stateDir` se může ztratit záznam zapsaný právě během ořezu (jen když se opravdu ořezává). Reasoning se přičítá k output stejně, jako to dělá OpenCode ve vlastním `cost`; u Claude modelů ho AI SDK zvlášť nehlásí, takže se nic nezapočítá dvakrát, u jiných providerů ověřit na živých datech. Baseline subagenta se čte až při dokončení tahu.
     - Ověřeno jen s mock klientem (tvar `message.updated` a `info.mode`/`agent` podle SDK, ne živě). `statsTable` je jen v OpenCode; Codex ji může převzít do `adapters/shared`.
6. README (sekce Statistika, jak se počítá a že je to odhad), volba `stats: on|off`, verze 0.9.0.

## B) Měření přesnosti (už existuje základ)
Dnes: `test/cases.json` (129 případů) + `expected.json` + `eval.py`, spouští se ručně přes nástroj `test` (stojí tokeny). Chybí:
1. **Pravidelné spouštění:** skript `scripts/eval.sh` (3 běhy na případ, výstup přesnost % a seznam chyb), spustit před každým vydáním; číslo do README („přesnost 94 % na 129 případech, classifier sonnet“).
2. **Případy z reálného provozu:** z logu `pick:` vybrat prompty, kde uživatel nabídku odmítl nebo zvolil jinou možnost → kandidáti do `cases.json` (s jeho potvrzením očekávaného výsledku). Tak se sada učí z chyb.
3. **Drobnosti uprostřed chatu** (víme, že selhávají): doplnit 10–15 případů (díky, ok, krátká otázka, zpráva kolegovi) a měřit odděleně; pak teprve řešit (návrh A z `subagent-for-lower-model.md`: lokální pravidlo „Haiku · low uprostřed chatu → zůstat tady bez otázky“, nebo předfiltr bez klasifikátoru).
4. **Srovnání klasifikátorů:** stejná sada pro haiku/sonnet → přesnost vs. cena, ať je vidět, jestli se levnější klasifikátor vyplatí.

## Otevřené otázky
- Ukládat statistiku ve výchozím stavu zapnutou?
