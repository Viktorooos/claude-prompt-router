# Context Guard: návrh modu, který hlídá kontext a předání práce

Stav: návrh, čeká na rozhodnutí uživatele (sekce Otevřená rozhodnutí). Nic není implementované.

## Proč

Dnešní hook `~/.claude/hooks/context-handover.sh` (+ `context_handover.py`) běží v `PostToolUse`.
Každý práh ohlásí **jednou za session** jako `additionalContext` a dál nic nekontroluje.
Když Claude pokyn přehlédne nebo odloží, nikdo si toho nevšimne: uživatel stav nevidí
a hook se už neozve. Mod to řeší tak, že stav ukazuje sám (bez Clauda), připomíná, dokud
se úkol nesplní, a sám ověří, jestli soubor se stavem opravdu vznikl.

## Co API umí (ověřeno v typech, build 2.1.309)

| Potřeba | Jde? | Jak |
| --- | --- | --- |
| Počet tokenů v kontextu | ano | `$.session.usage()` → `context.tokens`, `window`, `percent` (stejná čísla jako stavová řádka, volání nic nestojí). Událost `session.measure` je posílá sama po každém tahu hlavního vlákna. |
| Počet zhuštění | ano | Hook `session.compact`: `await next(e)` vrátí `{ messages }` (proběhlo) nebo `{ skip }`. Počítat jen `trigger` `auto`/`manual`/`plugin`, ne `precompute`, a jen bez `agentId` (hlavní konverzace). Po reloadu modu jde počet dopočítat z `$.session.messages()` (notice `compact_boundary`). |
| Ovlivnit, co zhuštění zachová | ano | V `session.compact` `next({ ...e, instructions })`: např. „zachovej cestu ke stavu `<soubor>` a seznam otevřených kroků“. Dnes hook nic takového neumí. |
| Pokyn pro Clauda u promptu | ano, s omezením | `prompt.submit`: pole `context` se **v desktop aplikaci k modelu nedostane** (zjištěno v Prompt Routeru, `register.tsx:450`), poznámka se musí přilepit k textu promptu `[…]`, uživatel ji pak vidí v přepisu. |
| Pokyn uprostřed dlouhého tahu | ano | Hook `tool.call`: `const r = await next(e)` a vrátit `{ ...r, context: [pokyn] }`. Je to přesná náhrada `PostToolUse.additionalContext`, model to čte, uživatel ne. Důležité pro `/proved` a dlouhé tahy, kde uživatel nic nepíše. |
| Tvrdé vynucení | ano | Hook `tool.call` může vrátit `{ deny: "…" }`, tedy odmítnout třeba `Edit`/`Write`, dokud nevznikne soubor se stavem. Silné, ale možné (viz rozhodnutí 3). |
| Stav na stavové řádce | ano | `$.ui.status(text)` z jakéhokoli hooku (např. `ctx 152k · 1× zhuštěno`). |
| Pruh nad promptem | ano | `ui.render` na `{ component: 'AbovePrompt' }`. V desktopu ověřit (krok 1). |
| Toast | ano | `$.ui.toast(text)`. |
| Zápis souboru se stavem | ano | `$.fs.write(path, text)`, `$.fs.exists`, `$.fs.stat` (mtime). Mod umí zapsat kostru a ověřit, že ji Claude vyplnil. |
| Sám spustit novou session | **nejisté, ověřit pokusem** | Žádné `$.session.start` není. `$.agent.spawn` dělá jen subagenta. Cesty, které zbývají: `$.tool.call({ tool: "mcp__ccd_session__start_session", … })` (projde permission check jako volání modelu) nebo `$.mcp.call("ccd_session", "start_session", …)`. Aplikace ale u `initiation: "user_asked"` hlídá, že o to požádal uživatel, a u tahu, který nezačal uživatel, start odmítá. Pravděpodobně projde jen `own_initiative` = karta, na kterou uživatel klikne. `$.session.send` umí poslat zprávu existující session. |
| Odlišit subagenty | ano | `tool.call` a `session.compact` nesou `agentId`; bez něj je to hlavní vlákno. |

## Co mod dělá

Prahy se dají nastavit (`userConfig`), výchozí hodnoty jsou jako dnes:

| Úroveň | Kdy | Co mod udělá sám (mechanicky) | Co chce po Claudovi |
| --- | --- | --- | --- |
| 0 OK | < T1 | Stavová řádka `ctx 85k`. | nic |
| 1 Zapsat stav | ≥ T1 = 150k | Řádka zežloutne `ctx 152k · zapiš stav`, jeden toast. Založí kostru stavového souboru (hotové / zbývá / soubor:řádek / pasti / jak ověřit), pokud ještě není. | Vyplnit stav a pokračovat v práci. |
| 2 Předat | ≥ T2 = 400k **nebo** 2. zhuštění | Pruh nad promptem „Předej práci“ s cestou ke stavu, toast. | Dokončit logickou část, aktualizovat stav, předat práci nové session. |

Kontrola, že se pokyn splnil (to dnes chybí):

- Splněno u úrovně 1 = stavový soubor existuje a jeho `mtime` je novější než okamžik, kdy úroveň začala, a kostra je vyplněná (nezůstaly prázdné nadpisy).
- Dokud splněno není, mod připomíná: po každých N voláních nástrojů (výchozí 15) a u každého promptu. Jednou za session, jako dnes, to není.
- Stav úrovně zůstává v `$.state` (přežije reload modu) a do `$.store` pod id session (přežije restart).
- Po zhuštění se úroveň 1 obnoví (stejně jako dnes), počet zhuštění ne.
- Při zhuštění mod do `instructions` vloží cestu ke stavovému souboru, takže ji souhrn nezahodí.

Co zůstává na Claudovi (mechanicky to zajistit nejde):

- Obsah stavu (co je hotové, pasti, proč se co rozhodlo). Mod umí jen ověřit, že soubor je vyplněný.
- Kdy přesně přestat: „dokonči rozdělanou logickou část“ je úsudek.
- Spuštění nové session, pokud pokus v kroku 1 ukáže, že mod sám `start_session` nespustí. Pak mod aspoň zařídí, že uživatel vidí pruh „Předej práci“ a jedno tlačítko / příkaz `/predat`, který Claudovi pošle prompt s přesným pokynem. Tím se z toho stane akce uživatele, ne Claudova poslušnost.
- Pravidla `/proved` (podkrok commitne a skončí řádkou `PŘEDÁNÍ:`, koordinátor spustí session). Mod pozná podkrok jen nepřímo; text pokynu zůstane jako dnes, jen ho mod připomíná, dokud nevidí splnění.

## Jak nahradí hook

1. Mod běží vedle hooku v režimu „jen ukazuj“ (stavová řádka, pruh, žádné pokyny), dokud se neověří, že čísla sedí s `context_handover.py` (log `~/.claude/state/handover/log.jsonl` a log modu).
2. Pak se v modu zapnou pokyny a hook se ze `settings.json` (`PostToolUse`) odebere. **Jen se souhlasem uživatele.**
3. Texty pokynů se převezmou z `context_handover.py` (HANDOVER, úrovně 1–3), aby se chování neměnilo.
4. Sekce Kontext v `~/.claude/CLAUDE.md` se zkrátí: místo popisu hooku stačí „Context Guard ukazuje stav a připomíná; když ohlásí předání, řiď se jeho textem“. Trvalý pokyn „spusť session bez ptaní“ zůstane, protože ho mod nemusí umět. **Jen se souhlasem.**
5. `HANDOVER_T1` / `HANDOVER_T2` z prostředí mod přečte jako výchozí hodnoty, takže stávající nastavení zůstane.

## Jak se nepoplete s Prompt Routerem

Kdo co dělá:

- **Router** rozhoduje o **novém promptu**: patří sem, subagentovi, nebo do nové session? Nad 60k posílá nesouvisející prompty do nové session. Současná práce zůstává tady.
- **Guard** rozhoduje o **současné práci**: je chat tak velký, že se musí přestěhovat? Na nový prompt se nedívá.

Kde se můžou střetnout: chat je nad T2 a uživatel napíše nesouvisející prompt. Router řekne „pošli tenhle prompt do nové session“ a Guard „zapiš stav a předej práci“. Uživatel by dostal dvě otázky najednou.

Pravidla:

1. **Pokyn u promptu pošle nejvýš jeden mod.** Guard u promptu nic nepřidá, když Router už k textu přidal svou poznámku (`[Prompt Router suggests …`). Nesouvisející prompt vyřeší Router a Guard se připomene až u dalšího volání nástroje (`tool.call`), tedy v práci, která do chatu patří.
2. **Guard nikdy neodpovídá na „kam s promptem“** a nepoužívá AskUserQuestion u promptu, takže se nekříží s Routerovým dialogem.
3. **Router ví o Guardu** (volitelné, vyžaduje změnu Routeru se souhlasem): Guard zveřejní svou úroveň v `$.state` (`contextGuard.level`), Router ji přes `dependencies` přečte. Na úrovni 2 Router přestane nabízet „zůstat tady“ jako doporučenou volbu, protože chat se stejně stěhuje.
4. **Pořadí hooků** `prompt.submit` mezi dvěma pluginy v typech popsané není. Pravidlo 1 funguje, jen když Guard běží *po* Routeru (vidí jeho text). Ověřit v kroku 1. Když to nepůjde, platí jednodušší pravidlo: Guard u promptu pokyny nevkládá vůbec a mluví jen přes `tool.call` a UI.
5. Stavová řádka: Router si ji půjčuje jen na chvíli (`prompt router…`), Guard ji drží trvale. Každý plugin má vlastní řádek, takže se nepřepisují. Ověřit v desktopu.

## Kroky implementace (každý 30–60 min)

- [ ] **1. Pokus: co opravdu projde (spike).** Minimální mod v `~/.claude/dev-mods/…/context-guard/`: `session.measure` → `$.ui.status`, `AbovePrompt` pruh, `session.compact` čítač, `tool.call` s `context`. Vyzkoušet `$.tool.call` / `$.mcp.call` na `start_session` (s `user_asked` i `own_initiative`) a pořadí `prompt.submit` vůči Routeru. Soubory: `register.tsx`, `plugin.json`, `hooks.json`. Hotovo = zapsané výsledky (co jde a co ne) do tohoto plánu.
- [ ] **2. Kostra modu a stav.** Repo/složka podle rozhodnutí 1, `types/index.d.ts` s `PluginState.contextGuard` (`level`, `compactions`, `levelSince`, `stateFile`, `nudges`), `userConfig` (prahy, interval připomínek, cesta ke stavu), výpočet úrovně jako čistá funkce. Ověření: `claude plugin validate`, `tsc -p`, unit testy výpočtu úrovně (prahy, reset po zhuštění, 2. zhuštění) v `*.test.ts` přes `claude plugin test`.
- [ ] **3. Zobrazení.** Stavová řádka (vždy), pruh nad promptem (úroveň ≥ 1), toast při přechodu úrovně. Ověření: test renderu + ruční pohled v desktopu.
- [ ] **4. Stavový soubor a kontrola splnění.** Kostra souboru, kontrola `mtime` a vyplnění, připomínání přes `tool.call` po N voláních a u promptu podle pravidel s Routerem. Texty převzaté z `context_handover.py`. Ověření: testy (soubor chybí / starý / vyplněný), subagenti přeskočeni.
- [ ] **5. Zhuštění.** `instructions` s cestou ke stavu, čítač, obnova po reloadu z `compact_boundary`. Ověření: test se simulovaným `session.compact`, ručně `/compact` v testovací session.
- [ ] **6. Předání.** Podle výsledku kroku 1: buď mod spustí session sám, nebo příkaz `/predat` + tlačítko v pruhu, které pošle Claudovi pokyn k předání. Ověření: ruční průchod v desktopu.
- [ ] **7. Souběh s hookem a přechod.** Režim „jen ukazuj“, porovnání s logem hooku pár dní; potom (se souhlasem) odebrat hook ze `settings.json` a zkrátit `CLAUDE.md`. Volitelně úprava Routeru (pravidlo 3).

## Otevřená rozhodnutí

1. **Kde mod bude:** vlastní repo `~/.claude/mods-src/context-guard` (doporučeno, oddělené od Routeru), nebo druhý plugin v marketplace tohoto repa.
2. **Kam zapisovat stav:** pevně `docs/plans/<větev>-handover.md` v projektu, scratchpad session, nebo nechat jako dnes na Claudovi (mod pak kontroluje jen „nějaký soubor změněný po prahu“, což je slabší).
3. **Tvrdé vynucení:** má mod na úrovni 2 odmítat `Edit`/`Write` mimo stavový soubor, dokud stav není zapsaný? Spolehlivé, ale může zdržet dokončení rozdělané věci.
4. **Prahy:** nechat 150k / 400k / 2 zhuštění, nebo je navázat na procento okna (`percent`), aby fungovaly i u modelů s jiným oknem.
5. **Úprava Routeru:** má Router číst úroveň Guardu (pravidlo 3), nebo stačí, že Guard ustoupí sám (pravidlo 1)?
6. **Poznámka v textu promptu:** v desktopu je poznámka viditelná v přepisu. Vadí to, nebo má Guard u promptu mlčet a mluvit jen přes `tool.call` a UI?

## Stav implementace (2026-10-30, předávací poznámka)

Uživatel řekl „udělej to a pořádně otestuj“. Rozhodnutí, která jsem zvolil sám (výchozí, dají se změnit v `userConfig`):

- Mod: vlastní složka `~/.claude/mods-src/context-guard` s vlastním `marketplace.json` (stejně jako Router). Necommitovat, neinstalovat a neměnit `settings.json` bez souhlasu.
- Stavový soubor: `~/.claude/state/context-guard/<sessionId>.md` (absolutní cesta přes `$.env.get('HOME')`). Mod zapíše kostru s `<!-- vyplň -->`. Splněno = soubor změněný po vstupu do úrovně a bez značek.
- Guard u promptu mlčí, Claudovi píše jen přes `tool.call` → `{ ...r, context: [pokyn] }`. Tím se nikdy nesrazí s Routerem. Router se nemění.
- Úrovně: 0 / 1 (≥ T1 150k) / 2 (≥ T2 400k nebo ≥ 2 zhuštění). Prahy z `userConfig`, výchozí z `HANDOVER_T1/T2`.
- Subagenti (`e.agentId`) se přeskakují v `tool.call` i `session.compact`. `precompute` se nepočítá.
- `handoverMode` auto (výchozí) / ask / off. Auto: na úrovni 2, po splnění stavu a na `turn.complete` hlavního vlákna mod sám zavolá `$.tool.call({ tool: 'mcp__ccd_session__start_session', initiation: 'user_asked', context: 'fresh', use_worktree: false, title, prompt: 'pokračuj podle <soubor>', background })`, záložně `$.mcp.call('ccd_session','start_session',…)`. Když poslední odpověď obsahuje řádku `PŘEDÁNÍ:` (podkrok `/proved`), nespouští nic. Při selhání: toast a pruh s tlačítkem „Předat“, které volá totéž s `consent` (stisk uživatele).
- Pořadí `SessionMessage` nemá notice `compact_boundary`, takže počet zhuštění se drží v `$.state` (přežije reload) a v `$.store` pod id session.
- Testy: `claude plugin test` (kit `claude-code/testing`: `mock.clock`, hooky `on('fs.write')`, `on('ui.status')` atd. odpovídají `{ value }`), čistá logika v `hooks/logic.ts`.

Hotovo: průzkum API. Zbývá: napsat mod, testy, `claude plugin validate`, `tsc`.
Ověřit naživo (testy to neukážou): zda `tool.call` `context` dojde k modelu v desktopu, zda aplikace přijme `start_session` od modu, zda desktop kreslí `AbovePrompt`.

### Testy (2026-10-30, hotovo)
- `plugins/context-guard/test/guard.test.tsx`: 34 testů, všechny prochází (`claude plugin test .`). `claude plugin validate` a `tsc` jsou čisté.
- Pokrývají: prahy na hranici (149 999/150 000/400 000), 2 zhuštění, nový cyklus po změně úrovně, kontrolu souboru (mtime, značky), připomínky po `remindEvery`, ignorování subagentů, selhání `session.usage`, počítání zhuštění (precompute, agent, veto se nepočítají), cestu v `instructions`, automatické předání (argumenty `start_session`, jen jednou, jednorázová zpráva), `PŘEDÁNÍ:`, přerušený tah, režimy ask/off/show, zálohu přes `mcp.call`, odmítnutí textem, tlačítko s consent, prahy z env a options, obnovu ze store, vlastní složku a pruh v terminálu i desktopu.
- Mutační kontrola: 11 schválně vložených chyb (6 z nich po code review) (práh o 1 vedle, pozdní ohlášení po zhuštění, starý soubor jako zapsaný, pokyny subagentům, předání po přerušení) a každou chytil aspoň jeden test.
- Opravy kódu nalezené testy: (1) úroveň zvednutá zhuštěním se ohlásí hned u dalšího nástroje (`step` nastaví `toolsSinceNudge = remindEvery`), (2) `turn.complete` čte `e.answer`, po přerušeném nebo chybném tahu nepředává a stav souboru obnoví i v režimu show.
- Testy nahrazují engine, takže neověří: jestli desktop doručí `tool.call` context modelu, jestli aplikace přijme `start_session` od modu (`user_asked`, consent) a jestli desktop kreslí `AbovePrompt`. To ověří až souběh naživo (`mode: show`, pak `full`).

### Code review (2026-10-30, hotovo)
Opraveno, každá oprava má test: (1) odmítnutí `start_session` (`deny`, text odmítnutí) je konečné, záloha `$.mcp.call` běží jen když nástroj nejde zavolat; (2) stav `handoff: 'starting'` a synchronní příznak brání dvojímu startu (tlačítko a konec tahu najednou); (3) po `failed` pokyn říká „spusť start_session sám“; (4) `save` zapisuje jen změněné klíče do aktuálního atomu (souběh measure a turn.complete); (5) nový cyklus nuluje `handoff` (kromě started a starting); (6) id session a prahy z env se čtou líně, takže fungují i po reloadu modu bez `session.start`; (7) precompute dostane cestu, ale nepočítá se; (8) vlastní start modu už neoznačí zprávu „práce přešla“ jako doručenou.
Neřešeno: úroveň zvednutá zhuštěním nebo measure se ohlásí až u dalšího nástroje (stejně jako hook). Návrhy na zjednodušení odloženy: jedna funkce `startOk(r)`, text pruhu ze `status()`, ukládat celé `g` místo KEPT.

### Nasazení (2026-10-31)
- Nainstalováno `context-guard@context-guard` (user scope), hook `context-handover.sh` odpojen ze `settings.json` (záloha `settings.json.bak-context-guard`, skripty zůstaly). `~/.claude/CLAUDE.md` přepsán na Context Guard (Claude session nespouští sám, jen po selhání modu; koordinátor `/proved` píše `spusť /proved <plán>` do stavového souboru).
- Naživo ověřeno: pokyn z `tool.call` v desktopu došel modelu (session 8e92e140 při 170k). Zbývá naživo: spuštění session modem a pruh `AbovePrompt`.

- 2026-10-31: pruh nad promptem (AbovePrompt) odstraněn, desktop ho nezobrazuje; stačí stavový řádek. Režim ask se ptá otázkou bez tlačítka. Testy 33/33, validate a tsc OK.
