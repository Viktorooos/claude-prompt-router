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
export function contextBarSvg(share: number | null, at: number, _width = 280, height = 10, animate = false): string {
  // Percent lengths: the drawing fills whatever width the pane gives it, ends stay round.
  const p = share == null ? 0 : Math.min(1, Math.max(0, share / 100))
  const [a, b] = TONES[tone(share, at)]
  const r = n(height / 2)
  const w = n(p * 100)
  const label = share == null ? '–' : `${Math.round(share)}%`
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="${height + 6}" role="img"><title>Context ${label}${at ? `, new session at ${at}%` : ''}</title><style>
.t{fill:#1d1f23;opacity:.08}.k{stroke:#1d1f23;stroke-width:2;stroke-linecap:round;opacity:.45}
@media (prefers-color-scheme: dark){.t{fill:#f2f3f5;opacity:.1}.k{stroke:#f2f3f5;opacity:.6}}
${animate ? `.f{animation:g .7s cubic-bezier(.2,.8,.2,1) both}@keyframes g{from{width:0}}
.k{animation:o .5s .35s ease-out both}@keyframes o{from{opacity:0}}
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
export function sparkSvg(values: readonly number[], labels: readonly string[], width = 280, height = 64, color: string = ACCENT): string {
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
.l{fill:none;stroke:${empty ? '#8a8f98' : color};stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:1;stroke-dashoffset:0;animation:draw 1.5s cubic-bezier(.65,0,.35,1) both}
.f{fill:url(#f);animation:fade 1s .7s ease-out both}
.o{stroke:#8a8f98;stroke-opacity:.35;stroke-width:1;stroke-dasharray:3 3}
.e{fill:${color};transform-box:fill-box;transform-origin:center;animation:pop .5s 1.35s cubic-bezier(.34,1.56,.64,1) both}
.r{fill:${color};opacity:.22;transform-box:fill-box;transform-origin:center;animation:pop .5s 1.4s cubic-bezier(.34,1.56,.64,1) both}
.d{fill:${color};opacity:0;transition:opacity .15s}.z{fill:transparent}.h:hover .d{opacity:1}
@keyframes draw{from{stroke-dashoffset:1}}
@keyframes fade{from{opacity:0}}
@keyframes pop{from{transform:scale(0)}}
${STILL}
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

// Icons for the fold headings, drawn on a 24×24 grid.
const ICONS = {
  sliders: '<path d="M5 8h9M18 8h1M5 16h3M12 16h7"/><circle cx="16" cy="8" r="2"/><circle cx="10" cy="16" r="2"/>',
  chart: '<path d="M5 19V11M10 19V6M15 19v-5M20 19V9"/>',
} as const
export type FoldIcon = keyof typeof ICONS

// A fold's heading: an icon on an accent tile, a bold name and a line that says what is inside, so a
// closed section still reads as something to open. animate: the tile pops and the words slide in,
// only on the one redraw after a turn ends.
export function foldHeadSvg(name: string, sub: string, icon: FoldIcon, open: boolean, animate = false, color: string = ACCENT): string {
  const font = 'font-family="-apple-system,BlinkMacSystemFont,system-ui,sans-serif"'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="40" role="img"><title>${esc(name)}${open ? '' : ', closed'}</title><style>
.n{fill:#1d1f23}.s{fill:#1d1f23;opacity:.55}.b{fill:${color};opacity:${open ? '.22' : '.14'}}
@media (prefers-color-scheme: dark){.n{fill:#f2f3f5}.s{fill:#f2f3f5;opacity:.6}.b{opacity:${open ? '.3' : '.2'}}}
.i{transform-origin:20px 20px}
${animate ? `.i{animation:p .55s cubic-bezier(.3,1.6,.5,1) both}@keyframes p{from{transform:scale(.4);opacity:0}}
.w{animation:w .5s .12s cubic-bezier(.2,.8,.2,1) both}@keyframes w{from{opacity:0;transform:translateX(-6px)}}
${STILL}` : ''}
</style><g class="i"><rect class="b" x="2" y="2" width="36" height="36" rx="10"/><g transform="translate(8 8)" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round">${ICONS[icon]}</g></g>
<g class="w"><text class="n" x="50" y="17" ${font} font-size="14" font-weight="650">${esc(name)}</text><text class="s" x="50" y="34" ${font} font-size="12">${esc(sub)}</text></g></svg>`
}
