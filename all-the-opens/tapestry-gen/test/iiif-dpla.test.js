import test from 'node:test'
import assert from 'node:assert/strict'

import { iiifCredit, iiifEntryFrom, iiifHomepage, iiifMetadata, iiifString, iiifThumbnail } from '../src/iiif.js'
import { dplaEntryFrom, dplaUrl } from '../src/dpla.js'
// Shared across every search-shape partner, so it lives in relevance.js beside
// the corroboration gate rather than in one partner's module (moved 2026-08-10).
import { rankShelfEntries, uniqueEntries } from '../src/relevance.js'
// LC authority helpers moved to src/lc.js on 2026-08-10 — one home for the
// two lookups (cheap authorized form vs. full record with variants).
import { decodeLcHeading, lcHeadingFromGraph } from '../src/lc.js'

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

// Presentation 1.0 (Shared Canvas, 2013) as ids.si.edu serves it. Every field
// below is copied from the live manifest for FS-F1950.19_Stitched, fetched
// 2026-08-21: the label repeats the manifest's own id, the umbrella body signs
// the attribution while `metadata` names the museum that actually holds the
// scroll, and the object page arrives as an already-resolved ARK URL. Measured
// across all 120 live Smithsonian manifests on 2026-08-18 (LUI-181), the label
// repeats the id in 117, the holder is in "Data Source" in 118, an ARK is in
// "Guid" in 117.
const SHARED_CANVAS = {
  '@context': 'http://www.shared-canvas.org/ns/context.json',
  '@id': 'https://ids.si.edu/ids/manifest/FS-F1950.19_Stitched',
  '@type': 'sc:Manifest',
  label: 'FS-F1950.19_Stitched',
  attribution: 'Smithsonian Institution',
  license: 'https://www.si.edu/termsofuse',
  metadata: [
    { label: 'Title', value: 'Dwelling in the Fuchun Mountains, after Huang Gongwang' },
    { label: 'Guid', value: 'http://n2t.net/ark:/65665/ye3be50b12d-37cb-4c2b-884c-1ddadd7d692e' },
    { label: 'Data Source', value: 'National Museum of Asian Art' },
    { label: 'Credit Line', value: 'Purchase — Charles Lang Freer Endowment' },
  ],
  sequences: [
    {
      canvases: [
        {
          images: [
            {
              resource: {
                '@id': 'https://ids.si.edu/ids/full.jpg',
                service: { '@id': 'https://ids.si.edu/iiif/FS-F1950.19' },
              },
            },
          ],
        },
      ],
    },
  ],
}

test('iiifMetadata reads the metadata pairs of every Presentation version', () => {
  assert.equal(iiifMetadata(SHARED_CANVAS).get('Data Source'), 'National Museum of Asian Art')
  // v3 wraps both halves in language maps.
  const v3 = { metadata: [{ label: { en: ['Title'] }, value: { en: ['Nighthawks'] } }] }
  assert.equal(iiifMetadata(v3).get('Title'), 'Nighthawks')
  // A repeated label keeps the first value stated, and a bare manifest an empty map.
  const twice = { metadata: [{ label: 'Artist', value: 'Wang Hui' }, { label: 'Artist', value: 'Huang Gongwang' }] }
  assert.equal(iiifMetadata(twice).get('Artist'), 'Wang Hui')
  assert.equal(iiifMetadata({}).size, 0)
})

test('a label that only repeats the manifest id yields to the stated Title', () => {
  const entry = iiifEntryFrom(SHARED_CANVAS, SHARED_CANVAS['@id'], 'Fallback')
  assert.equal(entry.title, 'Dwelling in the Fuchun Mountains, after Huang Gongwang')
})

test('a real label is never displaced by metadata', () => {
  const named = { ...SHARED_CANVAS, label: 'Dwelling in the Fuchun Mountains, scroll 2' }
  assert.equal(iiifEntryFrom(named, named['@id'], null).title, 'Dwelling in the Fuchun Mountains, scroll 2')
})

test('the holding museum leads the credit and the signing body follows it', () => {
  // Both stated: the museum that holds the scroll, then the body that signs the manifest.
  assert.equal(iiifCredit(SHARED_CANVAS), 'National Museum of Asian Art (Smithsonian Institution)')
  // Only metadata names anyone: the museum stands alone.
  assert.equal(iiifCredit({ ...SHARED_CANVAS, attribution: undefined }), 'National Museum of Asian Art')
  // Only the top-level field names anyone: unchanged from before metadata was read.
  assert.equal(iiifCredit({ ...SHARED_CANVAS, metadata: [] }), 'Smithsonian Institution')
})

test('a rights notice is never composed into a credit line', () => {
  // v2 attribution is free text, and plenty of it is a rights notice rather than
  // a name. Composing those reads as nonsense, so the stated text stands alone.
  const notice = { ...SHARED_CANVAS, attribution: '© The Library of Trinity College Dublin. All rights reserved.' }
  assert.equal(iiifCredit(notice), '© The Library of Trinity College Dublin. All rights reserved.')
  // Nor is a name repeated when one field already contains the other.
  const nested = { ...SHARED_CANVAS, attribution: 'National Museum of Asian Art, Smithsonian' }
  assert.equal(iiifCredit(nested), 'National Museum of Asian Art, Smithsonian')
})

test('the object page comes from metadata rather than looping back to the manifest', () => {
  // The Smithsonian states its ARK already resolved, so it is served as stated.
  const entry = iiifEntryFrom(SHARED_CANVAS, SHARED_CANVAS['@id'], null)
  assert.equal(entry.href, 'http://n2t.net/ark:/65665/ye3be50b12d-37cb-4c2b-884c-1ddadd7d692e')
  // A bare ARK is resolved through Name-to-Thing, which is what an ARK is for.
  const bare = { ...SHARED_CANVAS, metadata: [{ label: 'Guid', value: 'ark:/65665/300123' }] }
  assert.equal(iiifHomepage(bare), 'https://n2t.net/ark:/65665/300123')
  // An accession number is not a URL and must never become one.
  const accession = { ...SHARED_CANVAS, metadata: [{ label: 'Identifier', value: 'F1950.19' }] }
  assert.equal(iiifHomepage(accession), null)
})

// KMSKA Antwerp's v2 attribution, verbatim from the live manifest for object
// 34343, fetched 2026-08-21. Presentation 2 has no `provider` field, so the
// museum links its own name inside the prose instead — and in front of that
// name sits a machine-generated run of licence codes and repeated collection
// strings, which is what a reader saw before the anchor was read.
const KMSKA_ATTRIBUTION = "CC0, CC0, Public domain, Koninklijk Museum voor Schone Kunsten Antwerpen - Collectie Vlaamse Gemeenschap, Koninklijk Museum voor Schone Kunsten Antwerpen - Collectie Vlaamse Gemeenschap, Koninklijk Museum voor Schone Kunsten Antwerpen - Collectie Vlaamse Gemeenschap, Koninklijk Museum voor Schone Kunsten Antwerpen - Collectie Vlaamse Gemeenschap<p><a href=\"http://creativecommons.org/publicdomain/mark/1.0/\"><img src=\"https://licensebuttons.net/p/mark/1.0/88x31.png\"/></a></p><a href=\"https://kmska.be/en\">Royal Museum of Fine Arts Antwerp - Flemish Community</a><br>The jpg files of public domain artworks are downloadable in high resolution through the KMSKA website. Requesting images can be done through the contact form at <a href=\"https://kmska.be/en/contact\">kmska.be/en/contact</a>.</p>"

test('a museum that links its own name in HTML is credited by that name', () => {
  const m = { '@context': 'http://iiif.io/api/presentation/2/context.json', attribution: [{ '@language': 'en', '@value': KMSKA_ATTRIBUTION }] }
  assert.equal(iiifCredit(m), 'Royal Museum of Fine Arts Antwerp - Flemish Community')
})

test('a licence badge and a bare domain are never mistaken for the institution', () => {
  // The Creative Commons badge is the first anchor in the blob above and the
  // museum's contact URL the last; the name between them is the credit.
  const between = {
    attribution:
      '<a href="http://creativecommons.org/publicdomain/mark/1.0/"><img src="x"/></a>' +
      '<a href="https://example.org/en">Example Museum of Fine Arts</a>' +
      '<a href="https://example.org/contact">example.org/contact</a>',
  }
  assert.equal(iiifCredit(between), 'Example Museum of Fine Arts')
  // A badge alone names nobody, and there is no prose behind it to fall back to.
  const badgeOnly = { attribution: '<p><a href="http://creativecommons.org/publicdomain/mark/1.0/"><img src="x"/></a></p>' }
  assert.equal(iiifCredit(badgeOnly), null)
  // No anchor names an institution, so the publisher's own text stands rather
  // than being thrown away — the same contract as an attribution with no link.
  const domainOnly = { attribution: '<a href="https://example.org/contact">example.org/contact</a>' }
  assert.equal(iiifCredit(domainOnly), 'example.org/contact')
})

test('an attribution with no link is credited exactly as it reads', () => {
  // The v2 fixture above is this shape, and must not change.
  const notice = { attribution: '<span>\u00a9 The Library of Trinity College Dublin</span>' }
  assert.equal(iiifCredit(notice), '\u00a9 The Library of Trinity College Dublin')
})

test('the blanket Smithsonian terms URL is not read as an open licence', () => {
  assert.equal(iiifEntryFrom(SHARED_CANVAS, SHARED_CANVAS['@id'], null).rights.copy, null)
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
// failure this lookup must not have, since it is indistinguishable from an
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
  // The window, not the shelf size: one request reads 50 rows so the pick can
  // be ranked here instead of taken from the top of DPLA's unordered index.
  // Same request count, bigger body. See rankShelfEntries.
  assert.match(url, /page_size=50/)
})

test('the shelf is ranked and deduped locally, and never filtered', () => {
  // The real shape of the Armstrong heading: the items DPLA returns first are
  // unrelated, the good ones are further down, and one group repeats.
  const e = (title, imageUrl = null) => ({ title, imageUrl })
  const picked = rankShelfEntries(
    [
      e('Ricci Poster 143', 'https://t/1.jpg'),
      e('Kristina McNeill', 'https://t/2.jpg'),
      e('Bussed balloonist', 'https://t/3.jpg'),
      e("The World's Columbian exposition"),
      e('Astronaut Neil Armstrong, Cincinnati, Ohio', 'https://t/4.jpg'),
      e('Ceremony for Apollo 11 astronauts Armstrong, Aldrin, and Collins', 'https://t/5.jpg'),
      e('Ceremony for Apollo 11 astronauts Armstrong, Aldrin, and Collins arrive', 'https://t/6.jpg'),
      e('The lunar module, with astronauts Neil A. Armstrong aboard', 'https://t/7.jpg'),
      e('Neil Armstrong and Buzz Aldrin plant the flag', 'https://t/8.jpg'),
    ],
    { heading: 'Armstrong, Neil, 1930-2012', anchorLabel: 'Neil Armstrong' },
  )
  const titles = picked.map((p) => p.title)
  // Titles naming the subject lead; the index-order junk is gone.
  assert.match(titles[0], /Astronaut Neil Armstrong/)
  assert.ok(!titles.some((t) => /Ricci Poster|Kristina McNeill|balloonist/.test(t)))
  // The near-identical ceremony records contribute at most ONE card. (Here
  // they score below four better matches and contribute none — the point is
  // that they can never fill the shelf with copies of one photograph.)
  assert.ok(titles.filter((t) => /^Ceremony for Apollo 11/.test(t)).length <= 1)
  // Capped at the shelf size.
  assert.equal(picked.length, 4)
})

test('ranking degrades to DPLA’s own order rather than emptying a shelf', () => {
  // No title shares a token with the anchor: every score is 0 or 1, so the
  // shelf is what it always was. A ranker that filtered would show nothing.
  const e = (title) => ({ title, imageUrl: null })
  const input = [e('Alpha'), e('Beta'), e('Gamma'), e('Delta'), e('Epsilon')]
  const picked = rankShelfEntries(input, { heading: 'Cambodia', anchorLabel: 'Cambodia' })
  assert.deepEqual(
    picked.map((p) => p.title),
    ['Alpha', 'Beta', 'Gamma', 'Delta'],
  )
})

test('a thumbnail breaks a tie but never outranks being about the subject', () => {
  const e = (title, imageUrl = null) => ({ title, imageUrl })
  const picked = rankShelfEntries(
    [e('A picture of nothing relevant', 'https://t/1.jpg'), e('Cambodia', null)],
    { heading: 'Cambodia', anchorLabel: 'Cambodia' },
  )
  // One matching token (2) beats a thumbnail (1), even unillustrated.
  assert.equal(picked[0].title, 'Cambodia')
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

test('europeanaUrl lookups on the stated entity URI and asks only for open items', async () => {
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
