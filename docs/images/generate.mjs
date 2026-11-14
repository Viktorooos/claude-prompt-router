// Generates the README's illustrations as SVG, with sample data (not real usage), each in a light and
// a dark variant (<name>-light.svg, <name>-dark.svg) for <picture> + prefers-color-scheme.
// Colours, icons and labels are read from the pane's own code (core/panel.ts); nothing there changes.
// Run: node docs/images/generate.mjs   (Node 23.6+, it imports the .ts directly; writes next to this script)
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACCENT, PERIOD_LABELS, TONES, TTL_NAME, VIOLETS, WHERE_LABEL, tileSvg, tone } from '../../plugins/prompt-router/core/panel.ts'

const OUT = dirname(fileURLToPath(import.meta.url))
const FONT = '-apple-system,BlinkMacSystemFont,system-ui,sans-serif' // the pane's own stack
const n = v => Math.round(v * 100) / 100
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const usd = v => `$${v.toFixed(2)}`

// The pane's card icons (24×24 paths), taken from its tile drawing so they never drift from it.
const PATHS = {}
const icon = name => (PATHS[name] ??= tileSvg(name, '#000').match(/translate\(6 6\)"[^>]*>([\s\S]*?)<\/g><\/g><\/svg>$/)[1])

const THEMES = {
  light: {
    ink: '#1d1f23', mute: '#5f636b', dim: '#8b8f98', card: '#ffffff', soft: '#f5f3fd', line: '#e6e3f2', track: '#ebe8f5',
    chip: '#efedf7', chipText: '#4a4e56', chipOn: '#1d1f23', chipOnText: '#ffffff', tile: 0.15,
    shadow: '#2a2357', shadowOp: 0.1, bgA: '#ffffff', bgB: '#f2efff', glow: 0.16,
  },
  dark: {
    ink: '#f2f3f5', mute: '#a2a6ae', dim: '#70747d', card: '#17181f', soft: '#1e1f28', line: '#2b2c37', track: '#282934',
    chip: '#24252f', chipText: '#c9ccd2', chipOn: '#f2f3f5', chipOnText: '#111216', tile: 0.22,
    shadow: '#000000', shadowOp: 0.45, bgA: '#121219', bgB: '#1b1830', glow: 0.22,
  },
}

// Drawing helpers for one theme.
function kit(mode) {
  const dark = mode === 'dark'
  const T = THEMES[mode]
  const i = dark ? 1 : 0 // the lighter tone of each pair reads on dark
  const C = { green: TONES.calm[i], amber: TONES.near[i], red: TONES.over[i], grey: TONES.idle[i], violet: VIOLETS[i], violet2: VIOLETS[i + 1], accent: ACCENT }
  const t = (x, y, s, o = {}) =>
    `<text x="${n(x)}" y="${n(y)}" font-size="${o.size ?? 13}"${o.w ? ` font-weight="${o.w}"` : ''} fill="${o.fill ?? T.ink}"${o.anchor ? ` text-anchor="${o.anchor}"` : ''}${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`
  const rect = (x, y, w, h, r, fill, stroke, extra = '') =>
    `<rect x="${n(x)}" y="${n(y)}" width="${n(w)}" height="${n(h)}" rx="${n(r)}" fill="${fill}"${stroke ? ` stroke="${stroke}"` : ''}${extra}/>`
  const card = (x, y, w, h, r = 18) => rect(x, y, w, h, r, T.card, T.line, ' filter="url(#sh)"')
  const soft = (x, y, w, h, r = 12) => rect(x, y, w, h, r, T.soft, T.line)
  const tile = (x, y, c, name, s = 36) => {
    const k = s / 36
    return `<g transform="translate(${n(x)} ${n(y)})"><rect width="${s}" height="${s}" rx="${n(10 * k)}" fill="${c}" fill-opacity="${T.tile}"/><g transform="translate(${n(6 * k)} ${n(6 * k)}) scale(${n(k)})" fill="none" stroke="${c}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icon(name)}</g></g>`
  }
  const bar = (x, y, w, frac, grad = 'calm', tick = null, h = 8) =>
    rect(x, y, w, h, h / 2, T.track) + rect(x, y, Math.max(h, w * frac), h, h / 2, `url(#${grad})`) +
    (tick != null ? rect(x + w * tick - 1, y - 3, 2, h + 6, 1, T.ink, null, ' opacity=".55"') : '')
  const chip = (x, y, label, on) => {
    const w = n(label.length * 6.7 + 22)
    return { svg: rect(x, y, w, 28, 9, on ? T.chipOn : T.chip) + t(x + w / 2, y + 18.5, label, { size: 12, anchor: 'middle', w: on ? 600 : 500, fill: on ? T.chipOnText : T.chipText }), w }
  }
  const check = (x, y) => `<circle cx="${n(x)}" cy="${n(y)}" r="10" fill="${C.green}" fill-opacity="${T.tile}"/><path d="M${n(x - 4.2)} ${n(y + 0.3)}l2.8 2.9 5.6-6" fill="none" stroke="${C.green}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  const cross = (x, y) => `<circle cx="${n(x)}" cy="${n(y)}" r="10" fill="${C.grey}" fill-opacity="${T.tile}"/><path d="M${n(x - 3.5)} ${n(y - 3.5)}l7 7M${n(x + 3.5)} ${n(y - 3.5)}l-7 7" stroke="${C.grey}" stroke-width="2" stroke-linecap="round"/>`
  // The whole picture: a canvas with room for the cards' shadows (pad), the body shifted into it.
  const svg = (W, H, body, pad = [8, 6]) => `<svg xmlns="http://www.w3.org/2000/svg" width="${W + 2 * pad[0]}" height="${H + 3 * pad[1]}" viewBox="0 0 ${W + 2 * pad[0]} ${H + 3 * pad[1]}" font-family="${FONT}">
<defs>
<filter id="sh" x="-10%" y="-12%" width="120%" height="140%"><feDropShadow dx="0" dy="5" stdDeviation="8" flood-color="${T.shadow}" flood-opacity="${T.shadowOp}"/></filter>
<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="40"/></filter>
${['calm', 'near', 'over'].map(k => `<linearGradient id="${k}" x1="0" x2="1"><stop offset="0" stop-color="${TONES[k][0]}"/><stop offset="1" stop-color="${TONES[k][1]}"/></linearGradient>`).join('\n')}
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.green}" stop-opacity=".28"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/></linearGradient>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${T.bgA}"/><stop offset="1" stop-color="${T.bgB}"/></linearGradient>
</defs>
<g transform="translate(${pad[0]} ${pad[1]})">
${body}
</g>
</svg>
`
  return { T, C, t, rect, card, soft, tile, bar, chip, check, cross, svg, dark }
}

// Smooth path through points (Catmull-Rom to Bezier).
function smooth(pts) {
  let d = `M${n(pts[0][0])},${n(pts[0][1])}`
  for (let k = 0; k < pts.length - 1; k++) {
    const p0 = pts[k - 1] ?? pts[k], p1 = pts[k], p2 = pts[k + 1], p3 = pts[k + 2] ?? p2
    d += ` C${n(p1[0] + (p2[0] - p0[0]) / 6)},${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)},${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])},${n(p2[1])}`
  }
  return d
}

// Sample data: saved per day, 1–14 November 2026 (1 Nov is a Sunday).
const DAYS = [3.9, 14.62, 9.35, 21.48, 12.51, 1.58, -0.26, 6.2, 11.4, 8.75, 2.1, 16.3, 9.8, 4.12]
const SAVED = DAYS.reduce((a, b) => a + b, 0)
const WITHOUT = SAVED / 0.22
const WITH = WITHOUT - SAVED
const HOVER = 3 // Wed 4 Nov

// The month chart: area and line above zero in green, below it in red.
function monthChart(K, x, w, zero, scale, id, labels = true) {
  const { T, C, t } = K
  const pts = DAYS.map((v, k) => [x + 6 + (k * (w - 12)) / (DAYS.length - 1), zero - v * scale])
  const line = smooth(pts)
  let o = `<defs><clipPath id="${id}a"><rect x="0" y="0" width="2000" height="${zero}"/></clipPath><clipPath id="${id}b"><rect x="0" y="${zero}" width="2000" height="200"/></clipPath></defs>`
  o += `<line x1="${x}" x2="${x + w}" y1="${zero}" y2="${zero}" stroke="${T.line}" stroke-width="1.5"/>`
  o += `<path d="${line} L${n(pts.at(-1)[0])},${zero} L${n(pts[0][0])},${zero} Z" fill="url(#area)" clip-path="url(#${id}a)"/>`
  o += `<path d="${line}" fill="none" stroke="${C.green}" stroke-width="2.6" stroke-linecap="round" clip-path="url(#${id}a)"/>`
  o += `<path d="${line}" fill="none" stroke="${C.red}" stroke-width="2.6" stroke-linecap="round" clip-path="url(#${id}b)"/>`
  if (labels) {
    const h = pts[HOVER]
    o += `<line x1="${n(h[0])}" x2="${n(h[0])}" y1="${n(h[1])}" y2="${zero}" stroke="${C.green}" stroke-opacity=".45" stroke-dasharray="3 4"/>`
    o += `<circle cx="${n(h[0])}" cy="${n(h[1])}" r="9" fill="${C.green}" fill-opacity=".2"/><circle cx="${n(h[0])}" cy="${n(h[1])}" r="4.2" fill="${C.green}"/>`
    o += `<circle cx="${n(pts[6][0])}" cy="${n(pts[6][1])}" r="3.6" fill="${C.red}"/>`
  }
  const lab = [[0, '1 Nov', 'start'], [6, '7 Nov', 'middle'], [13, '14 Nov', 'end']]
  for (const [k, s, a] of lab) o += t(k === 0 ? x : k === 13 ? x + w : pts[k][0], zero + 24, s, { size: 11, fill: T.dim, anchor: a })
  return o
}

// ───────── Hero banner ─────────
function hero(K) {
  const { T, C, t, rect, card, tile, bar } = K
  const W = 1200, H = 440
  let o = rect(0, 0, W, H, 28, 'url(#bg)', T.line)
  o += `<g clip-path="url(#heroClip)"><circle cx="980" cy="90" r="190" fill="${VIOLETS[1]}" fill-opacity="${T.glow}" filter="url(#glow)"/><circle cx="160" cy="430" r="170" fill="${TONES.calm[1]}" fill-opacity="${n(T.glow * 0.7)}" filter="url(#glow)"/></g>`
  o = `<defs><clipPath id="heroClip"><rect width="${W}" height="${H}" rx="28"/></clipPath></defs>` + o
  o += tile(60, 58, C.violet, 'route', 60)
  o += t(140, 102, 'Claude Prompt Router', { size: 44, w: 800, ls: '-.02em' })
  o += t(60, 168, 'The right place, model and effort for every prompt,', { size: 23, w: 500, fill: T.ink })
  o += t(60, 200, 'decided before the agent starts working.', { size: 23, w: 500, fill: T.mute })
  const perks = [
    ['coin', C.green, 'Spend less', 'a cheaper model and effort whenever one can do the job'],
    ['window', C.violet, 'Keep chats lean', 'side work goes to a subagent, a new topic to a fresh session'],
    ['toggle', C.accent, 'Stay in control', 'every change is asked first, unless you choose auto'],
  ]
  perks.forEach(([ic, c, a, b], k) => {
    const y = 248 + k * 60
    o += tile(60, y, c, ic, 42) + t(118, y + 18, a, { size: 16, w: 700 }) + t(118, y + 37, b, { size: 13.5, fill: T.mute })
  })
  // A small "You saved" card.
  const x = 770, y = 46, w = 370
  o += card(x, y, w, 348)
  o += tile(x + 22, y + 22, C.green, 'coin') + t(x + 70, y + 45, 'You saved', { w: 600, size: 15 }) + t(x + w - 22, y + 45, PERIOD_LABELS.month, { anchor: 'end', size: 12, fill: T.mute })
  o += t(x + 22, y + 120, usd(SAVED), { size: 50, w: 800, fill: C.green, ls: '-.02em' }) + t(x + w - 22, y + 106, '22 % less', { size: 14, fill: C.green, anchor: 'end', w: 600 })
  o += bar(x + 22, y + 138, w - 44, 0.78)
  o += t(x + 22, y + 178, 'Without router', { size: 12, fill: T.mute }) + t(x + 22, y + 197, usd(WITHOUT), { w: 600, size: 15 })
  o += t(x + 190, y + 178, 'With router', { size: 12, fill: T.mute }) + t(x + 190, y + 197, usd(WITH), { w: 600, size: 15, fill: C.green })
  o += monthChart(K, x + 22, w - 44, y + 300, 3.3, 'hc', false)
  return K.svg(W, H, o, [0, 0])
}

// ───────── How it works ─────────
function howItWorks(K) {
  const { T, C, t, card, soft, tile } = K
  const W = 1200, H = 420
  let o = ''
  // Prompt → classifier.
  o += card(20, 160, 200, 100) + tile(40, 180, C.grey, 'spark') + t(88, 203, 'Your prompt', { size: 16, w: 700 }) + t(40, 238, 'only the text you typed', { size: 12.5, fill: T.mute })
  o += `<path d="M228 210h52" stroke="${T.dim}" stroke-width="2" stroke-linecap="round"/><path d="M273 203l8 7-8 7" fill="none" stroke="${T.dim}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`
  o += card(290, 140, 260, 140) + tile(312, 162, C.amber, 'cpu') + t(360, 185, 'Classifier', { size: 16, w: 700, fill: C.amber })
  o += t(312, 226, 'one small call per prompt', { size: 13, fill: T.ink }) + t(312, 248, 'none for yes, ok or option 2', { size: 12.5, fill: T.mute })
  // Four outcomes.
  const out = [
    ['keep', C.grey, 'toggle', 'an approval or an answer', 'nothing changes'],
    ['here', C.green, 'target', 'builds on this chat', 'maybe a new effort'],
    ['subagent', C.violet, 'branch', 'self-contained read, search, build, tests', 'short result back'],
    ['session', C.accent, 'window', 'unrelated, or long mechanical work', 'fresh context'],
  ]
  out.forEach(([k, c, ic, when, what], j) => {
    const y = 30 + j * 88, cy = y + 36
    o += `<path d="M558 210C624 210 616 ${cy} 682 ${cy}" fill="none" stroke="${c}" stroke-opacity=".7" stroke-width="2"/><circle cx="684" cy="${cy}" r="3.5" fill="${c}"/>`
    o += card(696, y, 484, 72, 16) + tile(714, y + 16, c, ic, 40)
    o += t(768, y + 31, WHERE_LABEL[k].text, { size: 16, w: 700, fill: c }) + t(768, y + 53, when, { size: 12.5, fill: T.mute })
    o += t(1162, y + 42, what, { size: 12.5, fill: T.ink, anchor: 'end', w: 500 })
  })
  o += soft(290, 378, 890, 34, 10) + t(735, 400, 'ask: you pick   ·   auto: applied, with a short notice', { size: 13, fill: T.mute, anchor: 'middle' })
  return K.svg(W, H, o, [0, 0])
}

// ───────── Feature cards ─────────
function features(K) {
  const { T, C, t, card, tile } = K
  const items = [
    ['route', C.violet, 'Routes every prompt', 'Keep, here, a subagent or a new session,', 'decided before the agent starts.'],
    ['cpu', C.amber, 'Picks model and effort', "On a new chat's first prompt, and the", 'effort on every later one.'],
    ['swap', C.green, 'Never breaks your cache', 'No model switch mid-chat. Another model', 'runs as a subagent instead.'],
    ['window', C.accent, 'Watches the context', 'Past the share you choose, new work', 'goes to a fresh session.'],
    ['coin', C.green, 'Shows what it saved', 'In dollars, per day and month, against', "keeping each chat's first model."],
    ['clock', C.amber, 'Cache countdown', 'How long the cache stays warm, and what', 'the next message costs warm or cold.'],
    ['pane', C.violet, 'A pane beside the chat', 'Every number and every setting,', 'so you rarely open a config file.'],
    ['spark', C.accent, 'No call for plain replies', 'yes, ok, option 2, a number or a letter,', 'in five languages.'],
    ['target', C.violet2, 'Local, with your rules', 'The log keeps no prompt text. Rules in', 'plain text, tuned with a live eval.'],
  ]
  const W = 1200, cw = (W - 40 - 48) / 3, ch = 146
  let o = ''
  items.forEach(([ic, c, title, a, b], k) => {
    const x = 20 + (k % 3) * (cw + 24), y = 14 + Math.floor(k / 3) * (ch + 24)
    o += card(x, y, cw, ch) + tile(x + 24, y + 24, c, ic, 42) + t(x + 80, y + 51, title, { size: 17, w: 700 })
    o += t(x + 24, y + 98, a, { size: 13.5, fill: T.mute }) + t(x + 24, y + 119, b, { size: 13.5, fill: T.mute })
  })
  return K.svg(W, 14 + 3 * ch + 2 * 24 + 14, o, [0, 8])
}

// ───────── Pane: You saved + Cache ─────────
function savedCache(K) {
  const { T, C, t, card, tile, bar, chip } = K
  const W = 480
  let o = card(8, 8, W - 16, 452)
  o += tile(28, 28, C.green, 'coin') + t(78, 42, 'You saved', { w: 600, size: 14 })
  o += t(78, 60, "compared with keeping each chat's first model", { size: 11, fill: T.mute })
  let x = 28
  for (const [k, label] of Object.entries(PERIOD_LABELS)) {
    const c = chip(x, 96, label, k === 'month')
    o += c.svg; x += c.w + 6
  }
  o += t(28, 186, usd(SAVED), { size: 46, w: 700, fill: C.green, ls: '-.02em' }) + t(W - 28, 176, '22 % less', { anchor: 'end', size: 13, fill: C.green, w: 500 })
  o += bar(28, 202, W - 56, 0.78)
  o += t(28, 244, 'Without router', { fill: T.mute, size: 12 }) + t(28, 262, usd(WITHOUT), { w: 600, size: 14 })
  o += t(250, 244, 'With router', { fill: T.mute, size: 12 }) + t(250, 262, usd(WITH), { w: 600, size: 14, fill: C.green })
  o += t(28, 298, 'Saved per day, this month', { size: 11.5, fill: T.mute })
  o += monthChart(K, 28, W - 56, 392, 3.6, 'sc')
  o += t(W / 2, 444, `Wed 4 Nov  ·  ${usd(DAYS[HOVER])} saved  ·  point at a day for its numbers`, { size: 11, fill: T.mute, anchor: 'middle' })
  // Cache
  const y = 476
  o += card(8, y, W - 16, 224)
  o += tile(28, y + 20, C.green, 'clock') + t(78, y + 34, 'Continue here', { w: 600, size: 14 })
  o += t(78, y + 52, "The next message reads this chat's 184k tokens", { size: 11, fill: T.mute }) + t(78, y + 67, 'from the cache: $0.04 instead of $1.47.', { size: 11, fill: T.mute })
  o += t(W - 28, y + 44, '47:12', { size: 34, w: 700, fill: C.green, anchor: 'end' }) + t(W - 28, y + 64, 'left', { anchor: 'end', size: 11.5, fill: T.mute })
  o += bar(28, y + 94, W - 56, 0.79, 'calm', 0.21)
  o += t(28, y + 120, 'Last reply 14:08', { size: 11, fill: T.mute }) + t(W - 28, y + 120, `${TTL_NAME['1h']} cache`, { size: 11, fill: T.mute, anchor: 'end' })
  o += t(28, y + 156, 'Next message, cache warm', { size: 12, fill: T.mute }) + t(28, y + 176, '$0.04', { w: 600, size: 15, fill: C.green })
  o += t(250, y + 156, 'Once it lapsed', { size: 12, fill: T.mute }) + t(250, y + 176, '$1.47', { w: 600, size: 15 })
  o += t(28, y + 206, 'Every message starts the hour again · list prices', { size: 11, fill: T.mute })
  return K.svg(W, y + 232, o)
}

// ───────── Pane: This chat + What you got ─────────
function thisChat(K) {
  const { T, C, t, card, soft, tile, bar } = K
  const W = 480, share = 44, at = 50
  const tn = tone(share, at)
  const col = { calm: C.green, near: C.amber, over: C.red, idle: C.grey }[tn]
  let o = card(8, 8, W - 16, 214)
  o += tile(28, 28, col, 'gauge') + t(78, 42, 'This chat', { w: 600, size: 14 }) + t(78, 60, 'Sonnet · High', { size: 11.5, fill: T.mute })
  o += t(28, 118, `${share} %`, { size: 38, w: 700, fill: col, ls: '-.02em' }) + t(W - 28, 108, '440k of 1M tokens', { anchor: 'end', size: 12, fill: T.mute })
  o += bar(28, 134, W - 56, share / 100, tn, at / 100)
  o += t(28, 166, `Asks for a new session at ${at} % (500k). The tick on the bar marks it.`, { size: 11, fill: T.mute })
  o += t(28, 196, 'Last reply', { size: 11.5, fill: T.mute }) + t(28, 214, '$0.09', { w: 600, size: 14 })
  o += t(250, 196, 'This session', { size: 11.5, fill: T.mute }) + t(250, 214, '$9.84', { w: 600, size: 14 })
  o += card(8, 238, W - 16, 254)
  o += tile(28, 258, C.violet, 'spark') + t(78, 272, 'What you got', { w: 600, size: 14 }) + t(78, 290, 'From the log, same period as above', { size: 11.5, fill: T.mute })
  const mini = (x, y, w, h, a, b, c, d) =>
    soft(x, y, w, h) + t(x + 14, y + 24, a, { size: 11.5, fill: T.mute }) + t(x + 14, y + 46, b, { w: 700, size: 16 }) + t(x + 14, y + 66, c, { size: 10.5, fill: T.mute }) + (d ? t(x + 14, y + 80, d, { size: 10.5, fill: T.mute }) : '')
  o += mini(24, 308, 208, 92, 'Kept out of your chat', '5.8 M tokens', 'read by subagents instead,', '≈ 6 full contexts')
  o += mini(244, 308, 212, 92, 'Cheaper picks saved', '$58.40', '≈ 4.1 % of your weekly limit;', 'stronger picks used $2.12')
  o += mini(24, 410, W - 48, 70, 'Weekly limit, all in', '≈ 4.4 % less', `+${usd(SAVED)}; 1 % of your limit ≈ $14.36, measured`)
  return K.svg(W, 500, o)
}

// ───────── Pane: settings ─────────
function settingRow(K, x, y, w, color, ic, title, desc, value, kind = 'select') {
  const { T, t, rect, soft, tile } = K
  const h = 24 + desc.length * 15 + 26
  let o = soft(x, y, w, h, 14) + tile(x + 14, y + 20, color, ic, 34) + t(x + 62, y + 34, title, { w: 600, size: 13 })
  desc.forEach((l, k) => (o += t(x + 62, y + 52 + k * 15, l, { size: 10.8, fill: T.mute })))
  if (kind === 'switch') {
    const on = value === 'On'
    o += rect(x + w - 66, y + 20, 52, 28, 14, on ? T.chipOn : T.chip) + t(x + w - 40, y + 39, value, { anchor: 'middle', size: 12.5, fill: on ? T.chipOnText : T.chipText, w: 600 })
  } else {
    const bw = Math.max(70, value.length * 7.4 + 40)
    o += rect(x + w - bw - 14, y + 20, bw, 28, 9, T.card, T.line) + t(x + w - bw - 2, y + 39, value, { size: 12.5 }) +
      `<path d="M${n(x + w - 34)} ${y + 32}l4 4 4-4" fill="none" stroke="${T.mute}" stroke-width="1.5" stroke-linecap="round"/>`
  }
  return { svg: o, h }
}
function group(K, W, y, color, ic, title, sub, rows) {
  const { T, t, card, tile } = K
  let inner = '', yy = y + 76
  for (const r of rows) {
    const s = settingRow(K, 24, yy, W - 48, color, ...r)
    inner += s.svg; yy += s.h + 10
  }
  const h = yy - y + 6
  return { svg: card(8, y, W - 16, h) + tile(28, y + 20, color, ic, 38) + t(80, y + 36, title, { w: 600, size: 14 }) + t(80, y + 54, sub, { size: 11.5, fill: T.mute }) + inner, h }
}
function settings(K, which) {
  const { C } = K
  const W = 480
  const router = y => group(K, W, y, C.violet, 'route', 'Router', 'Routing every prompt', [['route', 'Router', ['Picks the cheapest model and effort that', 'can handle each prompt.'], 'On', 'switch']])
  const model = y => group(K, W, y, C.violet2, 'sliders', 'Model & effort', 'ask · ask · auto · ask', [
    ['spark', 'Model for a new chat', ['On your first prompt, suggests a better', 'model. Ask: you confirm. Auto: it just', 'switches. Recommended: ask.'], 'ask'],
    ['swap', 'Model mid-chat', ['When a later prompt needs a different model,', 'offers a subagent. Recommended: ask.'], 'ask'],
    ['gauge', 'Effort', ['Raises or lowers the thinking effort to fit', 'the prompt. Recommended: ask.'], 'auto'],
    ['branch', 'Subagents', ['Sends a side task to a cheaper subagent', 'instead of switching this chat.', 'Recommended: ask.'], 'ask'],
  ])
  const session = y => group(K, W, y, C.green, 'window', 'Session', '50% · ask · on', [
    ['window', 'Start a new session at', ['Once the chat fills this much of its', 'context, new work goes to a fresh session.', 'Recommended: 50%.'], '50%'],
    ['window', 'New session: ask or auto', ['Ask: you confirm. Auto: it starts by itself', 'when the chat reaches the share.'], 'ask'],
    ['bell', 'Notifications', ['Shows a short note when the router changes', 'something. Recommended: on.'], 'On', 'switch'],
  ])
  const more = y => group(K, W, y, C.accent, 'sliders', 'More settings', 'Classifier, savings baseline, auto-open', [
    ['cpu', 'Decided by', ['The model that reads your prompt and', 'decides. Haiku is cheaper, Sonnet more', 'accurate. Recommended: haiku.'], 'haiku'],
    ['scale', 'Savings compared with', ['What "You saved" is measured against.', 'Recommended: first.'], 'first model'],
    ['pane', 'Open this pane on start', ['Opens this pane by itself when a session', 'starts. Recommended: off.'], 'Off', 'switch'],
  ])
  let y = 8, body = ''
  for (const p of which === 'a' ? [router, model] : [session, more]) { const g = p(y); body += g.svg; y += g.h + 14 }
  return K.svg(W, y, body)
}

// ───────── Pane: Details ─────────
function details(K) {
  const { T, C, t, rect, card, soft, tile } = K
  const W = 480
  let o = card(8, 8, W - 16, 384)
  o += tile(28, 28, C.violet, 'chart') + t(78, 42, 'Details', { w: 600, size: 14 }) + t(78, 60, 'Balance +$3.12 · 94 % right', { size: 11.5, fill: T.mute })
  o += soft(24, 90, W - 48, 128, 14)
  o += t(40, 118, 'Router balance', { size: 12, fill: T.mute }) + t(40, 160, '+$3.12', { size: 32, w: 700, fill: C.green, ls: '-.02em' }) +
    t(40, 182, 'vs. your own picks, classifier included', { size: 11, fill: T.mute }) + t(40, 206, 'Decisions right · 95 %: 88–97 %', { size: 11, fill: T.mute })
  const cx = 384, cy = 154, r = 38, circ = 2 * Math.PI * r, lo = 0.88, hi = 0.97, p = 0.94
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.violet}" stroke-opacity="${T.tile}" stroke-width="9"/>`
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.violet}" stroke-opacity=".4" stroke-width="9" stroke-dasharray="${n((hi - lo) * circ)} ${n(circ)}" stroke-dashoffset="${n(-lo * circ)}" transform="rotate(-90 ${cx} ${cy})"/>`
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.violet}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${n(p * circ - 6)} ${n(circ)}" transform="rotate(-90 ${cx} ${cy})"/>`
  o += t(cx, cy + 2, '94%', { anchor: 'middle', size: 19, w: 700 }) + t(cx, cy + 18, 'right', { anchor: 'middle', size: 10.5, fill: T.mute })
  o += t(28, 252, 'Where tasks went', { w: 600, size: 12.5 }) + t(W - 28, 252, '117 tasks', { anchor: 'end', size: 12, fill: T.mute })
  const parts = [['opus', 0.58, VIOLETS[0], 68, '$0.88'], ['haiku', 0.24, VIOLETS[1], 28, '$0.06'], ['sonnet', 0.18, VIOLETS[2], 21, '$0.36']]
  const bw = W - 56
  let bx = 28
  o += `<defs><clipPath id="pill"><rect x="28" y="266" width="${bw}" height="12" rx="6"/></clipPath></defs><g clip-path="url(#pill)">`
  for (const [, f, c] of parts) { o += rect(bx, 266, bw * f - 2, 12, 0, c); bx += bw * f }
  o += '</g>'
  parts.forEach(([nm, f, c, k, cost], j) => {
    const y = 304 + j * 26
    o += rect(28, y - 9, 10, 10, 3, c) + t(46, y, nm, { size: 12.5 }) + t(250, y, `${k} tasks · ${cost}/task`, { size: 12, fill: T.mute, anchor: 'middle' }) + t(W - 28, y, `${Math.round(f * 100)} %`, { size: 12.5, w: 600, anchor: 'end' })
  })
  o += t(28, 380, 'Full table: /router stats.', { size: 11, fill: T.mute })
  return K.svg(W, 400, o)
}

// ───────── Platforms ─────────
function platforms(K) {
  const { T, C, t, rect, card, soft, check, cross } = K
  const W = 1200, x0 = 20, colX = 268, cw = 128
  const heads = [['Where, model,', 'effort'], ['Ask or auto'], ['Subagent'], ['New session'], ['Pane, cache', 'countdown'], ['Savings'], ['Status']]
  const ok = { ok: 1 }, no = { no: 1 }
  const rows = [
    ['Claude Code', 'mod · desktop app, CLI, VS Code', C.accent, [ok, ok, ['Agent tool'], ['start_session'], ok, ['pane, footer,', '/router stats'], { dot: C.green, text: 'used daily' }]],
    ['OpenCode', 'plugin · CLI / TUI, desktop', C.grey, [ok, ok, ['task'], ['router_session'], no, ['router_stats', 'text table'], { dot: C.amber, text: 'unit-tested only' }]],
  ]
  const orch = ['Orca', 'Claude Squad', 'Conductor', 'Crystal', 'Vibe Kanban']
  const rowH = 66, headH = 64, orchH = 40
  const H = 20 + headH + rows.length * rowH + 52 + orch.length * orchH + 20
  let o = card(x0, 10, W - 40, H - 20)
  heads.forEach((h, k) => h.forEach((s, j) => (o += t(colX + k * cw + cw / 2, 46 + j * 16 - (h.length - 1) * 8, s, { size: 12, w: 600, fill: T.mute, anchor: 'middle' }))))
  let y = 10 + headH
  for (const [name, sub, dot, cells] of rows) {
    o += `<line x1="${x0 + 20}" x2="${W - x0 - 20}" y1="${y}" y2="${y}" stroke="${T.line}"/>`
    const cy = y + rowH / 2
    o += `<circle cx="${x0 + 30}" cy="${cy - 6}" r="6" fill="${dot}"/>` + t(x0 + 46, cy - 1, name, { size: 16, w: 700 }) + t(x0 + 46, cy + 17, sub, { size: 11.5, fill: T.mute })
    cells.forEach((c, k) => {
      const mx = colX + k * cw + cw / 2
      if (c.ok) o += check(mx, cy)
      else if (c.no) o += cross(mx, cy)
      else if (c.dot) o += `<circle cx="${n(mx - c.text.length * 3.2 - 8)}" cy="${cy - 4}" r="4" fill="${c.dot}"/>` + t(mx + 6, cy, c.text, { size: 12.5, w: 600, anchor: 'middle' })
      else c.forEach((s, j) => (o += t(mx, cy + 4 + j * 16 - (c.length - 1) * 8, s, { size: 12.5, anchor: 'middle' })))
    })
    y += rowH
  }
  // Orchestrators: they start the real `claude`, so everything works as in the Claude Code row.
  o += rect(x0 + 1, y, W - 2 * x0 - 2, 40, 0, T.soft) + `<line x1="${x0}" x2="${W - x0}" y1="${y}" y2="${y}" stroke="${T.line}"/>`
  o += t(x0 + 24, y + 25, 'ORCHESTRATORS THAT RUN THE REAL claude', { size: 11.5, w: 700, fill: T.mute, ls: '.08em' })
  y += 52
  orch.forEach((name, k) => {
    o += `<circle cx="${x0 + 30}" cy="${y + k * orchH + 16}" r="4.5" fill="${C.accent}" fill-opacity=".55"/>` + t(x0 + 46, y + k * orchH + 21, name, { size: 15, w: 600 })
  })
  const bx = colX + 4, bw = cw * 7 - 8, by = y, bh = orch.length * orchH - 8
  o += soft(bx, by, bw, bh, 14)
  o += check(bx + 40, by + bh / 2 - 22) + t(bx + 64, by + bh / 2 - 17, 'Same as Claude Code. Each one starts the real claude CLI, so the router runs inside it unchanged.', { size: 14, w: 600 })
  o += t(bx + 64, by + bh / 2 + 10, 'Every decision, ask or auto, subagents and savings work as in the row above.', { size: 13, fill: T.mute })
  o += t(bx + 64, by + bh / 2 + 32, 'A new session is offered as a claude … command to run, as everywhere outside the desktop app.', { size: 13, fill: T.mute })
  return K.svg(W, H, o, [0, 8])
}

const DRAW = {
  hero, 'how-it-works': howItWorks, features, platforms,
  'pane-saved-cache': savedCache, 'pane-this-chat': thisChat,
  'pane-settings-a': K => settings(K, 'a'), 'pane-settings-b': K => settings(K, 'b'), 'pane-details': details,
}
const written = []
for (const mode of ['light', 'dark']) {
  const K = kit(mode)
  for (const [name, draw] of Object.entries(DRAW)) {
    const file = `${name}-${mode}.svg`
    writeFileSync(join(OUT, file), draw(K))
    written.push(file)
  }
}
console.log('wrote', written.join(', '))
