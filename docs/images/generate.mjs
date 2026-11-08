// Generates the README's pane illustrations as SVG, with sample data (not real usage).
// Run: node docs/images/generate.mjs   (writes the .svg files next to this script)
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = dirname(fileURLToPath(import.meta.url))
const FONT = `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Helvetica, Arial, sans-serif`
const C = {
  bg: '#141716', card: '#1b1f1d', card2: '#222725', line: '#2c3230', text: '#eef2ef', mute: '#9aa59f', dim: '#6b7570',
  green: '#5cc98f', green2: '#2f8a5f', red: '#e0554f', teal: '#3fb6a0', orange: '#e0834a', blue: '#5b8def', purple: '#8b7cf0', amber: '#e3b341',
}
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
const t = (x, y, s, o = {}) =>
  `<text x="${x}" y="${y}" font-size="${o.size ?? 13}" font-weight="${o.w ?? 400}" fill="${o.fill ?? C.text}" text-anchor="${o.anchor ?? 'start'}" ${o.ls ? `letter-spacing="${o.ls}"` : ''}>${esc(s)}</text>`
const rect = (x, y, w, h, r, fill, stroke, sw = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}" ${stroke ? `stroke="${stroke}" stroke-width="${sw}"` : ''}/>`

const ICON = {
  dollar: c => `<path d="M12 6v12M15 9.2c-.6-.8-1.7-1.2-3-1.2-1.7 0-2.8.8-2.8 2 0 1.3 1.1 1.8 2.8 2.1 1.8.3 3 .8 3 2.1 0 1.2-1.2 2-3 2-1.4 0-2.5-.5-3.1-1.4" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  clock: c => `<circle cx="12" cy="12" r="6.5" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M12 8.5V12l2.4 1.6" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  gauge: c => `<path d="M6 16.5a7 7 0 1 1 12 0" fill="none" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><path d="M12 13.5l2.6-3.4" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  spark: c => `<path d="M12 5l1.6 4.4L18 11l-4.4 1.6L12 17l-1.6-4.4L6 11l4.4-1.6z" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/>`,
  window: c => `<rect x="6" y="7" width="12" height="10" rx="2" fill="none" stroke="${c}" stroke-width="1.6"/><path d="M12 9.6v4.8M9.6 12h4.8" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/>`,
  bell: c => `<path d="M8 15.5h8l-1-1.6v-3a3 3 0 0 0-6 0v3z M11 17.5h2" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>`,
  sliders: c => `<path d="M7 9h10M7 15h10" stroke="${c}" stroke-width="1.6" stroke-linecap="round"/><circle cx="14" cy="9" r="1.8" fill="${C.card}" stroke="${c}" stroke-width="1.5"/><circle cx="10" cy="15" r="1.8" fill="${C.card}" stroke="${c}" stroke-width="1.5"/>`,
  route: c => `<circle cx="8" cy="8" r="1.8" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="16" cy="16" r="1.8" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M9.5 9.2c3 1 1 4.6 4.5 5.6" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round"/>`,
  chip: c => `<rect x="8" y="8" width="8" height="8" rx="1.5" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M10.5 6v2M13.5 6v2M10.5 16v2M13.5 16v2M6 10.5h2M6 13.5h2M16 10.5h2M16 13.5h2" stroke="${c}" stroke-width="1.3" stroke-linecap="round"/>`,
  scale: c => `<path d="M12 6.5v11M8 17.5h8M6.5 9.5h11M6.5 9.5l-1.8 4a2.2 2.2 0 0 0 3.6 0zM17.5 9.5l-1.8 4a2.2 2.2 0 0 0 3.6 0z" fill="none" stroke="${c}" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/>`,
  pane: c => `<rect x="6" y="7" width="12" height="10" rx="2" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M13.5 7v10" stroke="${c}" stroke-width="1.5"/>`,
  bars: c => `<path d="M8 17v-4M12 17V8M16 17v-6" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`,
  swap: c => `<path d="M7 10h9l-2.5-2.5M17 14H8l2.5 2.5" fill="none" stroke="${c}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`,
  branch: c => `<circle cx="9" cy="8" r="1.7" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="9" cy="16" r="1.7" fill="none" stroke="${c}" stroke-width="1.5"/><circle cx="15" cy="10" r="1.7" fill="none" stroke="${c}" stroke-width="1.5"/><path d="M9 9.7v4.6M15 11.7c0 2-6 1-6 2.6" fill="none" stroke="${c}" stroke-width="1.5"/>`,
}
const tile = (x, y, color, icon, s = 36) =>
  `<g transform="translate(${x} ${y})"><rect width="${s}" height="${s}" rx="10" fill="${color}" fill-opacity=".16"/><g transform="translate(${(s - 24) / 2} ${(s - 24) / 2})">${ICON[icon](color)}</g></g>`

const head = (w, h, extra = '') => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="${FONT}">
<defs>
<linearGradient id="gbar" x1="0" x2="1"><stop offset="0" stop-color="${C.green2}"/><stop offset="1" stop-color="${C.green}"/></linearGradient>
<linearGradient id="rbar" x1="0" x2="1"><stop offset="0" stop-color="#b53b36"/><stop offset="1" stop-color="${C.orange}"/></linearGradient>
<linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${C.green}" stop-opacity=".34"/><stop offset="1" stop-color="${C.green}" stop-opacity="0"/></linearGradient>
<linearGradient id="hero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#101514"/><stop offset="1" stop-color="#17201c"/></linearGradient>
<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
${extra}</defs>`

const card = (x, y, w, h, border = C.line, fill = C.card) => rect(x, y, w, h, 18, fill, border, 1.2)
const bar = (x, y, w, frac, grad = 'gbar', tick) =>
  rect(x, y, w, 8, 4, '#2a302e') + rect(x, y, Math.max(8, w * frac), 8, 4, `url(#${grad})`) +
  (tick != null ? `<rect x="${x + w * tick - 1}" y="${y - 3}" width="2" height="14" rx="1" fill="${C.text}"/>` : '')

// Smooth path through points (Catmull-Rom to Bezier).
function smooth(pts) {
  let d = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2
    d += ` C${p1[0] + (p2[0] - p0[0]) / 6},${p1[1] + (p2[1] - p0[1]) / 6} ${p2[0] - (p3[0] - p1[0]) / 6},${p2[1] - (p3[1] - p1[1]) / 6} ${p2[0]},${p2[1]}`
  }
  return d
}

// ───────── Pane: You saved + Cache ─────────
function savedCache() {
  const W = 480, days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  const v = [3.9, 14.62, 9.35, 21.48, 12.51, 1.58, -0.26]
  const cx = 28, cw = W - 56, zero = 372, scale = 2.7
  const pts = v.map((a, i) => [cx + 10 + (i * (cw - 20)) / 6, zero - a * scale])
  const line = smooth(pts)
  const seg = (a, b) => `<path d="${a}" fill="none" stroke="${b}" stroke-width="2.4" stroke-linecap="round"/>`
  let o = head(W, 690)
  o += rect(0, 0, W, 690, 0, 'none')
  // You saved
  o += card(8, 8, W - 16, 432, '#2a302e')
  o += tile(28, 28, C.green, 'dollar') + t(78, 42, 'You saved', { w: 600, size: 14 }) +
    t(78, 60, 'compared with running every prompt on your history (71 % Opus high,', { size: 11, fill: C.mute }) +
    t(78, 75, '16 % Opus extra high, 9 % Opus max, 4 % Sonnet high)', { size: 11, fill: C.mute })
  const tabs = [['Today', 28, 62], ['7 days', 98, 70], ['Total', 176, 60]]
  for (const [n, x, w] of tabs) {
    const on = n === '7 days'
    o += rect(x, 96, w, 30, 9, on ? '#f2f5f3' : '#2b312f') + t(x + w / 2, 115, n, { size: 12.5, anchor: 'middle', fill: on ? '#101312' : '#cfd6d2', w: 500 })
  }
  o += `<text x="28" y="186" font-size="46" font-weight="700" fill="${C.green}">$63.18</text>`
  o += t(W - 28, 176, '22 % less', { anchor: 'end', size: 13, fill: C.green, w: 500 })
  o += bar(28, 202, W - 56, 0.78)
  o += t(28, 244, 'Without router', { fill: C.mute, size: 12 }) + t(28, 262, '$284.60', { w: 600, size: 14 })
  o += t(250, 244, 'With router', { fill: C.mute, size: 12 }) + t(250, 262, '$221.42', { w: 600, size: 14, fill: C.green })
  o += t(28, 298, 'Saved per day, last 7 days', { size: 11.5, fill: C.mute })
  // chart
  o += `<line x1="${cx}" x2="${cx + cw}" y1="${zero}" y2="${zero}" stroke="#3a4240" stroke-width="1"/>`
  o += `<path d="${line} L${pts[6][0]},${zero} L${pts[0][0]},${zero} Z" fill="url(#area)" opacity=".9" clip-path="url(#above)"/>`
  o = o.replace('</defs>', `<clipPath id="above"><rect x="0" y="0" width="${W}" height="${zero}"/></clipPath><clipPath id="below"><rect x="0" y="${zero}" width="${W}" height="80"/></clipPath></defs>`)
  o += `<path d="${line}" fill="none" stroke="${C.green}" stroke-width="2.6" stroke-linecap="round" clip-path="url(#above)"/>`
  o += `<path d="${line}" fill="none" stroke="${C.red}" stroke-width="2.6" stroke-linecap="round" clip-path="url(#below)"/>`
  // hover on Thursday
  const th = pts[3]
  o += `<line x1="${th[0]}" x2="${th[0]}" y1="${th[1]}" y2="${zero}" stroke="${C.green}" stroke-opacity=".35" stroke-dasharray="3 4"/>`
  o += `<circle cx="${th[0]}" cy="${th[1]}" r="9" fill="${C.green}" fill-opacity=".18"/><circle cx="${th[0]}" cy="${th[1]}" r="4.2" fill="${C.green}"/>`
  o += `<circle cx="${pts[6][0]}" cy="${pts[6][1]}" r="4" fill="${C.red}"/>`
  days.forEach((d, i) => {
    const hov = i === 3
    if (hov) o += rect(pts[i][0] - 19, zero + 17, 38, 20, 10, '#2f3633')
    o += t(pts[i][0], zero + 31, d, { anchor: 'middle', size: 11, fill: hov ? C.text : C.dim, w: hov ? 600 : 400 })
  })
  o += t(W / 2, 424, 'Thu 5 Nov  ·  $21.48 saved  ·  point at a day for its numbers', { size: 11, fill: C.mute, anchor: 'middle' })
  // Cache
  o += card(8, 456, W - 16, 224, C.green2)
  o += tile(28, 476, C.green, 'clock') + t(78, 490, 'Continue here', { w: 600, size: 14 })
  o += t(78, 508, "The next message reads this chat's 184k tokens from the", { size: 11, fill: C.mute }) + t(78, 523, 'cache: $0.04 instead of $1.47.', { size: 11, fill: C.mute })
  o += `<text x="${W - 28}" y="500" font-size="34" font-weight="700" fill="${C.green}" text-anchor="end">47:12</text>` + t(W - 28, 520, 'left', { anchor: 'end', size: 11.5, fill: C.mute })
  o += bar(28, 550, W - 56, 0.79, 'gbar', 0.21)
  o += t(28, 576, 'Last reply 14:08', { size: 11, fill: C.mute }) + t(W - 28, 576, '1-hour cache', { size: 11, fill: C.mute, anchor: 'end' })
  o += t(28, 612, 'Next message, cache warm', { size: 12, fill: C.mute }) + t(28, 632, '$0.04', { w: 600, size: 15, fill: C.green })
  o += t(250, 612, 'Once it lapsed', { size: 12, fill: C.mute }) + t(250, 632, '$1.47', { w: 600, size: 15 })
  o += t(28, 662, 'Every message starts the hour again · list prices', { size: 11, fill: C.mute })
  return o + '</svg>'
}

// ───────── Pane: This chat + What you got ─────────
function thisChat() {
  const W = 480
  let o = head(W, 500)
  o += card(8, 8, W - 16, 214, '#3a2a29')
  o += tile(28, 28, C.red, 'gauge') + t(78, 42, 'This chat', { w: 600, size: 14 }) + t(78, 60, 'Sonnet · High', { size: 11.5, fill: C.mute })
  o += t(28, 118, '34 %', { size: 38, w: 700, fill: C.orange }) + t(W - 28, 108, '341k of 1M tokens', { anchor: 'end', size: 12, fill: C.mute })
  o += bar(28, 134, W - 56, 0.34, 'rbar', 0.5)
  o += t(28, 166, 'Asks for a new session at 50 % (500k). The tick on the bar marks it.', { size: 11, fill: C.mute })
  o += t(28, 196, 'Last reply', { size: 11.5, fill: C.mute }) + t(28, 214, '$0.09', { w: 600, size: 14 })
  o += t(250, 196, 'This session', { size: 11.5, fill: C.mute }) + t(250, 214, '$9.84', { w: 600, size: 14 })
  o += card(8, 238, W - 16, 254, C.line)
  o += tile(28, 258, C.teal, 'spark') + t(78, 272, 'What you got', { w: 600, size: 14 }) + t(78, 290, 'From the log, same period as above', { size: 11.5, fill: C.mute })
  const mini = (x, y, w, h, a, b, c, d) =>
    rect(x, y, w, h, 12, C.card2, '#323a37') + t(x + 14, y + 24, a, { size: 11.5, fill: C.mute }) + t(x + 14, y + 46, b, { w: 700, size: 16 }) + t(x + 14, y + 66, c, { size: 10.5, fill: C.mute }) + (d ? t(x + 14, y + 80, d, { size: 10.5, fill: C.mute }) : '')
  o += mini(24, 308, 208, 92, 'Kept out of your chat', '5.8 M tokens', 'read by subagents instead,', '≈ 6 full contexts')
  o += mini(244, 308, 212, 92, 'Cheaper picks saved', '$58.40', '≈ 4.1 % of your weekly limit;', 'stronger picks used $2.12')
  o += mini(24, 410, W - 48, 70, 'Weekly limit, all in', '≈ 4.4 % less', '+$63.18; 1 % of your limit ≈ $14.36, measured')
  return o + '</svg>'
}

// ───────── Pane: settings ─────────
function settingRow(x, y, w, color, icon, title, desc, value, kind = 'select') {
  const lines = desc
  let o = rect(x, y, w, 24 + lines.length * 15 + 26, 14, C.card2, '#323a37')
  o += tile(x + 14, y + 20, color, icon, 34) + t(x + 62, y + 34, title, { w: 600, size: 13 })
  lines.forEach((l, i) => (o += t(x + 62, y + 52 + i * 15, l, { size: 10.8, fill: C.mute })))
  if (kind === 'switch') {
    const on = value === 'On'
    o += rect(x + w - 66, y + 20, 52, 28, 14, on ? '#f1f4f2' : '#3a4240') + t(x + w - 40, y + 39, value, { anchor: 'middle', size: 12.5, fill: on ? '#111' : C.mute, w: 600 })
  } else {
    const bw = Math.max(70, value.length * 7.4 + 40)
    o += rect(x + w - bw - 14, y + 20, bw, 28, 9, '#2d3431', '#3b4441') + t(x + w - bw - 14 + 12, y + 39, value, { size: 12.5 }) +
      `<path d="M${x + w - 34} ${y + 32}l4 4 4-4" fill="none" stroke="${C.mute}" stroke-width="1.5" stroke-linecap="round"/>`
  }
  return { svg: o, h: 24 + lines.length * 15 + 26 }
}
function group(W, y, color, icon, title, sub, rows) {
  let inner = '', yy = y + 76
  for (const r of rows) {
    const s = settingRow(24, yy, W - 48, color, ...r)
    inner += s.svg; yy += s.h + 10
  }
  const h = yy - y + 6
  return { svg: card(8, y, W - 16, h, color) + tile(28, y + 20, color, icon, 38) + t(80, y + 36, title, { w: 600, size: 14 }) + t(80, y + 54, sub, { size: 11.5, fill: C.mute }) + inner, h }
}
function settings(which) {
  const W = 480
  const router = y => group(W, y, C.purple, 'route', 'Router', 'Routing every prompt', [['route', 'Router', ['Picks the cheapest model and effort that', 'can handle each prompt.'], 'On', 'switch']])
  const model = y => group(W, y, C.blue, 'sliders', 'Model & effort', 'ask · ask · auto · ask', [
    ['spark', 'Model for a new chat', ['On your first prompt, suggests a better', 'model. Ask: you confirm. Auto: it just', 'switches. Recommended: ask.'], 'ask'],
    ['swap', 'Model mid-chat', ['When a later prompt needs a different model,', 'offers a subagent. Recommended: ask.'], 'ask'],
    ['gauge', 'Effort', ['Raises or lowers the thinking effort to fit', 'the prompt. Recommended: ask.'], 'auto'],
    ['branch', 'Subagents', ['Sends a side task to a cheaper subagent', 'instead of switching this chat.', 'Recommended: ask.'], 'ask'],
  ])
  const session = y => group(W, y, C.teal, 'window', 'Session', '50% · ask · on', [
    ['window', 'Start a new session at', ['Once the chat fills this much of its', 'context, new work goes to a fresh session.', 'Recommended: 50%.'], '50%'],
    ['window', 'New session: ask or auto', ['Ask: you confirm. Auto: it starts by itself', 'when the chat reaches the share.'], 'ask'],
    ['bell', 'Notifications', ['Shows a short note when the router changes', 'something. Recommended: on.'], 'On', 'switch'],
  ])
  const more = y => group(W, y, C.orange, 'sliders', 'More settings', 'Classifier, savings baseline, auto-open', [
    ['chip', 'Decided by', ['The model that reads your prompt and', 'decides. Haiku is cheaper, Sonnet more', 'accurate. Recommended: haiku.'], 'haiku (recommended)'],
    ['scale', 'Savings compared with', ['What "You saved" is measured against.', 'Recommended: history.'], 'history (recommended)'],
    ['pane', 'Open this pane on start', ['Opens this pane by itself when a session', 'starts. Recommended: off.'], 'Off', 'switch'],
  ])
  const parts = which === 'a' ? [router, model] : [session, more]
  let y = 8, body = ''
  for (const p of parts) { const g = p(y); body += g.svg; y += g.h + 14 }
  return head(W, y) + body + '</svg>'
}

// ───────── Pane: Details ─────────
function details() {
  const W = 480
  let o = head(W, 400)
  o += card(8, 8, W - 16, 384, C.purple)
  o += tile(28, 28, C.purple, 'bars') + t(78, 42, 'Details', { w: 600, size: 14 }) + t(78, 60, 'Balance +$3.12 · 94 % right', { size: 11.5, fill: C.mute })
  o += rect(24, 90, W - 48, 128, 14, C.card2, '#323a37')
  o += t(40, 118, 'Router balance', { size: 12, fill: C.mute }) + t(40, 160, '+$3.12', { size: 32, w: 700, fill: C.green }) +
    t(40, 182, 'vs. your own picks, classifier included', { size: 11, fill: C.mute }) + t(40, 206, 'Decisions right · 95 %: 88–97 %', { size: 11, fill: C.mute })
  // ring
  const cx = 384, cy = 154, r = 38, circ = 2 * Math.PI * r
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#323a37" stroke-width="9"/>`
  const lo = 0.88, hi = 0.97, p = 0.94
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.purple}" stroke-opacity=".38" stroke-width="9" stroke-dasharray="${(hi - lo) * circ} ${circ}" stroke-dashoffset="${-lo * circ}" transform="rotate(-90 ${cx} ${cy})"/>`
  o += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${C.purple}" stroke-width="9" stroke-linecap="round" stroke-dasharray="${p * circ - 6} ${circ}" transform="rotate(-90 ${cx} ${cy})"/>`
  o += t(cx, cy + 2, '94%', { anchor: 'middle', size: 19, w: 700 }) + t(cx, cy + 18, 'right', { anchor: 'middle', size: 10.5, fill: C.mute })
  o += t(28, 252, 'Where tasks went', { w: 500, size: 12.5 }) + t(W - 28, 252, '117 tasks', { anchor: 'end', size: 12, fill: C.mute })
  const parts = [['opus', 0.58, '#5b4fd6', 68, '$0.88'], ['haiku', 0.24, '#8b7cf0', 28, '$0.06'], ['sonnet', 0.18, '#b3a8f7', 21, '$0.36']]
  let bx = 28; const bw = W - 56
  o += `<clipPath id="pill"><rect x="28" y="266" width="${bw}" height="12" rx="6"/></clipPath><g clip-path="url(#pill)">`
  parts.forEach(([, f, c]) => { o += `<rect x="${bx}" y="266" width="${bw * f - 2}" height="12" fill="${c}"/>`; bx += bw * f })
  o += '</g>'
  parts.forEach(([n, f, c, k, cost], i) => {
    const y = 304 + i * 26
    o += rect(28, y - 9, 10, 10, 3, c) + t(46, y, n, { size: 12.5 }) + t(250, y, `${k} tasks · ${cost}/task`, { size: 12, fill: C.mute, anchor: 'middle' }) + t(W - 28, y, `${Math.round(f * 100)} %`, { size: 12.5, w: 600, anchor: 'end' })
  })
  o += t(28, 380, 'Full table: /router stats.', { size: 11, fill: C.mute })
  return o + '</svg>'
}

// ───────── Hero banner ─────────
function hero() {
  const W = 1200, H = 430
  let o = head(W, H)
  o += rect(0, 0, W, H, 28, 'url(#hero)', '#26302b', 1.5)
  o += `<circle cx="1010" cy="120" r="170" fill="${C.green}" fill-opacity=".10" filter="url(#glow)"/><circle cx="170" cy="400" r="150" fill="${C.purple}" fill-opacity=".09" filter="url(#glow)"/>`
  o += `<g transform="translate(60 56)"><rect width="64" height="64" rx="18" fill="${C.green}" fill-opacity=".16" stroke="${C.green}" stroke-opacity=".5"/><g transform="translate(14 14) scale(1.5)">${ICON.route(C.green)}</g></g>`
  o += t(144, 100, 'Prompt Router', { size: 46, w: 800 })
  o += t(60, 168, 'The right place, the right model and the right effort', { size: 24, fill: '#d6ddd9', w: 500 })
  o += t(60, 200, 'for every prompt, decided before the agent starts working.', { size: 24, fill: '#d6ddd9', w: 500 })
  o += t(60, 244, 'And a pane that shows what it saved you.', { size: 18, fill: C.green, w: 600 })
  // flow
  const node = (x, y, w, label, sub, col) =>
    rect(x, y, w, 62, 14, C.card, col, 1.4) + t(x + w / 2, y + 28, label, { anchor: 'middle', size: 15, w: 700, fill: col }) + t(x + w / 2, y + 48, sub, { anchor: 'middle', size: 11.5, fill: C.mute })
  o += node(60, 300, 150, 'Your prompt', 'any chat', C.text)
  o += `<path d="M214 331h34" stroke="${C.dim}" stroke-width="2" stroke-linecap="round"/><path d="M243 325l7 6-7 6" fill="none" stroke="${C.dim}" stroke-width="2" stroke-linecap="round"/>`
  o += node(254, 300, 170, 'Classifier', 'one small call', C.amber)
  o += `<path d="M428 331h30" stroke="${C.dim}" stroke-width="2" stroke-linecap="round"/>`
  o += `<path d="M458 331c20 0 18-50 42-50M458 331h42M458 331c20 0 18 50 42 50" fill="none" stroke="${C.dim}" stroke-width="2"/>`
  const opts = [['here', 'this chat', C.green, 281], ['subagent', 'short result back', C.blue, 331], ['session', 'fresh context', C.purple, 381]]
  opts.forEach(([a, b, c, y], i) => (o += rect(500, y - 20, 200, 40, 12, C.card, c, 1.3) + t(516, y + 5, a, { size: 14, w: 700, fill: c }) + t(686, y + 5, b, { size: 11.5, fill: C.mute, anchor: 'end' })))
  // mini saved card
  o += card(760, 40, 380, 350, '#2a302e')
  o += tile(782, 62, C.green, 'dollar') + t(832, 86, 'You saved', { w: 600, size: 15 })
  o += t(782, 164, '$63.18', { size: 54, w: 800, fill: C.green }) + t(1118, 150, '22 % less', { size: 14, fill: C.green, anchor: 'end', w: 600 })
  o += bar(782, 182, 336, 0.78)
  o += t(782, 224, 'Without router', { size: 12, fill: C.mute }) + t(782, 244, '$284.60', { w: 600, size: 16 }) + t(960, 224, 'With router', { size: 12, fill: C.mute }) + t(960, 244, '$221.42', { w: 600, size: 16, fill: C.green })
  const v = [3.9, 14.62, 9.35, 21.48, 12.51, 1.58, -0.26], z = 344, pts = v.map((a, i) => [790 + (i * 320) / 6, z - a * 3.7])
  o += `<path d="${smooth(pts)} L${pts[6][0]},${z} L${pts[0][0]},${z} Z" fill="url(#area)"/><path d="${smooth(pts)}" fill="none" stroke="${C.green}" stroke-width="2.5" stroke-linecap="round"/>`
  o += `<line x1="782" x2="1118" y1="${z}" y2="${z}" stroke="#3a4240"/>` + t(782, 376, 'Mon', { size: 10.5, fill: C.dim }) + t(1118, 376, 'Sun', { size: 10.5, fill: C.dim, anchor: 'end' })
  return o + '</svg>'
}

const files = { 'hero.svg': hero(), 'pane-saved-cache.svg': savedCache(), 'pane-this-chat.svg': thisChat(), 'pane-settings-a.svg': settings('a'), 'pane-settings-b.svg': settings('b'), 'pane-details.svg': details() }
for (const [n, s] of Object.entries(files)) writeFileSync(join(OUT, n), s)
console.log('wrote', Object.keys(files).join(', '))
