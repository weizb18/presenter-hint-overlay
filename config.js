'use strict'

const fs = require('node:fs')
const path = require('node:path')

// Three modifiers on every binding. Global shortcuts are taken away from every
// other app on the machine, so a combo that Chrome or Keynote might want is a
// bad neighbour. Arrow keys and a couple of letters behind Cmd+Alt+Shift are
// about as unclaimed as macOS gets.
//
// Known caveat, electron/electron#19747: globalShortcut does not fire on
// non-QWERTY keyboard layouts. That is why these live in a config file.
const DEFAULTS = {
  bounds: { x: null, y: null, width: 620, height: 260 },
  hotkeys: {
    toggleHidden: 'Cmd+Alt+Shift+O',
    scrollUp: 'Cmd+Alt+Shift+Up',
    scrollDown: 'Cmd+Alt+Shift+Down',
    scrollLeft: 'Cmd+Alt+Shift+Left',
    scrollRight: 'Cmd+Alt+Shift+Right',
    toggleReposition: 'Cmd+Alt+Shift+M',
    cycleTextColor: 'Cmd+Alt+Shift+T',
    quit: 'Cmd+Alt+Shift+Q'
  },
  // keyed: luminance becomes alpha, so the page white disappears entirely and
  //        only the text is left, fully opaque.
  // textColor 'source' keeps the colours you set in the document itself, which
  //        is where font size and everything else already lives. Set a hex like
  //        '#ffffff' to force one colour regardless of the document.
  // dim:   invert the page so it reads dark, then make the whole thing
  //        translucent. Text goes translucent too.
  // off:   leave Google's own rendering alone.
  appearance: { mode: 'keyed', opacity: 1, textColor: 'source', colorChosen: false },
  url: null,
  scrollStep: 120
}

function merge (base, over) {
  const out = { ...base }
  for (const k of Object.keys(over || {})) {
    const v = over[k]
    out[k] = (v && typeof v === 'object' && !Array.isArray(v)) ? merge(base[k] || {}, v) : v
  }
  return out
}

function load (dir) {
  const file = path.join(dir, 'overlay-config.json')
  let saved
  try {
    saved = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return { file, cfg: { ...DEFAULTS } }
  }

  // One-time migration. Early builds hard-defaulted the text colour to white
  // and wrote it to disk, so upgrading users would keep getting white text and
  // reasonably conclude the new default did not work. Drop it once, then leave
  // the field alone forever after.
  if (saved.appearance && saved.appearance.textColor === '#ffffff' && !saved.appearance.colorChosen) {
    delete saved.appearance.textColor
  }
  const cfg = merge(DEFAULTS, saved)
  cfg.appearance.colorChosen = true
  return { file, cfg }
}

function save (file, cfg) {
  try {
    fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + '\n')
  } catch (err) {
    console.error('[overlay] 无法保存配置', err.message)
  }
}

module.exports = { DEFAULTS, load, save }
