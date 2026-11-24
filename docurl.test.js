'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const { normalizeDocUrl } = require('./docurl')

const ID = '1R0izXiLjvHRZTpW7-i7DOs58YPA60VcUuUzUYd67vxM'
const WANT = `https://docs.google.com/document/d/${ID}/edit?rm=minimal`

test('rewrites a normal /edit link', () => {
  const r = normalizeDocUrl(`https://docs.google.com/document/d/${ID}/edit`)
  assert.equal(r.url, WANT)
  assert.equal(r.error, undefined)
})

test('rewrites an /edit link that already carries a fragment and query', () => {
  const r = normalizeDocUrl(`https://docs.google.com/document/d/${ID}/edit?usp=sharing&tab=t.0#heading=h.abc`)
  assert.equal(r.url, WANT)
})

test('rewrites a /view link', () => {
  assert.equal(normalizeDocUrl(`https://docs.google.com/document/d/${ID}/view`).url, WANT)
})

test('rewrites a bare /d/<id> link with no trailing verb', () => {
  assert.equal(normalizeDocUrl(`https://docs.google.com/document/d/${ID}`).url, WANT)
})

test('rewrites a /preview link, because /preview is a static snapshot', () => {
  assert.equal(normalizeDocUrl(`https://docs.google.com/document/d/${ID}/preview`).url, WANT)
})

test('accepts a bare document id', () => {
  const r = normalizeDocUrl(ID)
  assert.equal(r.url, WANT)
})

test('tolerates surrounding whitespace', () => {
  assert.equal(normalizeDocUrl(`  https://docs.google.com/document/d/${ID}/edit \n`).url, WANT)
})

test('warns on a publish-to-web link instead of silently rewriting it', () => {
  const pub = 'https://docs.google.com/document/d/e/2PACX-1vSomeLongPublishedIdHere/pub'
  const r = normalizeDocUrl(pub)
  assert.equal(r.url, pub, 'should load it as given rather than fabricate an /edit url')
  assert.match(r.warn, /五分钟/)
})

test('passes a non-Google url through with a note', () => {
  const r = normalizeDocUrl('https://example.com/pad/abc')
  assert.equal(r.url, 'https://example.com/pad/abc')
  assert.match(r.note, /不是 Google Docs/)
})

test('rejects empty input', () => {
  for (const v of ['', '   ', null, undefined]) {
    assert.ok(normalizeDocUrl(v).error, `expected an error for ${JSON.stringify(v)}`)
  }
})

test('rejects something that is neither a url nor an id', () => {
  const r = normalizeDocUrl('把链接发我一下')
  assert.ok(r.error)
  assert.equal(r.url, undefined)
})

test('a short random word is not mistaken for a document id', () => {
  assert.ok(normalizeDocUrl('hello').error)
})
