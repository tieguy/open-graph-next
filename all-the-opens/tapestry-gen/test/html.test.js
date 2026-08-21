import { test } from 'node:test'
import assert from 'node:assert/strict'

import { stripTags } from '../src/html.js'

test('a tag comes out and its text stays', () => {
  assert.equal(stripTags('The <i>Night Watch</i>, 1642'), 'The Night Watch, 1642')
})

test('a comment holding a tag leaves nothing behind', () => {
  // Real enwiki wikitext, from the Rembrandt article: an editor commented out a
  // sentence that carried a <ref>. Reading from `<` to the first `>` swallows
  // `<!--` together with that ref and leaves the comment's tail — `Bull-->` —
  // standing in the text of a card.
  assert.equal(
    stripTags('Rembrandt<!--he never left it.<ref>Bull</ref>--> painted this'),
    'Rembrandt painted this',
  )
})

test('a comment holding a wikilink leaves nothing behind', () => {
  assert.equal(
    stripTags('Saskia<!--sold [[Saskia van Uylenburgh|the grave]].--> died 1642'),
    'Saskia died 1642',
  )
})

test('a comment with no closer runs to the end, as MediaWiki reads it', () => {
  assert.equal(stripTags('Kept<!-- and the rest is swallowed'), 'Kept')
})

test('text with neither tag nor comment is returned unchanged', () => {
  assert.equal(stripTags('Portrait of a man, 1655'), 'Portrait of a man, 1655')
})

test('a run of bare angle brackets does not take super-linear time', () => {
  // The `[^>]` form this replaced took 4.2 s on this input, and quadrupled
  // whenever the input doubled. Article text is not a length we choose.
  const started = process.hrtime.bigint()
  stripTags('<'.repeat(80000))
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  assert.ok(ms < 250, `stripTags took ${ms.toFixed(0)}ms on 80,000 "<"`)
})

test('a run of bare comment openers does not take super-linear time', () => {
  const started = process.hrtime.bigint()
  stripTags('<!--'.repeat(60000))
  const ms = Number(process.hrtime.bigint() - started) / 1e6
  assert.ok(ms < 250, `stripTags took ${ms.toFixed(0)}ms on 60,000 "<!--"`)
})
