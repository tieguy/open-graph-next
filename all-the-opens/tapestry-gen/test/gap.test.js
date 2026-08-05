import test from 'node:test'
import assert from 'node:assert/strict'

import { articleReach, gapCounts, hostOf, partnerTally, visibilityReport } from '../src/gap.js'

const band = (entries, footnotes = []) => ({ id: 's1', title: 'S', entries, footnotes })

test('articleReach reads the article’s own reach off the parse response', () => {
  const reach = articleReach({
    templates: [{ ns: 10, title: 'Template:Authority control' }, { ns: 10, title: 'Template:Cite web' }],
    externallinks: [
      'https://www.openlibrary.org/works/OL1W',
      'http://archive.org/details/x',
      'not a url',
    ],
    html:
      '<div class="mw-kartographer-map">…</div>',
  })
  assert.deepEqual([...reach.hosts].sort(), ['archive.org', 'openlibrary.org'])
  assert.equal(reach.kartographer, true)
  assert.equal(reach.identifierBar, true)
})

test('a Wayback link is a rescued citation, not the Archive appearing in the article', () => {
  // Nearly every mature article carries one. Counting it would let the page
  // claim the Internet Archive is visible almost everywhere on Wikipedia —
  // a much weaker and quite different statement.
  const reach = articleReach({ externallinks: ['https://web.archive.org/web/2015/http://x.test/'] })
  assert.equal(reach.hosts.has('web.archive.org'), false)
  const report = visibilityReport([band([{ source: 'internet_archive', title: 'A scan' }])], reach)
  assert.equal(report[0].tier, 'invisible')
})

test('hostOf normalizes www and refuses what will not parse', () => {
  assert.equal(hostOf('https://WWW.GBIF.org/species/1'), 'gbif.org')
  // A hostless URL parses but has no host to compare — `mailto:` shows up in
  // reference lists often enough to matter.
  assert.equal(hostOf('mailto:x@y.test'), null)
  assert.equal(hostOf('/wiki/Earth'), null)
})

test('a partner earns a tally mark by giving something, not by being cited', () => {
  const tally = partnerTally([
    band(
      [{ source: 'met' }, { source: 'met' }, { source: 'openstreetmap' }],
      [
        { access: { url: 'https://archive.org/details/x' } },
        { access: { url: 'https://openlibrary.org/books/OL1M' } },
        // A bare DOI in a footnote is the article citing a paper; OpenAlex
        // did not put it there and must not be credited for it.
        { access: null, html: '<a href="https://doi.org/10.1/x">doi</a>' },
      ],
    ),
  ])
  // Cards and footnote links are counted apart and never summed: a row
  // reading "13 items" beside six visible cards cannot be checked.
  assert.deepEqual(tally.get('met'), { cards: 2, notes: 0 })
  assert.deepEqual(tally.get('openstreetmap'), { cards: 1, notes: 0 })
  assert.deepEqual(tally.get('internet_archive'), { cards: 0, notes: 1 })
  assert.deepEqual(tally.get('openlibrary'), { cards: 0, notes: 1 })
  assert.equal(tally.has('openalex'), false)
})

test('the three tiers, and the one partner that can reach the top of them', () => {
  const reach = articleReach({
    templates: [{ title: 'Template:Authority control' }],
    externallinks: ['https://openlibrary.org/works/OL1W', 'https://www.openstreetmap.org/#map=5'],
    html: '<div class="mw-kartographer-maplink">map</div>',
  })
  const report = visibilityReport(
    [
      band([
        { source: 'met', title: 'A painting' },
        { source: 'openstreetmap', title: 'Map' },
        { source: 'openlibrary', title: 'A book' },
      ]),
    ],
    reach,
  )
  // Ordered shown → link → invisible: the finding is what the list ends on.
  assert.deepEqual(
    report.map((r) => [r.slug, r.tier]),
    [
      ['openstreetmap', 'shown'],
      ['openlibrary', 'link'],
      ['met', 'invisible'],
    ],
  )
  // Open Library rides {{Authority control}}, and the report says exactly that
  // rather than guessing at "somewhere on the page".
  assert.match(report[1].where, /identifier list at the foot of the article/)
  assert.deepEqual(gapCounts(report), { total: 3, shown: 1, link: 1, invisible: 1 })
})

test('OpenStreetMap without Kartographer is not shown, whatever else the article links', () => {
  // The article links osm.org from a citation but embeds no map: that is a
  // link, not the map appearing in the article as OpenStreetMap's.
  const reach = articleReach({
    externallinks: ['https://www.openstreetmap.org/way/1'],
    html: '<p>no map here</p>',
  })
  const report = visibilityReport([band([{ source: 'openstreetmap', title: 'Map' }])], reach)
  assert.equal(report[0].tier, 'link')
})

test('IIIF has no fixed host, so its reach is judged by where its own cards point', () => {
  const entries = [{ source: 'iiif', title: 'A manuscript', href: 'https://www.smk.dk/en/artwork/1' }]
  const linked = visibilityReport([band(entries)], articleReach({ externallinks: ['https://smk.dk/x'] }))
  assert.equal(linked[0].tier, 'link')
  const not = visibilityReport([band(entries)], articleReach({ externallinks: [] }))
  assert.equal(not[0].tier, 'invisible')
})

test('no reach, or no partners, means no report to render', () => {
  assert.deepEqual(visibilityReport([], articleReach({})), [])
  assert.deepEqual(gapCounts([]), { total: 0, shown: 0, link: 0, invisible: 0 })
})
