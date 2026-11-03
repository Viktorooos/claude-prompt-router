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

// A part of the savings bill as a bar: filled to its share (0–1) of the largest part, over a faint
// track, growing in on each draw.
export function partBarSvg(share: number, color: string, width = 160, height = 8): string {
  const w = n(Math.max(share > 0 ? 2 : 0, Math.min(1, share) * width))
  const r = n(height / 2)
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img"><style>
.t{fill:#8a8f98;opacity:.18}.b{fill:${color};transform-origin:0 0;animation:grow .8s cubic-bezier(.65,0,.35,1) both}
@keyframes grow{from{transform:scaleX(0)}}
${STILL}
</style><rect class="t" width="${width}" height="${height}" rx="${r}"/>${w ? `<rect class="b" width="${w}" height="${height}" rx="${r}"/>` : ''}</svg>`
}

// The terminal's colour for a tone.
export const TONE_THEME: Record<Tone, 'success' | 'warning' | 'error' | 'inactive'> = { calm: 'success', near: 'warning', over: 'error', idle: 'inactive' }

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif"
const STILL = '@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}'
const n = (v: number) => Number(v.toFixed(2))
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// The context ring: fills to the chat's share on every draw, a tick at the threshold, the colour
// warming as it nears it, and a glow once past it that settles on its own (no endless loop).
export function ringSvg(share: number | null, at: number, size = 104): string {
  const c = 52
  const r = 40
  const len = 2 * Math.PI * r
  const p = share == null ? 0 : Math.min(1, Math.max(0, share / 100))
  const t = tone(share, at)
  const [a, b] = TONES[t]
  const off = n(len * (1 - p))
  const angle = (at / 100) * 2 * Math.PI - Math.PI / 2
  const tick = at
    ? `<line class="k" x1="${n(c + Math.cos(angle) * 30)}" y1="${n(c + Math.sin(angle) * 30)}" x2="${n(c + Math.cos(angle) * 50)}" y2="${n(c + Math.sin(angle) * 50)}"/>`
    : ''
  const label = share == null ? '–' : `${Math.round(share)}%`
  const glow = t === 'over' ? `<circle class="a g" cx="${c}" cy="${c}" r="${r}" transform="rotate(-90 ${c} ${c})" filter="url(#b)"/>` : ''
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 104 104" role="img"><title>Context ${label}${at ? `, new session at ${at}%` : ''}</title><style>
.t{fill:none;stroke:#8a8f98;stroke-opacity:.18;stroke-width:10}
.a{fill:none;stroke:url(#s);stroke-width:10;stroke-linecap:round;stroke-dasharray:${n(len)};stroke-dashoffset:${off};animation:fill 1.3s cubic-bezier(.22,1,.36,1) both}
.g{stroke-width:14;opacity:.35;animation:fill 1.3s cubic-bezier(.22,1,.36,1) both,glow 1.2s 1.3s ease-out both}
.k{stroke:#8a8f98;stroke-width:3;stroke-linecap:round;opacity:.9;animation:rise .5s .9s ease-out both}
.v{font:650 22px ${FONT};fill:#1d1f23;text-anchor:middle;letter-spacing:-.02em;animation:rise .6s .25s ease-out both}
.u{font:600 7.5px ${FONT};fill:#8a8f98;text-anchor:middle;letter-spacing:.14em;animation:rise .6s .4s ease-out both}
@media (prefers-color-scheme: dark){.v{fill:#f2f3f5}.t{stroke-opacity:.26}}
@keyframes fill{from{stroke-dashoffset:${n(len)}}}
@keyframes glow{from{opacity:.12}to{opacity:.45}}
@keyframes rise{from{opacity:0;transform:translateY(3px)}}
${STILL}
</style><defs><linearGradient id="s" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient><filter id="b" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="3"/></filter></defs>
<circle class="t" cx="${c}" cy="${c}" r="${r}"/>${glow}${p > 0 ? `<circle class="a" cx="${c}" cy="${c}" r="${r}" transform="rotate(-90 ${c} ${c})"/>` : ''}${tick}
<text class="v" x="${c}" y="${c + 4}">${label}</text><text class="u" x="${c}" y="${c + 18}">CONTEXT</text></svg>`
}

// A dot beside the last decision: a soft ping while it is fresh (under a minute), still after.
export function pulseSvg(ageMs: number, color: string = ACCENT, size = 18): string {
  const fresh = ageMs >= 0 && ageMs < 60_000
  // A fixed count, not one that shrinks with the age: the drawing then stays the same between draws,
  // so the ping does not restart on every redraw. It stops after its two pulses; the dot stays.
  const times = 2
  const dot = fresh ? color : '#8a8f98'
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 18 18" role="img"><title>${fresh ? 'Fresh decision' : 'Decision'}</title><style>
.w{fill:${dot};transform-origin:9px 9px;opacity:0;animation:ping 1.8s cubic-bezier(0,.55,.45,1) ${times}}
.c{fill:${dot};animation:pop .45s cubic-bezier(.34,1.56,.64,1) both;transform-origin:9px 9px}
@keyframes ping{from{opacity:.55;transform:scale(1)}to{opacity:0;transform:scale(2.2)}}
@keyframes pop{from{transform:scale(0)}}
${STILL}
</style>${fresh ? '<circle class="w" cx="9" cy="9" r="4"/>' : ''}<circle class="c" cx="9" cy="9" r="4"/></svg>`
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
