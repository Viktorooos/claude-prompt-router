# Vypínač pro každou funkci routeru, srozumitelné názvy voleb (0.8.0)

Větev `feat/here-other-model-adapters` (navazuje na v0.7.0). Na větvi už je necommitnutá funkce „here na jiném modelu“ pro Codex a OpenCode: codex 50/50, opencode 36/36.

## Rozhodnutí (schválil uživatel)
Každá funkce má vlastní volbu. Výchozí hodnota zachovává dnešní chování. Volby žijí ve sdíleném `core/router.ts` (`Config`, `toConfig`), takže platí stejně pro Claude Code, Codex i OpenCode.

| Nový název | Hodnoty (výchozí první) | Dřív | Co řídí |
|---|---|---|---|
| `effortDetection` | ask, auto, off | `effortMode` (bez off) | effort u promptu, který zůstává tady |
| `firstChatDetection` | ask, auto, off | `modelMode` | model u prvního promptu chatu |
| `midChatModelDetection` | ask, auto, off | (přes `modelMode: off`) | pozdější prompt sedí jinému modelu → Subagent / Stay here |
| `subagentSuggestions` | ask, off | – | nabídka subagenta na samostatný úkol |
| `sessionSuggestions` | ask, off | – | nabídka nové session |
| `notifications` | on, off | – | toast po automatické změně a štítek v patičce (Codex: systémová zpráva) |

- **Staré klíče se čtou dál:** `effortMode` a `modelMode` platí, když nový klíč chybí. Stávajícím uživatelům se nic nerozbije. `/router` upozorní, že je dobré klíč přejmenovat (podobně jako dnes u klíče `prompt-router`).
- `modelMode: off` ve staré konfiguraci vypne obě funkce, `firstChatDetection` i `midChatModelDetection`. Přesně tak to fungovalo v 0.7.0.
- **effortDetection off:** router effort nikdy nenastaví ani nenabídne. V otázkách „Do it here“ a „Stay here“ zůstane jen jedna možnost bez úrovně.
- **subagentSuggestions off:** z „subagent“ se stane „here“. Pak se uplatní effort a, pokud je zapnutá, nabídka jiného modelu.
- **sessionSuggestions off:** ze „session“ se stane „here“.
- **midChatModelDetection auto:** žádná otázka, agent rozhodne sám: subagent jen u většího samostatného úkolu, který potřebuje jiný model (těžký návrh/debug na slabším modelu, dlouhá mechanika na silném); rychlá otázka, krátká odpověď nebo zpráva zůstane tady. Zůstat tady = effort podle `effortDetection` (auto přepne, ask se ptá jen na effort, off nic). Model chatu se nemění; nakonec jedna věta, co zvolil. Codex desktop (MCP, bez spawn_agent) funkci dál vynechává.
- **notifications off:** žádný toast a žádný štítek v patičce. Model a effort se nastavují dál.

## Kroky
✅ 1. Testy (padají): core `toConfig` (nové klíče, staré jako záloha, neplatné hodnoty → výchozí) a v každé platformě testy, že `off` danou funkci opravdu vypne. Existující testy neoslabovat; testy, které používají staré názvy, smí zůstat (ověřují zpětnou kompatibilitu).
   Hotovo: CC +22 (76), Codex +9 (59), OpenCode +9 (45); nové před implementací padaly. Volby se čtou stejnou cestou jako naostro (pluginConfigs `prompt-router@prompt-router`, krátký klíč, soubory voleb Codex/OpenCode).
✅ 2. Core + Claude Code (`plugin.json` userConfig s novými názvy a popisy, `register.tsx`).
   Hotovo: core `SWITCHES`, `toConfig`, `optionSources`, `describeOptions`, `optionsLine`, `allowed()`. `register.tsx` `loadOptions`: přepínač na výchozí hodnotě od enginu ustoupí starému klíči, pokud ho settings.json výslovně neuvádí. `/router` vypíše všechny volby s původem; log `effective options` jednou za session i s cestou kopie modu.
✅ 3. Codex (`hook.ts`, `notes.ts`, `mcp.ts`, `install.ts` výchozí config) a OpenCode (`prompt-router.ts`, `notes.ts`, `install.ts`).
   Hotovo. Codex: notifications off = bez systemMessage u auto řádku, log voleb u prvního promptu chatu. OpenCode: log voleb při načtení pluginu. MCP serverInfo 0.8.0.
✅ 4. README:
   - tabulka voleb (název, hodnoty, výchozí, co dělá, kam ji dát na každé platformě) v Concepts → Options;
   - sekce Options u každé platformy s novými názvy;
   - poznámka o starých názvech;
   - řádek „Here on another model“ v tabulce funkcí na ✅ pro všechny tři platformy;
   - changelog 0.8.0, počty testů;
   - verze 0.8.0 v `plugin.json` a `marketplace.json`.
   Hotovo: tabulka voleb + kam je dát, poznámka o starých názvech, srovnání, changelog 0.8.0, počty 76/59/45 = 180, verze 0.8.0.
✅ 5. Ověření: 4 příkazy z „Hotovo“ v plánu `subagent-for-lower-model.md` + `check-tests.sh`, code review medium.
   Hotovo: 4 příkazy a kontrola ochrany testů OK (přes test-runner). Code review medium neproběhlo.
✅ 6. midChatModelDetection auto (dodatek od koordinátora): testy napřed (padaly), `SWITCHES` + `DECIDE_OTHER`/`TOLD_OTHER` v core, `otherAutoNote` v `register.tsx`, `codex/notes.ts`, `opencode/notes.ts`, volba v `plugin.json`, README tabulka a počty.
   Hotovo: CC +3 (79), Codex +3 (62, z toho 1 desktop v mcp.test), OpenCode +2 (47) = 188. Všechny sady a validate OK.
