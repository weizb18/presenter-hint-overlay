'use strict'

// ---------------------------------------------------------------------------
// Turn whatever the user pastes into the one Google Docs URL form that is both
// chrome-free and live.
//
// Measured 2026-09-04 against real documents with headless Chrome:
//   /edit?rm=minimal   no menubar/toolbar/titlebar, AND the realtime /bind
//                      channel opens. This is the only form that does both.
//   /preview           chrome-free but a STATIC snapshot. Over 35s it issued
//                      22 requests and never opened a realtime channel.
//   /d/e/<id>/pub      real DOM and stylable, but `cache-control: max-age=300`.
//                      Google's own banner says it updates every 5 minutes.
//   ?rm=embedded       menubar still visible.
//   /htmlview          404.
//
// No dependency on Electron, so this stays unit-testable.
// ---------------------------------------------------------------------------

const DOC_ID_RE = /\/document\/d\/(e\/)?([A-Za-z0-9_-]{10,})/
const BARE_ID_RE = /^[A-Za-z0-9_-]{20,}$/

/**
 * @param {string} input anything the user pasted
 * @returns {{url?: string, from?: string, note?: string, warn?: string, error?: string}}
 */
function normalizeDocUrl (input) {
  const raw = String(input == null ? '' : input).trim()
  if (!raw) return { error: '还没有输入链接' }

  if (BARE_ID_RE.test(raw)) {
    return { url: `https://docs.google.com/document/d/${raw}/edit?rm=minimal`, from: raw }
  }

  const m = raw.match(DOC_ID_RE)

  if (!m) {
    if (/^https?:\/\//i.test(raw)) {
      return {
        url: raw,
        note: '这不是 Google Docs 链接，按原样加载。实时状态指示只对 Google Docs 有效。'
      }
    }
    return { error: '看不出这是一个链接或文档 ID' }
  }

  if (m[1]) {
    return {
      url: raw,
      warn: '这是「发布到网络」形式的链接。Google 对它缓存约五分钟，收不到实时编辑。' +
            '用它跑 M0 会得到一个假的否定结论。请改用普通的文档链接。'
    }
  }

  return { url: `https://docs.google.com/document/d/${m[2]}/edit?rm=minimal`, from: raw }
}

module.exports = { normalizeDocUrl }
