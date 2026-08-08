import test from 'node:test'
import assert from 'node:assert/strict'

import {
  digitalnzBrowseUrl,
  digitalnzEntryFrom,
  digitalnzRights,
  digitalnzUrl,
} from '../src/digitalnz.js'

// Fixtures drawn from LUI-145's live-verified query (2026-08-08):
// `https://api.digitalnz.org/v3/records.json?text="John Stuart Yeates"`,
// four of the eight records that answered it.

test('digitalnzUrl asks for the exact quoted heading and the fields the card reads', () => {
  const url = digitalnzUrl('Yeates, John Stuart', 'KEY')
  assert.match(url, /text=%22Yeates%2C%20John%20Stuart%22/)
  assert.match(url, /api_key=KEY/)
  assert.match(url, /per_page=4/)
})

test('digitalnzBrowseUrl quotes the same heading the query asked for', () => {
  assert.equal(
    digitalnzBrowseUrl('Yeates, John Stuart'),
    'https://digitalnz.org/records?text=%22Yeates%2C%20John%20Stuart%22',
  )
})

// ---- rights: "a mark is never a guess" -------------------------------------

test('digitalnzRights reads All rights reserved as the InC mark, via the shared rightsstatements vocabulary', () => {
  const r = digitalnzRights(['All rights reserved'])
  assert.equal(r.code, 'INC')
  assert.deepEqual(r.marks, ['copyright'])
})

test('digitalnzRights gives no mark to Unknown — a real non-answer, not a gap to fill', () => {
  assert.equal(digitalnzRights(['Unknown']), null)
})

test('digitalnzRights gives no mark to Share/Modify/Use commercially — a permission, not a license', () => {
  // DigitalNZ states what a reader MAY DO; it does not say which license
  // grants it or whether attribution is required, so this must not become a
  // CC0/public-domain glyph the way GBIF and OpenStreetMap's vocabularies
  // also stay words-only rather than guessed marks.
  assert.equal(digitalnzRights(['Share', 'Modify', 'Use commercially']), null)
})

test('digitalnzRights recognizes nothing from an empty or malformed usage array', () => {
  assert.equal(digitalnzRights([]), null)
  assert.equal(digitalnzRights(undefined), null)
  assert.equal(digitalnzRights(null), null)
})

// ---- entries ------------------------------------------------------------

test('a fully-open DigitalNZ record becomes a card credited to the CONTRIBUTING institution, not DigitalNZ', () => {
  // Massey University's images of Yeates, usage Share/Modify/Use commercially.
  const record = {
    id: '22887493',
    title: 'John Stuart Yeates, citation, 1977',
    content_partner: ['Massey University'],
    landing_url: 'https://massey.recollect.co.nz/nodes/view/22887493',
    thumbnail_url: 'https://massey.recollect.co.nz/thumb/22887493.jpg',
    usage: ['Share', 'Modify', 'Use commercially'],
  }
  const e = digitalnzEntryFrom(record, 'Yeates, John Stuart', 'John Stuart Yeates')
  assert.equal(e.source, 'digitalnz')
  assert.equal(e.description, 'Massey University')
  // DigitalNZ's own durable record page, not the partner host that may rot —
  // the same choice dplaEntryFrom makes for dp.la/item/… over isShownAt.
  assert.equal(e.href, 'https://digitalnz.org/records/22887493')
  assert.equal(e.imageUrl, 'https://massey.recollect.co.nz/thumb/22887493.jpg')
  assert.equal(e.rights.copy, null)
  // The credit line names the institution AND states the usage words plainly
  // in place of a glyph this vocabulary cannot honestly support.
  assert.equal(e.attribution.author, 'Massey University · May be shared, modified, used commercially')
  assert.match(e.why, /Filed under “Yeates, John Stuart” — the subject heading libraries catalog John Stuart Yeates under/)
  assert.equal(e.topic, 'John Stuart Yeates')
  assert.equal(e._via, 'P244')
})

test('an all-rights-reserved record carries the © mark and still names its institution', () => {
  // Victoria University of Wellington's copy of Yeates' PhD certificate.
  const record = {
    id: '30112233',
    title: 'University of New Zealand PhD certificate — John Stuart Yeates',
    content_partner: ['Victoria University of Wellington'],
    landing_url: 'https://forms.wgtn.ac.nz/x',
    usage: ['All rights reserved'],
  }
  const e = digitalnzEntryFrom(record, 'Yeates, John Stuart', 'John Stuart Yeates')
  assert.equal(e.rights.copy.code, 'INC')
  assert.equal(e.attribution.author, 'Victoria University of Wellington · in copyright')
})

test('a record with usage Unknown gets a card but no rights mark', () => {
  // The Alexander Turnbull Library photo, already linked from the article's
  // own External links — usage Unknown per LUI-145.
  const record = {
    id: '22887492',
    title: 'John Stuart Yeates, Massey College',
    content_partner: ['Alexander Turnbull Library'],
    thumbnail_url: 'https://ndhadeliver.natlib.govt.nz/thumb/22887492.jpg',
    usage: ['Unknown'],
  }
  const e = digitalnzEntryFrom(record, 'Yeates, John Stuart', 'John Stuart Yeates')
  assert.equal(e.rights.copy, null)
  assert.equal(e.attribution.author, 'Alexander Turnbull Library')
})

test('no title or no landing page/id at all → no card, same refusal as DPLA', () => {
  assert.equal(digitalnzEntryFrom({ id: '1' }, 'H', 'L'), null)
  assert.equal(digitalnzEntryFrom({ title: 'T' }, 'H', 'L'), null)
})

test('a record with no content_partner still gets a card, credited to DigitalNZ generically', () => {
  const record = { id: '1', title: 'T', landing_url: 'https://x.test/1', usage: [] }
  const e = digitalnzEntryFrom(record, 'H', 'L')
  assert.equal(e.description, 'A DigitalNZ partner institution')
  assert.equal(e.attribution.author, null)
})
