# Production ready: opravy z analýzy 2026-11-06

Cíl: router na žádné platformě nestojí víc, než ušetří, neztrácí data a funguje na macOS, Linuxu i Windows. Pořadí podle dopadu: Codex teď spíš tokeny spotřebovává (bod A), Claude Code funguje, ale ztrácí statistiky (bod B), OpenCode nikdy neběžel (bod C).

## Výchozí stav (naměřeno)

- Testy: 410/410 (CC 226, Codex 101, OpenCode 76, shared 6, usage-scan 1). Živý eval v CC: 24 vzorků, 22 správně, obě chyby kvůli uživatelovým `rules` a `newSessionAt`, ne kvůli klasifikátoru.
- Codex, prompt „ahoj co umis“ na gpt-6.1-sol ultra (rollout `~/.codex/sessions/2026/11/06/rollout-2026-11-06T21-28-08-01a1b28c-….jsonl`), celkem ~41 s:
  - 0–9,5 s: hook `UserPromptSubmit` (klasifikace přes `codex exec`), prompt čeká,
  - 14–22 s: agent volá MCP `route` (druhá klasifikace, 7,7 s), protože hook v kontrolní skupině mlčel a `~/.codex/AGENTS.md` říká volat `route`, když chybí poznámka „[Prompt Router: …“,
  - 22–41 s: sol ultra přemýšlí a hledá na webu (router chtěl gpt-6-luna low, kontrolní skupina ho umlčela).
  - Jedna klasifikace = 69–75k tokenů (`codex exec` načte celý kontext Codexu), dvě klasifikace ~145k, samotná odpověď ~173k.
  - Interní požadavek desktopové appky („This is an app-generated request for a suggested next user message…“) se klasifikoval taky (~47k tokenů) a router na něj „applied“ rozhodnutí.

## Kroky

### 0. Zrušit kontrolní skupinu (nejdřív, před A–C)

- [x] 0. Odstranit kontrolní skupinu a měřenou úsporu (60–90 min, kdyžtak rozdělit na jádro + Claude Code a adaptéry). Pryč: volba `holdoutPct` (`plugin.json`, `adapters/codex/install.ts`, `adapters/opencode/install.ts:26`), losování a mlčení (`inHoldout` v `core/router.ts:114`, `placeTask`/`trialExempt`/`heldWhere`/`wantsChange`, pokud je nepotřebuje nic jiného), `trial()` a Welch interval v `core/stats.ts`, sekce „Measured saving“ v `/router stats`, na stránce a v panelu (`core/panel.ts`, `register.tsx`), totéž v `adapters/codex/hook.ts`, `adapters/codex/stats.ts`, `adapters/opencode/prompt-router.ts`, `adapters/opencode/stats.ts`. Zůstává: odhad úspor podle ceníku (chování z 0.9.0). U ostatních novinek z 0.10.0 (odmítnuté nabídky, redo, cena úlohy se subagenty, `scripts/usage-scan.mjs` pro useknuté tahy) ověřit, jestli je odhad používá: co ano, zůstává, co ne, pryč. Staré řádky logu s poli `holdout`, `trial`, `wanted` se musí dál načíst (pole se ignorují). README: sekce „Measured saving: router vs. control“ (ř. 275), volba v Options, FAQ, řádek 0.10.0 v changelogu. Ověření: `grep -rn -i 'holdout\|trial(' plugins adapters README.md` nic nenajde (kromě čtení starých záznamů), testy z „Jak ověřit“ zelené (testy kontrolní skupiny smazat spolu s funkcí, ostatní nesmí oslabit), `/router stats` na skutečném logu ukáže odhad bez chyby.

  Poznámky ke kroku 0 (hotovo):
  - Pryč: volba `holdoutPct` (plugin.json, install.ts v Codexu i OpenCode, README), `inHoldout`, `namesSetting`, `wantsChange`, `trialExempt`, `heldWhere` (router.ts), `placeTask`/`TaskState`, `trial()` s Welchem a celý jeho text (`trialText`, `trialHtml`, `measuredLabel`), mediány kontrolní skupiny, kvartily, ušetřený čas (`minutes`, `timeText`), `classOf`, `moveOf`, `MIN_CONTROL`. Záznamy `spawn` se už nepíšou (sloužily jen trialu), takže cena session spuštěné z úkolu se k úkolu nepřičítá. V Codexu zůstal soubor úkolů jen kvůli `offer` (párování přijaté nabídky) a vypršení po `end`.
  - Zůstalo: váhy re-worku a selhání, části (cheaper/escalation/rework/classifier), přesnost (Wilson), odmítnuté nabídky, redo, náklady úkolu včetně subagentů, `usage-scan.mjs` pro useknuté tahy, `minutesPerTask` v tabulce modelů. `balance()` teď každý routovaný úkol ocení přeceněním tokenů na baseline (jako odhad tokenů), effort se nepřeceňuje.
  - `~` (rough) znamená jen „méně než 12 routovaných úkolů“.
  - Staré řádky logu s `holdout`/`trial`/`wanted`/`wantedWhere` a záznamy `spawn` se načtou a pole se ignorují; rozhodnutí s `holdout: true` je obyčejný keep (test v `stats.test.ts`).
  - Na skutečném logu (720 záznamů, 74 routovaných úkolů) vychází bilance −$7.82.
  - Pro další kroky: krok 2 už nemusí řešit kontrolní skupinu v Codexu (poznámka „i v kontrolní skupině“ odpadá). Krok 8: `namesSetting` už neexistuje. Krok 9: trial už nepáruje session podle prvních 60 znaků `promptKey`, rozhodnutí o zkrácení/hashování je volnější. Klíče `holdoutPct` v `~/.claude/settings.json` a `~/.codex/prompt-router.json` smaže uživatel (konfigurace se v kroku neměnila).
  - Testy: CC 202, node 1, codex 99, opencode 73, shared 6 (smazané jen testy odstraněné funkce).

### A. Codex

- [x] 1. Zlehčit klasifikační `codex exec` (30–60 min). Nejdřív měření: spustit klasifikátor ručně s variantami a zapsat `input`/`cacheRead` z `--json` usage: dnešní argumenty; `+ --ignore-user-config` (bez MCP serverů, pluginů a apps z config.toml, auth zůstává); `+ -c` pro vypnutí AGENTS.md (zjistit klíč, např. `project_doc_max_bytes=0`, v `codex exec --help` / dokumentaci 0.166); `--ignore-rules`. Vybrat nejmenší variantu, která pořád vrací JSON podle schématu. Soubory: `adapters/codex/hook.ts:265-268` (`codexRunner` args). Ověření: unit test na argumenty v `adapters/codex/test/hook.test.ts`; živě jedna klasifikace pod ~10k vstupních tokenů a pod ~4 s (cíl upřesnit podle měření).

  Poznámky ke kroku 1 (hotovo):
  - Měřeno na codex-cli 0.166.0, gpt-6-luna low, skutečný prompt klasifikátoru z hooku (6 kB, „ahoj co umis“), `--json` usage (vstup = input_tokens včetně cached):
    - dnešní argumenty: 22 942 vstup, 0 cached, 7,5 s (plán uváděl 69–75k z desktopu, kde se načítá víc; tady CLI s config.toml),
    - `+ --ignore-user-config` (bez `-c mcp_servers.prompt_router…`, ten bez configu padá „in mcp_servers.prompt_router“): 21 279, 4,2 s,
    - `+ --ignore-rules -c project_doc_max_bytes=0`: bez úspory (AGENTS.md se v dočasném `-C` adresáři stejně nenačítá, globální `~/.codex/AGENTS.md` má 6 řádků); jeden běh 42k kvůli dvěma krokům modelu,
    - `+ -c model_instructions_file=<krátké instrukce>`: 17 843, 4,2 s,
    - `+ -c web_search="disabled"`, `--disable` multi_agent/apps/plugins/browser_use/computer_use/in_app_browser/image_generation/goals/tool_suggest/skill_search, `-c include_*_instructions=false`, `include_environment_context=false`: 12 592, 3,8 s,
    - `+ --disable shell_tool unified_exec view_image sleep_tool` (+ `hooks`): 11 719, 4,0 s. Vybráno. Živě přes nový `codexRunner`: 11 719 (11 520 cached), 4,0 s, JSON podle schématu.
    - Podlaha ~10k zůstává i s promptem „Reply {ok:true}“ (10 169): vnitřní část Codexu, kterou přes config vypnout nejde. `--disable code_mode_host` rozbije běh (model volá nástroj, „code-mode host is disabled“, 47k a 15 s), proto zůstává.
  - Kód: `classifierArgs(o, t, light)` a `needsUserConfig(toml)` v `adapters/codex/hook.ts`, spouštění v `runCodex`. Lehká varianta = `--ignore-user-config --ignore-rules`, vlastní `model_instructions_file` (do dočasného adresáře vedle schématu), vypnuté nástroje a poznámky.
  - Pojistky: neznámý feature flag (`--disable` na jiné verzi Codexu končí „Unknown feature flag“ ještě před voláním modelu) → jeden opakovaný běh s dnešními argumenty. `config.toml` s `model_provider`, `openai_base_url`, `chatgpt_base_url` nebo `[model_providers…]` → rovnou dnešní argumenty (lehká varianta by vlastního providera zahodila).
  - Pro krok 11 (README): klasifikace v Codexu ~11,7k vstupních tokenů (většinou cached) a ~4 s místo ~23k a ~7,5 s.

- [x] 2. Jen jedna klasifikace na prompt (30–60 min). (a) Hook vrací neutrální poznámku vždy, když proběhl, i v kontrolní skupině, u `keep` a při chybě (např. `[Prompt Router: checked]`), aby agent podle AGENTS.md `route` nevolal. Poznámka nesmí prozradit rozhodnutí kontrolní skupiny. (b) `route` v `mcp.ts` nejdřív hledá rozhodnutí hooku pro stejný chat a stejný `promptKey` za posledních ~120 s (`prompt-router-tasks.json` / stats) a vrátí ho bez volání klasifikátoru. (c) Upravit text bloku v AGENTS.md v `install.ts`. Soubory: `adapters/codex/hook.ts:459,493` (návraty `null`), `hook.ts:336`, `adapters/codex/mcp.ts:52`, `adapters/codex/install.ts` (AGENTS.md text). Ověření: unit testy (holdout → poznámka bez rozhodnutí; route s čerstvým rozhodnutím nevolá runner); živě jeden prompt = jeden řádek `pick` v `~/.codex/log/prompt-router.log`.

  Poznámky ke kroku 2 (hotovo):
  - (a) `handle` v `hook.ts` je teď obal kolem `classify`: jakmile se zavolal klasifikátor, vrátí vždy poznámku, u `keep`, „nic k přepnutí“, nečitelné odpovědi i chyby klasifikátoru `CHECKED` = `[Prompt Router: checked, nothing to switch. Answer the prompt as usual and do not mention the router.]` (bez modelu a rozhodnutí, bez systemMessage). Chyba klasifikátoru se už nevyhazuje, jde do logu jako `classifier: …`. `null` zůstává jen tam, kde klasifikace neproběhla (router vypnutý, lomítkový příkaz, prázdný prompt, chyba před klasifikací).
  - (b) Odpověď hooku se ukládá do souboru úkolů (`prompt-router-tasks.json`, pole `last: { key, ts, note }` u chatu). `recentAnswer(home, chat, prompt, now)` ji najde podle `promptKey(typed(prompt))` za posledních `REUSE_MS` = 120 s (chat neznámý → kterýkoli chat). `route` v `mcp.ts` ji vrátí bez klasifikátoru, `CHECKED` přeloží na svoje `GO_ON`. Porovnává se přes `promptKey`, takže krok 9 (hash) to nerozbije.
  - (c) Pravidlo v AGENTS.md (`AGENTS_RULE` v `install.ts`): `route` volat jen bez poznámky „[Prompt Router: …“, s poznámkou ji následovat; nikdy pro odpověď na vlastní otázku ani pro app-generated request. README (tabulka instalace, odstavec o desktopu) upravené. Do `~/.codex/AGENTS.md` se nový text dostane až reinstalací (koordinátor).
  - Testy: 9 asercí `r === null` u klasifikovaných promptů změněno na „neutrální poznámka“ (změna chování, ne oslabení), nové testy na `CHECKED`, `recentAnswer`, `route` bez druhé klasifikace a vypršení po 120 s. Codex 107.
  - Živé ověření (jeden `pick` na prompt v logu) jsem nedělal, vyžaduje reinstalaci adaptéru.

- [x] 3. Přeskočit interní požadavky appky (30 min). Přidat „This is an app-generated request“ (a podobné prefixy appky) do `INJECTED` v `adapters/codex/hook.ts:154` a stejný filtr v `mcp.ts`. Ověření: unit test; živě po tahu v desktopové appce žádný `pick` na tenhle text.

  Poznámky ke kroku 3 (hotovo):
  - V `~/.codex/log/prompt-router.log` i v rolloutech z listopadu je jediný takový prefix „This is an app-generated request for a suggested next user message“ (3× `pick`). Filtr `isAppRequest` v `hook.ts` (`/^\s*This is an? (app|system|automatically)[- ]generated request\b/i`) je o něco širší, jiné prefixy jsem nevymýšlel.
  - Hook: takový prompt vrací `null` (žádná klasifikace, poznámka ani záznam ve stats). Historie (`readHistory`, `textParts`) ho nepočítá mezi uživatelovy prompty. `route` v `mcp.ts` ho odbaví hned `GO_ON` bez hledání rolloutu. `INJECTED` zůstal beze změny, filtr je vedle něj (jeden regex na obou místech).
  - Testy: hook (žádné volání runneru, žádné rozhodnutí; historie), mcp (route bez klasifikátoru). Codex 110.

- [x] 4. Cena v `/router stats` pro Codex (30–60 min). GPT modely nejsou v `core/prices.ts`, stats ukazují $0. Doplnit GPT modely do ceníku (ceny API OpenAI), ať stats ukazují dolary jako v Claude Code. Soubory: `plugins/prompt-router/core/prices.ts`, `core/stats.ts:218-221`, `adapters/codex/stats.ts`. Ověření: `node --test adapters/codex/test/stats.test.ts` s turnem na `gpt-6.1-sol` ukazuje nenulovou cenu nebo tokeny.

  Poznámky ke kroku 4 (hotovo):
  - Ceny z https://developers.openai.com/api/docs/pricing (openai.com/api/pricing vrací 403, platform.openai.com/docs/pricing tam přesměruje), standard tier do 272K vstupu, USD za 1M (vstup / cached vstup / výstup): gpt-6-luna 0,10 / 0,01 / 0,50; gpt-6.1-terra 1 / 0,05 / 5; gpt-6.1-sol 2 / 0,10 / 10; gpt-6-sol 2 / 0,20 / 10; gpt-6-astra 10 / 1 / 50. Všechny čtyři používané modely mají cenu, nic nezůstalo bez ceny.
  - `MODEL_PRICES` v `core/prices.ts`, `priceOf` hledá přesné id (bez ohledu na velikost písmen) nebo id s datovou příponou (`gpt-6.1-sol-2026-09-01`), jinak jako dřív Claude jména. `cacheWrite` = 0: OpenAI zápis do cache neúčtuje zvlášť (zapsané tokeny jsou vstup; Codex hlásí `cache_write_input_tokens` 0). Dlouhý kontext (2×) a Fast mode (dřív Priority, 2×) nejsou započtené, stejně jako Haiku nad 100K, README to říká.
  - `compareWith` v Codexu (`strong-medium`) se teď porovnává s GPT modelem, na který tier míří v `models` (`gpt-6.1-sol`), za jeho cenu OpenAI, ne za Claude cenu Opusu. `routerCommand` v `hook.ts` přemapuje cíl, `statsReport(records, now, c, tier)` v `adapters/codex/stats.ts` píše „priced on gpt-6.1-sol, the strong tier (… OpenAI API list price …)“. `REFERENCE` (Opus medium, jen pro Claude Code) jsem neměnil, Codex ho neukazuje.
  - Na skutečném logu `~/.codex` (3 prompty dnes): Actual $0.09, klasifikátor $0.01, net −$0.01, nic bez ceny.
  - Testy: nový test cen (CC 203), Codex test compareWith přepsaný na GPT ceny (dřív testoval „Codex modely zůstávají bez ceny“, což je teď naopak), v testu tabulky nahrazen nepřeceněný model `gpt-6-luna` za `gpt-5-codex` (pořád testuje model bez ceny), nový test `/router stats` s `compareWith: strong-medium`. Codex 111.
  - README: odrážka Codex v Savings stats přepsaná.

- [x] 5. Windows pro Codex (30–60 min). `codexBin` hledá `codex` bez `.cmd`/`.exe` (`hook.ts:257`), `isOurs` regex nezná zpětná lomítka (`install.ts:122`, druhý install vytvoří duplicitu a uninstall nic nenajde), quoting příkazu přes `JSON.stringify` (`install.ts:112`). Ověření: unit testy s `path.win32` cestami a `process.platform` přes deps.

  Poznámky ke kroku 5 (hotovo, jen unit testy, na Windows nespuštěno):
  - `codexBin(env, places?, platform, exists)` v `hook.ts`: na Windows hledá `codex.exe` a `codex.cmd` v `PATH`/`Path` (oddělovač `;`, `path.win32`), jinak `%APPDATA%\npm\codex.cmd`. Nový `codexSpawn(bin, platform, exists, node)`: npm shim `codex.cmd` spouští jako `node <složka>\node_modules\@openai\codex\bin\codex.js` (Node `.cmd` bez shellu nespustí a cmd.exe by rozbil argumenty); jen shim bez balíčku vedle jde přes `shell: true` (tam by cesty s mezerou v argumentech mohly selhat). Na Windows `detached: false` (jinak by naskočilo okno konzole) a `windowsHide: true`; zabíjení po timeoutu tam padne na `child.kill`, které vnuka za shellem nezabije.
  - `install.ts`: `command(hook, platform, node)` na Windows dává cesty v obyčejných uvozovkách (cmd.exe nezná JSON escapy), POSIX beze změny (`JSON.stringify`, ať se stávajícím instalacím nemění příkaz a Codex nežádá znovu o trust). `isOurs` (teď exportovaný) pozná `adapters[\\/]+codex[\\/]+hook.ts`, tedy i zdvojená lomítka ze starého JSON quotingu. `install(home, now, hook, platform)`.
  - Nejistota: nevím, jestli Codex na Windows spouští hook přes cmd.exe, nebo PowerShell. V PowerShellu by `"C:\…\node.exe" "…hook.ts"` byl jen řetězec (chtělo by `& "…"`). Ověřit při prvním běhu na Windows.
  - Testy: Windows `codexBin`, `codexSpawn`, `command`, `isOurs` a dvojí install + uninstall s Windows cestou (jeden záznam, pak žádný). Codex 116.


### B. Claude Code

- [x] 6. Statistiky a log bez ztrát při paralelních sessions (30–60 min). `flush()` a `log()` dělají read-modify-write bez zámku a `pending` se maže před zápisem. Varianta: append-only zápis nových řádků (zjistit, jestli `$.fs` má append), rotace jen občas se zápisem přes tmp + rename (jako `scripts/usage-scan.mjs:59-60`); `pending` mazat až po úspěšném zápisu. Soubory: `plugins/prompt-router/hooks/register.tsx:84-92`, `register.tsx:545-556`, `core/stats.ts` (`rotate`). Ověření: test se dvěma souběžnými `flush()`, oba záznamy v souboru; `claude plugin test plugins/prompt-router`.
  Poznámky ke kroku 6 (hotovo):
  - `$.fs` umí jen `read`/`write`/`list`/`exists`/`stat`/`ancestors`, žádný append ani rename. Proto zápis přes `$.process.run(['node', scripts/append.mjs, <soubor>, stats|tail], { stdin })`: zámek = adresář `<soubor>.lock` (`mkdir` je atomický, čeká až 5 s, zámek starší než 30 s se bere jako opuštěný), `appendFile`, pak ořez jen když je potřeba (stats: první řádek starší než 90 dní nebo nad 5 MB → `rotate` z `core/stats.ts` na 80 % limitu, tmp + rename; chybový log: nad 40 kB → posledních 20 kB). Exit 0 = řádky jsou v souboru, i když ořez selže.
  - Bez Node (nebo nenulový exit) se zapisuje postaru přepsáním celého souboru, ale v rámci jednoho procesu jeden zápis po druhém; mezi paralelními sessions se tam pořád může něco ztratit.
  - `pending` je `Pending<Entry>` v `core/stats.ts`: flush jeden po druhém, záznam odchází až po úspěšném zápisu, při chybě zůstává do dalšího flushe (strop 5000, pak nejstarší pryč).
  - Testy: CC `Pending` (dva souběžné flushe, neúspěšný zápis, strop), `needsRotate`; node `test/node/append.test.mjs` (dva procesy najednou, 30 zápisů najednou, rotace přes tmp, tail). CC 207, node 5.

- [x] 7. Domovská složka bez `split('/.claude/')` (30 min). Brát HOME/USERPROFILE a `CLAUDE_CONFIG_DIR` z prostředí modu (zjistit, co `$` nabízí), ne z cesty pluginu; před `session.start` nezapisovat do `/.claude/mods-logs`. Soubory: `register.tsx:35`, `register.tsx:847`. Ověření: unit test s Windows rootem (`C:\Users\x\.claude\plugins\…`) a s vlastním config direm.
  Poznámky ke kroku 7 (hotovo):
  - `$.env.get` je k dispozici (jména musí být literály, `claude plugin validate` je vypíše: `CLAUDE_CONFIG_DIR`, `HOME`, `USERPROFILE`). `claudeDir()` v `core/router.ts`: `CLAUDE_CONFIG_DIR` (bez koncových lomítek), jinak `HOME`, pak `USERPROFILE` + `.claude` (oddělovač `\` jen u čistě Windows cesty), jinak složka `….claude` z cesty pluginu (i se zpětnými lomítky), jinak ''.
  - `register.tsx`: `home` → `configDir` (nastaví `session.start`), cesty `${configDir}/mods-logs/…`, `/projects`, `/settings.json`. Před `session.start` `log()` ani `flush()` nic nezapisují (dřív `/.claude/mods-logs` v kořeni disku).
  - README: stats log pod `CLAUDE_CONFIG_DIR`, když je nastavený. Testy: `claudeDir` (config dir, Windows root, HOME, nic). CC 208.

- [x] 8. Rychlá cesta bez klasifikátoru (30–60 min). „yes“, „ok“, „d“, „option 2“, čísla a velmi krátké odpovědi na otázku agenta → `keep` bez volání modelu. Sdílené pro všechny platformy v `core/router.ts`, napojit v `register.tsx:576-591`, `adapters/codex/hook.ts`, `adapters/opencode/prompt-router.ts`. Ověření: unit testy (žádné volání runneru); živý eval `test/cases.json` případy `yes`, `option2`, `thanks`, `cz_yes`, `es_yes` dál `keep`; README ř. 96 a 592 sedí s kódem.
  Poznámky ke kroku 8 (hotovo):
  - `quickReply(text)` v `core/router.ts`: malá písmena, bez diakritiky, nejvýš 40 znaků a 5 slov; každé slovo musí být ze seznamu `QUICK_WORDS` (ano/ne/ok/díky/pokračuj… v angličtině, češtině, španělštině, němčině a francouzštině, plus „option/možnost/opción/variant(a/e)“), číslo do 3 číslic nebo jedno písmeno. Samé emoji nebo interpunkce taky projde. Ne: cokoli s vlastním slovem, znak re-worku (`isRedo`: „nefunguje“, „still wrong“), lomítkový příkaz.
  - Napojení: CC `decide()` vrátí prompt beze změny (žádný záznam rozhodnutí, jako dřív bez klasifikátoru). Codex hook vrátí `CHECKED` a uloží ho pro `route` (agent tak `route` nevolá), `route` v `mcp.ts` vrací rovnou `GO_ON`. OpenCode `decide()` skončí bez poznámky. Nástroj `test` (eval) dál volá klasifikátor, měří ho, ne rychlou cestu.
  - `test/cases.json`: `yes` („yes, go on“), `option2`, `thanks` („thanks!“), `cz_yes` („ano, pokračuj“), `es_yes` („sí, hazlo“) jdou všechny rychlou cestou → keep (unit test). Živý eval jsem nespouštěl (stojí tokeny).
  - Testy: 7 existujících testů používalo jako zástupný prompt „p“, „x“, „ok“, „go on“, „yes, go on“ a čekalo volání klasifikátoru; zástupné prompty změněné na věcné („fix it“, „and the readme“), aserce beze změny. Nové testy: `quickReply` ano/ne, CC/Codex hook/`route`/OpenCode bez volání klasifikátoru. CC 211, Codex 118, OpenCode 74.
  - README: odstavec o schválení (ř. ~96), „one small classifier call per prompt“ a cena klasifikátoru zmiňují výjimku.

- [x] 9. Soukromí ve statistikách (30 min). `promptKey` ukládá 200 znaků promptu na 90 dní (`register.tsx:499`, `register.tsx:1063`). Podle rozhodnutí níže zkrátit nebo hashovat (trial páruje session podle prvních 60 znaků, commit d45e3d9), a popsat v README v sekci Savings stats, co se ukládá.

  Poznámky ke kroku 9 (hotovo):
  - Rozhodnutí uživatele: hash. `promptKey` = prvních 16 hex číslic SHA-256 normalizovaného promptu (trim, malá písmena, mezery sloučené), bez zkrácení na 200 znaků. SHA-256 v čistém JS (`core/hash.ts`, synchronní; prostředí modu nemá `node:crypto`), node test proti `node:crypto` (čeština, emoji, hranice bloků).
  - Porovnávání beze změny (všude jen rovnost klíčů): `startsTask`/episody a „repeated“ ve stats, `recentAnswer` v Codexu (`last.key` v souboru úkolů), OpenCode. Staré řádky s textovým klíčem se načtou, ale s novým hashem se nikdy neshodují: prompt zopakovaný přes upgrade se nebere jako opakování (test v `stats.test.ts`); staré klíče zmizí s 90denním ořezem.
  - README, Savings stats: co přesně obsahují řádky decision / turn / accept, že text promptu ani odpovědi se neukládá a že krátký běžný prompt jde z hashe uhodnout zkoušením.
  - Mimo rozsah, k rozhodnutí: Codex `~/.codex/log/prompt-router.log` (ladicí log) dál zapisuje u každého `pick` prvních 60 znaků promptu a 200 znaků odpovědi klasifikátoru (`hook.ts`, `log(home, 'pick', …)`).
  - Testy: CC 213, node 6.


### C. OpenCode

- [ ] 10. První živý běh (60 min, jen se souhlasem s instalací OpenCode). Nainstalovat OpenCode, porovnat použité hooky a klienta (`chat.message`, `chat.params`, `client.session.*`, `client.tui.showToast`) s typy `@opencode-ai/plugin`/`@opencode-ai/sdk`, opravit názvy a tvary, upravit mock v `adapters/opencode/test/helpers.ts:34-50` podle skutečných odpovědí. Cesty konfigurace přes `XDG_CONFIG_HOME` a Windows (`install.ts:36`, `prompt-router.ts:103-104`), import shimu na Windows přes `file://` URL (`install.ts:40-43`). Ověření: plugin se načte, jeden prompt zaloguje rozhodnutí, `router_stats` vrátí tabulku; `node --test adapters/opencode/test/`.

  Přeskočeno: instalace OpenCode čeká na souhlas uživatele.

### D. Vydání

- [x] 11. Dokumentace (30 min). README: odznak verze, počty testů (410) a případů evaluace (132), řádek „Unreleased“ v changelogu patří k 0.9.1, řádek o ceně klasifikátoru v Codexu podle měření z kroku 1, tabulka Status.

  Poznámky ke kroku 11 (hotovo):
  - Odznaky: verze 0.10.0, testy 417 (CC 213, node 6, Codex 118, OpenCode 74, shared 6), eval 132 případů. Poslední živý eval (Sonnet 369/369, Opus 123/123, Haiku 114/123) běžel na 123 případech; README to tak říká, 9 novějších živě nespuštěno.
  - Changelog: „Unreleased“ → 0.9.1, doplněný řádek 0.9.2 (panel), 0.10.0 přepsaný na celou větev (odhad podle ceníku, rychlá cesta, hash promptu, Codex: jedna klasifikace, lehký klasifikátor ~12k/4 s místo 23k/7,5 s, přeskočené požadavky appky, ceny GPT, Windows; CC: paralelní sessions, config složka).
  - Cena klasifikátoru v Codexu (Accuracy and cost, sekce Codex) podle kroku 1. Status: Codex Windows jen unit testy, OpenCode nikdy živě. OpenCode varování 70 → 74 testů, požadavky Codexu zmiňují Windows. Věta o starých záznamech `holdout`/`trial`/`wanted` přepsaná (vývojové buildy 0.10.0, ne vydání).
- [x] 12. `/done`, verze, commit (navazuje na otevřený krok 7 v `measured-savings.md`).

  Poznámka k verzi:
  - Verze zůstává 0.10.0: commit 8c9ec91 „Release 0.10.0“ nebyl nikdy pushnutý, takže celá práce této větve patří do 0.10.0. `marketplace.json` i `plugin.json` už 0.10.0 mají, nic se neměnilo.
  - `/done` (velká feature, 8c9ec91..HEAD): testy OK (CC 213, node 8, codex 119, opencode 74, shared 6); check-tests: smazané assertions mají náhradu podle změněného chování (poznámka `checked` místo `null`, nové argumenty klasifikátoru, ceny GPT, prompt `x` jde rychlou cestou); tsc SKIP (TypeScript v prostředí není); UI SKIP (bez zařízení, panel ověří uživatel ručně).
  - Code review high: opraveno v ceaf25d (append.mjs na Node bez `import.meta.main`, bez type strippingu se log nerotoval, `--ignore-user-config` ztrácel nastavení přihlášení), simplify c2a5434, text poznámky `checked`/`GO_ON` v Codexu říká provést odpověď na vlastní otázku agenta (996ae4f, dřív „do not mention the router“ mohlo přejít odpověď „1“).
  - Nechané nálezy (na později): zámek v `scripts/append.mjs` (stale 30 s vs. čekání 5 s), dvojí zápis při zabití po timeoutu 15 s, `adapters/codex/stats.ts` zapisuje bez zámku, Codex debug log `~/.codex/log/prompt-router.log` ukládá 60 znaků promptu.
  - Neověřeno živě: krok 2 a 3 v Codexu (jeden `pick` na prompt), Windows, OpenCode.

## Rozhodnutí, která čekají na uživatele

- Instalovat OpenCode kvůli kroku 10?

## Rozhodnutí

- Kontrolní skupina (holdout) a měřená úspora se ruší úplně, úspory jen jako odhad podle ceníku (pokyn uživatele 2026-11-06, krok 0). Do té doby je vypnutá v nastavení: `holdoutPct: "0"` v `~/.claude/settings.json` a `~/.codex/prompt-router.json`; po kroku 0 tyhle klíče smazat. Verze 0.10.0 (krok 7 v `measured-savings.md`) se tím mění: changelog 0.10.0 přepsat podle toho, co z ní zůstane.
- Codex se má chovat stejně jako v Claude desktop (pokyn uživatele 2026-11-06): stejné funkce i výchozí hodnoty a statistiky v dolarech podle ceníku API OpenAI (krok 4). Kde Codex pluginu něco nedovolí (sám přepnout model nebo effort), co nejbližší náhrada a v README to přiznat.
- Codex: obě vrstvy proti dvojí klasifikaci (poznámka z hooku i deduplikace v `route`), protože desktopová appka teď spouští hook i MCP nástroj.
- Rychlá cesta patří do `core/router.ts`, aby se platformy nerozešly.
- `promptKey` se ukládá jako hash, ne text (pokyn uživatele 2026-11-06, krok 9).

## Paralelně

Krok 0 udělej první a samostatně, protože sahá do stejných souborů jako A, B i C. Potom jsou bloky A (Codex), B (Claude Code) a C (OpenCode) na sobě nezávislé a můžou běžet jako samostatné sessions ve vlastních worktree. Výjimka: krok 8 sahá do všech adaptérů a do `core/router.ts`, takže ho dělej až po A a C, nebo v jedné session s nimi.

## Jak ověřit

Z kořene repa: `claude plugin test plugins/prompt-router`, `node --test plugins/prompt-router/test/node/`, `node --test adapters/codex/test/`, `node --test adapters/opencode/test/`, `node --test adapters/shared/test/`. Živě: `~/.codex/log/prompt-router.log` (jeden `pick` na prompt), `~/.codex/log/prompt-router-stats.jsonl` (`classifier.usage`), časová osa z rolloutu v `~/.codex/sessions/`.
