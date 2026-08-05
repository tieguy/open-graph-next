import test from 'node:test'
import assert from 'node:assert/strict'

import { iiifCredit, iiifEntryFrom, iiifString, iiifThumbnail } from '../src/iiif.js'
import { dplaEntryFrom, dplaUrl } from '../src/dpla.js'
import { decodeLcHeading, lcHeadingFromGraph } from '../src/dpla.js'

// ---- IIIF (P6108) -----------------------------------------------------------

test('iiifString reads every label shape the two Presentation APIs use', () => {
  assert.equal(iiifString('Plain'), 'Plain')
  assert.equal(iiifString(['First', 'Second']), 'First')
  assert.equal(iiifString({ '@value': 'Valued' }), 'Valued')
  assert.equal(iiifString({ en: ['English'], fr: ['French'] }), 'English')
  assert.equal(iiifString({ none: ['Unlanged'] }), 'Unlanged')
  assert.equal(iiifString({ ga: ['Irish only'] }), 'Irish only')
  assert.equal(iiifString('<b>Marked up</b>'), 'Marked up')
  assert.equal(iiifString(null), null)
})

const V2 = {
  '@context': 'http://iiif.io/api/presentation/2/context.json',
  label: 'Book of Kells',
  attribution: '<span>© The Library of Trinity College Dublin</span>',
  related: 'https://library.tcd.ie/kells',
  sequences: [
    {
      canvases: [
        {
          images: [
            {
              resource: {
                '@id': 'https://iiif.tcd.ie/full.jpg',
                service: { '@id': 'https://iiif.tcd.ie/image/MS58_001r' },
              },
            },
          ],
        },
      ],
    },
  ],
}

const V3 = {
  '@context': 'http://iiif.io/api/presentation/3/context.json',
  label: { en: ['Ellesmere Chaucer'] },
  requiredStatement: { label: { en: ['Attribution'] }, value: { en: ['Huntington Library'] } },
  provider: [{ label: { en: ['The Huntington'] } }],
  homepage: [{ id: 'https://hdl.huntington.org/ellesmere' }],
  items: [
    {
      items: [
        {
          items: [
            { body: { id: 'https://hl.org/full.jpg', service: [{ id: 'https://hl.org/iiif/el1' }] } },
          ],
        },
      ],
    },
  ],
}

test('a v2 manifest becomes a card: image service, attribution, related link', () => {
  const e = iiifEntryFrom(V2, 'https://iiif.tcd.ie/manifest.json')
  assert.equal(e.source, 'iiif')
  assert.equal(e.title, 'Book of Kells')
  assert.equal(e.imageUrl, 'https://iiif.tcd.ie/image/MS58_001r/full/400,/0/default.jpg')
  assert.equal(e.href, 'https://library.tcd.ie/kells')
  assert.equal(e.attribution.author, '© The Library of Trinity College Dublin')
  assert.equal(e._via, 'P6108')
})

test('a v3 manifest becomes a card: requiredStatement wins the credit, homepage the link', () => {
  const e = iiifEntryFrom(V3, 'https://hl.org/manifest.json')
  assert.equal(e.title, 'Ellesmere Chaucer')
  assert.equal(e.imageUrl, 'https://hl.org/iiif/el1/full/400,/0/default.jpg')
  assert.equal(e.href, 'https://hdl.huntington.org/ellesmere')
  assert.equal(e.attribution.author, 'Huntington Library')
})

test('a stated thumbnail beats canvas digging; a bare manifest still links itself', () => {
  const e = iiifEntryFrom(
    { label: 'X', thumbnail: [{ id: 'https://x.test/thumb.jpg' }] },
    'https://x.test/manifest.json',
  )
  assert.equal(e.imageUrl, 'https://x.test/thumb.jpg')
  assert.equal(e.href, 'https://x.test/manifest.json')
  assert.equal(iiifCredit({}), null)
  assert.equal(iiifThumbnail({}), null)
  assert.equal(iiifEntryFrom(null, 'u', 'f'), null)
})

// ---- DPLA -------------------------------------------------------------------

test('the LC graph yields the authorized heading for exactly the asked id', () => {
  const graph = [
    { '@id': 'http://id.loc.gov/authorities/names/n79000001-781' },
    {
      '@id': 'http://id.loc.gov/authorities/names/n79000001',
      'http://www.w3.org/2004/02/skos/core#prefLabel': [{ '@value': 'Armstrong, Neil, 1930-2012' }],
    },
  ]
  assert.equal(lcHeadingFromGraph(graph, 'n79000001'), 'Armstrong, Neil, 1930-2012')
  assert.equal(lcHeadingFromGraph([], 'n79000001'), null)
  assert.equal(lcHeadingFromGraph('not a graph', 'x'), null)
})

// LC ships the same identifier twice: the authority record, which carries the
// heading, and an `rwo/agents` node for the real-world thing it names, which
// carries none. Matching on "@id ends with /<id>" hits both, and the order is
// NOT stable — n80014970 (Cambodia) lists the authority first and resolved;
// n79006404 (France) lists rwo first and silently resolved to null, costing the
// page every DPLA card under that anchor after the fetch was already paid for.
// Measured 2026-08-05: 8 of 14 sampled ids lost this coin flip.
test('the rwo/agents twin never stands in for the authority record', () => {
  const nodes = {
    rwo: { '@id': 'http://id.loc.gov/rwo/agents/n79006404' },
    authority: {
      '@id': 'http://id.loc.gov/authorities/names/n79006404',
      'http://www.w3.org/2004/02/skos/core#prefLabel': [{ '@value': 'France' }],
    },
  }
  // Either order, same answer.
  assert.equal(lcHeadingFromGraph([nodes.rwo, nodes.authority], 'n79006404'), 'France')
  assert.equal(lcHeadingFromGraph([nodes.authority, nodes.rwo], 'n79006404'), 'France')
  // Subject headings live under a different branch and must resolve too.
  assert.equal(
    lcHeadingFromGraph(
      [
        { '@id': 'http://id.loc.gov/rwo/agents/sh85005249' },
        {
          '@id': 'http://id.loc.gov/authorities/subjects/sh85005249',
          'http://www.loc.gov/mads/rdf/v1#authoritativeLabel': [{ '@value': 'Animals' }],
        },
      ],
      'sh85005249',
    ),
    'Animals',
  )
  // An id that appears ONLY as an rwo node has no authorized heading to report.
  assert.equal(lcHeadingFromGraph([nodes.rwo], 'n79006404'), null)
})

// HTTP headers are Latin-1, and LC sends UTF-8 bytes — so the plain
// `x-preflabel` arrives as "CÅdÃ¨s, George" and would go on to DPLA as a
// subject-name query matching nothing at all. That is why LC ships
// `x-preflabel-encoded` beside it. A silent zero-result search is exactly the
// failure this pivot must not have, since it is indistinguishable from an
// anchor the partners genuinely hold nothing under.
test('the encoded heading survives the trip through a Latin-1 header', () => {
  assert.equal(decodeLcHeading('C%C5%93d%C3%A8s%2C%20George'), 'Cœdès, George')
  assert.equal(decodeLcHeading('Champ%C4%81%20%28Kingdom%29'), 'Champā (Kingdom)')
  assert.equal(
    decodeLcHeading('%C3%89cole%20fran%C3%A7aise%20d%27Extr%C3%AAme-Orient'),
    "École française d'Extrême-Orient",
  )
  assert.equal(decodeLcHeading('Animals'), 'Animals')
  // A malformed sequence is not a heading; it must not throw mid-page.
  assert.equal(decodeLcHeading('%E0%A4%A'), null)
  assert.equal(decodeLcHeading(''), null)
  assert.equal(decodeLcHeading(null), null)
})

test('dplaUrl asks for the exact authorized heading and only the fields the card reads', () => {
  const url = dplaUrl('Apollo 11 (Spacecraft)', 'KEY')
  assert.match(url, /sourceResource\.subject\.name="Apollo%2011%20\(Spacecraft\)"/)
  assert.match(url, /api_key=KEY/)
  assert.match(url, /page_size=4/)
})

test('a DPLA doc becomes a card credited to its holding institution, keyed on P244', () => {
  const doc = {
    id: 'abc123',
    'sourceResource.title': ['Apollo 11 launch photograph'],
    dataProvider: { name: 'NASA on The Commons' },
    object: 'https://thumb.test/x.jpg',
    isShownAt: 'https://provider.test/item/1',
  }
  const e = dplaEntryFrom(doc, 'Apollo 11 (Spacecraft)', 'Apollo 11')
  assert.equal(e.source, 'dpla')
  assert.equal(e.description, 'NASA on The Commons')
  // The durable DPLA item page, not the provider host that may have rotted.
  assert.equal(e.href, 'https://dp.la/item/abc123')
  assert.match(e.why, /Filed under “Apollo 11 \(Spacecraft\)” — the subject heading American libraries use for Apollo 11/)
  // The property that found it lives in the ⓘ fold, not the credit line.
  assert.equal(e.attribution.license, null)
  // Without an id the provider link still opens a door…
  assert.equal(dplaEntryFrom({ ...doc, id: undefined }, 'S', 'S').href, 'https://provider.test/item/1')
  // …but no landing page at all → no card: a dead-end card is not a finding.
  assert.equal(dplaEntryFrom({ 'sourceResource.title': 'T' }, 'S', 'S'), null)
})

test('near-identical multi-part docs collapse to one card per title and holder', async () => {
  const { uniqueEntries } = await import('../src/dpla.js')
  const e = (title, description) => ({ title, description })
  const out = uniqueEntries([
    e('Interview, reel 1', 'Russell Library'),
    e('Interview, reel 1', 'Russell Library'), // the second reel of the same interview
    e('Interview, reel 1', 'South Carolina Digital Library'), // same title, different holder — kept
    e('Statement on editorial', 'South Carolina Digital Library'),
  ])
  assert.deepEqual(
    out.map((x) => `${x.title} @ ${x.description}`),
    [
      'Interview, reel 1 @ Russell Library',
      'Interview, reel 1 @ South Carolina Digital Library',
      'Statement on editorial @ South Carolina Digital Library',
    ],
  )
})

// ---- Europeana --------------------------------------------------------------

test('europeanaUrl pivots on the stated entity URI and asks only for open items', async () => {
  const { europeanaUrl, rightsName, europeanaEntryFrom } = await import('../src/europeana.js')
  // P7704 values carry a legacy /base/ segment the search index dropped.
  const url = europeanaUrl('agent/base/59904', 'KEY')
  assert.match(url, /query=%22http%3A%2F%2Fdata\.europeana\.eu%2Fagent%2F59904%22/)
  assert.match(url, /reusability=open/)
  assert.match(url, /wskey=KEY/)

  assert.equal(rightsName('http://creativecommons.org/publicdomain/mark/1.0/'), 'Public Domain')
  assert.equal(rightsName('http://creativecommons.org/publicdomain/zero/1.0/'), 'CC0')
  assert.equal(rightsName('http://creativecommons.org/licenses/by-sa/4.0/'), 'CC BY SA')
  assert.equal(rightsName(undefined), null)

  const e = europeanaEntryFrom(
    {
      title: ['Portret van een dame'],
      dataProvider: ['Rijksmuseum'],
      edmPreview: ['https://api.europeana.eu/thumbnail/x.jpg'],
      rights: ['http://creativecommons.org/publicdomain/mark/1.0/'],
      guid: 'https://www.europeana.eu/item/90402/SK_A_1',
    },
    'Rembrandt',
  )
  assert.equal(e.source, 'europeana')
  assert.equal(e.attribution.author, 'Rijksmuseum · Public Domain')
  assert.match(e.why, /Europeana’s member institutions link this to Rembrandt/)
  assert.equal(europeanaEntryFrom({ title: ['no guid'] }, 'X'), null)
})
