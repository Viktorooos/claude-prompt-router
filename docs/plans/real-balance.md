# Skutečná bilance routeru: peníze i čas včetně opakování

Navazuje na `router-stats.md`. Cíl: panel ukáže poctivé „+$1,20 a −2 h 10 min“ (nebo mínus) místo dnešního čísla, které přeceňuje stejné tokeny na jiném modelu a chyby levného modelu nezapočítá.

## Proč je dnešní číslo zavádějící
- `withoutUsd` předpokládá, že by práce bez routeru zabrala **stejné tokeny**. Když Haiku úkol nezvládne a pouští se znovu, opakování vypadá jako levná běžná práce. Ztráta se nikde neobjeví.
- `rework` / `accuracyPct` je jen procento (stejný text do 3 promptů), do dolarů se nepromítá a nezachytí přeformulování.
- Čas se neměří vůbec.

## Co jde zjistit přesně a co ne
- **Přesně:** skutečná cena a čas každého tahu (tokeny, `turn.start` → `turn.complete`), cena klasifikátoru, co se opakovalo (signály níže).
- **Jen odhadem:** co by stálo a trvalo totéž na silnějším modelu. Tohle se ze samotných dat uhodnout nedá.
- **Řešení: kontrolní skupina.** Router u malé části routovatelných promptů (výchozí 10 %, vypínatelné) záměrně nezasáhne a nechá model, který by zvolil člověk. Pak se porovnávají **naměřené** hodnoty: cena a čas na úkol, míra opakování, routed vs. kontrola. Po ~30–50 úkolech je rozdíl statisticky použitelný a je to jediný poctivý odpověď na „vyplatilo se to?“. Do té doby panel píše „odhad, málo dat“ a ukazuje rozsah.
- Přesnost tedy: u nákladů na úkol vysoká (měříme), u srovnání s „kdyby“ roste s počtem dat. Přesné číslo hned po instalaci nikdo neudělá, ale smyšlené číslo (dnešní stav) se nahradí měřeným s intervalem.

## Návrh

### Úkol (episode) jako jednotka
Úkol = routovaný prompt + navazující tahy, které ho opravují. Cena a čas úkolu = součet všech jeho tahů + klasifikátor. Úkol končí, když přijde prompt s jiným tématem, nebo po uplynutí 30 min bez aktivity.

### Signály selhání levného tahu (od silných po slabé)
1. Člověk po tahu **ručně přepne na silnější model/effort** a zopakuje prompt.
2. Stejný text znovu (dnešní `rework`).
3. Další prompt je oprava/stížnost („nefunguje“, „špatně“, „oprav“, „ne tak“): rozpozná to stejný levný klasifikátor v jednom volání spolu s routingem (příznak `followsUp: continues|corrects|new`), bez dalších nákladů navíc.
4. Přerušení tahu (Esc), chyba nástroje/testů na konci tahu, `git checkout`/revert souborů, které tah upravil.
5. Stejné soubory upraveny znovu v následujícím tahu (slabý signál, jen s dalším).
Každé selhání má váhu (silné 1,0, slabé 0,3–0,5); váhy do `core/prices.ts`-like konstant, ať jdou ladit.

### Bilance úkolu
- `actual` = cena + čas všech tahů úkolu + klasifikátor.
- `counterfactual` = medián ceny/času úkolu z **kontrolní skupiny** pro podobnou třídu (kategorie z klasifikátoru, např. malá úprava / bug / návrh); dokud kontrola nemá data, použije se dnešní přepočet tokenů a panel to označí „hrubý odhad“.
- `saved = counterfactual − actual` (peníze i minuty). Záporné = router stál víc.
- Rozpad v panelu: ušetřeno na levnějším modelu, **ztraceno na opakování**, příplatek za eskalaci, klasifikátor, rozdíl času.

### Zobrazení
- Štítek: `+$1,20 · −2 h 10 min dnes` (zelená/červená podle toho, jestli router vydělal). U malého vzorku `~` a tooltip „12 úkolů, odhad“.
- Panel/`/router stats`: dvě čísla vedle sebe (peníze, čas), pod nimi rozpad, tabulka podle modelu (Haiku/Sonnet/Opus: cena na úkol, % opakování, čas na úkol), přesnost = podíl úkolů bez selhání s intervalem spolehlivosti.
- Doporučení: když má Haiku u třídy „bug“ vysokou míru opakování a vychází dráž než Sonnet, panel to řekne a router může tu třídu přestat posílat na Haiku (krok 8, volitelný).

## Kroky (30–60 min)
✅ 1. **Čas a úkoly v datech.** Do záznamu `turn` přidat `startedAt`/`durationMs`; do `decision` příznak `followsUp` z klasifikátoru (úprava promptu klasifikátoru + `test/cases.json`). Soubory: `core/router.ts`, `core/stats.ts` (typy), `hooks/register.tsx`, `adapters/*` (stejné pole, jinde případně prázdné). Hotovo: testy ukazují nová pole, staré záznamy se dál načtou.
   - Poznámky: `follows` nepřidává nový klasifikátor, je to pole v jeho odpovědi (`parseFollows` v `core/router.ts`). Čas turnu bere `durationMs` od platformy; čas klasifikátoru je v `classifier.ms`, ale mimo `durationMs`. Codex a OpenCode zatím nezapisují `follows` ani čas (krok 1 jen pro Claude Code); doplnit až v kroku 3, kde je potřeba.
✅ 2. **Skládání úkolů.** Čistá funkce `episodes(records)` v `core/stats.ts`: seskupí tahy do úkolů podle pravidel výše. Testy napřed (úkol bez opakování, s opravou, s ručním přepnutím modelu, hranice 30 min). Hotovo: unit testy.
   - Poznámky: `episodes()` a `EPISODE_GAP` v `core/stats.ts`. Stejný `key` vždy pokračuje (opakování i po ručním přepnutí), jinak rozhoduje `follows`; starý záznam bez `follows` začíná nový úkol. Mezera 30 min se měří od posledního záznamu úkolu (konce turnu). Turny před prvním promptem, který router viděl, tvoří úkol bez decision.
3. **Signály selhání a váhy.** `failureOf(episode)` vrací 0–1 + důvody. Rozšířit `reworkedSet` o signály 1, 3 a 4. Testy včetně falešného poplachu (záměrné opakování). Hotovo: testy; `accuracyPct` se přepočte z vážených selhání.
4. **Kontrolní skupina.** V routeru `holdout` (výchozí 10 %, config `holdoutPct`, 0 = vypnuto), rozhodnutí se uloží jako `where: 'keep', holdout: true`; nikdy se netýká promptů, kde by to bylo riskantní (explicitní pokyn uživatele). Hotovo: test, že poměr sedí a že se holdout zapisuje.
5. **Bilance proti kontrole.** `balance(episodes)` počítá counterfactual z mediánů kontrolní skupiny podle třídy (fallback: dnešní přepočet, označený). Výstup peníze + minuty + interval. Hotovo: testy se syntetickými daty, kde je správný výsledek spočítaný ručně.
6. **UI.** Štítek a panel podle sekce Zobrazení (`core/stats.ts` render, `hooks/register.tsx`, `test/pane.test.tsx`). Hotovo: pane test + ruční kontrola v panelu.
7. **Migrace a dokumentace.** Staré záznamy bez nových polí zobrazit jako „hrubý odhad“; README sekce „Jak se počítá bilance“. Hotovo: načtení reálného logu `~/.claude/mods-logs/prompt-router-stats.jsonl`, porovnání starého a nového čísla na stejných datech.
8. *(volitelně)* Zpětná vazba do routeru: třídy s trvale zápornou bilancí na Haiku povýšit na Sonnet. Samostatné rozhodnutí po týdnu reálných dat.

## Rozhodnutí k potvrzení
- Kontrolní skupina 10 % znamená, že u každého desátého routovatelného promptu nic neušetříte, aby bylo číslo měřitelné. Můžete dát méně (pomalejší přesnost) nebo vypnout (zůstane odhad).
- Klasifikace „oprava/nová věc“ přidá pár tokenů do už existujícího volání klasifikátoru, bez dalšího volání.
- Platformy Codex/OpenCode: stejná logika ve sdíleném jádru, signály 3 a 4 jen tam, kde je platforma poskytuje.
