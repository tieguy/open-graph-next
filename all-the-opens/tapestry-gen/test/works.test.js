import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  authorBrowseUrl,
  authorWorkEntries,
  authorWorksUrl,
  iaMetadataUrl,
  scanIdsToVerify,
  soleAuthor,
} from '../src/works.js'

// The live card that exposed this, verbatim from search.json on 2026-08-06:
// a 1991 scholarly catalogue filed under the painter it is ABOUT, with three
// living co-authors, and no scan for `ebook_access` to object with.
const catalogue = {
  key: '/works/OL18415197W',
  title: 'Rembrandt, the master & his workshop',
  ebook_access: 'no_ebook',
  first_publish_year: 1991,
  cover_i: 5051657,
  author_key: ['OL18362A', 'OL291682A', 'OL1305770A', 'OL681671A'],
}

test('a work the subject merely co-wrote does not inherit their expired copyright', () => {
  const [entry] = authorWorkEntries({ docs: [catalogue] }, { cap: 4, olid: 'OL18362A' }).entries
  assert.equal(entry.access.trustsCreator, false)
  // And nothing is asserted in its place: Open Library said `no_ebook`, which
  // is silence, not a statement about copyright.
  assert.equal(entry.access.copy, null)
})

test('the sole-author test is about WHO, not how many names are listed', () => {
  assert.equal(soleAuthor({ author_key: ['OL18362A'] }, 'OL18362A'), true)
  assert.equal(soleAuthor(catalogue, 'OL18362A'), false)
  // A translator is a co-author for this purpose, and deliberately so: an
  // English Kafka is a new work with its own living rights holder.
  assert.equal(soleAuthor({ author_key: ['OL33146A', 'OL7356871A'] }, 'OL33146A'), false)
  // Missing or empty author data must not be read as "somebody else helped".
  assert.equal(soleAuthor({}, 'OL18362A'), true)
  assert.equal(soleAuthor({ author_key: [] }, 'OL18362A'), true)
})

test('a lent co-authored book still says it is lent — copy describes the object', () => {
  const lent = { ...catalogue, ebook_access: 'borrowable' }
  const [entry] = authorWorkEntries({ docs: [lent] }, { cap: 4, olid: 'OL18362A' }).entries
  assert.equal(entry.access.trustsCreator, false)
  assert.equal(entry.access.copy.code, 'LENT')
})

test('a sole-authored public work still trusts the creator ruling', () => {
  const own = { key: '/works/OL9W', title: 'Drawings', ebook_access: 'public', author_key: ['OL18362A'] }
  const [entry] = authorWorkEntries({ docs: [own] }, { cap: 4, olid: 'OL18362A' }).entries
  assert.equal(entry.access.trustsCreator, true)
})

// The response shape is OpenLibrary's `search.json`, not `/authors/<id>/works.json`
// (changed 2026-08-06). Both see the same corpus; only search.json carries
// `ebook_access`, which is what tells a card that its edition is lent rather
// than free. See the module comment for what else moved with it.
const response = {
  numFound: 10,
  docs: [
    { key: '/works/OL1W', title: 'Abriss der Lehre von der Flüssigkeits- und Gasbewegung', ebook_access: 'public' },
    { key: '/works/OL2W', title: 'Ergebnisse der Aerodynamischen Versuchsanstalt zu Göttingen', cover_i: 9583973, ebook_access: 'public' },
    { key: '/works/OL3W', title: 'Applied Hydro- and Aeromechanics', ebook_access: 'borrowable' },
    { key: '/works/OL4W', title: 'Führer durch die Strömungslehre', cover_i: 8651818, first_publish_year: 1942, ebook_access: 'no_ebook' },
  ],
}

test('the browse link lands on the page that makes the badge’s claim', () => {
  // The badge says "6 of 1,853" and links here, so this page has to report the
  // same 1,853 — the site's own search takes the pivot's own author_key and
  // sort, and answered "1,853 hits" against search.json's numFound of 1853 on
  // 2026-08-10. /authors/<olid> is the tempting URL and the wrong one: it 301s
  // to a slugged path and counts differently.
  const url = authorBrowseUrl('OL33146A')
  assert.match(url, /^https:\/\/openlibrary\.org\/search\?author_key=OL33146A&sort=editions$/)
  assert.doesNotMatch(url, /\/authors\//)
  // Same filter and same order as the request whose total it is explaining.
  const api = authorWorksUrl('OL33146A', 40)
  for (const part of ['author_key=OL33146A', 'sort=editions']) assert.ok(api.includes(part) && url.includes(part))
})

test('the query asks for the access field the rights code depends on', () => {
  const url = authorWorksUrl('OL33146A', 40)
  assert.match(url, /author_key=OL33146A/)
  assert.match(url, /ebook_access/)
  assert.match(url, /limit=40/)
  // An identifier pivot, never a name search: no disambiguation, no guessing
  // between people who share a name.
  assert.doesNotMatch(url, /[?&]q=/)
})

test('a work becomes an entry the renderer can place', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const guide = entries.find((e) => e.title === 'Führer durch die Strömungslehre')
  assert.equal(guide.source, 'openlibrary')
  assert.equal(guide.imageUrl, 'https://covers.openlibrary.org/b/id/8651818-M.jpg')
  assert.match(guide.description, /1942/)
  assert.equal(guide.href, 'https://openlibrary.org/works/OL4W')
})

test('works with a cover come first — a shelf of blank cards is not a shelf', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  assert.deepEqual(
    entries.slice(0, 2).map((e) => Boolean(e.imageUrl)),
    [true, true],
  )
})

test('a coverless work still appears, without a broken image', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const bare = entries.find((e) => e.title === 'Applied Hydro- and Aeromechanics')
  assert.equal(bare.imageUrl, null)
})

test('the cap limits what is shown but the total still counts what is held', () => {
  const { entries, total } = authorWorkEntries(response, { cap: 2 })
  assert.equal(entries.length, 2)
  assert.equal(total, 10)
})

test('the total falls back to the number of docs when the response omits it', () => {
  const { total } = authorWorkEntries({ docs: [{ title: 'A' }, { title: 'B' }] }, { cap: 5 })
  assert.equal(total, 2)
})

test('an author with no works yields nothing rather than an empty shelf', () => {
  assert.deepEqual(authorWorkEntries({ docs: [] }, { cap: 5 }).entries, [])
  assert.deepEqual(authorWorkEntries(undefined, { cap: 5 }).entries, [])
})

test('a work with no title is dropped — an untitled card says nothing', () => {
  const { entries } = authorWorkEntries({ docs: [{ cover_i: 1 }, { title: 'Real' }] }, { cap: 5 })
  assert.deepEqual(
    entries.map((e) => e.title),
    ['Real'],
  )
})

test('every entry declares the claim that found it', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  assert.ok(entries.every((e) => e._via === 'P648'))
})

test('each entry carries the access verdict that decides its rights', () => {
  const { entries } = authorWorkEntries(response, { cap: 10 })
  const lent = entries.find((e) => e.title === 'Applied Hydro- and Aeromechanics')
  assert.equal(lent.access.trustsCreator, false)
  assert.match(lent.access.copy.label, /lent, not free/i)

  const free = entries.find((e) => e.title.startsWith('Ergebnisse'))
  assert.equal(free.access.trustsCreator, true)
  assert.equal(free.access.copy, null)

  // No scan is no evidence — it must not suppress what Copyclear knows.
  const undigitized = entries.find((e) => e.title === 'Führer durch die Strömungslehre')
  assert.equal(undigitized.access.trustsCreator, true)
})

// A scan can be somebody else's book. Verbatim from search.json and
// archive.org/metadata on 2026-08-07: Open Library's edition of von Braun's
// Das Marsprojekt carries the ocaid of an 1874 pamphlet against a railroad
// franchise, so search.json rolls the pamphlet up into the work — `public`,
// `ia: ["reviewshowingwhy00unse"]` — and the card wore the pamphlet's title
// page as its cover with a free-to-read claim resting on it. See
// docs/internet-archive-issues.md #8 for the upstream shape.
const marsprojekt = {
  key: '/works/OL4460018W',
  title: 'Das Marsprojekt',
  ebook_access: 'public',
  first_publish_year: 1952,
  cover_i: 147012,
  ia: ['reviewshowingwhy00unse'],
  author_key: ['OL3027947A', 'OL3331742A'],
}
const railroad = {
  identifier: 'reviewshowingwhy00unse',
  title:
    'A review, showing why the franchise applied for by the Washington city and Point Lookout Railroad Company, as proposed by House bill 274, now pending before the House Committee on the District of Columbia, should not be granted',
  openlibrary_edition: 'OL1869208M',
  openlibrary_work: 'OL4460024W',
}

test('a scan matching neither the title nor the work key is not this book', () => {
  const iaMeta = { reviewshowingwhy00unse: railroad }
  const [entry] = authorWorkEntries({ docs: [marsprojekt] }, { cap: 4, olid: 'OL3027947A', iaMeta }).entries
  // The representative cover, not the pamphlet: with the scan disowned, the
  // card makes no edition-level claim, which is exactly the no-scan posture.
  assert.equal(entry.imageUrl, 'https://covers.openlibrary.org/b/id/147012-M.jpg')
  assert.doesNotMatch(entry.description, /scanned/)
})

test('a disowned scan takes its access verdict with it', () => {
  // Same misattribution, but the pamphlet lends: without the check the card
  // would say "lent, not free" about an edition of somebody else's book.
  const lent = { ...marsprojekt, ebook_access: 'borrowable' }
  const iaMeta = { reviewshowingwhy00unse: railroad }
  const [entry] = authorWorkEntries({ docs: [lent] }, { cap: 4, olid: 'OL3027947A', iaMeta }).entries
  assert.equal(entry.access.copy, null)
})

// The other face of the same coin, verbatim on 2026-08-07: Rizal's Noli Me
// Tangere is scanned as its 1912 English translation, The Social Cancer. The
// scan is genuinely this work — archive.org's own record says so — but the
// cover the reader sees is titled in another language than the card.
const noli = {
  key: '/works/OL1622789W',
  title: 'Noli Me Tangere',
  ebook_access: 'public',
  first_publish_year: 1902,
  cover_i: 5738053,
  ia: ['socialcancer00rizaiala'],
  author_key: ['OL178062A'],
}
const socialCancer = {
  identifier: 'socialcancer00rizaiala',
  title: 'The social cancer;',
  openlibrary_edition: 'OL14042495M',
  openlibrary_work: 'OL1622789W',
}

test('a scan the archive files under this work is kept, on its word not its title', () => {
  const iaMeta = { socialcancer00rizaiala: socialCancer }
  const [entry] = authorWorkEntries({ docs: [noli] }, { cap: 4, olid: 'OL178062A', iaMeta }).entries
  assert.equal(entry.imageUrl, 'https://archive.org/services/img/socialcancer00rizaiala')
})

test('a kept scan wearing another title says so on the card', () => {
  const iaMeta = { socialcancer00rizaiala: socialCancer }
  const [entry] = authorWorkEntries({ docs: [noli] }, { cap: 4, olid: 'OL178062A', iaMeta }).entries
  assert.match(entry.description, /scanned as “The social cancer”/)
})

test('titles that overlap vouch for a scan with no usable backlink', () => {
  // A translation whose subtitle names the original, on an item whose OL
  // backlink points elsewhere — the stale-backlink shape marsproject0000vonb
  // proves exists. Title containment keeps it; the caption still discloses.
  const fili = { ...noli, key: '/works/OL1622748W', title: 'El filibusterismo', ia: ['reignofgreedcomp0000riza'] }
  const iaMeta = {
    reignofgreedcomp0000riza: {
      title: 'The reign of greed; a complete English version of El filibusterismo',
      openlibrary_work: 'OL9999999W',
    },
  }
  const [entry] = authorWorkEntries({ docs: [fili] }, { cap: 4, olid: 'OL178062A', iaMeta }).entries
  assert.equal(entry.imageUrl, 'https://archive.org/services/img/reignofgreedcomp0000riza')
  assert.match(entry.description, /scanned as “The reign of greed”/)
})

test('an unverified scan keeps its cover — unfetched is not disproven', () => {
  const [entry] = authorWorkEntries({ docs: [marsprojekt] }, { cap: 4, olid: 'OL3027947A' }).entries
  assert.equal(entry.imageUrl, 'https://archive.org/services/img/reviewshowingwhy00unse')
  assert.doesNotMatch(entry.description, /scanned/)
})

test('a scan titled like its work needs no caption', () => {
  const iaMeta = { socialcancer00rizaiala: { ...socialCancer, title: 'Noli me tángere' } }
  const [entry] = authorWorkEntries({ docs: [noli] }, { cap: 4, olid: 'OL178062A', iaMeta }).entries
  assert.doesNotMatch(entry.description, /scanned/)
})

test('verification asks only about the scans the shelf will show', () => {
  const docs = [
    { key: '/works/OL1W', title: 'Scanned', ebook_access: 'public', ia: ['scan1'] },
    { key: '/works/OL2W', title: 'Unscanned', ebook_access: 'no_ebook', ia: ['notascan'], cover_i: 7 },
    { key: '/works/OL4W', title: 'Beyond the cap', ebook_access: 'public', ia: ['scan4'] },
  ]
  // `notascan` carries no verdict and `scan4` no card: neither is worth a request.
  assert.deepEqual(scanIdsToVerify({ docs }, { cap: 2 }), ['scan1'])
})

test('the metadata URL asks for the metadata section, not the file list', () => {
  assert.match(iaMetadataUrl('scan1'), /^https:\/\/archive\.org\/metadata\/scan1\/metadata$/)
})

test('a disowned scan with no fallback cover surrenders its place on the shelf', () => {
  const bare = { ...marsprojekt, cover_i: undefined }
  const covered = { key: '/works/OL5W', title: 'Covered', cover_i: 42, ebook_access: 'no_ebook' }
  const iaMeta = { reviewshowingwhy00unse: railroad }
  const { entries } = authorWorkEntries({ docs: [bare, covered] }, { cap: 4, olid: 'OL3027947A', iaMeta })
  assert.deepEqual(
    entries.map((e) => Boolean(e.imageUrl)),
    [true, false],
  )
})

test('MARC residue is not a title — responsibility statements and years fold away', () => {
  // Both shapes came off live cards on 2026-08-07: a caption reading
  // “scanned as ‘Rizal's own story of his life / edited by Austin Craig’”
  // or ‘The indolence of the Filipino   1913’ is noise wearing quotes. With
  // the residue folded, both match their work title and need no caption.
  const story = { ...noli, key: '/works/OL15741883W', title: "Rizal's own story of his life", ia: ['rizalsownstoryof00riza'] }
  const iaMeta = {
    rizalsownstoryof00riza: {
      title: "Rizal's own story of his life / edited by Austin Craig",
      openlibrary_work: 'OL15741883W',
    },
  }
  const [entry] = authorWorkEntries({ docs: [story] }, { cap: 4, olid: 'OL178062A', iaMeta }).entries
  assert.doesNotMatch(entry.description, /scanned/)

  const indolence = { ...noli, key: '/works/OL1622781W', title: 'The indolence of the Filipino', ia: ['indolenceoffilip0000riza_h1s7'] }
  const meta2 = {
    indolenceoffilip0000riza_h1s7: {
      title: 'The indolence of the Filipino \n  1913',
      openlibrary_work: 'OL1622781W',
    },
  }
  const [entry2] = authorWorkEntries({ docs: [indolence] }, { cap: 4, olid: 'OL178062A', iaMeta: meta2 }).entries
  assert.doesNotMatch(entry2.description, /scanned/)
})

test('the query asks for the books the world kept printing', () => {
  const url = authorWorksUrl('OL178062A', 40)
  assert.match(url, /sort=editions/)
  assert.match(url, /edition_count/)
})

// Open Library's answer to "what did Rizal write?" is 186 works for a man
// with a shelf of ten: the same book resurfaces as shard records split by
// spelling, article, or diacritic. Verbatim edition counts from search.json,
// 2026-08-07. Dedup folds the shards; the editions sort was not enough on its
// own because a 12-edition shard of El filibusterismo still outranked every
// genuine minor work.
const shards = {
  docs: [
    { key: '/works/OL1622789W', title: 'Noli Me Tangere', edition_count: 134, cover_i: 5738053, ebook_access: 'public' },
    { key: '/works/OL1622748W', title: 'El filibusterismo', edition_count: 84, cover_i: 1054329, ebook_access: 'public' },
    { key: '/works/OL34393091W', title: 'Filibusterismo', edition_count: 12, ebook_access: 'no_ebook' },
    { key: '/works/OL1622773W', title: 'Filipinas dentro de cien años', edition_count: 7, cover_i: 6050601, ebook_access: 'public' },
    { key: '/works/OL39278020W', title: 'Noli me tángere', edition_count: 4, ebook_access: 'no_ebook' },
  ],
}

test('a shard of a work is the work — articles and diacritics do not multiply a shelf', () => {
  const { entries } = authorWorkEntries(shards, { cap: 10, olid: 'OL178062A' })
  assert.deepEqual(
    entries.map((e) => e.title),
    ['Noli Me Tangere', 'El filibusterismo', 'Filipinas dentro de cien años'],
  )
})

test('the record with the most editions speaks for its shard group, wherever it sits', () => {
  // Defensive against a cached response in the old relevance order: the fold
  // keeps the biggest record, not the first one.
  const reversed = { docs: [...shards.docs].reverse() }
  const { entries } = authorWorkEntries(reversed, { cap: 10, olid: 'OL178062A' })
  const fili = entries.find((e) => /filibusterismo/i.test(e.title))
  assert.equal(fili.href, 'https://openlibrary.org/works/OL1622748W')
})

test('deduplication happens before the cap, not after it', () => {
  // With cap 3 and dupes taking two of three slots, a genuine work would
  // have been squeezed off the shelf.
  const { entries } = authorWorkEntries(shards, { cap: 3, olid: 'OL178062A' })
  assert.ok(entries.some((e) => e.title === 'Filipinas dentro de cien años'))
})

test('dedup asks about one scan per shard group too', () => {
  const docs = [
    { key: '/works/OL1W', title: 'The Book', edition_count: 9, ebook_access: 'public', ia: ['bigscan'] },
    { key: '/works/OL2W', title: 'Book', edition_count: 1, ebook_access: 'public', ia: ['shardscan'] },
  ]
  assert.deepEqual(scanIdsToVerify({ docs }, { cap: 5 }), ['bigscan'])
})

test('a caption is for a different title, not the same title wearing residue', () => {
  // Off a live card 2026-08-07: Kafka's Tagebücher, scanned as "TAGEBUCHER
  // 1910-1923 (GESAMMELTE WERKE Herausgegeben von Max Brod)". The scan IS
  // titled like the work — the caption rule must read through the shouting
  // and the series statement rather than quote them at the reader.
  const diaries = { ...noli, key: '/works/OL10306W', title: 'Tagebücher', ia: ['tagebucher0000kafk'] }
  const iaMeta = {
    tagebucher0000kafk: {
      title: 'TAGEBUCHER 1910-1923 (GESAMMELTE WERKE Herausgegeben von Max Brod)',
      openlibrary_work: 'OL10306W',
    },
  }
  const [entry] = authorWorkEntries({ docs: [diaries] }, { cap: 4, olid: 'OL33146A', iaMeta }).entries
  assert.doesNotMatch(entry.description, /scanned/)
})

test('a translation whose spelling drifts still earns its caption', () => {
  // La Métamorphose is not Metamorphosis-with-residue: neither folded title
  // contains the other, and the caption is how the card says the scan is
  // French.
  const meta = { ...noli, key: '/works/OL45804W', title: 'Metamorphosis', ia: ['lametamorphose0000kafk'] }
  const iaMeta = {
    lametamorphose0000kafk: { title: 'La Métamorphose', openlibrary_work: 'OL45804W' },
  }
  const [entry] = authorWorkEntries({ docs: [meta] }, { cap: 4, olid: 'OL33146A', iaMeta }).entries
  assert.match(entry.description, /scanned as “La Métamorphose”/)
})
