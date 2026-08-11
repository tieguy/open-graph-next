import test from 'node:test'
import assert from 'node:assert/strict'

import {
  digitalnzBrowseUrl,
  digitalnzEntryFrom,
  digitalnzRights,
  digitalnzUrl,
  pickDigitalnzEntries,
  subjectMatch,
} from '../src/digitalnz.js'

// Fixtures drawn from the live-verified queries of 2026-08-08 (LUI-145 and
// its PR-#11 test comment): the John Stuart Yeates record set, whose subject
// fields and usage values are quoted verbatim from real v3 responses.

const FORMS = [
  'Yeates, J. S. (John Stuart), 1900-1986', // LC's authorized form — matches nothing in DigitalNZ
  'Yeates, John Stuart, 1900-1986', // LC's variant, NLNZ's own form — the one that matches
  'Yeates, Jack, 1900-1986',
]

test('digitalnzUrl asks the subject filter for every LC form, keyless by omission', () => {
  const url = digitalnzUrl(FORMS, undefined)
  // One or[subject][] per form — the union is the "cataloged under" set.
  assert.equal((url.match(/or\[subject\]\[\]=/g) ?? []).length, 3)
  assert.match(url, /or\[subject\]\[\]=Yeates%2C%20John%20Stuart%2C%201900-1986/)
  // The record's own subject field rides back for the strict per-record check.
  assert.match(url, /fields=[^&]*subject/)
  // The window is wider than the shelf (DIGITALNZ_FETCH_WINDOW vs
  // DIGITALNZ_PER_ANCHOR) so the corroboration test has records to choose
  // among — same request count, bigger body, DPLA's own pattern.
  assert.match(url, /per_page=20/)
  // `api_key=` with an empty value is a 403 (verified 2026-08-08) — keyless
  // means the parameter is ABSENT, never empty.
  assert.ok(!url.includes('api_key'))
})

test('digitalnzUrl carries the key when one is set', () => {
  assert.match(digitalnzUrl(FORMS, 'KEY'), /&api_key=KEY$/)
})

test('digitalnzBrowseUrl quotes the exact heading the cards were matched on', () => {
  assert.equal(
    digitalnzBrowseUrl('Yeates, John Stuart, 1900-1986'),
    'https://digitalnz.org/records?text=%22Yeates%2C%20John%20Stuart%2C%201900-1986%22',
  )
})

// ---- the strict test: a record's own subject must state the heading --------

test('subjectMatch returns the LC form the record itself states — the variant, not the authorized form', () => {
  // The Alexander Turnbull Library photo, the one Yeates record that carries
  // a person-level subject (quoted verbatim from the live response).
  const turnbull = {
    id: 22887492,
    subject: [
      'Massey Agricultural College',
      'Yeates, John Stuart, 1900-1986',
      'Botanists',
      'Botany',
      'New Zealand',
      'Plants',
      'Palmerston North',
    ],
  }
  assert.equal(subjectMatch(turnbull, FORMS), 'Yeates, John Stuart, 1900-1986')
})

test('subjectMatch refuses records whose subjects never name the person — the Massey images and the Wikipedia self-reference', () => {
  // Massey's openly licensed images of Yeates carry only a collection-name
  // subject; strict matching deliberately forfeits them (the loose-match
  // question is filed, not decided here).
  assert.equal(subjectMatch({ subject: ['Massey University Archives Photograph Collection'] }, FORMS), null)
  // DigitalNZ indexes Wikipedia itself as a content partner, and the enwiki
  // article is the FIRST full-text result for Yeates — a card pointing back
  // at Wikipedia on this site would be a self-reference. Its record carries
  // no subjects at all, so the strict test excludes it with no special case.
  assert.equal(subjectMatch({ subject: [] }, FORMS), null)
  assert.equal(subjectMatch({}, FORMS), null)
})

// ---- rights: "a mark is never a guess" -------------------------------------

test('digitalnzRights reads All rights reserved as the InC mark, via the shared rightsstatements vocabulary', () => {
  const r = digitalnzRights(['All rights reserved'])
  assert.equal(r.code, 'INC')
  assert.deepEqual(r.marks, ['copyright'])
})

test('digitalnzRights shows Unknown as the ? mark — a real non-answer, said out loud', () => {
  // Until 2026-08-08 this returned null and the card stayed silent, which was
  // indistinguishable from a partner that publishes no rights fields at all.
  // An honestly recorded open question now surfaces as one — the ? mark and
  // the words, never a license glyph.
  const r = digitalnzRights(['Unknown'])
  assert.equal(r.code, 'UNKNOWN')
  assert.deepEqual(r.marks, ['unknown'])
  assert.equal(r.label, 'rights unknown')
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

test('a shelf never shows the same title twice — the shared fold, on DigitalNZ', () => {
  // Live case, 2026-08-09: Auckland Libraries holds four DISTINCT photographs
  // all cataloged "Apollo 11 moon landing, 1969", and the shelf showed all
  // four — four cards a reader cannot tell apart. The pick now rides
  // rankShelfEntries (src/relevance.js, shared with DPLA), so identical-title
  // records fold to their first and the cap is filled from what remains,
  // exactly as DPLA's shelves have worked since LUI-144.
  const mk = (id, title) => ({
    id,
    title,
    content_partner: ['Auckland Libraries'],
    landing_url: `http://example.test/${id}`,
    usage: ['Share'],
    subject: ['Aldrin, Buzz'],
  })
  const results = [
    mk(1, 'Apollo 11 moon landing, 1969'),
    mk(2, 'Apollo 11 moon landing, 1969'),
    mk(3, 'Apollo 11 moon landing, 1969'),
    mk(4, 'Apollo 11 moon landing, 1969'),
    mk(5, 'Aldrin on the ladder'),
    mk(6, 'Parade for the astronauts'),
  ]
  const picked = pickDigitalnzEntries(results, ['Aldrin, Buzz'], 'Buzz Aldrin')
  const titles = picked.entries.map((e) => e.title)
  assert.equal(new Set(titles).size, titles.length, 'every card distinct')
  assert.equal(titles.filter((t) => t.startsWith('Apollo 11 moon landing')).length, 1)
  assert.ok(titles.includes('Aldrin on the ladder'))
  assert.ok(titles.includes('Parade for the astronauts'))
})

test('the pick still corroborates and still reports the matched heading', () => {
  const record = {
    id: 9,
    title: 'Empire Day in Japan',
    content_partner: ['Somewhere'],
    landing_url: 'http://example.test/9',
    usage: ['Share'],
    subject: ['Tokyo (Japan)'],
  }
  // No corroboration context: the match alone decides, and the heading is the
  // form the record itself stated.
  const picked = pickDigitalnzEntries([record], ['Tokyo (Japan)'], 'Tokyo')
  assert.equal(picked.heading, 'Tokyo (Japan)')
  // A window with no matching record is null, not an empty shelf.
  assert.equal(pickDigitalnzEntries([record], ['Aldrin, Buzz'], 'Buzz Aldrin'), null)
})

test('a matched record becomes a card credited to the CONTRIBUTING institution, not DigitalNZ', () => {
  // The Turnbull photo as the live API returns it (thumbnails come from
  // NLNZ's delivery host; `id` is a NUMBER in the real response).
  const record = {
    id: 22887492,
    title: 'John Stuart Yeates, Massey College',
    content_partner: ['Alexander Turnbull Library'],
    landing_url: 'http://natlib.govt.nz/records/22887492',
    thumbnail_url: 'https://ndhadeliver.natlib.govt.nz/delivery/DeliveryManagerServlet?dps_pid=IE442161&dps_func=thumbnail',
    usage: ['Unknown'],
    subject: ['Yeates, John Stuart, 1900-1986', 'Botanists'],
  }
  const e = digitalnzEntryFrom(record, 'Yeates, John Stuart, 1900-1986', 'John Stuart Yeates')
  assert.equal(e.source, 'digitalnz')
  assert.equal(e.description, 'Alexander Turnbull Library')
  // DigitalNZ's own durable record page, not the partner host that may rot —
  // the same choice dplaEntryFrom makes for dp.la/item/… over isShownAt.
  assert.equal(e.href, 'https://digitalnz.org/records/22887492')
  // Usage Unknown: the ? mark on the title, "rights unknown" in the credit —
  // the honest open question said out loud, never a license glyph.
  assert.deepEqual(e.rights.copy.marks, ['unknown'])
  assert.equal(e.attribution.author, 'Alexander Turnbull Library · rights unknown')
  assert.match(e.why, /Filed under “Yeates, John Stuart, 1900-1986”/)
  assert.equal(e.topic, 'John Stuart Yeates')
  assert.equal(e._via, 'P244')
})

test('an all-rights-reserved record carries the © mark and still names its institution', () => {
  const record = {
    id: 30112233,
    title: 'University of New Zealand PhD certificate — John Stuart Yeates',
    content_partner: ['Victoria University of Wellington'],
    landing_url: 'https://forms.wgtn.ac.nz/x',
    usage: ['All rights reserved'],
    subject: ['Yeates, John Stuart, 1900-1986'],
  }
  const e = digitalnzEntryFrom(record, 'Yeates, John Stuart, 1900-1986', 'John Stuart Yeates')
  assert.equal(e.rights.copy.code, 'INC')
  assert.equal(e.attribution.author, 'Victoria University of Wellington · in copyright')
})

test('affirmative usage terms are said in words on the credit line, in place of a glyph', () => {
  const record = {
    id: 1,
    title: 'T',
    content_partner: ['Massey University'],
    landing_url: 'https://x.test/1',
    usage: ['Share', 'Modify', 'Use commercially'],
    subject: ['Yeates, John Stuart, 1900-1986'],
  }
  const e = digitalnzEntryFrom(record, 'Yeates, John Stuart, 1900-1986', 'John Stuart Yeates')
  assert.equal(e.rights.copy, null)
  assert.equal(e.attribution.author, 'Massey University · May be shared, modified, used commercially')
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
