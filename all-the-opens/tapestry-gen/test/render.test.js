import { test } from 'node:test'
import assert from 'node:assert/strict'

import { commonsFileTitle, firstSentences, imageCredit, infoboxLinks } from '../src/wikipedia.js'
import { escapeHtml } from '../src/html.js'
import { buildHtml, evidenceKey, sourcesUsed, zoomLink } from '../src/emit-html.js'
import { frontPage, GROUP_ORDER, groupedShowcase, holderShowcaseTitles, showcaseTitles, ungroupedShowcaseTitles } from '../src/front-page.js'
import { bootWarmTitles } from '../src/warming.js'

// What the shipped renderer and its article extraction promise. The curated
// generator's own tests — placement, Tapestry geometry, zip — retired with it
// on 2026-08-04 to attic/all-the-opens/tapestry-gen-curated/.

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

test('a commons file title is recovered from a thumbnail url', () => {
  const url =
    'https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/200px-Aldrin.jpg'
  // Spaces, not underscores: the API normalizes titles this way, and keying on
  // the raw URL form makes every dimension lookup silently miss.
  assert.equal(commonsFileTitle(url), 'File:Aldrin Apollo 11 original.jpg')
  assert.equal(commonsFileTitle('https://archive.org/services/img/apollo11'), null)
})

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
  assert.match(html, /CC BY-SA 4\.0/, 'the license line survives — it is true of every page')
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

test('a source reached only through footnote links still makes the legend', () => {
  // Footnotes carry no source slug — they are links. Apollo 11's references
  // borrow through the Archive and Open Library twenty times, and both would
  // otherwise vanish from the page's own legend.
  const bands = [
    {
      id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }],
      footnotes: [
        {
          id: 'a-note-1',
          num: '1',
          html: 'A book. <a class="ext" href="https://openlibrary.org/books/OL1M">OL1M</a>.',
          access: { url: 'https://archive.org/details/x', label: 'Borrow' },
        },
      ],
    },
  ]
  // Only the borrow link we added counts. The article's OWN link to
  // openlibrary.org is the article citing a catalog, not Open Library
  // helping — and crediting it would also make every partner the article
  // already links look like a contributor in the visibility panel.
  assert.deepEqual(sourcesUsed(bands), ['internet_archive'])
  const withCatalog = [
    { ...bands[0], footnotes: [{ ...bands[0].footnotes[0],
      access: { url: 'https://openlibrary.org/books/OL1M', label: 'Cataloged · Open Library' } }] },
  ]
  assert.deepEqual(sourcesUsed(withCatalog), ['openlibrary'])
})

test('the warmer and the front page read the same showcase list', () => {
  // The boot walk covers exactly the pages the front page's cards promise
  // are ready — this test pins the showcase half, its Art-group twin below
  // pins the other. A second, hand-kept copy of the titles would drift the
  // first time one changed, and the symptom would be a slow demo link
  // rather than an error.
  const html = frontPage({})
  for (const title of showcaseTitles()) {
    const href = `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    assert.ok(html.includes(`href="${href}"`), `front page links ${title}`)
    assert.ok(bootWarmTitles().includes(title), `${title} rides the boot warm walk`)
  }
  assert.equal(showcaseTitles().length, (html.match(/<a class="show"/g) ?? []).length)
})

test('every logo on a showcase card names a friend this page lists', () => {
  // The "other friends" rows are hand-written (see SHOWCASE) and nothing here
  // can check that a partner really answers for that article. What this does
  // check is the failure a rename would cause: a slug with no friend behind it
  // renders a blank square with no background rule and no accessible name, and
  // it would ship looking like a broken image rather than like an error.
  const html = frontPage({})
  const listed = new Set(
    [...html.matchAll(/<p class="who"><span class="fav fav-([a-z_]+)"/g)].map((m) => m[1]),
  )
  const onCards = new Set(
    [...html.matchAll(/<span class="fav fav-([a-z_]+)" title=/g)].map((m) => m[1]),
  )
  assert.ok(onCards.size > 0, 'the showcase cards carry logos')
  for (const slug of onCards) assert.ok(listed.has(slug), `${slug} is one of the friends listed`)
})

// ---- the plate: what stands in for a picture that does not exist -----------
//
// 229 of 435 DPLA cards on the six showcase pages have no thumbnail, and on
// Brown v. Board the imageless card was the HERO. A caption under nothing reads
// as a broken image; these assertions pin the difference.

const oneCard = (entry, inline = new Map()) =>
  buildHtml({
    title: 'T', description: 'd', inline,
    bands: [{ id: 'a', title: 'A', blocks: [{ type: 'p', html: '<p>t</p>' }], entries: [entry] }],
  })

test('a card with no image renders a plate rather than a caption under nothing', () => {
  const html = oneCard({ id: 'x', title: 'X', source: 'dpla' })
  assert.match(html, /class="plate bare"/)
})

test('an entry that supplies a label gets it set as the plate’s mark', () => {
  const html = oneCard({ id: 'x', title: 'Opinion', source: 'free_law', plate: '347 U.S. 483' })
  assert.match(html, /<span class="plate-mark">347 U\.S\. 483<\/span>/)
  assert.doesNotMatch(html, /class="plate bare"/)
})

test('the plate opens the same door the title does', () => {
  const html = oneCard({
    id: 'x', title: 'Opinion', source: 'free_law', plate: '347 U.S. 483',
    href: 'https://www.courtlistener.com/c/U.S./347/483/',
  })
  assert.match(html, /<a href="https:\/\/www\.courtlistener\.com\/c\/U\.S\.\/347\/483\/"[^>]*><div class="plate"/)
})

test('a plate label is escaped, never injected', () => {
  const html = oneCard({ id: 'x', title: 'X', source: 'dpla', plate: '<script>alert(1)</script>' })
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/)
  assert.match(html, /&lt;script&gt;/)
})

test('a card WITH an image is untouched — no plate competes with the picture', () => {
  // The image must be OURS to serve (inline bytes or an /img/ path): under
  // the never-hotlink rule a bare partner URL no longer counts as having one.
  const html = oneCard(
    { id: 'x', title: 'X', source: 'dpla', imageUrl: 'https://example.com/a.jpg' },
    new Map([['https://example.com/a.jpg', 'data:image/jpeg;base64,AAAA']]),
  )
  assert.doesNotMatch(html, /class="plate/)
  assert.match(html, /<img class="shot" src="data:image\/jpeg;base64,AAAA"/)
})

test('a partner image our fetch could not deliver renders as a text card, never a hotlink', () => {
  // The never-hotlink-a-partner rule (2026-08-17) has no failure exemption:
  // when the inline map holds no bytes for an unsafe image, the raw partner
  // URL must not reach the page — the reader's browser would otherwise be
  // aimed at exactly the host that refused ours.
  const html = oneCard({ id: 'x', title: 'X', source: 'dpla', imageUrl: 'https://example.com/a.jpg' })
  assert.doesNotMatch(html, /example\.com\/a\.jpg/)
  assert.doesNotMatch(html, /<img class="shot"/)
})

test('a Wikimedia image still hotlinks — the one exempt host', () => {
  const html = oneCard({ id: 'x', title: 'X', source: 'wikipedia', imageUrl: 'https://upload.wikimedia.org/wikipedia/commons/a/b.jpg' })
  assert.match(html, /<img class="shot" src="https:\/\/upload\.wikimedia\.org\/wikipedia\/commons\/a\/b\.jpg"/)
})

test('a bare plate is decorative — hidden from assistive tech, and never a link', () => {
  // An anchor wrapping an aria-hidden panel is a link with no accessible name.
  // The title beneath already opens the same door.
  const html = oneCard({ id: 'x', title: 'X', source: 'dpla', href: 'https://dp.la/item/abc' })
  assert.match(html, /<div class="plate bare" aria-hidden="true"><\/div>/)
  assert.doesNotMatch(html, /<a href="https:\/\/dp\.la\/item\/abc"[^>]*><div class="plate bare"/)
})

test('the dashed-card key names the fields THIS page matched on', () => {
  const taxon = {
    entries: [
      {
        evidence: 'corroborated',
        corroboratedBy: [{ field: 'scientific name', holding: 'Pongo pygmaeus', claimed: 'Pongo pygmaeus' }],
      },
    ],
  }
  const thesis = {
    entries: [
      {
        evidence: 'corroborated',
        corroboratedBy: [
          { field: 'creator', holding: 'Prandtl', claimed: 'Ludwig Prandtl' },
          { field: 'year', holding: '1899', claimed: '1899' },
          { field: 'institution', holding: 'LMU', claimed: 'LMU München' },
        ],
      },
    ],
  }
  // The bug this replaces: a hardcoded key told an orangutan page its dashed
  // cards were matched on an author, a date and an institution.
  const one = evidenceKey([taxon])
  assert.match(one, /what both of them state: the scientific name\./)
  assert.doesNotMatch(one, /author|institution/)
  assert.match(evidenceKey([thesis]), /the creator, the year and the institution\./)
  // A page with no corroborated card explains no style it does not use.
  assert.equal(evidenceKey([{ entries: [{ title: 'An ordinary card' }] }]), '')
  assert.equal(evidenceKey([]), '')
})

// --- zoom link for holder pages ----------------------------------------------

test('zoomLink emits a link for a holder-work entry with an href', () => {
  const entry = { standing: 'holder-work', href: 'https://rijksmuseum.nl/object' }
  const result = zoomLink(entry, 'Rijksmuseum')
  assert.match(result, /<a class="zoom"/)
  assert.match(result, /href="https:\/\/rijksmuseum\.nl\/object"/)
  assert.match(result, /High resolution at Rijksmuseum/)
})

test('zoomLink returns empty string for non-holder-work standing', () => {
  const entry = { standing: 'subject-document', href: 'https://example.com' }
  assert.equal(zoomLink(entry, 'Museum'), '')
})

test('zoomLink returns empty string when entry has no href', () => {
  const entry = { standing: 'holder-work' }
  assert.equal(zoomLink(entry, 'Museum'), '')
})

test('zoomLink escapes the institution name in output', () => {
  const entry = { standing: 'holder-work', href: 'https://example.com' }
  const result = zoomLink(entry, '<script>alert(1)</script>')
  assert.doesNotMatch(result, /<script>/)
  assert.match(result, /&lt;script&gt;/)
})

test('zoomLink escapes the href in output', () => {
  const entry = { standing: 'holder-work', href: 'https://example.com?x="y"' }
  const result = zoomLink(entry, 'Museum')
  assert.match(result, /href="https:\/\/example\.com\?x=&quot;y&quot;"/)
})

// Holder-page pins. The fixture is the REAL shape discover() resolves —
// `partner`, not `source` — and deliberately a manifest-held work whose
// provider name differs from the PARTNERS display name ("IIIF collections"),
// because Rijksmuseum's two names coincide and cannot detect an override
// that silently stopped firing.
const SMK_HOLDER = {
  medium: 'painting',
  partner: 'iiif',
  property: 'P6108',
  id: 'https://api.example.org/iiif/manifest/1',
  subjectQid: 'Q999',
  record: {
    partner: 'iiif',
    id: 'https://api.example.org/iiif/manifest/1',
    title: 'A Painting',
    creator: null,
    date: '1888',
    medium: null,
    dimensions: null,
    accession: null,
    credit: null,
    rights: {
      publicDomain: true,
      label: 'public domain',
      uri: 'https://creativecommons.org/publicdomain/mark/1.0/',
    },
    imageUrl: 'https://example.org/iiif/full/800,/0/default.jpg',
    href: 'https://collection.example.org/object/1',
    institution: 'Statens Museum for Kunst',
    requiredStatement: 'Photo: SMK Open',
    _providers: 1,
  },
}

const holderWorkEntry = () => ({
  source: 'iiif',
  title: 'A Painting',
  description: '1888',
  imageUrl: 'https://example.org/iiif/full/800,/0/default.jpg',
  href: 'https://collection.example.org/object/1',
  standing: 'holder-work',
  attribution: { author: 'Statens Museum for Kunst · public domain', license: null },
  rights: { copy: null },
  why: 'Statens Museum for Kunst’s own record of this painting — Wikidata names it directly.',
  trace: 'Wikidata records this painting’s IIIF manifest URL (P6108).',
  fix: { url: 'https://www.wikidata.org/wiki/Q999#P6108', label: 'Check or fix it on Wikidata' },
})

// The lede band carries the holder itself, as discover attaches it — the
// renderers read per-band furniture (zoom, requiredStatement, source bar)
// from `band.holder`, never from the page-level option.
const holderBands = () => [
  {
    index: '0',
    id: 'slede',
    title: 'Lede',
    blocks: [{ kind: 'text', text: 'A short stub about a painting.' }],
    entries: [holderWorkEntry()],
    holder: SMK_HOLDER,
  },
]

test('holder page masthead shows the two-party credit line, not the default', () => {
  const result = buildHtml({ title: 'Test', bands: holderBands(), holder: SMK_HOLDER })
  assert.match(result, /This page: Wikipedia \+ Statens Museum for Kunst/)
  assert.doesNotMatch(result, /Today, help came from:/)
})

test('legend chip, hero source bar and gap-panel row all name the provider, never the PARTNERS literal', () => {
  // A minimal reach so the visibility panel renders its partner rows.
  const reach = { hosts: new Set(), kartographer: false, identifierBar: false }
  const result = buildHtml({ title: 'Test', bands: holderBands(), holder: SMK_HOLDER, reach })
  const legend = result.match(/<div class="legend">([\s\S]*?)<\/div>/)[1]
  assert.match(legend, /Statens Museum for Kunst/)
  assert.doesNotMatch(legend, /IIIF collections/)
  const srcBar = result.match(/<div class="hero-src">([\s\S]*?)<\/div>/)[1]
  assert.match(srcBar, /Statens Museum for Kunst/)
  assert.doesNotMatch(srcBar, /IIIF collections/)
  const panelRow = result.match(/<th scope="row" class="gap-who">([\s\S]*?)<\/th>/)[1]
  assert.match(panelRow, /Statens Museum for Kunst/)
  assert.doesNotMatch(panelRow, /IIIF collections/)
})

test('the hero card carries the zoom link with the provider name and the record href', () => {
  const result = buildHtml({ title: 'Test', bands: holderBands(), holder: SMK_HOLDER })
  assert.match(
    result,
    /<a class="zoom" href="https:\/\/collection\.example\.org\/object\/1" target="_blank" rel="noopener">High resolution at Statens Museum for Kunst →<\/a>/,
  )
})

test('a sculpture page keeps the plain door — no flowery medium copy', () => {
  const holder = { ...SMK_HOLDER, medium: 'sculpture' }
  const bands = holderBands()
  bands[0].holder = holder
  const result = buildHtml({ title: 'Test', bands, holder })
  assert.match(result, /High resolution at Statens Museum for Kunst →/)
  assert.doesNotMatch(result, /brushwork/)
})

test('the more-pages door is read from holder.medium and the record count, never the record’s material string', () => {
  // The genuine case: the WORK_CLASSES medium word plus a stated count.
  const holder = {
    ...SMK_HOLDER,
    medium: 'manuscript',
    record: { ...SMK_HOLDER.record, medium: 'Tempera and gold on parchment', imageCount: 84 },
  }
  const bands = holderBands()
  bands[0].holder = holder
  const result = buildHtml({ title: 'Test', bands, holder })
  assert.match(result, /High resolution and more pages at Statens Museum for Kunst →/)
  // The decoy: a painting whose free-text material mentions a manuscript
  // must not fire the clause — holder.record.medium is a different fact.
  const decoy = {
    ...SMK_HOLDER,
    medium: 'painting',
    record: { ...SMK_HOLDER.record, medium: 'illuminated manuscript on vellum', imageCount: 84 },
  }
  const decoyBands = holderBands()
  decoyBands[0].holder = decoy
  assert.doesNotMatch(buildHtml({ title: 'Test', bands: decoyBands, holder: decoy }), /more pages/)
})

test('the IIIF requiredStatement renders in its own element, only when the record carries one', () => {
  const withStatement = buildHtml({ title: 'Test', bands: holderBands(), holder: SMK_HOLDER })
  assert.match(withStatement, /<p class="req-statement">Photo: SMK Open<\/p>/)
  const bare = {
    ...SMK_HOLDER,
    record: { ...SMK_HOLDER.record, requiredStatement: null },
  }
  const bands = holderBands()
  bands[0].holder = bare
  const without = buildHtml({ title: 'Test', bands, holder: bare })
  assert.doesNotMatch(without, /<p class="req-statement">/)
})

// The property both renderers must agree on: only the holder's own band
// carries the holder's furniture. A second band holding a DIFFERENT
// institution's manifest must keep its PARTNERS name, gain no zoom link and
// no requiredStatement — in the batch render AND the streamed fragment.
test('another institution’s card on a holder page keeps its own name, in both renderers', async () => {
  const { bandRail } = await import('../src/emit-html.js')
  const otherBand = {
    index: '3',
    id: 's3',
    title: 'Reception',
    blocks: [
      {
        kind: 'text',
        text: 'Prose long enough that a hero would ordinarily be allowed to float beside it. '.repeat(12),
      },
    ],
    entries: [
      {
        source: 'iiif',
        title: 'Some Other Manifest-Held Work',
        imageUrl: 'https://other.example.org/iiif/full/400,/0/default.jpg',
        href: 'https://other.example.org/object/9',
        standing: null,
      },
    ],
  }
  const batch = buildHtml({ title: 'Test', bands: [...holderBands(), otherBand], holder: SMK_HOLDER })
  const bandTwo = batch.slice(batch.indexOf('id="s3"'))
  assert.match(bandTwo, /IIIF collections/)
  assert.doesNotMatch(bandTwo, /Statens Museum for Kunst/)
  assert.doesNotMatch(bandTwo, /req-statement/)
  assert.doesNotMatch(bandTwo, /class="zoom"/)
  const streamed = bandRail(otherBand)
  assert.match(streamed, /IIIF collections/)
  assert.doesNotMatch(streamed, /Statens Museum for Kunst/)
  assert.doesNotMatch(streamed, /class="zoom"/)
})

// The standing guard against silent re-typesetting: a fixed non-holder render,
// pinned by hash. This is a FORWARD guard only — it pins the output as of the
// commit that set the constant; it does not itself establish any base-vs-HEAD
// invariant. ANY change to what non-holder pages emit — prose, typography,
// CSS — moves this hash and must be a deliberate, reviewed regeneration
// (update the constant in the same commit that changes the output, and say
// why).
test('a non-holder render is byte-stable', async () => {
  const { createHash } = await import('node:crypto')
  const bands = [
    {
      index: '0',
      id: 'slede',
      title: 'Lede',
      blocks: [{ kind: 'text', text: 'Article text about a subject, unremarkable.' }],
      entries: [
        {
          source: 'met',
          title: 'Work',
          href: 'https://example.com',
          imageUrl: 'data:image/png;base64,iVBORw0KGgo=',
        },
      ],
    },
  ]
  const out = buildHtml({ title: 'Fixture', bands })
  const digest = createHash('sha256').update(out).digest('hex')
  // The pinned output includes the stylesheet: the .holder-panel, .infobox-chip, .infobox-conflict and .rail-panel rules are part of it.
  // Re-pinned 2026-08-17: STYLE gained the .sr-conflict rule (the museum-flag
  // disagreement line) — a deliberate stylesheet change riding every page,
  // the same exception shape as the holder panel's rules.
  assert.equal(digest, '3966bdb8b82ee1440793dbd06e8e291a458d5304a14138b9eccec547e33edae4')
})

test('zoomLink adds "and more pages" only for a manuscript whose record states more than one image', () => {
  const entry = { standing: 'holder-work', href: 'https://www.metmuseum.org/art/collection/search/470309' }
  const more = zoomLink(entry, 'The Met', { medium: 'manuscript', imageCount: 210 })
  assert.match(more, /High resolution and more pages at The Met/)
  // one stated image: the promise would outrun the destination
  const single = zoomLink(entry, 'The Met', { medium: 'manuscript', imageCount: 1 })
  assert.match(single, /High resolution at The Met/)
  assert.doesNotMatch(single, /more pages/)
  // unknown count (Getty, Rijksmuseum): the plain phrase, never a guess
  const unknown = zoomLink(entry, 'J. Paul Getty Museum', { medium: 'manuscript', imageCount: null })
  assert.doesNotMatch(unknown, /more pages/)
  // a painting with many detail shots is not "more pages"
  const painting = zoomLink(entry, 'The Met', { medium: 'painting', imageCount: 12 })
  assert.doesNotMatch(painting, /more pages/)
})

test('a holder page carries the work’s copyright in the panel, not the slab — and says it once', () => {
  const bands = holderBands()
  bands[0].holder = SMK_HOLDER
  bands[0].subjectRights = {
    marks: [],
    label: 'public domain',
    line: 'Gerard Horenbout: copyrights on works have expired',
    detail: [],
    paulina: { url: 'https://paulina.toolforge.org/work/Q999', label: 'What this means where you are' },
  }
  const result = buildHtml({ title: 'Test', bands, holder: SMK_HOLDER })
  // The slab is gone — the panel is the one place the claim lives now
  assert.doesNotMatch(result, /class="subject-rights"/)
  assert.equal((result.match(/copyrights on works have expired/g) ?? []).length, 1)
  const panel = result.match(/<table class="infobox holder-panel">[\s\S]*?<\/table>/)[0]
  assert.match(panel, /copyrights on works have expired/)
  assert.match(panel, /<span class="infobox-chip">Wikidata<\/span>/)
  assert.match(panel, /Why, and what it means where you are/)
  assert.match(panel, /paulina\.toolforge\.org/)
})


test('the Art group shows the two-party pages, one friend each — and the boot walk backs their promise', () => {
  const html = frontPage()
  // The ready-now promise is real: every held title is in the same boot
  // walk (and, via the same list, warm.js's default walk) as the showcase.
  for (const title of holderShowcaseTitles()) {
    assert.ok(bootWarmTitles().includes(title), `${title} rides the boot warm walk`)
  }
  for (const title of holderShowcaseTitles()) {
    assert.ok(html.includes(escapeHtml(title)), `front page shows ${title}`)
  }
  assert.equal(holderShowcaseTitles().length, (html.match(/<a class="show held"/g) ?? []).length)
  // The chip retired with its second label; the readiness sentence is the
  // whole claim, covers the whole grid, and counts all nine.
  assert.match(html, /Nine articles are already rendered and cached/)
  // …and the count is always a word: a digit here means COUNT_WORDS ran out.
  assert.doesNotMatch(html, /\d+ articles are already rendered/)
  assert.equal((html.match(/<span class="chip">/g) ?? []).length, 0)
  // Three group rows, reading aids like the friends list's — and the
  // two-party fact is the Art group's own note.
  // Group rows are <p>, never headings: the hero's outline runs h1 straight
  // to the FAQ's h2, and a heading here would sit at no level.
  for (const g of [...GROUP_ORDER, 'Art']) {
    assert.ok(html.includes(`<p class="show-cat">${g}</p>`), `group row: ${g}`)
  }
  assert.doesNotMatch(html, /<h3 class="show-cat">/)
  assert.match(html, /<p class="show-note">Each of these articles is about a work an institution holds/)
  // Every showcase card names a group in GROUP_ORDER — a card outside the
  // list would silently fall out of the grid.
  assert.deepEqual(ungroupedShowcaseTitles(), [])
  // The small-caps line names the institution and its pipe — "Wikipedia +"
  // said nothing, since every page here is Wikipedia plus someone.
  assert.match(html, /Rijksmuseum · Linked Art \+ IIIF/)
  assert.match(html, /The Met · Open Access API/)
  assert.match(html, /J\. Paul Getty Museum · IIIF \+ JSON-LD/)
  assert.doesNotMatch(html, /Wikipedia \+ /)
  assert.match(html, /Natural history · glTF/)
  // The foot row names exactly one friend per held card
  const heldCards = html.match(/<a class="show held"[\s\S]*?<\/a>/g) ?? []
  for (const card of heldCards) {
    assert.equal((card.match(/class="fav fav-/g) ?? []).length, 1, 'one logo per held card')
  }
})

test('a group no card claims renders nothing — heading, note and all', () => {
  // The Art group's absence must take its note with it: a sentence claiming
  // "each of these articles" over zero cards would be the orphan the guard
  // exists to prevent.
  const none = groupedShowcase([], [])
  assert.equal(none, '')
  const artless = groupedShowcase(undefined, [])
  assert.doesNotMatch(artless, /<p class="show-cat">Art<\/p>/)
  assert.doesNotMatch(artless, /show-note/)
  assert.match(artless, /<p class="show-cat">History and the public record<\/p>/)
})
