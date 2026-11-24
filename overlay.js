'use strict'

// ---------------------------------------------------------------------------
// M1: the overlay itself.
//
// A transparent, always-on-top, click-through window showing a Google Doc.
// Everything here is macOS-shaped and every non-obvious call has a reason.
//
// THE THREE STATES. The overlay is inert to the mouse. It never takes a click,
// never takes a wheel event, never takes keyboard focus. Whatever is underneath
// keeps the mouse and the keyboard at all times.
//
//   passthrough  default, and where it lives for the entire talk. Every mouse
//                event goes straight through to the app below. Scrolling is
//                done with global hotkeys.
//   reposition   hotkey. The only moment the overlay accepts the mouse, so it
//                can be dragged. A pre-talk activity.
//   hidden       hotkey. Orthogonal to the other two.
//
// An earlier draft turned click-through off while the cursor was over the
// overlay, so the trackpad could scroll it. That was wrong for this product:
// it meant the presenter could not click or type into the window underneath
// while the cursor happened to be over the hints. Hotkey-only scrolling costs
// one keypress and keeps the overlay completely out of the way.
//
// WHY forward IS FALSE. setIgnoreMouseEvents' `forward` option is, on macOS,
// exactly one AppKit call: [window setAcceptsMouseMovedEvents:]. It governs
// mouse-MOVED events only and can never deliver a wheel event, so it buys
// nothing here. Leaving it off also means the renderer is never woken by
// pointer traffic it has no use for.
//
// WHY setContentProtection IS NOT CALLED. On macOS 15+ ScreenCaptureKit ignores
// NSWindow.sharingType outright; Apple's own DTS engineer stated there are no
// public APIs for preventing screen capture. On macOS 26 the call can make the
// window invisible to the presenter as well. Stealth comes from the presenter
// sharing only the Chrome window in Zoom, not from any API.
// ---------------------------------------------------------------------------

const {
  app, BaseWindow, WebContentsView, session, screen, globalShortcut, ipcMain
} = require('electron')
const path = require('node:path')

const { normalizeDocUrl } = require('./docurl')
const configStore = require('./config')
const appearance = require('./appearance')

const ANON_PARTITION = 'overlay-anon'
let appearanceKey = null  // handle of the injected stylesheet, so it can be swapped
const REPOSITION_INSET = 6
const MIN_WIDTH = 260
const MIN_HEIGHT = 120

/** Bounds captured when a resize gesture starts, so deltas stay absolute. */
let resizeOrigin = null

let win = null
let docView = null
let dragView = null
let cfg = null
let cfgFile = null

const ui = {
  hidden: false,
  repositioning: false
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createOverlay () {
  const b = cfg.bounds
  const area = screen.getPrimaryDisplay().workArea
  const width = b.width
  const height = b.height
  const x = b.x == null ? Math.round(area.x + (area.width - width) / 2) : b.x
  const y = b.y == null ? area.y + 96 : b.y

  win = new BaseWindow({
    x,
    y,
    width,
    height,
    // `panel` makes Electron add NSWindowStyleMaskNonactivatingPanel at
    // runtime. That single option buys three things at once: the window floats
    // above full-screened apps, it shows on every Space, and clicking it does
    // not activate this application.
    type: 'panel',
    // Hard requirement, not a nicety. A window that can take key status steals
    // the arrow keys, and the presenter's next press fails to advance their
    // slides with no visible cause. On macOS this is a pure attribute write.
    focusable: false,
    // Only matters in reposition mode, where the drag layer has a button.
    // Without it the first click on an inactive window is swallowed.
    acceptFirstMouse: true,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    skipTaskbar: true,
    backgroundColor: '#00000000'
    // Deliberately no `parent`. electron/electron#44150: panel plus
    // focusable:false plus a parent breaks mouse handling on the window.
  })

  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  const anon = session.fromPartition(ANON_PARTITION)

  docView = new WebContentsView({
    webPreferences: {
      session: anon,
      contextIsolation: true,
      nodeIntegration: false,
      // Default is already true, but this is load-bearing so it is spelled out.
      transparent: true,
      // The window sits unfocused for the whole talk. Without this Chromium
      // throttles its timers and the doc can go stale.
      backgroundThrottling: false
    }
  })
  // REQUIRED, and easy to miss. Electron's own note on the window `transparent`
  // option: "When you add a View to a BaseWindow, you'll need to call
  // view.setBackgroundColor with a transparent background color on that view to
  // make its background transparent as well." Without this the View paints an
  // opaque slab underneath the page, so no amount of work on the page itself
  // makes the overlay see-through. Alpha hex here is AARRGGBB, not RRGGBBAA.
  docView.setBackgroundColor('#00000000')

  dragView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-drag.js'),
      contextIsolation: true,
      nodeIntegration: false,
      transparent: true
    }
  })
  dragView.setBackgroundColor('#00000000')
  dragView.webContents.loadFile(path.join(__dirname, 'drag-layer.html'))
  dragView.setVisible(false)

  win.contentView.addChildView(docView)
  win.contentView.addChildView(dragView)

  layout()
  win.on('resize', layout)
  win.on('move', () => { if (!ui.repositioning) persistBounds() })

  setPassthrough(true)
  win.showInactive()
}

function layout () {
  if (!win) return
  const { width, height } = win.getContentBounds()
  const inset = ui.repositioning ? REPOSITION_INSET : 0
  docView.setBounds({
    x: inset,
    y: inset,
    width: Math.max(0, width - inset * 2),
    height: Math.max(0, height - inset * 2)
  })
  dragView.setBounds({ x: 0, y: 0, width, height })
}

function setPassthrough (on) {
  win.setIgnoreMouseEvents(on, { forward: false })
}

function pushSize () {
  if (!win || dragView.webContents.isDestroyed()) return
  const { width, height } = win.getBounds()
  dragView.webContents.send('size', { width, height })
}

/**
 * Resizing by hand rather than through the native path. Electron documents
 * that transparent windows are not resizable, and that setting `resizable` to
 * true "may make a transparent window stop working on some platforms", so the
 * grip in the drag layer drives setBounds directly instead.
 */
function resizeStart () {
  resizeOrigin = win.getBounds()
  pushSize()
}

function resizeTo (dx, dy) {
  if (!resizeOrigin) return
  win.setBounds({
    x: resizeOrigin.x,
    y: resizeOrigin.y,
    width: Math.max(MIN_WIDTH, Math.round(resizeOrigin.width + dx)),
    height: Math.max(MIN_HEIGHT, Math.round(resizeOrigin.height + dy))
  })
  layout()
  pushSize()
}

function resizeEnd () {
  resizeOrigin = null
  persistBounds()
}

function persistBounds () {
  if (!win) return
  const { x, y, width, height } = win.getBounds()
  cfg.bounds = { x, y, width, height }
  configStore.save(cfgFile, cfg)
}

// ---------------------------------------------------------------------------
// Appearance
//
// Re-applied on every load. The SVG filter definition has to live in the page,
// so it goes in with executeJavaScript; the rule that points at it is a real
// stylesheet, which means canvas tiles Docs creates later while scrolling pick
// it up automatically.
// ---------------------------------------------------------------------------

async function applyAppearance () {
  const wc = docView.webContents
  const a = cfg.appearance || {}
  try {
    if ((a.mode || 'keyed') === 'keyed') {
      await wc.executeJavaScript(appearance.svgJs(a.textColor))
    }
    if (appearanceKey) { await wc.removeInsertedCSS(appearanceKey); appearanceKey = null }
    appearanceKey = await wc.insertCSS(appearance.css(a))
    console.log(`[overlay] 观感 ${a.mode || 'keyed'} / 字色 ${appearance.labelFor(a.textColor)}`)
  } catch (err) {
    console.error('[overlay] 应用观感失败', err.message)
  }
}

function cycleTextColor () {
  cfg.appearance = cfg.appearance || {}
  const next = appearance.nextTextColor(cfg.appearance.textColor)
  cfg.appearance.textColor = next.value
  // Force keyed; the other modes exist for diagnosis, not for daily use, and
  // text colour is meaningless outside keyed anyway.
  cfg.appearance.mode = 'keyed'
  configStore.save(cfgFile, cfg)
  applyAppearance()
}

// ---------------------------------------------------------------------------
// Scrolling
//
// A synthetic wheel event goes through the same path as a real one, which
// matters because the doc body is a canvas with Google's own scroller on top.
// Anything that tries to scroll the DOM directly would miss it.
//
// Horizontal matters whenever the document page is wider than the overlay,
// which is the normal case unless the page size has been narrowed in the doc's
// own page setup. Wheel sign convention: positive scrolls up and left.
// ---------------------------------------------------------------------------

function scrollBy (dx, dy) {
  if (!docView || ui.hidden) return
  const b = win.getContentBounds()
  docView.webContents.sendInputEvent({
    type: 'mouseWheel',
    x: Math.round(b.width / 2),
    y: Math.round(b.height / 2),
    deltaX: dx,
    deltaY: dy,
    canScroll: true
  })
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

function toggleHidden () {
  ui.hidden = !ui.hidden
  if (ui.hidden) {
    win.hide()
  } else {
    // showInactive, never show(). show() would bring the app forward and take
    // the keyboard away from Chrome.
    win.showInactive()
  }
}

function toggleReposition () {
  ui.repositioning = !ui.repositioning

  if (ui.repositioning) {
    if (ui.hidden) { ui.hidden = false; win.showInactive() }
    // Being focusable during repositioning is what lets the OS drag the
    // window. It is a pre-talk activity, so briefly holding focus is fine.
    win.setFocusable(true)
    setPassthrough(false)
    dragView.setVisible(true)
    pushSize()
  } else {
    dragView.setVisible(false)
    setPassthrough(true)
    win.setFocusable(false)
    persistBounds()
  }

  layout()
}

// ---------------------------------------------------------------------------
// Hotkeys
// ---------------------------------------------------------------------------

function registerHotkeys () {
  const k = cfg.hotkeys
  const bind = (accel, fn, label) => {
    if (!accel) return
    const ok = globalShortcut.register(accel, fn)
    console.log(`[overlay] 快捷键 ${label}: ${accel} ${ok ? '已注册' : '注册失败，可能被其他应用占用'}`)
  }

  bind(k.toggleHidden, toggleHidden, '隐藏/呼出')
  bind(k.scrollUp, () => scrollBy(0, cfg.scrollStep), '上滚')
  bind(k.scrollDown, () => scrollBy(0, -cfg.scrollStep), '下滚')
  bind(k.scrollLeft, () => scrollBy(cfg.scrollStep, 0), '左移')
  bind(k.scrollRight, () => scrollBy(-cfg.scrollStep, 0), '右移')
  bind(k.toggleReposition, toggleReposition, '定位模式')
  // A frameless click-through window has no close button. This is the way out.
  bind(k.cycleTextColor, cycleTextColor, '切换字色')
  // For when something opaque survives and neither of us can guess which
  // element it is. Inspect it, send me the class name.
  bind(k.quit, () => app.quit(), '退出')
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

function resolveUrl () {
  const arg = process.argv.find(a => a.startsWith('--url='))
  const raw = arg ? arg.slice('--url='.length) : (process.env.OVERLAY_URL || cfg.url)
  if (!raw) return null
  const r = normalizeDocUrl(raw)
  if (r.error) { console.error('[overlay]', r.error); return null }
  if (r.warn) console.warn('[overlay] 警告:', r.warn)
  return r.url
}

app.whenReady().then(() => {
  const loaded = configStore.load(app.getPath('userData'))
  cfg = loaded.cfg
  cfgFile = loaded.file

  const url = resolveUrl()
  if (!url) {
    console.error(
      '[overlay] 没有可加载的地址。用下面任一方式提供：\n' +
      "  npm run overlay -- --url='https://docs.google.com/document/d/<ID>/edit'\n" +
      `  或在 ${cfgFile} 里设置 "url"`
    )
    app.quit()
    return
  }

  createOverlay()
  docView.webContents.on('did-finish-load', applyAppearance)
  docView.webContents.loadURL(url)
  console.log('[overlay] 已加载', url)

  // Remembering the url means the presenter fills it in once, ever.
  if (cfg.url !== url) { cfg.url = url; configStore.save(cfgFile, cfg) }

  registerHotkeys()

  ipcMain.on('reposition-done', () => { if (ui.repositioning) toggleReposition() })
  ipcMain.on('resize-start', resizeStart)
  ipcMain.on('resize-to', (_e, dx, dy) => resizeTo(dx, dy))
  ipcMain.on('resize-end', resizeEnd)
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// The overlay has no dock presence and no windows to speak of; quitting is
// driven by the hotkey.
app.on('window-all-closed', () => app.quit())
