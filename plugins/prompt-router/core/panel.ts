// The Prompt Router pane's drawings: SVG for the app surfaces (animated by CSS in the sandboxed frame,
// no scripts) and text bars for the terminal. Plain strings, so tests and a preview draw them too.
// The frame cannot read the app's colours: mid tones that read on light and dark, text by
// prefers-color-scheme, and every animation off under prefers-reduced-motion (the final state is the
// element's own style, the animation only runs from the start to it).

export const ACCENT = '#d97757'

export const TONES = {
  calm: ['#1fa37a', '#4cc59c'],
  near: ['#d98a1c', '#f0b545'],
  over: ['#e0483f', '#f07f4f'],
  idle: ['#8a8f98', '#a9aeb6'],
} as const

export type Tone = keyof typeof TONES

// How full the chat is against newSessionAt (or, with it off, against the whole window).
export function tone(share: number | null, at: number): Tone {
  if (share == null || !Number.isFinite(share)) return 'idle'
  const limit = at || 75
  if (share >= limit) return 'over'
  return share >= limit * (at ? 0.8 : 0.66) ? 'near' : 'calm'
}

// The terminal's colour for a tone.
export const TONE_THEME: Record<Tone, 'success' | 'warning' | 'error' | 'inactive'> = { calm: 'success', near: 'warning', over: 'error', idle: 'inactive' }

const STILL = '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}'
const n = (v: number) => Number(v.toFixed(2))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The chat's context as a flat bar: filled to its share in the tone's colour, a tick at the threshold.
// Still (no animation), so a redraw does not replay anything.
// from: where the fill starts growing (a share 0…100): 0 draws it in, the last shown share moves it on.
export function contextBarSvg(share: number | null, at: number, _width = 280, height = 10, animate = false, from = 0): string {
  // Percent lengths: the drawing fills whatever width the pane gives it, ends stay round.
  const p = share == null ? 0 : Math.min(1, Math.max(0, share / 100))
  const [a, b] = TONES[tone(share, at)]
  const r = n(height / 2)
  const w = n(p * 100)
  const label = share == null ? '–' : `${Math.round(share)}%`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height + 6}" role="img"><title>Context ${label}${at ? `, new session at ${at}%` : ''}</title><style>
.t{fill:#1d1f23;opacity:.08}.k{stroke:#1d1f23;stroke-width:2;stroke-linecap:round;opacity:.45}
@media (prefers-color-scheme: dark){.t{fill:#f2f3f5;opacity:.1}.k{stroke:#f2f3f5;opacity:.6}}
${animate ? `.f{animation:g .7s cubic-bezier(.2,.8,.2,1) both}@keyframes g{from{width:${n(Math.min(100, Math.max(0, from)))}%}}
${from ? '' : '.k{animation:o .5s .35s ease-out both}@keyframes o{from{opacity:0}}'}
${STILL}` : ''}
</style><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect class="t" y="3" width="100%" height="${height}" rx="${r}"/>${w ? `<rect class="f" y="3" width="${w}%" height="${height}" rx="${r}" fill="url(#s)"/>` : ''}${at ? `<line class="k" x1="${at}%" y1="1" x2="${at}%" y2="${height + 5}"/>` : ''}</svg>`
}

// A part of the balance as a bar from the middle: right for a saving, left for a cost, its length
// the part's share (−1…1) of the largest part. Still.
export function splitBarSvg(share: number, color: string, width = 160, height = 8): string {
  const mid = n(width / 2)
  const len = n(Math.min(1, Math.abs(share)) * mid)
  const x = share < 0 ? n(mid - len) : mid
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><style>
.t{fill:#8a8f98;opacity:.14}.m{stroke:#8a8f98;stroke-width:1;opacity:.6}
${STILL}
</style><rect class="t" width="${width}" height="${height}" rx="${n(height / 2)}"/>${len >= 0.5 ? `<rect x="${x}" width="${len}" height="${height}" rx="2" fill="${color}"/>` : ''}<line class="m" x1="${mid}" y1="0" x2="${mid}" y2="${height}"/></svg>`
}

// The net saving per day: a line that draws itself in, a soft area under it, the last day's dot,
// and a tooltip per day (labels, one per value).
// animate false: drawn in its final state at once (the pane's still redraws).
export function sparkSvg(values: readonly number[], labels: readonly string[], width = 280, height = 64, color: string = ACCENT, animate = true): string {
  const px = 6
  const py = 9
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo || 1
  const x = (i: number) => n(px + (values.length > 1 ? (i / (values.length - 1)) * (width - 2 * px) : (width - 2 * px) / 2))
  const y = (v: number) => n(py + ((hi - v) / span) * (height - 2 * py))
  const zero = y(0)
  const pts = values.map((v, i) => [x(i), y(v)] as const)
  let line = pts.length ? `M${pts[0]![0]} ${pts[0]![1]}` : ''
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!
    const [x1, y1] = pts[i]!
    const m = n((x0 + x1) / 2)
    line += ` C${m} ${y0} ${m} ${y1} ${x1} ${y1}`
  }
  const last = pts[pts.length - 1]
  const area = last ? `${line} L${last[0]} ${zero} L${pts[0]![0]} ${zero}Z` : ''
  const hits = pts
    .map(([px1, py1], i) => `<g class="h"><circle class="d" cx="${px1}" cy="${py1}" r="2.6"/><circle class="z" cx="${px1}" cy="${py1}" r="${n(Math.max(6, (width - 2 * px) / Math.max(1, values.length - 1) / 2))}"><title>${esc(labels[i] ?? '')}</title></circle></g>`)
    .join('')
  const empty = values.every(v => Math.abs(v) < 0.005)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><title>Net saving per day</title><style>
.l{fill:none;stroke:${empty ? '#8a8f98' : color};stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0}
.f{fill:url(#f)}
.o{stroke:#8a8f98;stroke-opacity:.35;stroke-width:1;stroke-dasharray:3 3}
.e{fill:${color};transform-box:fill-box;transform-origin:center}
.r{fill:${color};opacity:.22;transform-box:fill-box;transform-origin:center}
.d{fill:${color};opacity:0;transition:opacity .15s}.z{fill:transparent}.h:hover .d{opacity:1}
${animate ? `.l{animation:draw 1.5s cubic-bezier(.65,0,.35,1) both}.f{animation:fade 1s .7s ease-out both}
.e{animation:pop .5s 1.35s cubic-bezier(.34,1.56,.64,1) both}.r{animation:pop .5s 1.4s cubic-bezier(.34,1.56,.64,1) both}
@keyframes draw{from{stroke-dashoffset:1}}
@keyframes fade{from{opacity:0}}
@keyframes pop{from{transform:scale(0)}}
${STILL}` : ''}
</style><defs><linearGradient id="f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity="${empty ? 0 : 0.3}"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
${lo < 0 || empty ? `<line class="o" x1="${px}" y1="${zero}" x2="${width - px}" y2="${zero}"/>` : ''}${area ? `<path class="f" d="${area}"/>` : ''}${line ? `<path class="l" pathLength="1" d="${line}"/>` : ''}${last && !empty ? `<circle class="r" cx="${last[0]}" cy="${last[1]}" r="6"/><circle class="e" cx="${last[0]}" cy="${last[1]}" r="3.2"/>` : ''}${hits}</svg>`
}

// The terminal's ring: cells filled to the share, │ at the threshold.
export function barText(share: number | null, at: number, cells = 20): string {
  const filled = share == null ? 0 : Math.round((Math.min(100, Math.max(0, share)) / 100) * cells)
  const mark = at ? Math.round((at / 100) * cells) : -1
  let out = ''
  for (let i = 0; i < cells; i++) {
    if (i === mark) out += '│'
    out += i < filled ? '▰' : '▱'
  }
  return out
}

// The terminal's split bar: cells left of │ for a cost, right of it for a saving.
export function splitBarText(share: number, cells = 16): string {
  const half = Math.max(1, Math.floor(cells / 2))
  const k = Math.round(Math.min(1, Math.abs(share)) * half)
  const left = share < 0 ? '·'.repeat(half - k) + '█'.repeat(k) : '·'.repeat(half)
  const right = share > 0 ? '█'.repeat(k) + '·'.repeat(half - k) : '·'.repeat(half)
  return `${left}│${right}`
}

const BLOCKS = '▁▂▃▄▅▆▇█'

// The terminal's sparkline, one block per value from the lowest (or 0) to the highest.
export function sparkText(values: readonly number[]): string {
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const span = hi - lo
  return values.map(v => BLOCKS[span ? Math.round(((v - lo) / span) * 7) : 0]).join('')
}

export function ago(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 10) return 'just now'
  if (s < 60) return `${s} s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} h ago`
  return `${Math.floor(h / 24)} d ago`
}

// What each decision is called on the card, with a glyph.
export const WHERE_LABEL = {
  here: { glyph: '●', text: 'Stays here' },
  subagent: { glyph: '↳', text: 'Subagent' },
  session: { glyph: '⧉', text: 'New session' },
  keep: { glyph: '=', text: 'Kept as is' },
  other: { glyph: '⇄', text: 'Subagent on another model' },
} as const

// Tokens as 94k / 1.2M.
export function kTokens(t: number): string {
  return t >= 1_000_000 ? `${n(t / 1_000_000)}M` : `${Math.round(t / 1000)}k`
}

// A big bold figure (the pane's "You saved"), since Text has no font size.
export function bigNumberSvg(text: string, color: string, _width = 280, size = 36, animate = false): string {
  const h = Math.round(size * 1.25)
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  // animate: rises in, drawn only on the one redraw after a turn ends; every other redraw is still.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${h}"><style>text{letter-spacing:-.02em}${animate ? `text{animation:r .5s cubic-bezier(.2,.8,.2,1) both}@keyframes r{from{opacity:0;transform:translateY(8px)}}${STILL}` : ''}</style><text x="0" y="${Math.round(size)}" font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif" font-size="${size}" font-weight="700" fill="${color}">${safe}</text></svg>`
}

// A hairline across the pane: what separates its sections and settings, as the preview's border-top.
export function ruleSvg(_width = 280, strong = true): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="1" role="presentation"><style>
.l{fill:#1d1f23;opacity:${strong ? '.12' : '.07'}}@media (prefers-color-scheme: dark){.l{fill:#f2f3f5;opacity:${strong ? '.12' : '.07'}}}
</style><rect class="l" width="100%" height="1"/></svg>`
}

// The card icons, drawn on a 24×24 grid.
const ICONS = {
  sliders: '<path d="M5 8h9M18 8h1M5 16h3M12 16h7"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  chart: '<path d="M5 19V11M10 19V6M15 19v-5M20 19V9"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M14.5 9.2c-.5-.8-1.4-1.2-2.5-1.2-1.5 0-2.6.8-2.6 2s1.1 1.7 2.6 2 2.6.8 2.6 2-1.1 2-2.6 2c-1.1 0-2-.4-2.5-1.2M12 6.5V8M12 16v1.5"/>',
  gauge: '<path d="M4.5 16a8 8 0 1 1 15 0"/><path d="M12 13l3.5-4"/><circle cx="12" cy="13.5" r="1.2"/>',
  toggle: '<rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="2.6"/>',
  // The settings' and the details' own icons.
  route: '<circle cx="6" cy="18" r="2"/><circle cx="18" cy="6" r="2"/><path d="M8 18h5a3 3 0 0 0 0-6h-2a3 3 0 0 1 0-6h5"/>',
  spark: '<path d="M11 4l1.8 4.6 4.7 1.4-4.7 1.6L11 16l-1.8-4.4L4.5 10l4.7-1.4z"/><path d="M18 15v5M15.5 17.5h5"/>',
  swap: '<path d="M5 9h14l-3.5-3.5M19 15H5l3.5 3.5"/>',
  branch: '<circle cx="6" cy="6" r="2"/><circle cx="6" cy="18" r="2"/><circle cx="18" cy="8" r="2"/><path d="M6 8v8M18 10c0 4.5-6 3.5-10.5 6.8"/>',
  window: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M4 9.5h16M12 12.5v4M10 14.5h4"/>',
  bell: '<path d="M6.5 16v-5a5.5 5.5 0 0 1 11 0v5l1.5 2h-14z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>',
  cpu: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M10 4v3M14 4v3M10 17v3M14 17v3M4 10h3M4 14h3M17 10h3M17 14h3"/>',
  scale: '<path d="M12 5v14M8.5 19h7M5.5 8h13"/><path d="M5.5 8L3 13.5a2.5 2.5 0 0 0 5 0zM18.5 8L16 13.5a2.5 2.5 0 0 0 5 0z"/>',
  pane: '<rect x="4" y="5" width="16" height="14" rx="3"/><path d="M14.5 5v14"/>',
  target: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r=".9"/>',
} as const
export type CardIcon = keyof typeof ICONS

// A setting's or a detail's icon: the card's tile, smaller, so a row reads at a glance. off: grey, as
// the setting does nothing then. Always still: a row redraws on every press.
export function itemSvg(icon: CardIcon, color: string = ACCENT, on = true, size = 32): string {
  const c = on ? color : TONES.idle[0]
  const k = size / 28
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 28 28" aria-hidden="true"><style>
.b{fill:${c};opacity:${on ? '.18' : '.1'}}.e{stroke:${c};opacity:${on ? '.35' : '.18'}}@media (prefers-color-scheme: dark){.b{opacity:${on ? '.26' : '.14'}}.e{opacity:${on ? '.45' : '.22'}}}
</style><rect class="b" width="28" height="28" rx="8"/><rect class="e" x=".5" y=".5" width="27" height="27" rx="7.5" fill="none" stroke-width="${n(1 / k)}"/><g transform="translate(5 5) scale(.75)" fill="none" stroke="${c}" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g></svg>`
}

// A card's icon: the glyph in its colour on a soft tile of the same colour. The heading's words are
// Text beside it, in the app's own type. animate: the tile pops in, once.
export function tileSvg(icon: CardIcon, color: string = ACCENT, strong = false, animate = false): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36" aria-hidden="true"><style>
.b{fill:${color};opacity:${strong ? '.24' : '.15'}}@media (prefers-color-scheme: dark){.b{opacity:${strong ? '.32' : '.2'}}}
.i{transform-origin:18px 18px}
${animate ? `.i{animation:p .55s cubic-bezier(.3,1.6,.5,1) both}@keyframes p{from{transform:scale(.4);opacity:0}}${STILL}` : ''}
</style><g class="i"><rect class="b" width="36" height="36" rx="10"/><g transform="translate(6 6)" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICONS[icon]}</g></g></svg>`
}

// With against without the router: the track is the cost without it, the fill what was spent with
// it, the rest (the saving) a light band of the same colour. Over 100 %, the fill turns warm.
// from: where the fill starts growing (0…100 of the bar).
export function costBarSvg(withUsd: number, withoutUsd: number, animate = false, height = 10, from = 0): string {
  const p = withoutUsd > 0 ? Math.max(0, withUsd / withoutUsd) : 0
  const over = p > 1
  const w = n(Math.min(1, p) * 100)
  const [a, b] = over ? TONES.over : TONES.calm
  const r = n(height / 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" role="img"><title>Spent ${Math.round(p * 100)}% of the cost without the router</title><style>
.t{fill:${TONES.calm[1]};opacity:.22}${over ? '.t{fill:#8a8f98;opacity:.14}' : ''}
${animate ? `.f{animation:c .8s cubic-bezier(.2,.8,.2,1) both}@keyframes c{from{width:${n(Math.min(100, Math.max(0, from)))}%}}${STILL}` : ''}
</style><defs><linearGradient id="c" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient></defs>
<rect class="t" width="100%" height="${height}" rx="${r}"/>${w ? `<rect class="f" width="${w}%" height="${height}" rx="${r}" fill="url(#c)"/>` : ''}</svg>`
}

// Text inside a drawing, in the frame's own colours: dark on light, light on dark.
const INK = '.k{fill:#1d1f23}.m{fill:#1d1f23;opacity:.55}@media (prefers-color-scheme: dark){.k{fill:#f2f3f5}.m{fill:#f2f3f5;opacity:.6}}'
const FONT = 'font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif"'

// How often the router was right (0…100) as a ring: a soft track, the share filled in the colour from
// the top, and outside it a thin arc over the 95 % range, so the figure carries its own uncertainty.
// null: the track only and a dash. Always still: Details redraws on every press.
export function ringSvg(pct: number | null, low: number | null, high: number | null, color: string, size = 88): string {
  const c = size / 2
  const r = size * 0.36
  const w = size * 0.09
  const ro = size * 0.465
  const arc = (rad: number, a: number, b: number) => {
    const at = (p: number) => {
      const t = (Math.max(0, Math.min(100, p)) / 100) * 2 * Math.PI - Math.PI / 2
      return `${n(c + rad * Math.cos(t))} ${n(c + rad * Math.sin(t))}`
    }
    if (b - a >= 99.95) return `M${n(c)} ${n(c - rad)}a${n(rad)} ${n(rad)} 0 1 1 0 ${n(2 * rad)}a${n(rad)} ${n(rad)} 0 1 1 0 ${n(-2 * rad)}`
    return `M${at(a)}A${n(rad)} ${n(rad)} 0 ${b - a > 50 ? 1 : 0} 1 ${at(b)}`
  }
  const label = pct == null ? '–' : `${Math.round(pct)}%`
  const title = pct == null ? 'Not enough tasks yet' : `${Math.round(pct)} % right${low != null && high != null ? `, 95 %: ${Math.round(low)}–${Math.round(high)} %` : ''}`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img"><title>${esc(title)}</title><style>
.t{stroke:${color};opacity:.16}.ci{stroke:${color};opacity:.5}@media (prefers-color-scheme: dark){.t{opacity:.24}.ci{opacity:.6}}${INK}
</style><g fill="none" stroke-linecap="round"><circle class="t" cx="${n(c)}" cy="${n(c)}" r="${n(r)}" stroke-width="${n(w)}"/>
${pct != null && pct > 0 ? `<path d="${arc(r, 0, pct)}" stroke="${color}" stroke-width="${n(w)}"/>` : ''}
${low != null && high != null && high > low ? `<path class="ci" d="${arc(ro, low, high)}" stroke-width="${n(size * 0.03)}"/>` : ''}</g>
<text class="k" x="${n(c)}" y="${n(c + size * 0.035)}" text-anchor="middle" ${FONT} font-size="${n(size * 0.22)}" font-weight="700" letter-spacing="-.02em">${esc(label)}</text>
<text class="m" x="${n(c)}" y="${n(c + size * 0.19)}" text-anchor="middle" ${FONT} font-size="${n(size * 0.115)}" font-weight="500">right</text></svg>`
}

// The colours of the parts of a whole in one card's colour: the biggest part strongest. Mid tones that
// read on light and dark.
export const VIOLETS = ['#6d5ce8', '#8b7cf6', '#a99cf9', '#c4bafb', '#ddd7fd'] as const

// Parts of a whole (each share 0…1) as one rounded bar, a part per colour, parted by thin gaps cut out
// with a mask, so the gaps show whatever is behind them in either theme. Always still.
export function stackSvg(parts: readonly { share: number; color: string }[], height = 12, title = ''): string {
  const total = parts.reduce((a, p) => a + Math.max(0, p.share), 0) || 1
  let x = 0
  const segs: string[] = []
  const cuts: string[] = []
  for (const [i, p] of parts.entries()) {
    const w = (Math.max(0, p.share) / total) * 100
    if (w <= 0) continue
    segs.push(`<rect x="${n(x)}%" width="${n(w)}%" height="${height}" fill="${p.color}"/>`)
    if (i && x > 0) cuts.push(`<rect x="${n(x)}%" width="2" height="${height}" transform="translate(-1 0)" fill="#000"/>`)
    x += w
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height}" role="img"><title>${esc(title || 'Share of tasks')}</title><defs><mask id="g"><rect width="100%" height="${height}" rx="${n(height / 2)}" fill="#fff"/>${cuts.join('')}</mask></defs><g mask="url(#g)">${segs.join('')}</g></svg>`
}

// A legend's swatch: a small rounded square in the part's colour.
export function dotSvg(color: string, size = 10): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 10 10" role="img"><rect width="10" height="10" rx="3" fill="${color}"/></svg>`
}
