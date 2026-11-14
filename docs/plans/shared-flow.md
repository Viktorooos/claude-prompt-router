# Sdílený tok routeru pro Claude Code a OpenCode

Cíl:
- zamknout chování Claude Code golden testy,
- vytáhnout platformně neutrální tok tahu do `core/flow.ts`,
- přepojit na něj OpenCode, které tím dorovná chování Claude Code.

**Tvrdá podmínka: Claude Code se chová přesně jako teď.** To znamená stejný prompt klasifikátoru, poznámky, toasty, zápisy do configu, statistiky i pane.

Rozsah byl zúžen 2026-11-13. Rozšíření na Codex, Gemini, Factory a MCP se odložilo, protože tam router umí jen radit a model sám nepřepne (podklady v „Podklady“). Navazuje na `multi-platform.md`.

## Rozhodnutí
1. **Claude Code:** `hooks/register.tsx` se **nemění** a nikdo na něj nenapojuje `core/flow.ts`, ani `/done`, simplify nebo code review. Přepojení CC na sdílený tok je mimo tento plán.
2. **Sémantiku sdíleného toku určuje CC.** OpenCode se srovná na CC: zápis declined, auto návrh session, keep jen po klasifikaci, předávání šablony. Mění se tím OpenCode, ne CC.
3. **Config:**
   - CC beze změny: `plugin.json` `userConfig`, `~/.claude/settings.json` (`pluginConfigs`), `$.config`.
   - `OPTIONS`, `SWITCHES` a `toConfig` v `core/router.ts` se nemění.
   - OpenCode dál čte `~/.config/opencode/prompt-router.json` přes `toConfig` + `fromTiers`.
   - Volba, kterou potřebuje jen OpenCode, nejde do `SWITCHES`/`OPTIONS`.
4. **Commity v tomhle repu jsou bez řádku `Co-Authored-By`** (pravidlo uživatele, má přednost před systémovou připomínkou). Nic se nepushuje a PR nevzniká. Nainstalovaný plugin (`~/.claude/plugins/cache/prompt-router`) se nemění.
5. **Testy se neoslabují.** Nemažou se assertions, nic se nepřeskakuje a golden snapshoty se po F1 nepřegenerují. Očekávání OpenCode testů se smí změnit jen u srovnání na CC z bodu 2 a každá změna se vypíše v reportu.

## Pojistka pro Claude Code (platí pro každý podkrok a každé ověření)
- Tento příkaz musí skončit s exit 0 (`epic/shared-flow` založí koordinátor z `main` hned po schválení rozpisu):
  ```bash
  git diff --quiet epic/shared-flow..HEAD -- plugins/prompt-router/hooks plugins/prompt-router/core/panel.ts plugins/prompt-router/core/stats.ts plugins/prompt-router/core/prices.ts plugins/prompt-router/.claude-plugin
  ```
- Ze sdílených souborů se smí měnit jen `core/router.ts`, a to jen aditivně: volitelný parametr `host` s výchozí hodnotou = dnešní text. Nově přibývá `core/flow.ts`.
- Golden snapshoty z F1 musí projít beze změny. Rozdíl = chyba v kódu, ne v testu.

## Feature F1 `golden`: zamknout chování Claude Code
Feature je hotová, když:
- [x] golden testy jsou commitnuté a projdou na nezměněném produkčním kódu (CC 365/365),
- [x] pojistka platí (exit 0),
- [x] plná sada je zelená (kromě 2 známých testů, viz Provedení),
- [x] je zapsaný výsledek (ano/ne) kontroly `claude -p --plugin-dir` (ano, exit 0).

Média do PR: jen textové výstupy (testy, golden, `git diff --stat`), žádné video, fotky ani zařízení.

### F1.1 Golden testy
- Soubory: `plugins/prompt-router/test/golden.test.tsx`, `plugins/prompt-router/test/golden/*`. Mock engine je stejný jako v `test/router.test.ts`, stub `clock.every` jako `test/pane.test.tsx:711`.
- Determinismus:
  - `process.env.TZ = 'UTC'` na začátku souboru, pevný `$.clock.now`;
  - `Math.random` stubnout, nebo vynechat `chatId` ze snapshotu (`register.tsx:1052`);
  - `process.run` na skripty vyhodí chybu, takže log jde fallbackem přes `fs.read`/`fs.write` (`register.tsx:125-135`).
- Snapshot (celé texty, ne regex):
  1. prompt klasifikátoru (`model.complete`) pro matici: první / další tah, s tokeny / bez, aktuální model haiku/sonnet/opus/fable, vlastní pravidla, jazyk cs/en;
  2. všechny texty poznámek (ask/auto × here/subagent/session × přepnutí modelu/effortu);
  3. záznamy v logu (decision/accept/turn/declined) ze skriptovaného scénáře o 5 tazích;
  4. toasty a zápisy `config.set`;
  5. výstup `statsHtml` pro pevná data a obsah, který mod zapíše přes `fs.write`;
  6. `toConfig({})`, `toConfig` z výchozích hodnot `plugin.json` `userConfig` a `OPTIONS`, což zamkne názvy voleb a jejich výchozí hodnoty.
- Vznik snapshotů: test je zapíše jen s `GOLDEN_WRITE=1`, a to jedinkrát v F1, na nezměněném kódu. Commitnou se. Nikdo jiný `GOLDEN_WRITE` nepoužije. Co mock engine zachytit neumí (vykreslený strom pane, `clock.every` tiky), zapiš do „Dluh ověření“.
- `claude -p --plugin-dir plugins/prompt-router "/router"`: výsledek „ano“ i „ne“ je platný, zapiš ho do „Poznámky pro další krok“. Při „ne“ se živý smoke test CC přesune do dluhu.
- Hotovo, když:
  - golden zelené a commitnuté, druhý běh bez `GOLDEN_WRITE` zelený;
  - `git diff epic/shared-flow..HEAD --stat` ukazuje jen `test/golden*`;
  - pojistka a plná sada OK.

## Feature F2 `jadro`: sdílený tok a OpenCode na něm
Feature je hotová, když:
- `core/flow.ts` s CC jmény nástrojů vrací přesně texty a záznamy z `test/golden/*`,
- OpenCode používá `core/flow.ts`, posílá klasifikátoru vlastní `host` a jeho testy včetně 2 dnes červených projdou (nebo jsou doložené v dluhu),
- pojistka a golden platí.

Média do PR: jen textové výstupy.

### Výsledek F1.1
- [x] Hotovo, ověřeno (CC 365/365, test/node 13/13, validate OK, adapters 77/79 známé). Kritéria 3/3.
- Poznámky pro F2: sandbox `claude plugin test` nemá `node:fs`/`process`/JSON import, proto jsou snapshoty .ts moduly `plugins/prompt-router/test/golden/{config,log,notes,prompts,stats}.ts`, víceřádkové texty jako pole řádků (spojit `join('\n')`). Zápis jen `GOLDEN_WRITE=1 node test/golden/write.mjs`. Id chatu ve snapshotu = `<chat>`, cesta pluginu = `<plugin-root>`. Časy v poledne UTC. Mock engine `golden.test.tsx:52`. F2.2 importuje snapshoty relativně z `test/golden/*.ts`.

### F2.1 Parametr `host` (paralelně s F2.2, soubory se nepřekrývají)
- `core/router.ts`: `pickPrompt` dostane volitelný `host`. Výchozí hodnota je dnešní text „a Claude Code chat“ / „Claude's last reply“, takže CC ho nepředává a nic se nemění.
- Test v `router.test.ts`: bez `host` je výstup shodný s golden, s `host` se změní jen tyto dvě fráze.
- Hotovo, když: golden beze změny, nové testy zelené, pojistka OK.

### F2.2 `core/flow.ts`
- Čisté funkce bez `$`, s injektovaným časem a jmény nástrojů a modelů. Přepis logiky CC bez `$`:
  - finalizace výběru (`register.tsx:393-405`),
  - záznamy rozhodnutí a accept/declined (`:579-616`, `:1232-1290`),
  - texty poznámek s `{switchTool, askTool, sessionTool, agentTool, modelName, effortOf}` (`:407-506`),
  - tok quickReply → here/subagent/session (`:691-781`).
- Soubory: `core/flow.ts`, `test/flow.test.ts`. Test čte očekávané hodnoty z `test/golden/*` (F1).
- Hotovo, když: `flow.test.ts` zelený a dokazuje shodu s golden, `register.tsx` beze změny.

### Výsledek F2.1 a F2.2
- [x] F2.1 hotovo (CC 366, test/node 13/13, adapters 77/79 známé). Kritéria 3/3. `pickPrompt(text, c, template = TEMPLATE, host = HOST)`, `HOST` exportovaný, `TEMPLATE` se sloty `{{host_chat}}`/`{{host_reply}}`. Past: vlastní template soubor s pevným textem `host` ignoruje.
- [x] F2.2 hotovo (CC 452, flow.test.ts 87 proti golden, pojistka OK). Kritéria 2/2. API a pořadí volání v briefu F2.3. Pasti: `switchCall`/`sessionThen` vázané na CC; `declined`/`isRouterQuestion` golden nekryje; tabulka případů ve `flow.test.ts` je kopie z `golden.test.tsx`.

### F2.3 OpenCode na `core/flow.ts` (po F2.1 a F2.2)
- Soubory: `adapters/opencode/prompt-router.ts`, `notes.ts`, `stats.ts`, `test/*`. README až v F3.
- OpenCode volá `core/flow.ts`. Doplnit zápis declined, auto návrh session a keep jen po klasifikaci, předávat šablonu jako CC a `host` = „an OpenCode chat“ / „the assistant's last reply“.
- 2 dnes červené testy v `adapters/opencode/test/stats.test.ts`:
  - `:243` „the table compares with the compareWith option“,
  - `:162` „the stats tool shows today, 7 days and total“.

  Oprav kód, aby prošly. Pokud test odporuje záměrnému pozdějšímu commitu (zjisti přes `git log -p` u `core/stats.ts` a `adapters/opencode/stats.ts`), test neměň: zapiš ho do dluhu s odkazem na commit.
- Hotovo, když:
  - `node --test adapters/opencode/test/ adapters/shared/test/` zelené (nebo 2 testy doložené v dluhu);
  - změny očekávání vypsané (seznam převezme F3 do README);
  - golden, pojistka a plná sada OK.

### Výsledek F2.3
- [x] Hotovo (CC 453, test/node 13/13, adapters 79/81 se 2 v dluhu). `Names` ve `flow.ts:21-26` má volitelné `switchCall`, `sessionThen`, `agentCall`. Pro README (F3) změny OpenCode: výzvy mají CC znění („ACTION FIRST… call the question tool“), zmizel dovětek „if the question tool is not available, ask in one short message“; zápis declined na konci tahu; auto subagent a auto návrh session; nabídka platí do dalšího promptu; subagent přijat jen na nabízeném tieru; klasifikátor dostává host „an OpenCode chat“.

## Feature F3 `readme`: nové prémiové README
Feature je hotová, když:
- `README.md` je přepsané celé a působí prémiově (jednotný vizuální styl, vlastní SVG grafika, žádné rozbité odkazy),
- všechny obrázky vznikají skriptem `docs/images/generate.mjs` (opakovatelně),
- fakta v README sedí s kódem.

Média do PR: seznam vygenerovaných obrázků, výstupy kontrol a `git diff --stat`.

### F3.1 Grafika
- `docs/images/generate.mjs` rozšířit a přegenerovat všechny SVG v `docs/images/` v jednom stylu (barvy z `core/panel.ts` `VIOLETS`/`TONES`, jedno písmo, zaoblení, jemné stíny). Varianty světlá/tmavá se přepínají přes `<picture>` + `prefers-color-scheme`.
- Obrázky:
  - hero banner (název, jedna věta hodnoty, 3 přínosy);
  - diagram „jak to funguje“ (prompt → klasifikátor → here/subagent/session/keep);
  - karty funkcí;
  - pane: You saved, Cache, This chat, Settings, Details, nově s obdobími This month a Last month;
  - tabulka platforem jako grafika: Claude Code, OpenCode, orchestrátory.
- Skript jen čte z `core/*` (vykreslovací funkce, konstanty), nic v `core/` nemění.
- Hotovo, když:
  - `node docs/images/generate.mjs` proběhne bez chyby a druhý běh nic nezmění (`git diff --quiet docs/images`);
  - `for f in docs/images/*.svg; do xmllint --noout "$f" || echo "vadné $f"; done` nic nevypíše;
  - každé SVG je pod 300 KB.

### F3.2 Text README (po F3.1)
- Struktura:
  1. hero + odznaky;
  2. „Why“ ve 3 větách;
  3. Features (karty);
  4. Quick start pro Claude Code a OpenCode;
  5. jak to funguje (diagram);
  6. The pane (obrázky);
  7. Settings: tabulka všech voleb s výchozími hodnotami, delší části v `<details>`;
  8. Savings;
  9. Platformy: Claude Code, OpenCode a změny z F2.3; Orchestrátory (Orca, Claude Squad, Conductor, Crystal, Vibe Kanban) spouštějí skutečné `claude`, takže router jede s ním, bez pane a místo `start_session` příkaz `claude …`;
  10. Commands;
  11. vývoj a testy;
  12. FAQ;
  13. licence.
- Krátké věty, žádná vata. Každá sekce má obrázek nebo tabulku, ne zeď textu. Codex, Gemini a Factory jako „zvažováno, proč ne“ jen v jedné větě nebo vůbec.
- Hotovo, když (z kořene repa):
  - kontrola odkazů a obrázků nic nevypíše:
    ```bash
    grep -oE '\]\(([^)#:]+)|src="[^"]+"' README.md | sed -E 's/^\]\(|^src="|"$//g' | grep -v '^http' | sort -u | while read p; do [ -e "$p" ] || echo "chybí $p"; done
    ```
  - každá volba z `OPTIONS` v `core/router.ts` je v README:
    ```bash
    node -e "import('./plugins/prompt-router/core/router.ts').then(m=>{const r=require('fs').readFileSync('README.md','utf8');const x=m.OPTIONS.filter(o=>!r.includes('\`'+o+'\`'));if(x.length){console.log('chybí',x);process.exit(1)}})"
    ```
  - `(cd plugins/prompt-router && claude plugin validate .)` OK, pojistka a plná sada OK.

## Provedení

Rozpis schválen: 2026-11-14. Epic `epic/shared-flow` = `ed73284`. Postup plánu commituje koordinátor na `main` (jen tento soubor, bez Co-Authored-By).

### Ověřování
- Režim: `feature`. Ověřovací session nepoužívá zařízení, video ani screenshoty: projekt není mobilní aplikace. Kritéria „Tok / UI ready / Komunikace s BE“ ze skillu neplatí, platí „Feature je hotová, když“ ověřená příkazy.
- Hlavní větev: `main`.
- Lint: SKIP (projekt linter nemá).
- Build: SKIP (Node 26 spouští `.ts` přímo a typy nekontroluje, proto chování pokrývat testy).
- Média: textové výstupy do `~/.claude/pr-media/shared-flow/<feature>/` (výstup plné sady, golden, `git diff --stat`).
- Testy CC běží ve worktree pod `.claude/worktrees/` v repu (tam projdou 256/256). Když `claude plugin test .` hlásí `clock.every refused`, je to prostředí, ne kód: zapsat do dluhu, neopravovat testy.
- **Plná sada** (z kořene worktree):
  ```bash
  (cd plugins/prompt-router && claude plugin test . && node --test test/node/ && claude plugin validate .)
  node --test adapters/*/test/
  git diff --quiet epic/shared-flow..HEAD -- plugins/prompt-router/hooks plugins/prompt-router/core/panel.ts plugins/prompt-router/core/stats.ts plugins/prompt-router/core/prices.ts plugins/prompt-router/.claude-plugin
  ```
  Známý stav 2026-11-13 na `5663ac3`: CC 256/256, `test/node` 13/13, validate OK. `adapters/opencode/test/stats.test.ts` má 2 červené testy (:162 a :243, oba neodpovídají `/Saved .*\$3\.90/`), celkem 77/79. Do F2.3 se tolerují, potom ne.
- Živé testy: žádné (OpenCode není nainstalovaný), jen unit testy a mock engine CC.
- Rozjezd: 3 featury, celý plán najednou.

### Dluh ověření
- F1.1: golden nepokrývá vykreslený strom pane ani tiky `clock.every` (timer stubnutý, nikdy netiká).
- F2.3: `adapters/opencode/test/stats.test.ts:162` a `:243` čekají `$3.90`, vychází `$3.50`: záměrný commit 726f59f (dražší Haiku sazba nad 100K tokenů), testy nezměněny.
- F2.3: declined v OpenCode se zapisuje jen na `session.idle`/`session.status` idle, v živém OpenCode neověřeno.
- F2.2: větve `declined`/`isRouterQuestion` golden nekryje, jen unit test.
- F1.1: `claude -p --plugin-dir plugins/prompt-router "/router"` = ano (exit 0), ale mohla se načíst nainstalovaná kopie stejného jména.

### Před spuštěním (uživatel)
1. Hotovo: rozpracované změny commitnuté jako `5663ac3`, plán commitnutý.
2. Novou session otevřít ve složce `~/.claude/mods-src/prompt-router` a spustit `/proved docs/plans/shared-flow.md`. Rozpis schválit (jediný dotaz) a nechat běžet. Povolit scratchpad, `~/.claude/pr-media/` a `~/.claude/scripts/cleanup-worktrees.sh`.

### Tabulka stavu
| Feature | Podkrok | Podvětev | Session | Základ | Model/effort | Stav | Úklid |
| --- | --- | --- | --- | --- | --- | --- | --- |
| golden | F1.1 | claude/shared-flow-golden-tests-53504d (ab0b7d9) | golden-tests | ed73284 | Opus/high | mergnuto (8fa9546), kritéria 3/3 | worktree smazán |
| jadro | F2.1 | claude/shared-flow-jadro-host-5b5f73 (3e569d1) | jadro-host | 36c9c7d | Sonnet/medium | mergnuto (a130731), kritéria 3/3 | worktree smazán |
| jadro | F2.2 | claude/shared-flow-jadro-flow-828c4f (d38a91a) | jadro-flow | 36c9c7d | Opus/high | mergnuto (066e129), kritéria 2/2 | worktree smazán |
| jadro | F2.3 | claude/shared-flow-jadro-opencode-00a840 (32d6e03) | jadro-opencode | 066e129 | Opus/high | mergnuto (28d8564), kritéria 5/5 ano + 1 odloženo (dluh) | worktree smazán |
| readme | F3.1 | – | – | – | Opus/medium | čeká | – |
| readme | F3.2 | – | – | – | Opus/medium | čeká | – |

| Feature | Větev | Konec SHA | Stav | Kritéria | Média | PR |
| --- | --- | --- | --- | --- | --- | --- |
| golden | shared-flow-golden | 36c9c7d | ověřeno (overeni-golden, claude/shared-flow-golden-overeni-f389f2, oprava f51c20f; worktree spark-hover-7cb7a4 ponechán: běží v něm sleep, uklidí závěrečný úklid) | 4/4 | ~/.claude/pr-media/shared-flow/golden/ | ne |
| jadro | shared-flow-jadro | 28d8564 | ověřuje se (overeni-jadro) | – | – | ne |
| readme | shared-flow-readme | – | čeká | – | – | ne |

## Podklady: proč ne další nástroje (průzkum 2026-11-13)
- Codex CLI a Factory: háček umí jen přidat kontext, model ani effort nepřepne. Router by jen radil „přepni `/model …`“ a za to přidal 1–3 s a tokeny klasifikátoru na každý prompt. Codex byl kvůli tomu pozastaven (`e743931`) a smazán (`ee191bd`), obnovit se dá z gitu.
- Codex desktop, Copilot CLI (výstup háčku se zahazuje) a Cursor (háček jen blokuje) by šly jen přes MCP nástroj, který agent musí sám zavolat.
- Gemini CLI model přepnout umí (`BeforeModel` → `llm_request.model`), effort neověřen. Pro neplacené účty ho od 18. 6. 2026 nahrazuje Antigravity CLI s jiným formátem hooků. Kandidát na později.
- Orchestrátory (Orca stablyai/orca, Claude Squad, Conductor, Crystal, Vibe Kanban) spouštějí skutečné CLI, není co portovat.
- Duplicita CC ↔ OpenCode: `register.tsx` :370-406, :407-506, :579-616, :691-781, :1232-1290 vs. `adapters/opencode/prompt-router.ts` :412-505, `notes.ts`.
