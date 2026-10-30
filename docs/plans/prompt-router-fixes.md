# Prompt Router: opravy spolehlivosti (2026-10-30)

## Hotové (necommitnuté, v diffu)
- [x] Volby pod krátkým klíčem `pluginConfigs.prompt-router` se ignorovaly (engine čte jen `prompt-router@prompt-router`).
  `~/.claude/settings.json` přejmenován (záloha `settings.json.bak-prompt-router`). Mod teď krátký klíč použije sám,
  když plné ID chybí, a `/router` napíše, ať se klíč přejmenuje: `loadShortKey` v `hooks/register.tsx`.
- [x] Klasifikátor dostával `<system-reminder>` bloky aplikace místo promptu (řez na 4000 znaků): `typed()`
  v `decide` a `chatOf`. Prompt jen z bloků se neklasifikuje, `/příkaz` po bloku projde.
- [x] `start_session` jen tam, kde existuje (`canStartSession`: `$.tool.list`, jinak surface `desktop`); v terminálu
  a VS Code dá Claude příkaz `claude --model … --effort … "<úkol>"`.
- [x] `claude -p` / SDK (`origin.kind === 'sdk'`) se dál přeskakuje záměrně: model a effort tam určují přepínače.
- [x] Testy: 47/47 (`claude plugin test plugins/prompt-router`), `claude plugin validate` OK.
- README: oprava klíče v příkladu a FAQ.

## Zbývá
- Živý test v terminálovém CLI (interaktivní `claude` přes python pty) a v novém chatu v aplikaci: log
  `~/.claude/mods-logs/prompt-router.log` musí ukázat skutečný text promptu a žádný AskUserQuestion u effortu.
- [x] README (klienti, badge 47) a verze 0.5.1.
- Terminál: mod prompt zachytil (log `pick failed: api-error`), CLI má prošlé přihlášení → uživatel `/login` a zopakovat.
- Aplikace: start testovací session zamítl auto mode; ověřit novým chatem.
