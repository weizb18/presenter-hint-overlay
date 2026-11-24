'use strict'

// ---------------------------------------------------------------------------
// M0 validation harness.
//
// This is deliberately NOT the overlay. It is not transparent, not always on
// top, not click-through. Those belong to M1. This window exists only to
// answer four questions before any overlay work starts:
//
//   1. Does /edit?rm=minimal render with no editor chrome?
//   2. Does it receive a collaborator's edits live?
//   3. What does Google Docs show on the presenter's screen when the network
//      drops for ~15 seconds?
//   4. Does an unfocused window go stale after an hour of idling?
//
// So the window carries a status strip that makes the answers legible while
// you sit and watch. The realtime indicator is the important one: Docs opens a
// long-poll to /document/d/<id>/bind only when the live channel is running, so
// seeing that request is direct evidence that edits will arrive.
// ---------------------------------------------------------------------------

const { app, BaseWindow, WebContentsView, session, net, ipcMain, shell } = require('electron')
const path = require('node:path')
const { normalizeDocUrl } = require('./docurl')

const STRIP_HEIGHT = 92
const ONLINE_POLL_MS = 2000

/** A partition name WITHOUT the `persist:` prefix is in-memory only. That is
 *  the whole point: the window can never be signed in to Google, so there is
 *  no session that can expire ten minutes before a talk. */
const ANON_PARTITION = 'm0-anon'

let win = null
let strip = null
let docView = null
let onlineTimer = null

const state = {
  input: null,
  url: null,
  note: null,
  warn: null,
  error: null,
  bindCount: 0,
  lastBindAt: null,
  online: true,
  loadedAt: null,
  lastNav: null,
  throttling: process.env.M0_NO_THROTTLE !== '1'
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function layout () {
  if (!win) return
  const { width, height } = win.getContentBounds()
  strip.setBounds({ x: 0, y: 0, width, height: STRIP_HEIGHT })
  docView.setBounds({ x: 0, y: STRIP_HEIGHT, width, height: Math.max(0, height - STRIP_HEIGHT) })
}

function pushStatus () {
  if (!strip || strip.webContents.isDestroyed()) return
  strip.webContents.send('status', state)
}

function createWindow () {
  win = new BaseWindow({
    width: 1100,
    height: 820,
    title: 'M0 验证窗口'
  })

  strip = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload-strip.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  // Attach before loading. The listener would win the race anyway, since
  // loadFile cannot resolve within this tick, but ordering it explicitly means
  // the startup path does not depend on that.
  strip.webContents.once('did-finish-load', () => {
    pushStatus()
    const u = cliUrl()
    if (u) open(u)
  })
  strip.webContents.loadFile(path.join(__dirname, 'strip.html'))

  const anon = session.fromPartition(ANON_PARTITION)
  watchRealtimeChannel(anon)

  docView = new WebContentsView({
    webPreferences: {
      session: anon,
      contextIsolation: true,
      nodeIntegration: false,
      // Left at Electron's default (throttling ON) so the idle test measures
      // real-world behaviour. Set M0_NO_THROTTLE=1 to see whether disabling it
      // is what fixes a stale window.
      backgroundThrottling: state.throttling
    }
  })

  win.contentView.addChildView(strip)
  win.contentView.addChildView(docView)
  layout()
  win.on('resize', layout)

  wireDocEvents()

  win.on('closed', () => {
    if (onlineTimer) clearInterval(onlineTimer)
    win = null
  })
}

function wireDocEvents () {
  const wc = docView.webContents

  wc.on('did-navigate', (_e, url) => {
    state.lastNav = url
    if (/accounts\.google\.com/.test(url)) {
      state.error = '被重定向到了 Google 登录页。几乎可以肯定是这个文档还没有设成「知道链接的人可查看」。'
    }
    pushStatus()
  })

  wc.on('did-finish-load', () => {
    state.loadedAt = Date.now()
    pushStatus()
  })

  wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame) return
    state.error = `加载失败 ${code} ${desc}`
    pushStatus()
  })

  // Keep external links out of the harness window.
  wc.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })
}

/** Docs opens a long-poll to /document/d/<id>/bind when, and only when, the
 *  realtime channel is running. Counting those requests is the cheapest direct
 *  evidence that a collaborator's edits will actually arrive. */
function watchRealtimeChannel (ses) {
  ses.webRequest.onBeforeRequest({ urls: ['*://docs.google.com/*'] }, (details, cb) => {
    if (details.url.includes('/bind')) {
      state.bindCount += 1
      state.lastBindAt = Date.now()
      pushStatus()
    }
    cb({})
  })
}

function pollOnline () {
  onlineTimer = setInterval(() => {
    const now = net.isOnline()
    if (now !== state.online) {
      state.online = now
      pushStatus()
    }
  }, ONLINE_POLL_MS)
}

// ---------------------------------------------------------------------------
// Open
// ---------------------------------------------------------------------------

function open (input) {
  const r = normalizeDocUrl(input)

  state.input = input
  state.note = r.note || null
  state.warn = r.warn || null
  state.error = r.error || null
  state.url = r.url || null
  state.bindCount = 0
  state.lastBindAt = null
  state.loadedAt = null
  state.lastNav = null

  pushStatus()
  if (!r.url) return

  console.log('[M0] loading', r.url)
  docView.webContents.loadURL(r.url)
}

function cliUrl () {
  const arg = process.argv.find(a => a.startsWith('--url='))
  return arg ? arg.slice('--url='.length) : (process.env.M0_URL || null)
}

app.whenReady().then(() => {
  createWindow()
  pollOnline()

  ipcMain.on('open-url', (_e, input) => open(input))
  ipcMain.on('reload', () => docView && docView.webContents.reload())
  ipcMain.on('devtools', () => docView && docView.webContents.openDevTools({ mode: 'detach' }))
})

app.on('window-all-closed', () => app.quit())
