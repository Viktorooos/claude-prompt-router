# Změřená úspora: router vs. kontrolní skupina

Větev `feat/measured-savings` (z `integrate/all` 22ecc6e, kde už je všechno mergnuté). Cíl: místo odhadů jedno změřené číslo, kolik stojí průměrný úkol s routerem a bez něj (s intervalem spolehlivosti), i po typech úkolů. Měření nevolá žádný model.

## Zjištění (výchozí stav)
- Kontrolní skupina má v logu 0 záznamů. Příčiny:
  1. Když chat nemá nastavený effort (`now === ''`, v logu ~25 ze ~50 změn „here“), `above('', 'low')` vrací false a prompt do kontroly nikdy nepadne (`hooks/register.tsx` `holdsOut`).
  2. Do kontroly smí jen posun dolů v rámci „here“. Subagent, session a zvýšení se nelosují, takže ze ~10 vhodných promptů při 10 % vychází očekávaně ~1 záznam.
  3. Losuje se každý prompt zvlášť, takže navazující prompty kontrolního úkolu router normálně přepíná a kontrola je „znečištěná“.
- `usage` v záznamu tahu je už skutečný součet tokenů všech požadavků tahu (engine `TurnCompleteInput.usage`). Odhadem je přecenění „bez routeru“: váhy `EFFORT_OUTPUT`, `switched` a `mainContext`. Chybí tokeny přerušených tahů (bez `usage`) a práce ve spuštěných sessions (`core/stats.ts` poznámka u `NOTE`).
- `chat` v logu je id vygenerované modem, ne id přepisu. `$.session.id()` = jméno souboru přepisu `~/.claude/projects/<projekt>/<id>.jsonl`, subagenti v `<id>/subagents/*.jsonl`.

## Rozhodnutí
- **Pokus po úkolech (randomizace):** o kontrole se rozhoduje u prvního promptu úkolu (stejné pravidlo jako `episodes()`: mezera 30 min, `follows` new, opakovaný text pokračuje). První rozhodnutí úkolu dostane `trial: 'router' | 'control'`, když router chce něco změnit (model, effort, subagent nebo session). Ze způsobilosti jsou vyloučené prompty, které samy jmenují model/effort, a volby xhigh/max (kvůli kvalitě). Losování je stejné pro obě skupiny, takže srovnání je férové (intention-to-treat: počítá se i nabídka, kterou člověk odmítl).
- **Kontrolní úkol:** router v něm mlčí u všech promptů (zapíše `where: 'keep'`, `holdout`, `wanted`). Výjimka: prompt, který jmenuje nastavení nebo chce xhigh/max, router obslouží normálně a úkol zůstane v kontrole.
- `holdoutPct` výchozí dočasně **30 %**, hodnoty `30, 0, 5, 10, 20` (zpět na 10 % v nastavení).
- **Cena úkolu** = skutečná cena všech tahů úkolu (hlavní chat, navazující prompty i přepracování, subagenti, spuštěné sessions) + klasifikátor (jen ve skupině router: bez routeru by neběžel). Studená cache po přepnutí modelu nebo v nové session je ve skutečných tokenech (cache write), nic se nedopočítává.
- **Tokeny z přepisu** se čtou jen při `/router stats` (skript `scripts/usage-scan.mjs`, bez modelu), ne při promptu ani v panelu. Doplní tokeny tahů, které log nemá (přerušené tahy). Rozhodnutí nesou `session` (id přepisu).
- **Sessions:** volání `start_session` zapíše `{kind:'spawn', chat, ts, key}` (klíč promptu nové session). Nová session se k úkolu přiřadí, když její první rozhodnutí má stejný klíč (prvních 60 znaků) do 15 min.
- **`EFFORT_OUTPUT` pryč:** přecenění „bez routeru“ zůstává jen pro model (náhradní odhad, dokud nejsou data z pokusu); změna effortu se oceňuje jen měřením.
- **Odmítnutí:** když router v tahu položil otázku „Prompt Router“ (AskUserQuestion) a do konce tahu nepřišlo přijetí, zapíše se `{kind:'accept', outcome:'declined'}`.
- **Přepracování bez modelu:** rozhodnutí nese `redo: true`, když text promptu jednoduchým pravidlem (cz/en: „nefunguje“, „zkus to znovu“, „pořád“, „not working“, „try again“ …) opravuje předchozí odpověď. `failureOf` ho bere jako `corrected`.
- **Výsledné číslo:** průměrná cena úkolu router vs. kontrola, rozdíl a 95% interval (Welchův test, normální aproximace), do 5 úkolů v kterékoli skupině jen „málo dat“. Rozdělení podle typu úkolu = kam by ho router poslal: `here↓` (levněji), `here↑` (dráž), `subagent`, `session`.

## Kroky
- [x] 0. Merge: vše už v `integrate/all`, testy 370/370. `main` = `origin/main`, posouvá se jen pullem z GitHubu, proto lokálně ne.
- [x] 1. Pokus po úkolech + oprava `now === ''` (30–60 min). Soubory: `core/router.ts` (`startsTask`, `trialEligible`), `core/stats.ts` (`episodes` použije `startsTask`), `hooks/register.tsx` (`holdsOut` → stav úkolu), `.claude-plugin/plugin.json`, `core/router.ts` OPTIONS (30 %). Ověření: nejdřív padající test „unknown effort → may be held out“, pak testy úkolu přes víc promptů v `test/router.test.ts`.
- [x] 2. Odmítnutí, `redo`, `session` v rozhodnutích, `spawn` (30–60 min). Soubory: `hooks/register.tsx`, `core/router.ts` (`isRedo`), `core/stats.ts` (typy, `failureOf`, `declined`). Ověření: testy v `test/router.test.ts` a `test/stats.test.ts`.
- [x] 3. Měření: `trial(records)` v `core/stats.ts` (cena úkolu, sessions přes `spawn`, klasifikátor, Welch, typy), odstranit `EFFORT_OUTPUT` (30–60 min). Ověření: testy v `test/stats.test.ts` s ručně spočítanými čísly.
- [x] 4. Tokeny z přepisu: `scripts/usage-scan.mjs` + čistá funkce `withTranscripts(records, scans)` v `core/stats.ts`, volání z `/router stats` (30–60 min). Ověření: test na fixture přepisu (dedup podle `message.id`, subagenti, okna úkolů).
- [ ] 5. Zobrazení: `/router stats` text a HTML, panel (bez přepisu), README (30 min). Ověření: testy textu, `claude plugin test`.
- [ ] 6. Adaptéry Codex/OpenCode: `follows`, `key`, `accept`, `trial`/holdout po úkolech, `redo` (30–60 min). Soubory: `adapters/codex/hook.ts`, `adapters/opencode/prompt-router.ts`, `adapters/shared`. Ověření: `node --test adapters/*/test/`.
- [ ] 7. `/done`, verze 0.10.0, commit.

## Jak ověřit
Z kořene repa: `claude plugin test plugins/prompt-router`, `node --test plugins/prompt-router/test/node/`, `node --test adapters/codex/test/`, `node --test adapters/opencode/test/`, `node --test adapters/shared/test/`.

## Poznámky pro další krok
- Krok 1: `startsTask` v `core/stats.ts` sdílí pravidlo s `episodes()`; stav úkolu `task` + `lastTrial` v `hooks/register.tsx` (`holdsOut` se volá pro každý prompt s rozhodnutím, i bez pick). Kontrolní úkol: `where: 'keep'`, `holdout`, `wanted`, `wantedWhere` (subagent/session); první rozhodnutí úkolu `trial`.
- Krok 2: `isRedo` v `core/router.ts`; v rozhodnutí `session` (z `$.session.id()` při `session.start`) a `redo`; `tool.call` hook bez filtru: AskUserQuestion s hlavičkou „Prompt Router“ → `routerAsked`, na konci tahu bez přijetí `{kind:'accept', outcome:'declined'}`; `start_session` → přijetí nabídky session + `{kind:'spawn', key}`. `Spawn` je v `Entry`, `episodes`/`reworkedSet` ho přeskakují.
- Krok 3: `trial(records, since)` v `core/stats.ts` vrací řádky `all`, `cheaper`, `dearer`, `subagent`, `session` (jen ty s úkoly): `router`/`control` = počet úkolů a průměrná cena, `saving` = kontrola − router s Welchovým 95% intervalem, `null` pod `MIN_TRIAL` (5). Napojená session (spawn: stejný klíč, do 15 min) se přičte k úkolu, který ji spustil. `EFFORT_OUTPUT`, `effortUsd` a řádek „Effort (estimate)“ jsou pryč; testy odhadu effortu přepsané na novou specifikaci (effort se nepřeceňuje). README ř. ~266 ještě zmiňuje `EFFORT_OUTPUT`, opraví krok 5.
- Krok 4: `scripts/usage-scan.mjs <projects> <out> <session>...` zapíše požadavky (ts, model, agent, usage; dedup podle `message.id`, poslední kopie, čas první) do `~/.claude/mods-logs/prompt-router-usage.json`; test v `test/node/usage-scan.test.mjs` (node --test). `withTranscripts(records, scans)` doplní přerušeným hlavním tahům tokeny z požadavků od předchozího tahu a označí je `transcript: true` (dál se počítají jako přerušené). `fillFromTranscripts` v `hooks/register.tsx` skenuje jen sessions s přerušeným tahem, jen v `/router stats`; když sken selže, použije poslední výsledek. `trial()` se zatím nikde nezobrazuje (krok 5).
