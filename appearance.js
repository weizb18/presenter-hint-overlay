'use strict'

// ---------------------------------------------------------------------------
// Making a Google Doc see-through.
//
// The hard fact: since 2021 Docs paints the body into a <canvas>, and the page
// white is inside the pixel data, not on a DOM element behind it. Measured on a
// real doc: 90,000 sampled canvas pixels, every one of them alpha 255, 91% of
// them pure white. Setting background:transparent on every ancestor changes
// nothing, because there is no element holding that white.
//
// Two ways out, both implemented, switchable at runtime.
//
// KEYED (default). An SVG feColorMatrix maps luminance to alpha: white page
// pixels get alpha 0 and vanish, dark glyph pixels get alpha 1 and stay, and
// the antialiased edges in between get a proportional alpha, which is exactly
// what you want for legibility. Net effect: the background is genuinely gone
// and the text is fully opaque. By default the RGB rows are identity, so the
// text keeps whatever colour the document gives it; pass a hex to force one
// colour instead. Strictly better than dimming the whole thing.
//
// DIM. The measured fallback: invert the canvas so the page reads dark, then
// drop the element's opacity. Verified to produce real translucency in a
// transparent window, average alpha 199/255 at opacity 0.78. The catch is that
// the text goes translucent along with the background, so anything bright
// behind the overlay ghosts through the glyphs.
//
// Both are pure CSS plus one injected <svg>, so they survive Docs recreating
// canvas tiles as you scroll: insertCSS installs a stylesheet rule that matches
// future elements too, rather than an inline style on the tiles present today.
// ---------------------------------------------------------------------------

const FILTER_ID = 'overlay-luma'
const SVG_ID = 'overlay-luma-svg'

/** Split '#rrggbb' into the 0..1 components feColorMatrix wants. */
function rgb01 (hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  const n = m ? parseInt(m[1], 16) : 0xffffff
  return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
}

/**
 * alpha = 1 - mean(R,G,B), then masked by the input's own alpha.
 *
 * The mask is not optional, and leaving it out was a real bug. feColorMatrix's
 * alpha row here is `-1/3 -1/3 -1/3 0 1`; the fourth coefficient multiplies the
 * INPUT alpha, and setting it to 0 discards it. A pixel that was already fully
 * transparent is (0,0,0,0), so the matrix computes 1 - 0 = 1 and turns it into
 * opaque BLACK. Every transparent region of the canvas — the gutters at the
 * left and top, and the gaps between pages — came out as solid black bars.
 *
 * feComposite with operator="in" against SourceAlpha intersects the keyed
 * result with wherever the original actually had coverage, so transparent stays
 * transparent. Trying to express this in the matrix alone does not work:
 * feColorMatrix is linear per channel and cannot multiply luminance by alpha.
 */
function svgJs (textColor) {
  // 'source' keeps whatever colours the document itself uses, so bold red for
  // an urgent hint survives. Anything else forces every surviving pixel to
  // that one colour.
  const keepSource = !textColor || textColor === 'source' || textColor === 'auto'
  const [r, g, b] = rgb01(textColor)
  const rgbRows = keepSource
    ? `1, 0, 0, 0, 0,
    0, 1, 0, 0, 0,
    0, 0, 1, 0, 0,`
    : `0, 0, 0, 0, ${r},
    0, 0, 0, 0, ${g},
    0, 0, 0, 0, ${b},`
  return `
(() => {
  const old = document.getElementById(${JSON.stringify(SVG_ID)})
  if (old) old.remove()
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.id = ${JSON.stringify(SVG_ID)}
  svg.setAttribute('width', '0')
  svg.setAttribute('height', '0')
  svg.style.cssText = 'position:absolute;width:0;height:0;pointer-events:none'
  const f = document.createElementNS(NS, 'filter')
  f.setAttribute('id', ${JSON.stringify(FILTER_ID)})
  f.setAttribute('color-interpolation-filters', 'sRGB')
  // Default filter region is -10%/120%, which would blur the edges outward.
  f.setAttribute('x', '0')
  f.setAttribute('y', '0')
  f.setAttribute('width', '100%')
  f.setAttribute('height', '100%')

  const m = document.createElementNS(NS, 'feColorMatrix')
  m.setAttribute('type', 'matrix')
  m.setAttribute('values', [
    ${rgbRows}
    -0.3333, -0.3333, -0.3333, 0, 1
  ].join(' '))
  m.setAttribute('result', 'keyed')
  f.appendChild(m)

  // Intersect with the source's own coverage. Without this, already-transparent
  // pixels come back as opaque black.
  const c = document.createElementNS(NS, 'feComposite')
  c.setAttribute('in', 'keyed')
  c.setAttribute('in2', 'SourceAlpha')
  c.setAttribute('operator', 'in')
  f.appendChild(c)

  svg.appendChild(f)
  document.documentElement.appendChild(svg)
})()
`
}

/**
 * Everything that is not the text itself.
 *
 * The first pass at this named individual Docs classes and inevitably missed
 * some, leaving an opaque frame down the left and across the top and a
 * scrollbar along the bottom. Enumerating Google's class names is a losing
 * game: they are minified, they change, and the page is deep. So the rule is
 * inverted. Strip the background off EVERY element, then let the canvas filter
 * decide what survives. Nothing in a canvas-rendered document needs a DOM
 * background, because all the real content is pixels.
 */
const BASE_CSS = `
  /* The page surface, the workspace behind it, every wrapper in between. */
  *, *::before, *::after {
    background-color: transparent !important;
    background-image: none !important;
    box-shadow: none !important;
    border-color: transparent !important;
    outline-color: transparent !important;
  }

  /* Scrollbars. The overlay scrolls by hotkey; a track along the edge is just
     an opaque stripe. Both the WebKit pseudo-elements and the standard
     property, because Chromium honours whichever it sees first. */
  ::-webkit-scrollbar, ::-webkit-scrollbar-track, ::-webkit-scrollbar-thumb,
  ::-webkit-scrollbar-corner, ::-webkit-resizer {
    width: 0 !important;
    height: 0 !important;
    background: transparent !important;
    display: none !important;
  }
  html, body, * { scrollbar-width: none !important; }

  /* Chrome that rm=minimal leaves behind, and the rulers, which are DOM and
     therefore still paint even though the body is a canvas. */
  #kix-horizontal-ruler, #kix-vertical-ruler,
  .docs-ruler, .docs-ruler-horizontal, .docs-ruler-vertical,
  .docs-butterbar-container, .docs-gm-toolbar, .docs-omnibox,
  .docs-ui-hide-print-only, .kix-spell-underline,
  #docs-chrome, #docs-toolbar-wrapper, #docs-header {
    display: none !important;
  }
  /* Deliberately NOT hidden: .kix-page and .app-container-decorated. The first
     holds the canvas tiles, so display:none on it takes the text with it. The
     second is a wrapper whose contents are not all chrome. Both are handled by
     the universal background rule above instead. */

  /* Page geometry: no gutters, no centring margins, no page break gap. */
  .kix-page, .kix-page-paginated, .kix-page-content-wrapper {
    margin: 0 !important;
    padding-left: 0 !important;
    padding-right: 0 !important;
  }
`

function css (appearance) {
  const a = appearance || {}
  const mode = a.mode || 'keyed'

  if (mode === 'off') return BASE_CSS

  if (mode === 'dim') {
    const o = typeof a.opacity === 'number' ? a.opacity : 0.85
    return BASE_CSS + `
  canvas.kix-canvas-tile-content {
    filter: invert(1) hue-rotate(180deg);
    opacity: ${o};
  }
`
  }

  // keyed
  const o = typeof a.opacity === 'number' ? a.opacity : 1
  return BASE_CSS + `
  canvas.kix-canvas-tile-content {
    filter: url(#${FILTER_ID});
    opacity: ${o};
  }
`
}

const MODES = ['keyed', 'dim', 'off']

function nextMode (mode) {
  const i = MODES.indexOf(mode)
  return MODES[(i + 1) % MODES.length]
}

// What the presenter actually needs to change at runtime is the text colour,
// because the right answer depends on what is behind the overlay: dark text
// over a white slide, light text over a dark editor. The rendering mode, by
// contrast, gets decided once and stays.
const TEXT_COLORS = [
  { value: 'source', label: '文档原本的颜色' },
  { value: '#000000', label: '黑' },
  { value: '#ffffff', label: '白' }
]

function nextTextColor (current) {
  const i = TEXT_COLORS.findIndex(c => c.value === current)
  return TEXT_COLORS[(i + 1) % TEXT_COLORS.length]
}

function labelFor (value) {
  const hit = TEXT_COLORS.find(c => c.value === value)
  return hit ? hit.label : value
}

module.exports = { css, svgJs, nextMode, nextTextColor, labelFor, MODES, TEXT_COLORS }
