# Prompt Router pro Codex a OpenCode

Cíl: stejná logika routeru (klasifikátor, pravidla, rozhodnutí here / subagent / session / keep, auto a ask)
i v Codexu (CLI + desktop) a OpenCode (CLI/TUI + desktop). Chování Claude Code modu se nemění.

## Zjištění (průzkum 2026-10-31)

| Potřeba | Claude Code | Codex 0.153.4 (CLI + ChatGPT.app sdílí `~/.codex`) | OpenCode (V1 plugin API, npm `@opencode-ai/plugin` 1.19) |
| --- | --- | --- | --- |
| Háček před promptem | `prompt.submit`, přepíše text | `UserPromptSubmit` v `~/.codex/hooks.json`, jen **přidá** kontext (`additionalContext`), text nepřepíše | `chat.message`, upraví `parts` i `message` |
| Přepnout effort/model sám | `config.set` | **Nejde** (háček ani MCP to neumí; jen `/model` ručně, nebo `-m`/`-c` při startu) | ano: `output.message.model = {providerID, modelID, variant}` |
| Nástroj `switch` | `$.tool.register` | MCP server jde, ale přepnout nic neumí | `tool()` z pluginu + aplikace v dalším `chat.message` |
| Historie chatu | `$.session.messages` | `transcript_path` (JSONL, formát nestabilní) | `client.session.messages` |
| Klasifikátor | `$.model.complete` | `codex exec -m gpt-5.6-luna -c model_reasoning_effort=low --ephemeral …` (1–3 s navíc) | dočasná session přes `client.session.prompt` s malým modelem |
| Dotaz uživateli | AskUserQuestion | `request_user_input` jen v Plan mode → v textu | vestavěný nástroj `question` |
| Toast | `$.ui.toast` | `systemMessage` (varování) | `client.tui.showToast` (jen TUI) |
| Nová session | `start_session` / příkaz `claude` | příkaz `codex -m … -c model_reasoning_effort=…` | `client.session.create` + `session.prompt` |
| Subagent s modelem | Agent tool | `spawn_agent` (model/effort per volání neověřeno) | `task` + agent v configu |

Node 26 spouští `.ts` přímo (bez buildu), takže adaptéry importují jádro bez kopírování.
Mod smí importovat soubory ze své složky, proto jádro bydlí uvnitř modu.

## Rozhodnutí (čeká na uživatele)
1. **Codex „auto“ effort**: Codex přepnutí ze skriptu neumí. Návrh: v auto agent na začátku odpovědi
   napíše jeden řádek „Prompt Router: pro tohle stačí `/model gpt-5.6-luna low`“ a pokračuje (bez dotazu);
   v ask položí otázku textem. Alternativa: spouštěč `codex-routed`, který zvolí model a effort jen pro první prompt nové session.
2. **Mapování modelů**: třídy haiku / sonnet / opus / fable → Codex luna / terra / sol / gpt-6.1-sol, OpenCode
   podle volby uživatele (výchozí Anthropic modely). Mapování v nastavení adaptéru.
3. **Klasifikátor v Codexu**: `codex exec` s luna (tvoje ChatGPT přihlášení, bez API klíče), nebo Anthropic API klíč.
4. **OpenCode verze**: V1 API (stabilní, dokumentované). V2 (release 2.2.4) až později. OpenCode se netestuje živě.

## Kroky

### 0. Commit současných oprav (5 min)
- Soubory: `README.md`, `plugins/prompt-router/**`, `docs/plans/prompt-router-fixes.md`.
- Hotovo: commit na `main` (nebo větvi), čistý `git status`.

### 1. Vytáhnout jádro z modu beze změny chování (45 min)
- Nový `plugins/prompt-router/core/router.ts`: čistá logika bez `$` a JSX: `TEMPLATE`, `pickPrompt`, `parsePick`,
  `field`, `typed`, `clip`, `asLevel`, `knownModel`, `asModel`, konstanty, typy `Pick`/`Config`/`Chat`, `toConfig`.
  Texty poznámek (askNote/switchNote) zůstávají v `register.tsx`, protože jmenují nástroje Claude Code.
- `hooks/register.tsx` je importuje.
- Ověření: před změnou uložit golden výstup `pickPrompt` + všech poznámek pro sadu vstupů; po změně identický.
  47/47 testů, `claude plugin validate`, `/router` v `claude -p` hlásí totéž.

### 2. Codex adaptér (60 min) — samostatná session, vlastní worktree
- `adapters/codex/hook.ts` (UserPromptSubmit: stdin JSON → historie z `transcript_path` → `codex exec` klasifikátor →
  `hookSpecificOutput.additionalContext` s poznámkou pro Codex), `adapters/codex/notes.ts`, `install.ts`
  (zapíše do `~/.codex/hooks.json` a `~/.codex/prompt-router.json`, se zálohou), `adapters/codex/test/*.test.ts` (node:test).
- Rekurze: klasifikační `codex exec` spouštět s proměnnou `PROMPT_ROUTER_INNER=1`, háček ji přeskočí.
- Ověření: unit testy; živě `codex exec "kolik je 2+2"` a interaktivní `codex` přes pty → log
  `~/.codex/log/prompt-router.log` ukáže rozhodnutí a agent poznámku použije; desktop ChatGPT.app ručně uživatelem
  (háček je potřeba jednou schválit přes `/hooks`).

### 3. OpenCode adaptér (60 min) — samostatná session, vlastní worktree, souběžně s krokem 2
- `adapters/opencode/prompt-router.ts` (V1 plugin: `chat.message` klasifikace a přepnutí `model`/`variant` v auto,
  poznámka pro nástroj `question` v ask, nástroj `switch`, `tui.showToast`), `adapters/opencode/package.json`, testy s mock `client`.
- Rekurze: klasifikační session přeskočit podle sessionID.
- Ověření: unit testy; živě ne (OpenCode není nainstalovaný), uvést v README.

### 4. README a verze (30 min)
- Úvod + tabulka platforem; sekce **Claude Code**, **Codex**, **OpenCode**, každá: instalace, nastavení, co umí a co ne
  (Codex bez automatického přepnutí), odinstalace. Společné části (jak router rozhoduje, pravidla, eval) jednou.
- Verze 0.6.0 v `plugin.json`, changelog.
- Ověření: všechny testy (mod + adaptéry), `claude plugin validate`, odkazy v README.

## Pasti
- Codex háček se musí jednou důvěřovat přes `/hooks` (hash), po každé změně skriptu znovu.
- Codex efforty se liší podle modelu (luna nemá `ultra`); mapovat jen na podporované.
- `transcript_path` formát není stabilní: chyba čtení = klasifikace bez historie, nikdy pád.
- Claude Code mod: po kroku 1 nesmí změnit ani znak výstupu (golden test).

## Stav (2026-10-31)
- [x] Krok 0: commit bd0b2dd na `main` (ff merge `fix/reliability`). Nic nepushnuto.
- Krok 1 rozdělaný: větev `feat/multi-platform`. Postup: přesunout doslova z `hooks/register.tsx` do `core/router.ts`
  (s `export`): `LEVELS`, `NAMES`, `MODELS`, `MODEL_NAMES`, `ALL_MODELS`, typy `Where/Config/Model/Pick/Chat`
  (Chat bez `conf` z globálu: `chatOf` zůstává v modu), `norm`, `asLevel`, `knownModel`, `asModel`, `typed`, `clip`,
  `TEMPLATE`, `MODEL_HEAD_FIRST`, `MODEL_HEAD`, `FABLE_RULE`, `pickPrompt`, `field`, `parsePick`, `str`, `toConfig`.
  `Level` zůstává v `types/index.d.ts` (jádro ho re-exportuje/definuje stejně).
  Golden: skript porovná těla přesunutých bloků s `git show main:plugins/prompt-router/hooks/register.tsx` (bez `export `),
  plus 47/47 `claude plugin test plugins/prompt-router` a `claude plugin validate plugins/prompt-router`.
- Pak krok 3 plánu chatu: ověřit, jestli běžící Codex session znovu čte `~/.codex/config.toml` (rozhodne Codex auto: dialog
  přes MCP elicitation + zápis configu, nebo jen řádek `/model …`). Uživatelův config: model gpt-5.6-sol, effort high.
- Codex mapování (výchozí, nastavitelné): haiku→gpt-5.6-luna, sonnet→gpt-5.6-terra, opus→gpt-5.6-sol, fable→gpt-6.1-sol;
  klasifikátor `codex exec -m gpt-5.6-luna -c model_reasoning_effort=low --ephemeral --skip-git-repo-check -s read-only`.
- [x] Krok 1 hotový: commit a399052 (`core/router.ts`, golden porovnání řádků s `main` = beze změny, 47/47, validate OK, jádro se načte v Node).
- Běží: subagent testuje reload `config.toml` v Codexu (záloha `~/.codex/config.toml.bak-router-test`; po skončení zkontrolovat, že config je obnovený).
- Běží: subagent staví OpenCode adaptér v `adapters/opencode/` (prompt-router.ts, install.ts, testy `node --test adapters/opencode/test/`).
- Další: Codex adaptér `adapters/codex/` podle výsledku reload testu.
- [x] OpenCode adaptér: `adapters/opencode/` (prompt-router.ts, notes.ts, install.ts, 27/27 `node --test adapters/opencode/test/`), necommitnuté.
  Odchylky od 1:1 (do README): přepnutí = „hold“ per zpráva (picker se nehne); model mid-turn ne, effort ano přes chat.params;
  subagenti `router-haiku|sonnet|opus|fable` přes config hook; nová session nástrojem `router_session`; `/router` přes config command;
  volby v `~/.config/opencode/prompt-router.json`. Neověřeno živě (seznam v reportu: variant pole, @opencode-ai/plugin v ~/.config/opencode, `opencode --prompt`).
- [x] Reload test: běžící Codex **nečte** config.toml mezi tahy (turn_context drží startovní model/effort). Rozhodnutí: Codex auto =
  jeden řádek „přepni `/model …`“ + systemMessage, pokračuje bez dotazu; ask = dotaz textem. Config obnoven (diff OK).
  Codex login je rozbitý („refresh token was already used“) → uživatel `codex logout` + `codex login`. Subagent omylem
  spustil self-update na 0.166.0, vráceno na 0.153.4.
- Běží: subagent staví Codex adaptér `adapters/codex/` (hook.ts, notes.ts, install.ts, testy) + živý test.
- Zbývá: README po platformách, verze 0.6.0, changelog, commit; spustit všechny testy.
- [x] Codex adaptér: `adapters/codex/` 27/27, nainstalovaný v ~/.codex (záloha hooks.json `.bak-prompt-router-1793403795614`),
  `~/.codex/prompt-router.json` má uživatelovy volby z Claude Code (auto/auto, Czech; záloha `.bak-defaults`). Živě: hook s reálným
  klasifikátorem OK; Codex sám hook nespustí, dokud ho uživatel nedůvěřuje přes `/hooks`.
- [x] `userLang` přesunut do core (register/opencode/codex importují), 47/27/27, validate OK.
- Běží: subagent přepisuje README (sekce Claude Code / Codex / OpenCode, verze 0.6.0, changelog).
- Pak: commit na feat/multi-platform, merge do main jen na pokyn.
- Desktop ChatGPT.app (2026-10-31 01:00–01:06): CLI i `codex exec` (i přibalený 0.166) háček spustí a poznámku vypíšou.
  Desktop chat 01:00 (app-server 0.164) háček spustil (log pick 00:00:51Z), ale výstup se do chatu ani rolloutu nedostal.
  Desktop chat 01:03 (po restartu, 0.166) háček nespustil vůbec. Výstup háčku je správný (ověřeno ručně s gpt-6.1-sol).
  Hypotézy: app-server ignoruje additionalContext/systemMessage u GUI tahů; 0.166 má hooky pro desktop vypnuté
  nebo jinou trust databázi. Stop po 2 pokusech, čeká na uživatele.
- Desktop 01:12 (nový chat): háček se nespustil (žádný proces hook.ts, žádný záznam v logu). Ruční `app-server` ze stejné binárky,
  se stejnými `-c` přepínači a nastavením vlákna (auto_review, workspace-write, priority) háček spustí vždy. hooks/list: trusted, enabled.
  Log desktopu: „Received turn/started for unknown conversation“ s jiným ID, než má vlákno → desktop nejspíš tahy běží přes vlastní
  vnitřní vrstvu, která UserPromptSubmit nevolá. Na naší straně oprava není; možnosti: nahlásit OpenAI, používat Codex CLI.
- [x] Desktop cesta: MCP server `adapters/codex/mcp.ts` (nástroj `route`, stejný kód jako háček) + blok v `~/.codex/config.toml`
  (`default_tools_approval_mode = "approve"`) a pravidlo v `~/.codex/AGENTS.md`, oboje s markery a zálohou (install/uninstall).
  Klasifikátor běží s `-c mcp_servers.prompt_router.enabled=false`. Ověřeno přes desktopový app-server s vypnutým háčkem:
  agent zavolal `route` a odpověď začala řádkem Prompt Router. Codex testy 41/41. Zbývá: uživatel v desktopu po restartu.
