import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

import {
  buildId,
  chooseStalePages,
  pagePath,
  purgeStalePages,
  readPage,
  sourceFingerprint,
  writePage,
} from '../src/page-cache.js'

const BUILD = 'a'.repeat(16)
const OTHER = 'b'.repeat(16)
const dir = () => mkdtemp(join(tmpdir(), 'page-cache-'))

// ---- the build id ---------------------------------------------------------
//
// The silent failure this key exists to prevent: a deploy changes the markup,
// and a page cache that does not know it serves the previous build's layout
// forever, to everyone, with nothing in the logs.

test('the fingerprint moves when any shipped byte moves', () => {
  const base = [{ name: 'src/a.js', bytes: 'one' }, { name: 'serve.js', bytes: 'two' }]
  const changed = [{ name: 'src/a.js', bytes: 'one!' }, { name: 'serve.js', bytes: 'two' }]
  assert.notEqual(sourceFingerprint(base), sourceFingerprint(changed))
})

test('and does not move for anything else — readdir order included', () => {
  const files = [{ name: 'src/a.js', bytes: 'one' }, { name: 'src/b.js', bytes: 'two' }]
  assert.equal(sourceFingerprint(files), sourceFingerprint([...files].reverse()))
  assert.equal(sourceFingerprint(files), sourceFingerprint(files.map((f) => ({ ...f }))))
})

// A file swapped for another of the same length is the case a naive digest of
// concatenated bytes would miss; the name and length ride in the hash for it.
test('two files trading contents is a different build', () => {
  const a = [{ name: 'src/a.js', bytes: 'xxx' }, { name: 'src/b.js', bytes: 'yyy' }]
  const b = [{ name: 'src/a.js', bytes: 'yyy' }, { name: 'src/b.js', bytes: 'xxx' }]
  assert.notEqual(sourceFingerprint(a), sourceFingerprint(b))
})

test('the experiment flag changes the build id when set vs unset', () => {
  process.env.HOLDER_PAGE = '1'
  const withFlag = buildId()
  delete process.env.HOLDER_PAGE
  const withoutFlag = buildId()
  assert.notEqual(withFlag, withoutFlag)
  process.env.HOLDER_PAGE = '1'
})

// ---- what a stored page is keyed by ---------------------------------------

test('the same article asked for in different spellings replays one render', () => {
  const paths = ['Apollo 11', 'Apollo_11', 'apollo_11'].map((t) => pagePath('/c', BUILD, t))
  assert.equal(new Set(paths).size, 1)
})

test('a different article, or a different build, is a different file', () => {
  assert.notEqual(pagePath('/c', BUILD, 'Apollo 11'), pagePath('/c', BUILD, 'Apollo 12'))
  assert.notEqual(pagePath('/c', BUILD, 'Apollo 11'), pagePath('/c', OTHER, 'Apollo 11'))
})

// ---- storing and replaying ------------------------------------------------

test('a stored render comes back byte-identical, and only to its own build', async () => {
  const d = await dir()
  const html = '<!doctype html><p>whole page</p>'
  assert.equal(await writePage(d, BUILD, 'Apollo 11', html), true)
  assert.deepEqual(await readPage(d, BUILD, 'apollo_11'), { html, degraded: false })
  assert.equal(await readPage(d, OTHER, 'Apollo 11'), null)
  assert.equal(await readPage(d, BUILD, 'Never rendered'), null)
})

// ---- renders made while a source was refusing us --------------------------
//
// A page rendered during someone's rate limit is whole and missing things at
// once. Storing it buys the replay speed the page cache exists for; marking it
// lets serve.js stop replaying it the moment the refusal expires, so five
// minutes of rate limit never becomes days of a thinner article.

test('a degraded render is stored, and says so when read back', async () => {
  const d = await dir()
  assert.equal(await writePage(d, BUILD, 'Apollo 11', '<p>thin</p>', true), true)
  assert.deepEqual(await readPage(d, BUILD, 'Apollo 11'), { html: '<p>thin</p>', degraded: true })
})

// One stored answer per title: the full render that follows a recovery must
// retire the thin one it replaces, and never leave both for a reader to race.
test('a full render replaces the thin one, in both directions', async () => {
  const d = await dir()
  await writePage(d, BUILD, 'Apollo 11', '<p>thin</p>', true)
  await writePage(d, BUILD, 'Apollo 11', '<p>whole</p>')
  assert.deepEqual(await readPage(d, BUILD, 'Apollo 11'), { html: '<p>whole</p>', degraded: false })
  assert.equal((await readdir(d)).length, 1, 'the thin file is gone, not shadowed')
  await writePage(d, BUILD, 'Apollo 11', '<p>thin again</p>', true)
  assert.deepEqual(await readPage(d, BUILD, 'Apollo 11'), { html: '<p>thin again</p>', degraded: true })
  assert.equal((await readdir(d)).length, 1)
})

test('a write leaves no temp file behind for the sweep to count', async () => {
  const d = await dir()
  await writePage(d, BUILD, 'Apollo 11', '<p>x</p>')
  assert.deepEqual(await readdir(d), [basename(pagePath(d, BUILD, 'Apollo 11'))])
})

// A cache that cannot write must make the demo slow, never wrong — the same
// stance as the request cache it sits beside.
test('an unwritable cache reports false rather than throwing', async () => {
  const d = await dir()
  // A regular file where the cache directory should be: mkdir fails ENOTDIR.
  await writeFile(join(d, 'blocked'), '')
  assert.equal(await writePage(join(d, 'blocked'), BUILD, 'Apollo 11', '<p>x</p>'), false)
})

// ---- retiring a build's pages ---------------------------------------------

test('the purge takes other builds’ pages and nothing else', () => {
  const names = [
    `page-${OTHER}-${'1'.repeat(16)}.html`,
    `page-${OTHER}-${'1'.repeat(16)}.thin.html`,
    `page-${BUILD}-${'1'.repeat(16)}.html`,
    `page-${BUILD}-${'4'.repeat(16)}.thin.html`,
    `spike-${'2'.repeat(16)}.json`,
    `fact-class-Q42.json`,
    `datauri-${'3'.repeat(16)}.txt`,
    'page-not-a-build.html',
  ]
  assert.deepEqual(chooseStalePages(names, BUILD), [
    `page-${OTHER}-${'1'.repeat(16)}.html`,
    `page-${OTHER}-${'1'.repeat(16)}.thin.html`,
  ])
})

test('the purge deletes them on disk and leaves the request cache alone', async () => {
  const d = await dir()
  await writePage(d, BUILD, 'Apollo 11', '<p>current</p>')
  await writePage(d, OTHER, 'Apollo 11', '<p>previous</p>')
  await writeFile(join(d, `spike-${'2'.repeat(16)}.json`), '{}')
  assert.equal(await purgeStalePages(d, BUILD), 1)
  const left = (await readdir(d)).sort()
  assert.equal(left.length, 2)
  assert.ok(left.some((n) => n.startsWith(`page-${BUILD}-`)), 'this build survives')
  assert.ok(left.some((n) => n.startsWith('spike-')), 'the request cache is untouched')
  assert.deepEqual(await readPage(d, BUILD, 'Apollo 11'), { html: '<p>current</p>', degraded: false })
})
