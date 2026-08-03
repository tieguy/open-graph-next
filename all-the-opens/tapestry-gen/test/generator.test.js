import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { makeZip } from '../src/zip.js'
import { buildAdjacency, hopDistances } from '../src/dataset.js'
import { placeItems } from '../src/place.js'
import {
  cardHeight,
  CARD_STYLE,
  citationCardHeight,
  estimateTextHeight,
  imageHeight,
  layoutBands,
  LANES,
  mediaAspect,
  PROSE,
  startView,
  WIDTHS,
  wrappedLines,
} from '../src/layout.js'
import { commonsFileTitle, firstSentences, imageCredit, infoboxLinks } from '../src/wikipedia.js'
import { attributionLine, buildTapestry, escapeHtml, placementNote } from '../src/emit.js'
import { buildHtml, sourcesUsed } from '../src/emit-html.js'

test('zip round-trips through an external unzip', () => {
  const payload = JSON.stringify({ version: 7, hello: 'wörld — ünicode' })
  const buffer = makeZip([{ name: 'root.json', data: payload }])
  const dir = mkdtempSync(join(tmpdir(), 'tapgen-'))
  const path = join(dir, 'out.tapestry')
  writeFileSync(path, buffer)

  const listed = execFileSync('python3', ['-c',
    `import zipfile;z=zipfile.ZipFile('${path}');print(z.namelist()[0]);print(z.read('root.json').decode())`,
  ]).toString().trim().split('\n')

  assert.equal(listed[0], 'root.json')
  assert.equal(listed.slice(1).join('\n'), payload)
})

test('zip output is byte-identical across runs', () => {
  const a = makeZip([{ name: 'root.json', data: 'stable' }])
  const b = makeZip([{ name: 'root.json', data: 'stable' }])
  assert.deepEqual(a, b)
})

// --- placement --------------------------------------------------------------

const SECTIONS = [{ index: 'lede' }, { index: '1' }, { index: '2' }]

function fixture(connections) {
  const adj = buildAdjacency(connections)
  const items = new Map(
    ['seed', 'linked', 'media', 'osm', 'critter', 'orphan', 'landmark'].map((id) => [id, { id }]),
  )
  return { items, adj }
}

test('the seed is pinned to the first band even though the article never links itself', () => {
  const { items, adj } = fixture({})
  const result = placeItems({
    items, sections: SECTIONS, sectionQids: new Map(), itemQids: new Map(), adj, seedId: 'seed',
  })
  assert.deepEqual(result.placement.get('seed'), {
    section: 'lede', tier: 1, via: 'article subject',
  })
})

test('an item whose QID a section wikilinks is placed there', () => {
  const { items, adj } = fixture({})
  const result = placeItems({
    items,
    sections: SECTIONS,
    sectionQids: new Map([['1', ['Q42']]]),
    itemQids: new Map([['linked', 'Q42']]),
    adj,
    seedId: 'seed',
  })
  assert.equal(result.placement.get('linked').section, '1')
  assert.equal(result.placement.get('linked').tier, 1)
})

test('media reaches a section through its connection to a wikilinked item', () => {
  const { items, adj } = fixture({
    linked: [{ targetId: 'media', type: 'subject', label: 'footage', linkedVia: ['manual'] }],
  })
  const result = placeItems({
    items,
    sections: SECTIONS,
    sectionQids: new Map([['2', ['Q42']]]),
    itemQids: new Map([['linked', 'Q42']]),
    adj,
    seedId: 'seed',
  })
  assert.deepEqual(result.placement.get('media'), { section: '2', tier: 2, via: 'linked' })
})

test('an item adjacent to two placed items takes the earlier body section', () => {
  const { items, adj } = fixture({
    linked: [{ targetId: 'media', type: 'subject', label: 'a', linkedVia: ['wikidata'] }],
    landmark: [{ targetId: 'media', type: 'subject', label: 'b', linkedVia: ['wikidata'] }],
  })
  const result = placeItems({
    items,
    sections: SECTIONS,
    sectionQids: new Map([['2', ['Q_LATE']], ['1', ['Q_EARLY']]]),
    itemQids: new Map([['linked', 'Q_LATE'], ['landmark', 'Q_EARLY']]),
    adj,
    seedId: 'seed',
  })
  assert.equal(result.placement.get('media').section, '1')
})

test('a body section beats the lede for both tiers', () => {
  // The lede summarises the article, so it wikilinks nearly everything the body
  // discusses. Letting it win drags most of the dataset into the opening band.
  const { items, adj } = fixture({
    linked: [{ targetId: 'media', type: 'subject', label: 'a', linkedVia: ['wikidata'] }],
  })
  const result = placeItems({
    items,
    sections: SECTIONS,
    // 'linked' is wikilinked from both the lede and a body section.
    sectionQids: new Map([['lede', ['Q42']], ['2', ['Q42']]]),
    itemQids: new Map([['linked', 'Q42']]),
    adj,
    seedId: 'seed',
  })
  assert.equal(result.placement.get('linked').section, '2', 'tier 1 prefers the body')
  assert.equal(result.placement.get('media').section, '2', 'tier 2 follows its anchor')
})

test('purely geographic items go to the prologue, not into a section', () => {
  const { items, adj } = fixture({
    osm: [
      { targetId: 'linked', type: 'location', label: 'at', linkedVia: ['coordinates'] },
      { targetId: 'landmark', type: 'location', label: 'near', linkedVia: ['geonames', 'coordinates'] },
    ],
  })
  const result = placeItems({
    items,
    sections: SECTIONS,
    sectionQids: new Map([['1', ['Q42']]]),
    itemQids: new Map([['linked', 'Q42']]),
    adj,
    seedId: 'seed',
  })
  assert.ok(result.prologue.includes('osm'), 'expected prologue placement')
  assert.equal(result.placement.has('osm'), false, 'must not be absorbed as tier 2')
})

test('a subject sitting at those coordinates goes to the coda instead', () => {
  const { items, adj } = fixture({
    critter: [{ targetId: 'landmark', type: 'subject', label: 'observed at', linkedVia: ['coordinates'] }],
  })
  const result = placeItems({
    items, sections: SECTIONS, sectionQids: new Map(), itemQids: new Map(), adj, seedId: 'seed',
  })
  assert.ok(result.coda.includes('critter'))
  assert.equal(result.prologue.includes('critter'), false)
})

test('a location edge also backed by a non-geographic authority stays in the narrative', () => {
  // The Sea of Tranquility case: a `location` edge, but Wikidata asserts what it
  // is, not merely where. It must not be swept into the coda.
  const { items, adj } = fixture({
    linked: [{ targetId: 'landmark', type: 'location', label: 'landing site', linkedVia: ['wikidata', 'coordinates'] }],
  })
  const result = placeItems({
    items,
    sections: SECTIONS,
    sectionQids: new Map([['1', ['Q42']]]),
    itemQids: new Map([['linked', 'Q42']]),
    adj,
    seedId: 'seed',
  })
  assert.equal(result.placement.get('landmark').tier, 2)
  assert.equal(result.coda.includes('landmark'), false)
  assert.equal(result.prologue.includes('landmark'), false)
})

test('an item with no edges at all is reported unreached, not placed by geography', () => {
  const { items, adj } = fixture({})
  const result = placeItems({
    items, sections: SECTIONS, sectionQids: new Map(), itemQids: new Map(), adj, seedId: 'seed',
  })
  assert.ok(result.unplaced.includes('orphan'))
  assert.equal(result.prologue.includes('orphan'), false)
  assert.equal(result.coda.includes('orphan'), false)
})

test('every item is accounted for in exactly one bucket', () => {
  const { items, adj } = fixture({
    linked: [{ targetId: 'media', type: 'subject', label: 'x', linkedVia: ['wikidata'] }],
    osm: [{ targetId: 'linked', type: 'location', label: 'at', linkedVia: ['coordinates'] }],
    critter: [{ targetId: 'landmark', type: 'subject', label: 'at', linkedVia: ['coordinates'] }],
  })
  const result = placeItems({
    items,
    sections: SECTIONS,
    sectionQids: new Map([['1', ['Q42']]]),
    itemQids: new Map([['linked', 'Q42']]),
    adj,
    seedId: 'seed',
  })
  const buckets = [
    ...result.placement.keys(),
    ...result.prologue,
    ...result.coda,
    ...result.unplaced,
  ]
  assert.equal(buckets.length, items.size, 'no item counted twice or dropped')
  assert.equal(new Set(buckets).size, items.size)
})

// --- graph helpers ----------------------------------------------------------

test('adjacency is undirected even though connections.json is not', () => {
  const adj = buildAdjacency({
    a: [{ targetId: 'b', type: 'subject', label: 'x', linkedVia: ['wikidata'] }],
  })
  assert.equal(adj.get('b')[0].id, 'a')
})

test('hop distance walks the undirected graph', () => {
  const adj = buildAdjacency({
    a: [{ targetId: 'b', type: 'subject', label: 'x', linkedVia: [] }],
    b: [{ targetId: 'c', type: 'subject', label: 'y', linkedVia: [] }],
  })
  assert.equal(hopDistances(adj, 'a').get('c'), 2)
})

// --- layout -----------------------------------------------------------------

test('bands stack downward and never overlap', () => {
  const bands = [
    { id: 'one', title: 'One', text: 'short', html: '<p>short</p>', entries: [{ id: 'x' }, { id: 'y' }] },
    { id: 'two', title: 'Two', text: 'short', html: '<p>short</p>', entries: [{ id: 'z' }] },
  ]
  const out = layoutBands(bands)
  const [first, second] = out.bands
  assert.ok(second.y >= first.y + first.height, 'second band starts below the first')
  assert.equal(out.groups.length, 2)
})

test('the first entry in a band is the hero and later ones are standard', () => {
  const out = layoutBands([
    { id: 'b', title: 'B', text: 't', html: '<p>t</p>', entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  ])
  const entries = out.items.filter((i) => i.kind === 'entry')
  assert.equal(entries[0].sizeClass, 'hero')
  assert.equal(entries[0].size.width, WIDTHS.hero)
  assert.equal(entries[1].sizeClass, 'standard')
  assert.equal(entries[1].size.width, WIDTHS.standard)
  assert.equal(entries[2].sizeClass, 'standard')
})

test('card height follows content length rather than a fixed box', () => {
  const short = cardHeight('Tiny', 'one line', WIDTHS.standard)
  const long = cardHeight('Tiny', 'x'.repeat(900), WIDTHS.standard)
  assert.ok(long > short, 'a longer description makes a taller card')
  assert.ok(short < 260, `a short card should stay compact, got ${short}`)
})

test('a hero card is taller than a standard card with identical text', () => {
  const text = 'x'.repeat(200)
  assert.ok(
    cardHeight('Title', text, WIDTHS.standard, true) >
      cardHeight('Title', text, WIDTHS.standard, false),
    'hero type sizes must be applied when isHero is set',
  )
})

test('card height accounts for a title that wraps', () => {
  const oneLine = cardHeight('Short', 'body', WIDTHS.standard)
  const wrapped = cardHeight('A very long title '.repeat(6), 'body', WIDTHS.standard)
  assert.ok(wrapped > oneLine, 'a wrapping title must add height')
})

test('a card leaves no more than a line of slack over its content', () => {
  // Guards the double-padding bug: chrome was counted twice, leaving cards a
  // quarter empty. Compare against a hand-computed height for known content.
  const s = CARD_STYLE
  const description = 'y'.repeat(300)
  const height = cardHeight('Title', description, WIDTHS.standard)
  const lines = wrappedLines(description, WIDTHS.standard - 48, s.body.standard)
  const expected =
    s.padding +
    s.label.size * s.label.lineHeight + s.label.marginBottom +
    s.title.standard * s.title.lineHeight + s.title.marginBottom +
    lines * s.body.standard * s.body.lineHeight + s.body.marginBottom +
    s.note.size * s.note.lineHeight
  assert.ok(Math.abs(height - expected) <= 1, `got ${height}, expected about ${expected}`)
})

test('standard entries fill the shorter column so tall cards do not leave gaps', () => {
  const out = layoutBands([
    {
      id: 'b', title: 'B', text: 't', html: '<p>t</p>',
      entries: [
        { id: 'hero', title: 'H', description: 'h' },
        { id: 'tall', title: 'T', description: 'x'.repeat(1200) },
        { id: 'short', title: 'S', description: 'y' },
        { id: 'next', title: 'N', description: 'z' },
      ],
    },
  ])
  const byId = Object.fromEntries(out.items.filter((i) => i.kind === 'entry').map((i) => [i.id, i]))
  // 'tall' and 'short' start side by side; 'next' goes under 'short', the shorter column.
  assert.equal(byId.tall.position.y, byId.short.position.y)
  assert.equal(byId.next.position.x, byId.short.position.x)
  assert.ok(byId.next.position.y < byId.tall.position.y + byId.tall.size.height)
})

test('standard entries alternate between two columns', () => {
  const out = layoutBands([
    { id: 'b', title: 'B', text: 't', html: '<p>t</p>', entries: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
  ])
  const entries = out.items.filter((i) => i.kind === 'entry')
  assert.equal(entries[1].position.x, LANES.media.x)
  assert.notEqual(entries[2].position.x, entries[1].position.x)
})

test('text and media lanes do not overlap horizontally', () => {
  assert.ok(LANES.spine.x + LANES.spine.width <= LANES.media.x)
  assert.ok(LANES.citations.x + LANES.citations.width <= LANES.spine.x)
})

test('text height grows with content and has a floor', () => {
  assert.equal(estimateTextHeight('', 560), 200)
  assert.ok(estimateTextHeight('x'.repeat(2000), 560) > estimateTextHeight('x'.repeat(200), 560))
})

// --- text extraction --------------------------------------------------------

test('first sentences strip markup, footnotes and tables', () => {
  const html =
    '<table><tr><td>infobox</td></tr></table>' +
    '<p>Apollo 11 was a spaceflight.<sup>[1]</sup> It landed in 1969. A third one.</p>'
  const out = firstSentences(html, 2)
  assert.equal(out, 'Apollo 11 was a spaceflight. It landed in 1969.')
})

test('sentence splitting is not fooled by an initial', () => {
  const out = firstSentences('<p>John F. Kennedy spoke. Then he left.</p>', 1)
  assert.equal(out, 'John F. Kennedy spoke.')
})

test('decodes entities that would otherwise show as raw markup', () => {
  assert.equal(firstSentences('<p>Fish &amp; chips cost &lt;5.</p>', 1), 'Fish & chips cost <5.')
})

// --- attribution ------------------------------------------------------------

test('image credit is pulled from Commons extmetadata, with markup stripped', () => {
  const ext = {
    LicenseShortName: { value: 'CC BY-SA 4.0' },
    Artist: { value: '<a href="//commons.wikimedia.org/wiki/User:NASA">NASA</a>' },
  }
  assert.deepEqual(imageCredit(ext), { license: 'CC BY-SA 4.0', author: 'NASA' })
})

test('image credit tolerates a missing license or author', () => {
  assert.deepEqual(imageCredit({ Artist: { value: 'NASA' } }), { license: null, author: 'NASA' })
  assert.deepEqual(imageCredit({ LicenseShortName: { value: 'Public domain' } }), {
    license: 'Public domain', author: null,
  })
})

test('image credit is null when there is nothing to credit', () => {
  assert.equal(imageCredit(undefined), null)
  assert.equal(imageCredit({}), null)
})

test('an attribution line names the author and licence, escaping both', () => {
  const line = attributionLine({ author: 'NASA & friends', license: 'CC BY-SA 4.0' })
  assert.match(line, /NASA &amp; friends/)
  assert.match(line, /CC BY-SA 4.0/)
})

test('no attribution line is rendered when there is no credit', () => {
  assert.equal(attributionLine(null), '')
  assert.equal(attributionLine({ author: null, license: null }), '')
})

// --- infobox links ----------------------------------------------------------

test('infobox wikilinks are extracted from the lede infobox, not the body prose', () => {
  const html =
    '<table class="infobox vevent"><tbody>' +
    '<tr><th>Landing site</th><td><a href="/wiki/Sea_of_Tranquility" title="Sea of Tranquility">Mare Tranquillitatis</a></td></tr>' +
    '<tr><th>Launch site</th><td><a href="/wiki/Kennedy_Space_Center_Launch_Complex_39A" title="x">LC-39A</a></td></tr>' +
    '</tbody></table>' +
    '<p>Prose linking the <a href="/wiki/Moon" title="Moon">Moon</a>.</p>'
  assert.deepEqual(infoboxLinks(html).sort(), [
    'Kennedy Space Center Launch Complex 39A',
    'Sea of Tranquility',
  ])
})

test('infobox extraction skips non-article namespaces and de-dupes', () => {
  const html =
    '<table class="infobox"><tr><td>' +
    '<a href="/wiki/File:Apollo.jpg" title="File:Apollo.jpg">img</a>' +
    '<a href="/wiki/Neil_Armstrong" title="Neil Armstrong">Armstrong</a>' +
    '<a href="/wiki/Neil_Armstrong" title="Neil Armstrong">Armstrong</a>' +
    '</td></tr></table>'
  assert.deepEqual(infoboxLinks(html), ['Neil Armstrong'])
})

test('infobox extraction spans a nested table rather than stopping at the first close', () => {
  // Crew infoboxes often nest a table; a non-greedy match would drop links after it.
  const html =
    '<table class="infobox"><tr><td>' +
    '<table><tr><td><a href="/wiki/Buzz_Aldrin" title="Buzz Aldrin">Aldrin</a></td></tr></table>' +
    '<a href="/wiki/Sea_of_Tranquility" title="Sea of Tranquility">landing</a>' +
    '</td></tr></table>'
  const links = infoboxLinks(html)
  assert.ok(links.includes('Buzz Aldrin'))
  assert.ok(links.includes('Sea of Tranquility'), 'link after the nested table is still found')
})

test('infobox extraction returns nothing when there is no infobox', () => {
  assert.deepEqual(infoboxLinks('<p>No infobox <a href="/wiki/Moon">here</a>.</p>'), [])
})

// --- emit -------------------------------------------------------------------

test('card text is escaped so titles cannot inject markup', () => {
  assert.equal(escapeHtml('<script>"x"&</script>'), '&lt;script&gt;&quot;x&quot;&amp;&lt;/script&gt;')
})

test('a media node emits a v7 webpage item carrying its source and webpageType', () => {
  const doc = buildTapestry({
    title: 'T',
    description: 'D',
    laidOut: {
      groups: [],
      bands: [],
      items: [{
        kind: 'media',
        id: 'media-ia-footage',
        groupId: 'group-s1',
        entry: { id: 'ia-footage' },
        media: { type: 'webpage', source: 'https://archive.org/details/x', webpageType: 'iaVideo' },
        position: { x: 980, y: 0 },
        size: { width: 1000, height: 563 },
      }],
    },
    items: new Map([['ia-footage', { id: 'ia-footage', source: 'internet_archive', title: 'Footage' }]]),
    placementInfo: new Map([['ia-footage', { tier: 2, via: 'wiki-moon-landing' }]]),
    generatedAt: '2026-07-23T00:00:00.000Z',
  })
  const item = doc.items.find((i) => i.id === 'media-ia-footage')
  assert.equal(item.type, 'webpage')
  assert.equal(item.source, 'https://archive.org/details/x')
  assert.equal(item.webpageType, 'iaVideo')
  assert.match(item.notes, /connection/, 'a media item still says why it landed here')
})

test('a citation node emits a minor text card with title, publisher, and its link in notes', () => {
  const doc = buildTapestry({
    title: 'T', description: 'D',
    laidOut: {
      groups: [], bands: [],
      items: [{
        kind: 'citation', id: 'cite-c1', groupId: 'g',
        citation: { id: 'c1', kind: 'web', title: 'JFK Speech', publisher: 'NASA', href: 'https://web.archive.org/x' },
        position: { x: -520, y: 0 }, size: { width: 320, height: 150 },
      }],
    },
    items: new Map(), placementInfo: new Map(), generatedAt: '2026-07-23T00:00:00.000Z',
  })
  const it = doc.items.find((i) => i.id === 'cite-c1')
  assert.equal(it.type, 'text')
  assert.match(it.text, /JFK Speech/)
  assert.match(it.text, /NASA/)
  assert.equal(it.notes, 'https://web.archive.org/x')
})

test('a citation-cover node emits an image item pointing at the cover', () => {
  const doc = buildTapestry({
    title: 'T', description: 'D',
    laidOut: {
      groups: [], bands: [],
      items: [{
        kind: 'citation-cover', id: 'cite-cover-c2', groupId: 'g',
        citation: { id: 'c2', cover: 'https://cov.test/x.jpg', href: 'https://x.test' },
        position: { x: -520, y: 0 }, size: { width: 320, height: 400 },
      }],
    },
    items: new Map(), placementInfo: new Map(), generatedAt: '2026-07-23T00:00:00.000Z',
  })
  const it = doc.items.find((i) => i.id === 'cite-cover-c2')
  assert.equal(it.type, 'image')
  assert.equal(it.source, 'https://cov.test/x.jpg')
})

test('every placement carries a human-readable reason', () => {
  assert.match(placementNote({ tier: 1, via: 'Q9696' }), /wikilink/)
  assert.match(placementNote({ tier: 2, via: 'wiki-jfk' }), /connection/)
  assert.equal(placementNote(undefined), 'unplaced')
})

// --- pictures ---------------------------------------------------------------

test('a portrait image gets a taller box than a landscape one', () => {
  const portrait = imageHeight(600, 1.4)
  const landscape = imageHeight(600, 0.66)
  assert.ok(portrait > landscape)
})

test('an extreme aspect ratio is capped so one picture cannot swallow a band', () => {
  assert.ok(imageHeight(600, 8) < 600 * 2, 'a very tall image must be clamped')
})

test('a commons file title is recovered from a thumbnail url', () => {
  const url =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/200px-Aldrin.jpg'
  // Spaces, not underscores: the API normalises titles this way, and keying on
  // the raw URL form makes every dimension lookup silently miss.
  assert.equal(commonsFileTitle(url), 'File:Aldrin Apollo 11 original.jpg')
  assert.equal(commonsFileTitle('https://archive.org/services/img/apollo11'), null)
})

test('an entry with a thumbnail emits a picture above its caption', () => {
  const out = layoutBands([
    {
      id: 'b', title: 'B', text: 't', html: '<p>t</p>',
      entries: [{ id: 'x', title: 'X', description: 'd', thumbnail: 'https://example.org/x.jpg' }],
    },
  ])
  const picture = out.items.find((i) => i.kind === 'image')
  const caption = out.items.find((i) => i.kind === 'entry')
  assert.ok(picture, 'expected an image node')
  assert.equal(picture.position.x, caption.position.x, 'picture and caption share a column')
  assert.ok(picture.position.y < caption.position.y, 'picture sits above its caption')
  assert.ok(
    picture.position.y + picture.size.height <= caption.position.y,
    'picture and caption must not overlap',
  )
})

test('an entry with resolved media emits a media node above its caption', () => {
  const out = layoutBands([
    {
      id: 'b', title: 'B', text: 't', html: '<p>t</p>',
      entries: [{
        id: 'x', title: 'X', description: 'd',
        media: { type: 'webpage', source: 'https://archive.org/details/x', webpageType: 'iaVideo' },
      }],
    },
  ])
  const media = out.items.find((i) => i.kind === 'media')
  const caption = out.items.find((i) => i.kind === 'entry')
  assert.ok(media, 'expected a media node')
  assert.equal(media.media.webpageType, 'iaVideo', 'carries the media descriptor through to emit')
  assert.equal(media.position.x, caption.position.x, 'media and caption share a column')
  assert.ok(media.position.y < caption.position.y, 'media sits above its caption')
  assert.ok(
    media.position.y + media.size.height <= caption.position.y,
    'media and caption must not overlap',
  )
})

test('a playable video reserves a landscape box; audio a short wide bar', () => {
  const video = mediaAspect({ type: 'webpage', webpageType: 'iaVideo' })
  const audio = mediaAspect({ type: 'webpage', webpageType: 'iaAudio' })
  assert.ok(video < 1, 'video is landscape (height < width)')
  assert.ok(audio < video, 'audio is shorter than video')
})

test('an entry without a thumbnail emits no picture', () => {
  const out = layoutBands([
    { id: 'b', title: 'B', text: 't', html: '<p>t</p>', entries: [{ id: 'x', title: 'X', description: 'd' }] },
  ])
  assert.equal(out.items.filter((i) => i.kind === 'image').length, 0)
})

// --- citations (left gutter) ------------------------------------------------

test('a band’s citations stack in the citations lane, left of the spine', () => {
  const out = layoutBands([
    {
      id: 'b', title: 'B', text: 't', html: '<p>t</p>',
      entries: [{ id: 'x', title: 'X', description: 'd' }],
      citations: [
        { id: 'c1', kind: 'web', title: 'Src', publisher: 'NASA' },
        { id: 'c2', kind: 'news', title: 'Two', publisher: 'Rice' },
      ],
    },
  ])
  const cites = out.items.filter((i) => i.kind === 'citation')
  assert.equal(cites.length, 2)
  for (const c of cites) assert.equal(c.position.x, LANES.citations.x, 'sits in the citations lane')
  assert.ok(cites[0].position.x + cites[0].size.width <= LANES.spine.x, 'left of the spine')
  assert.ok(cites[1].position.y >= cites[0].position.y + cites[0].size.height, 'stacked, not overlapping')
})

test('a book citation with a cover emits a cover image above its card', () => {
  const out = layoutBands([
    {
      id: 'b', title: 'B', text: 't', html: '<p>t</p>',
      entries: [{ id: 'x', title: 'X', description: 'd' }],
      citations: [{ id: 'c2', kind: 'book', title: 'Bk', publisher: 'Pub', cover: 'https://cov.test/x.jpg' }],
    },
  ])
  const cover = out.items.find((i) => i.kind === 'citation-cover')
  const card = out.items.find((i) => i.kind === 'citation')
  assert.ok(cover, 'expected a cover image node')
  assert.equal(cover.position.x, LANES.citations.x)
  assert.ok(cover.position.y < card.position.y, 'cover sits above its card')
})

test('a band with no citations adds nothing to the citations lane', () => {
  const out = layoutBands([
    { id: 'b', title: 'B', text: 't', html: '<p>t</p>', entries: [{ id: 'x', title: 'X', description: 'd' }] },
  ])
  assert.equal(out.items.filter((i) => i.kind === 'citation' || i.kind === 'citation-cover').length, 0)
})

test('citation card height grows with a longer title', () => {
  const short = citationCardHeight('Short', 'NASA', WIDTHS.minor)
  const long = citationCardHeight('A very long citation title '.repeat(4), 'NASA', WIDTHS.minor)
  assert.ok(long > short)
})

// --- opening view -----------------------------------------------------------

test('the opening view frames drawn content, not the empty lane grid', () => {
  // The citations lane holds nothing until phase 3. Framing it wasted 600px —
  // a fifth of the opening view — on blank canvas.
  const out = layoutBands([
    {
      id: 'first', title: 'F', text: 't', html: '<p>t</p>',
      entries: [{ id: 'a', title: 'A', description: 'd' }],
    },
  ])
  const view = startView(out.bands)
  // The overview title lives far off to the left and is deliberately not framed.
  const drawn = out.items.filter((i) => i.kind !== 'overview')
  const left = Math.min(...drawn.map((i) => i.position.x))
  const right = Math.max(...drawn.map((i) => i.position.x + i.size.width))

  assert.ok(view.position.x > LANES.citations.x, 'must not frame the empty citations lane')
  assert.ok(left - view.position.x <= 80, 'no more than padding to the left of content')
  assert.ok(view.size.width >= right - left, 'content fits horizontally')
})

test('the opening view is never widened, only heightened, to reach its aspect', () => {
  // Widening scales the prose down; adding height does not.
  const out = layoutBands([
    { id: 'first', title: 'F', text: 't', html: '<p>t</p>', entries: [{ id: 'a', title: 'A', description: 'd' }] },
  ])
  const view = startView(out.bands)
  const right = Math.max(...out.items.map((i) => i.position.x + i.size.width))
  assert.ok(view.size.width <= right + 160, 'width hugs content')
  assert.ok(view.size.height >= view.size.width * 0.6, 'height reaches a landscape aspect')
})

test('prose stays legible when the opening view is fitted to a laptop', () => {
  const out = layoutBands([
    { id: 'first', title: 'F', text: 't', html: '<p>t</p>', entries: [{ id: 'a', title: 'A', description: 'd' }] },
  ])
  const view = startView(out.bands)
  const scale = Math.min(1400 / view.size.width, 868 / view.size.height)
  assert.ok(PROSE.body * scale >= 15, `body text renders at ${(PROSE.body * scale).toFixed(1)}px`)
})

// --- overview layer & empty sections ----------------------------------------

test('each band gets an overview title far to the left, outside every group', () => {
  const out = layoutBands([
    { id: 'a', title: 'Background', text: 't', html: '<p>t</p>', entries: [{ id: 'x', title: 'X', description: 'd' }] },
    { id: 'b', title: 'Mission', text: 't', html: '<p>t</p>', entries: [{ id: 'y', title: 'Y', description: 'd' }] },
  ])
  const overviews = out.items.filter((i) => i.kind === 'overview')
  assert.equal(overviews.length, 2)
  for (const o of overviews) {
    assert.equal(o.position.x, LANES.overview.x, 'sits in the overview lane')
    assert.equal(o.groupId, null, 'outside every group, so presentation steps ignore it')
  }
})

test('an overview title aligns with the top of its band', () => {
  const out = layoutBands([
    { id: 'a', title: 'A', text: 't', html: '<p>t</p>', entries: [{ id: 'x', title: 'X', description: 'd' }] },
    { id: 'b', title: 'B', text: 't', html: '<p>t</p>', entries: [{ id: 'y', title: 'Y', description: 'd' }] },
  ])
  for (const band of out.bands) {
    const overview = out.items.find((i) => i.id === `overview-${band.id}`)
    assert.equal(overview.position.y, band.y)
  }
})

// --- footer provenance -------------------------------------------------------

// The page opens by claiming it used no curated dataset. A footer that names one
// contradicts the page's own argument, so provenance is the caller's to state.

test('the footer states the provenance its caller gives it', () => {
  const html = buildHtml({
    title: 'T',
    description: 'd',
    bands: [],
    provenance: 'Generated from <code>somewhere/else/</code>.',
  })
  assert.match(html, /Generated from <code>somewhere\/else\/<\/code>\./)
  assert.doesNotMatch(html, /web-demo\/data\/apollo-11/)
})

test('a page with no stated provenance claims none', () => {
  const html = buildHtml({ title: 'T', description: 'd', bands: [] })
  assert.doesNotMatch(html, /Generated from/)
  assert.match(html, /CC BY-SA 4\.0/, 'the licence line survives — it is true of every page')
})

// --- the legend describes this page, not the project ------------------------

// Same rule as the corroborated key: a legend entry for something the page does
// not contain is noise, and it implies a reach the page did not have. It also
// happens to be where the broken icons were — sources this page never used.

test('the legend names only the sources the page actually shows', () => {
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      entries: [{ id: 'x', title: 'X', source: 'internet_archive' }],
    },
  ]
  const html = buildHtml({ title: 'T', description: 'd', bands })
  assert.match(html, /Internet Archive/)
  assert.doesNotMatch(html, /GBIF/, 'nothing on this page came from GBIF')
  assert.doesNotMatch(html, /iNaturalist/)
  assert.doesNotMatch(html, /Free Law Project/)
})

test('a source with no fetchable icon still gets a legend entry, without a broken image', () => {
  // CourtListener returns 403 to anyone hotlinking its favicon. A named entry
  // with no picture beats an entry with a picture that will not load.
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      entries: [{ id: 'x', title: 'X', source: 'free_law' }],
    },
  ]
  const html = buildHtml({ title: 'T', description: 'd', bands, inline: new Map() })
  assert.match(html, /Free Law Project/)
  assert.doesNotMatch(html, /courtlistener\.com\/favicon/, 'no live hotlink that 403s')
})

test('a source reached only through citation links still makes the legend', () => {
  // Citations carry no source slug — they are links. Apollo 11 points at
  // OpenLibrary twenty times and would otherwise vanish from its own legend.
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      citations: [{ title: 'Book', kind: 'book', href: 'https://openlibrary.org/books/OL1M' }],
    },
  ]
  assert.deepEqual(sourcesUsed(bands), ['openlibrary'])
})
