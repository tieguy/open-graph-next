import test from 'node:test'
import assert from 'node:assert/strict'

import { arxivEntry, openAlexEntry, openAlexUrl, scholarlyIdentifiers } from '../src/scholarly.js'
import {
  aicEntryFrom,
  gbifEntryFrom,
  inatEntryFrom,
  mappable,
  mapEntry,
  metEntryFrom,
  osmFeature,
  parseEarthPoint,
  statementEntries,
  wdqsUrl,
} from '../src/statements.js'

// ---- scholarly ----------------------------------------------------------

test('scholarlyIdentifiers reads doi, pmid, and both arXiv spellings', () => {
  const wikitext = `
    <ref>{{cite journal |title=Paper A |doi=10.1000/abc |pmid=123}}</ref>
    <ref>{{cite arXiv |title=Paper B |arxiv=1706.03762}}</ref>
    <ref>{{cite arXiv |title=Paper C |eprint=2001.00001}}</ref>
    <ref>{{cite journal |title=Old arXiv styling |doi=10.48550/arXiv.1508.06576}}</ref>
    <ref>{{cite web |title=No identifiers |url=https://example.test}}</ref>
    <ref>{{cite journal |title=Paper A again |doi=10.1000/abc}}</ref>`
  const found = scholarlyIdentifiers(wikitext)
  assert.deepEqual(
    found.map((c) => [c.title, c.doi, c.pmid, c.arxiv]),
    [
      ['Paper A', '10.1000/abc', '123', null],
      ['Paper B', null, null, '1706.03762'],
      ['Paper C', null, null, '2001.00001'],
      // An arXiv DOI is folded into the arxiv field: open by construction.
      ['Old arXiv styling', null, null, '1508.06576'],
    ],
  )
})

test('openAlexEntry only exists when the work is actually open', () => {
  const open = openAlexEntry(
    {
      title: 'T',
      publication_year: 2020,
      open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://x.test/pdf' },
      authorships: [{ author: { display_name: 'A. Author' } }, { author: { display_name: 'B' } }],
    },
    'doi',
  )
  assert.equal(open.href, 'https://x.test/pdf')
  assert.equal(open.description, 'A. Author et al. · 2020')
  // The reason class, so a cited paper never shares an unlabelled strip with
  // the subject's own ORCID shelf in the lede.
  assert.equal(open.topic, 'Cited in this section')
  assert.equal(openAlexEntry({ title: 'closed', open_access: { is_oa: false } }, 'doi'), null)
  assert.equal(openAlexEntry({ title: 'oa but no url', open_access: { is_oa: true } }, 'doi'), null)
})

test('an arXiv citation becomes an entry with zero lookups', () => {
  const e = arxivEntry({ title: 'Attention Is All You Need', arxiv: '1706.03762' })
  assert.equal(e.href, 'https://arxiv.org/abs/1706.03762')
  assert.equal(e.source, 'arxiv')
  assert.equal(e.topic, 'Cited in this section')
})

test('openAlexUrl batches values and carries the polite mailto', () => {
  const url = openAlexUrl('doi', ['10.1/a', '10.2/b'], 'op@example.test')
  assert.match(url, /filter=doi%3A10\.1%2Fa%7C10\.2%2Fb/)
  assert.match(url, /mailto=op%40example\.test/)
})

// ---- statements ---------------------------------------------------------

test('wdqsUrl asks for every partner property over the anchor set', () => {
  const url = wdqsUrl(['Q1', 'Q2'])
  for (const p of ['P3634', 'P4610', 'P846', 'P3151', 'P625', 'P402', 'P10689', 'P11693'])
    assert.ok(url.includes(p), p)
  assert.match(url, /VALUES%20%3Fitem%20%7B%20wd%3AQ1%20wd%3AQ2%20%7D/)
})

test('wdqsUrl also asks whether the item is a locatable, extant place', () => {
  const url = decodeURIComponent(wdqsUrl(['Q1']))
  assert.match(url, /AS \?place/)
  assert.match(url, /AS \?defunct/)
  assert.match(url, /wdt:P31\/wdt:P279\*/)
  assert.match(url, /wdt:P576/)
})

test('mappable: a locatable extant place maps; a language or dead polity never does', () => {
  // WDQS returns xsd:boolean bindings as the literal strings 'true'/'false',
  // and entityStatements stores binding values verbatim.
  assert.equal(mappable({ place: 'true', defunct: 'false', coord: 'Point(103.9 13.4)' }), true)
  assert.equal(mappable({ place: 'false', defunct: 'false', coord: 'Point(104 12)' }), false) // Khmer, a language
  assert.equal(mappable({ place: 'true', defunct: 'true' }), false) // Khmer Empire
  assert.equal(mappable({}), false) // WDQS failed for this item: refuse, don't guess
})

test('parseEarthPoint reads Earth points and refuses other globes', () => {
  assert.deepEqual(parseEarthPoint('Point(-80.649 28.573)'), { lon: -80.649, lat: 28.573 })
  // Tranquility Base is real, but OpenStreetMap has not surveyed the Moon.
  assert.equal(parseEarthPoint('<http://www.wikidata.org/entity/Q405> Point(23.47 0.67)'), null)
  assert.equal(parseEarthPoint(undefined), null)
})

test('partner entries carry image, link, and the property that made them', () => {
  const met = metEntryFrom({
    title: 'Washington Crossing the Delaware',
    artistDisplayName: 'Emanuel Leutze',
    objectDate: '1851',
    primaryImageSmall: 'https://images.metmuseum.org/x.jpg',
    objectURL: 'https://www.metmuseum.org/art/collection/search/11417',
    isPublicDomain: true,
  })
  assert.equal(met._via, 'P3634')
  assert.match(met.attribution.author, /public domain/)

  const aic = aicEntryFrom({
    data: { id: 6565, title: 'American Gothic', artist_display: 'Grant Wood (American)\nx', date_display: '1930', image_id: 'img-1', is_public_domain: false },
    config: { iiif_url: 'https://www.artic.edu/iiif/2' },
  })
  assert.equal(aic.imageUrl, 'https://www.artic.edu/iiif/2/img-1/full/400,/0/default.jpg')
  assert.equal(aic.description, 'Grant Wood (American) · 1930')

  const inat = inatEntryFrom({
    id: 48662,
    name: 'Danaus plexippus',
    preferred_common_name: 'Monarch',
    observations_count: 500000,
    default_photo: { medium_url: 'https://inat.test/p.jpg', attribution: '(c) Someone, CC BY', license_code: 'cc-by' },
  })
  assert.equal(inat.title, 'Monarch (Danaus plexippus)')
  assert.match(inat.description, /500,000 community observations/)
  assert.equal(inat.imageUrl, 'https://inat.test/p.jpg')

  const gbif = gbifEntryFrom({ scientificName: 'Danaus plexippus (Linnaeus, 1758)', canonicalName: 'Danaus plexippus' }, 5133088)
  assert.match(gbif.imageUrl, /taxonKey=5133088/)
  assert.match(gbif.title, /Where Danaus plexippus has been recorded/)

  const map = mapEntry({ lat: 28.5729, lon: -80.649 }, 'Kennedy Space Center')
  // A single OSM tile, never maps.wikimedia.org (Wikimedia-projects-only,
  // refuses outside referrers) — and the tile is inlined by the entry points.
  assert.match(map.imageUrl, /^https:\/\/tile\.openstreetmap\.org\/8\/\d+\/\d+\.png$/)
  assert.match(map.href, /openstreetmap\.org/)
  assert.equal(map.title, 'Map: Kennedy Space Center')
})

test('only openly licensed photos illustrate a taxon; reserved-rights sets say so', () => {
  // The all-rights-reserved default photo (license_code null) yields to the
  // first CC-licensed photo in the taxon's set.
  const fallback = inatEntryFrom({
    id: 1,
    name: 'X',
    default_photo: { medium_url: 'https://inat.test/arr.jpg', attribution: '(c) A, all rights reserved', license_code: null },
    taxon_photos: [
      { photo: { medium_url: 'https://inat.test/arr2.jpg', attribution: '(c) B, all rights reserved', license_code: null } },
      { photo: { medium_url: 'https://inat.test/open.jpg', attribution: '(c) C, CC BY-NC', license_code: 'cc-by-nc' } },
    ],
  })
  assert.equal(fallback.imageUrl, 'https://inat.test/open.jpg')
  assert.equal(fallback.attribution.author, '(c) C, CC BY-NC')
  // Every photo reserved → unillustrated, and the credit states the fact.
  const reserved = inatEntryFrom({
    id: 2,
    name: 'Y',
    default_photo: { medium_url: 'https://inat.test/arr.jpg', attribution: '(c) A', license_code: null },
  })
  assert.equal(reserved.imageUrl, null)
  assert.match(reserved.attribution.author, /none under an open licence/)
})

test('an open paper card names the licence of its open copy, or admits read-only', () => {
  const base = {
    title: 'T',
    open_access: { is_oa: true, oa_status: 'gold', oa_url: 'https://x.test/pdf' },
    authorships: [{ author: { display_name: 'A' } }],
  }
  const ccby = openAlexEntry({ ...base, best_oa_location: { license: 'cc-by' } }, 'doi')
  assert.equal(ccby.attribution.author, 'open access · gold · CC BY')
  const bronze = openAlexEntry(base, 'doi')
  assert.equal(bronze.attribution.author, 'open access · gold · free to read')
})

test('entries with no image still render as named cards (no fabricated visuals)', () => {
  assert.equal(metEntryFrom({ title: 'No image', primaryImageSmall: '' }).imageUrl, null)
  assert.equal(metEntryFrom(null), null)
  assert.equal(inatEntryFrom({ name: 'X' }).imageUrl, null)
  assert.equal(gbifEntryFrom(null, 1), null)
})

test('a mapped OSM feature beats a bare pin: link, zoom, and evidence follow it', () => {
  // The Art Institute is relation 1870546; its building is way 388436810.
  const feature = osmFeature({ osmr: '1870546', osmw: '388436810' })
  assert.deepEqual(feature, { kind: 'way', id: '388436810', via: 'P10689', zoom: 15 })
  const card = mapEntry({ lat: 41.8794, lon: -87.6239 }, 'Art Institute of Chicago', feature)
  assert.equal(card.href, 'https://www.openstreetmap.org/way/388436810')
  assert.match(card.imageUrl, /^https:\/\/tile\.openstreetmap\.org\/15\//)
  assert.match(card.description, /Mapped in OpenStreetMap as way 388436810/)
  assert.equal(card._via, 'P10689')
  // A relation alone still zooms to district scale, not a whole region.
  assert.equal(osmFeature({ osmr: '1870546' }).zoom, 11)
  // Coordinates alone keep the regional pin, credited to P625.
  const pin = mapEntry({ lat: 41.8794, lon: -87.6239 }, 'Somewhere')
  assert.equal(pin._via, 'P625')
  assert.match(pin.href, /mlat=41\.8794/)
})

test('statementEntries builds no map card for a non-place, even with room for one', async () => {
  const dead = await statementEntries('Q201705', { coord: 'Point(103.9 13.4)', place: 'true', defunct: 'true' }, { label: 'Khmer Empire', withMap: true })
  assert.deepEqual(dead, [])
  const lang = await statementEntries('Q9205', { coord: 'Point(104 12)', place: 'false', defunct: 'false' }, { label: 'Khmer', withMap: true })
  assert.deepEqual(lang, [])
  const wat = await statementEntries('Q43473', { coord: 'Point(103.8667 13.4125)', place: 'true', defunct: 'false', osmw: '43497551' }, { label: 'Angkor Wat', withMap: true })
  assert.equal(wat.length, 1)
  assert.equal(wat[0].source, 'openstreetmap')
})
