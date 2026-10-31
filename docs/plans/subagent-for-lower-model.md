# Here + jiný model → nabídnout subagenta, model v chatu nepřepínat

Větev `feat/subagent-for-lower-model` (z `main` 9075640), worktree `~/.claude/mods-src/prompt-router-wt/subagent-lower-model`.

## Proč
Přepnutí modelu uprostřed chatu rozbije prompt cache: nový model načte celý kontext znovu za plnou cenu. Hlavní model se proto uprostřed chatu nepřepíná nikdy. Když prompt patří do tohoto chatu, ale sedí mu jiný model (slabší i silnější), router nabídne subagenta s tím modelem, nebo zůstat tady jen s přehodnoceným effortem.

**Rozsah teď: jen Claude Code.** Codex a OpenCode se jen prověří, jestli to jde (krok 5), implementace až po schválení.

## Jak to je dnes (zjištěno)
- Model pro „here“ se mění **jen u prvního promptu chatu** (`p.first`): Claude Code `register.tsx:308`, Codex `hook.ts:365`, OpenCode `prompt-router.ts:357`. Tam ještě žádná cache není, přepnutí nic nestojí.
- Uprostřed chatu klasifikátor dostává `MODEL_HEAD` = „for subagent or session; for here use the current one“ (`core/router.ts:111`), takže pro „here“ vrací aktuální model a adaptéry `p.model` u „here“ ignorují. Případ „here + slabší model“ uprostřed chatu tedy dnes vůbec nenastává; vznikne až změnou `MODEL_HEAD`.
- Notu „Subagent (model · effort)“ + „Do it here …“ s přehodnocením effortu podle `effortMode` už umí `askNote` pro `where: 'subagent'` na všech třech platformách. Nový případ ji přepoužije s jiným úvodem.
- Codex 0.166.0: `spawn_agent` bere `model` i `reasoning_effort` (v binárce jsou chyby „Unknown model … for spawn_agent. Available models“ a „Reasoning effort … is not supported for model …“; popis nástroje říká nastavit `model` jen na výslovné přání uživatele, a to výběr „Subagent“ je). Když nástroj chybí (multi-agent vypnutý), nota už dnes říká „řekni to jednou větou a udělej to tady“. ChatGPT desktop jde přes MCP `route` → stejný `handle()`, takže se změní s Codexem.

## Rozhodnutí
1. **Kdy nastane:** `where = here`, není to první prompt, není to prompt přes běžící tah, aktuální model je známý a `p.model` se od něj liší (slabší i silnější).
2. **První prompt chatu zůstává jako dnes** (model se přepne podle `modelMode`), cache tam ještě není. Potvrzeno uživatelem.
3. **Drobnosti** (krátká odpověď, pozdrav) zůstávají tady bez otázky, jak říká dnešní pravidlo klasifikátoru. Potvrzeno uživatelem.
4. **`modelMode: off`** = router na model nesahá → otázka se neukáže, chování jako dnes (jen effort).
5. **Otázka:** možnosti `Subagent (<Model> · <effort>)` (první, doporučená) a `Stay here …` (v jazyce uživatele, česky „Zůstat tady“). Effort u „Stay here“ jako dnes v `askNote`:
   - effort se nemění → jedna možnost „Stay here“;
   - `ask` → „Stay here (<nový>)“ a „Stay here (keep <současný>)“;
   - `auto` → jen „Stay here (<nový>)“, po výběru se effort přepne bez další otázky (mod ho nepřepíná předem).
   Model hlavního chatu se v žádné větvi nepřepíná; nota to řekne výslovně.
6. **Subagent:** `Agent` s `model` a `effort`. Prompt staví na kontextu chatu, takže hlavní model předá subagentovi v zadání vše potřebné z chatu; subagent vrátí jen krátký výsledek.
7. **`MODEL_HEAD`:** klasifikátor pro „here“ uprostřed chatu vrací model, který úkol potřebuje (ne automaticky aktuální); drobnosti dál aktuální model.
8. Verze 0.7.0 (`plugin.json`, `marketplace.json`), changelog + věta v Concepts.

## Kroky

### ✅ 1. Testy (padají) — ~30 min
- `plugins/prompt-router/test/router.test.ts`: (a) here + sonnet na opus chatu, `ask`, jiný effort → „Subagent (Sonnet · …)“, „Stay here (…)“, „Stay here (keep …)“, Agent s model/effort, zákaz přepnutí modelu, mod nic nenastaví; (b) here + opus na haiku chatu (silnější) → stejná otázka; (c) `auto` → jen „Stay here (…)“, effort se předem nenastaví; (d) stejný effort → jen „Stay here“; (e) `modelMode: off` → jako dnes; (f) prompt přes běžící tah → beze změny; (g) klasifikátor dostává nový `MODEL_HEAD`. Existující testy beze změny.

### ✅ 2. Core + Claude Code — ~30 min
- `core/router.ts`: `MODEL_HEAD`.
- `hooks/register.tsx` `decide()`: větev před dnešní „here“ logikou → `askNote` ve variantě „other model here“.
- Ověření: `claude plugin test plugins/prompt-router`, `claude plugin validate plugins/prompt-router`.

### ✅ 3. README, verze — ~15 min
- Concepts: krátký odstavec; changelog 0.7.0 (jen Claude Code).

### ✅ 4. Kontrola
- Všechny čtyři příkazy z „Hotovo“ (adaptéry se nemění, ale sdílí `core`). Volitelně případy do `test/cases.json` + `eval.py` (živý klasifikátor, stojí tokeny).

### ✅ 5. Codex + OpenCode: prověřit proveditelnost
- Codex: `spawn_agent` s `model` a `reasoning_effort` (0.166 podporuje), rozdíl oproti dnešnímu `/model` řádku, ChatGPT desktop přes MCP `route`.
- OpenCode: `task` s `router-<model>` agentem, effort přes `subEffort`.
- Výstup: poznámky sem, implementace až po schválení.

## Stav po implementaci (Claude Code)
- `core/router.ts`: `MODEL_HEAD_HERE`, `Chat.hereModel` (jen Claude Code ho zapíná, adaptéry dostávají starý `MODEL_HEAD` a chovají se beze změny), `Pick.other`.
- `hooks/register.tsx`: `pick()` nastaví `other` (here, ne první prompt, známý model, jiný model, `modelMode` ≠ off); `decide()` → `otherNote()`; společné možnosti „here“ v `hereChoice()` (sdílí `askNote`). „Do it here“ bez změny effortu je teď v notě v uvozovkách.
- Testy: plugin 55/55 (8 nových), validate OK, codex 41/41, opencode 27/27. README Concepts + changelog 0.7.0, verze 0.7.0.

## Codex a OpenCode: dá se to udělat (prověřeno, neimplementováno)
**Codex CLI — ano.** Hook model ani effort běžícího chatu stejně přepnout neumí, takže „nepřepínat model“ platí samo. Stačí v `hook.ts` (větev `here`, ř. ~363) ne-první prompt s `routerModel(o.models, model)` ≠ `p.model` poslat na novou notu v `notes.ts`: „Subagent (<slug> · <effort>)“ = `spawn_agent` s `model` a `reasoning_effort` (0.166 je podporuje, validuje model i effort; popis nástroje říká nastavit model jen na výslovné přání uživatele, což výběr splňuje), „Stay here (…)“ = dnešní řádek `/model <aktuální slug> <effort>` (ask: dvě možnosti, auto: jedna). Bez `spawn_agent` (multi-agent vypnutý) už dnes platí „řekni to a udělej tady“. Nepřiřazený (vlastní) model → `routerModel` vrátí '' → beze změny. Klasifikátor dostane `hereModel: true` v `Chat`.
**ChatGPT desktop (MCP `route`) — s výhradou.** Jde přes stejný `handle()`, ale desktop nejspíš nemá `spawn_agent`, takže by otázka nabízela subagenta, který skončí „udělám to tady“. Návrh: v `mcp.ts` předat `handle()` příznak (např. `deps.noSubagent`) a tam novou otázku vynechat (jen effort jako dnes). Ověřit v desktopu, jestli `spawn_agent` má.
**OpenCode — ano.** Model hlavního chatu mění jen `applyModel` u prvního promptu, jinde ne. V `prompt-router.ts` (větev `here`, ř. ~350) ne-první prompt s `routerModel(model)` ≠ `p.model` → nová nota v `notes.ts`: „Subagent“ = `task` s `subagent_type: router-<model>` (agenti už existují v `config`), effort nastaví stávající `tool.execute.before` ze `st.last` (pick se ukládá před větvením, funguje i pro `where: here`); „Stay here (…)“ = `router_switch` jen s `effort` (ask/auto jako dnes). V `auto` se effort nesmí aplikovat předem (dnes `applyLevel` v here větvi), nová větev musí přijít před ním.
**Odhad:** obě platformy ~45 min včetně testů (`hook.test.ts`, `prompt-router.test.ts`), nejlépe se stejným `hereChoice` refaktorem v jejich `notes.ts`.

## Hotovo
`claude plugin test plugins/prompt-router`, `claude plugin validate plugins/prompt-router`, `node --test adapters/codex/test/`, `node --test adapters/opencode/test/` projdou; README má Concepts + changelog; nic necommitnuto ani pushnuto.

## Drobnosti uprostřed chatu (eval, otevřené)
- Živý eval (sonnet klasifikátor, 3 běhy na případ): přejmenování → Sonnet, návrh na Haiku chatu → Opus, debug na Sonnet chatu → Opus, díky → keep, ahoj → aktuální model. Všechny běhy daly stejný výsledek.
- Problém: krátké otázky a zprávy v Opus chatu klasifikátor posílá na Haiku, takže se zobrazí otázka na subagenta. Je to v rozporu s rozhodnutím 3. Příčina: pravidlo pro haiku v TEMPLATE výslovně jmenuje „one short answer … a short message, a quick fact“.
- Pokus 1 (hlavička „quick question or short message keeps the current one, overrides haiku rule“): otázky OK, zpráva kolegovi pořád Haiku.
- Pokus 2 (+ „writing a short message or email“): zpráva OK, „na co je ten 30s skew?“ znovu Haiku ×3. Úprava textu se přelévá z jednoho případu do druhého.
- Návrhy: (A) pravidlo v kódu: subagenta nenabízet, když návrh je Haiku · low (drobnost se nevyplatí delegovat), deterministické; (B) přesunout výjimku přímo do řádku haiku v TEMPLATE (mění prompt i pro adaptéry, jen s hereModel slotem); (C) nechat, jak to je.
