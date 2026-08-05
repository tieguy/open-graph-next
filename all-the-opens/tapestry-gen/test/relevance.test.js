import test from 'node:test'
import assert from 'node:assert/strict'

import { heroRank, pickHero } from '../src/hero.js'
import { BROAD_ABOVE, broadNote, tooBroad } from '../src/breadth.js'
import { claimAnchors, preferRelated, subjectAnchors } from '../src/dedup.js'
import { dplaBrowseUrl } from '../src/dpla.js'
import { europeanaBrowseUrl } from '../src/europeana.js'

// --- which find leads the section -------------------------------------------

const shot = (e) => ({ imageUrl: 'https://example.test/x.jpg', ...e })

test('the subject as a document outranks every picture of it', () => {
  // Brown v. Board: the front page promises the opinion itself, "the primary
  // document before any book about it". A thumbnail must not beat it.
  const opinion = { source: 'free_law', title: 'Opinion of the Court', standing: 'subject-document' }
  const photo = shot({ source: 'dpla', title: 'A photograph', standing: 'subject-record' })
  assert.ok(heroRank(opinion) < heroRank(photo))
  assert.equal(pickHero([photo, opinion]).hero.title, 'Opinion of the Court')
})

test('a partner’s record of the subject outranks a record of something merely linked', () => {
  const own = shot({ source: 'artic', title: 'American Gothic', standing: 'subject-record' })
  const other = shot({ source: 'europeana', title: 'öljymaalaus' })
  assert.ok(heroRank(own) < heroRank(other))
  assert.equal(pickHero([other, own]).hero.title, 'American Gothic')
})

test('an illustrated record outranks a map, which outranks a text-only card', () => {
  const map = { source: 'openstreetmap', title: 'Map: Somewhere', imageUrl: 'https://tile.test/1.png' }
  const pic = shot({ source: 'met', title: 'An object' })
  const text = { source: 'internet_archive', title: 'A scan' }
  assert.ok(heroRank(pic) < heroRank(map))
  assert.ok(heroRank(map) < heroRank(text))
})

test('the subject’s own work ranks below a record OF the subject but above a stranger’s', () => {
  const record = shot({ source: 'artic', title: 'The painting', standing: 'subject-record' })
  const work = shot({ source: 'openlibrary', title: 'A book he wrote', standing: 'subject-work' })
  const stranger = shot({ source: 'dpla', title: 'Something else' })
  assert.ok(heroRank(record) < heroRank(work))
  assert.ok(heroRank(work) < heroRank(stranger))
})

test('the hoisted find leaves the shelf, and article order breaks ties', () => {
  const a = shot({ source: 'met', title: 'First' })
  const b = shot({ source: 'met', title: 'Second' })
  const { hero, rest } = pickHero([a, b])
  assert.equal(hero.title, 'First')
  assert.deepEqual(rest.map((e) => e.title), ['Second'])
})

test('nothing worth leading with means no hero at all, entries untouched', () => {
  // A text-only citation card blown up to a 330px float is the thin box the
  // references fold used to be. Refuse rather than fill the slot badly.
  const text = [{ source: 'internet_archive', title: 'A scan' }]
  const { hero, rest } = pickHero(text)
  assert.equal(hero, null)
  assert.deepEqual(rest, text)
  assert.deepEqual(pickHero([]), { hero: null, rest: [] })
  assert.deepEqual(pickHero(undefined), { hero: null, rest: [] })
})

test('a primary document leads even with nothing to look at', () => {
  const opinion = { source: 'free_law', title: 'Opinion of the Court', standing: 'subject-document' }
  assert.equal(pickHero([opinion]).hero.title, 'Opinion of the Court')
})

test('an Internet Archive embed counts as something to look at', () => {
  const embed = { source: 'internet_archive', title: 'A film', media: { source: 'https://archive.org/details/x' } }
  assert.equal(pickHero([embed]).hero.title, 'A film')
})

// --- anchors too broad to sample --------------------------------------------

test('the denominator separates every showcase shelf worth keeping from every one worth dropping', () => {
  // Measured on prod, 2026-08-05. Kept: Brown v. Board of Education of Topeka
  // (54), monarch butterfly (83), Apollo 11 (126), Art Institute of Chicago
  // (190). Dropped: genetic engineering (465), fluid mechanics (652),
  // molecular biology (831), US Supreme Court (1,409), space flight (3,016),
  // oil painting (6,123).
  for (const n of [54, 83, 126, 190]) assert.equal(tooBroad(n), false, `${n} should be kept`)
  for (const n of [465, 652, 831, 1409, 3016, 6123]) assert.equal(tooBroad(n), true, `${n} should be dropped`)
  // The threshold sits in the gap between the two, and the gap is wide.
  assert.ok(BROAD_ABOVE > 190 && BROAD_ABOVE < 465)
})

test('the subject’s own heading is exempt at any size', () => {
  // A thousand items filed under this article's subject ARE about it; a
  // thousand filed under the category it belongs to are about other things.
  assert.equal(tooBroad(99999, { isSubject: true }), false)
  assert.equal(tooBroad(99999, { isSubject: false }), true)
})

test('a broad note keeps the count as a number, so the page can format it', () => {
  const n = broadNote({ source: 'dpla', label: 'spaceflight', heading: 'Space flight', total: '3016', url: 'https://dp.la/x' })
  assert.equal(n.total, 3016)
  assert.equal(n.heading, 'Space flight')
  assert.equal(broadNote({ source: 'europeana', label: 'oil painting', total: 6123, url: 'x' }).heading, null)
})

test('the browse links carry the query the count came from', () => {
  // Europeana's: the SAME search, reusability and all, so the number a reader
  // checks is the number the page printed.
  const eu = europeanaBrowseUrl('concept/base/222')
  assert.match(eu, /^https:\/\/www\.europeana\.eu\/en\/search\?query=/)
  assert.match(eu, /reusability=open/)
  assert.ok(eu.includes(encodeURIComponent('"http://data.europeana.eu/concept/222"')))
  // The legacy /base/ segment must be stripped or the entity matches nothing.
  assert.doesNotMatch(eu, /base/)
  assert.equal(dplaBrowseUrl('Space flight'), 'https://dp.la/search?subject=%22Space%20flight%22')
})

// --- which links the lede anchors on ----------------------------------------

const claims = (props) => Object.fromEntries(
  Object.entries(props).map(([p, id]) => [p, [{ mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id } } } }]]),
)

test('only entity-valued statements name an anchor', () => {
  const mixed = {
    P170: [{ mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id: 'Q217434' } } } }],
    P571: [{ mainsnak: { datavalue: { type: 'time', value: { time: '+1930-00-00T00:00:00Z' } } } }],
    P4610: [{ mainsnak: { datavalue: { type: 'string', value: '6565' } } }],
    // somevalue/novalue snaks carry no datavalue at all.
    P276: [{ mainsnak: { snaktype: 'somevalue' } }],
  }
  assert.deepEqual([...subjectAnchors(mixed)], [['Q217434', 0]])
  assert.equal(subjectAnchors(undefined).size, 0)
  assert.equal(subjectAnchors({}).size, 0)
})

test('a property that names a particular thing outranks one that names a category', () => {
  // The real claims on American Gothic (Q464782). P170 creator names a person;
  // P186 material used names what it is made of; P135 names a movement.
  const ranks = subjectAnchors(
    claims({ P170: 'Q217434', P195: 'Q239303', P186: 'Q3155607', P135: 'Q15838173' }),
  )
  assert.equal(ranks.get('Q217434'), 0) // Grant Wood — creator
  assert.equal(ranks.get('Q239303'), 0) // Art Institute — collection
  assert.equal(ranks.get('Q3155607'), 1) // beaverboard — material
  assert.equal(ranks.get('Q15838173'), 1) // Regionalism — movement
  assert.equal(ranks.get('Q174705'), undefined) // oil painting — never mentioned
})

test('the best rank wins when two statements name the same entity', () => {
  // American Gothic states the American Gothic House as both P180 depicts and
  // P941 inspired by; either would do, and neither must demote the other.
  const ranks = subjectAnchors({
    P180: [{ mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id: 'Q4743920' } } } }],
    P9493: [{ mainsnak: { datavalue: { type: 'wikibase-entityid', value: { id: 'Q4743920' } } } }],
  })
  assert.equal(ranks.get('Q4743920'), 0)
})

test('the lede prefers what the subject names most specifically, article order inside each tier', () => {
  // American Gothic's lede, in document order: the medium and the board come
  // before the painter, and the museum that owns it comes last of seventeen.
  // A flat "does the subject mention it" test is NOT enough here — the item
  // does mention beaverboard, as its material, and two anchor slots spent on
  // beaverboard and Regionalism are two dead ends.
  const candidates = ['Q174705', 'Q3155607', 'Q15838173', 'Q217434', 'Q239303']
  const ranks = subjectAnchors(
    claims({ P170: 'Q217434', P195: 'Q239303', P186: 'Q3155607', P135: 'Q15838173' }),
  )
  assert.deepEqual(preferRelated(candidates, ranks), [
    'Q217434', // Grant Wood — creator
    'Q239303', // Art Institute of Chicago — collection
    'Q3155607', // beaverboard — mentioned, but only as the material
    'Q15838173', // Regionalism — mentioned, as the movement
    'Q174705', // oil painting — never mentioned at all
  ])
})

test('with nothing related, the order is exactly document order', () => {
  const candidates = ['Q1', 'Q2', 'Q3']
  assert.deepEqual(preferRelated(candidates, new Map()), candidates)
})

test('nulls survive the reordering, because claimAnchors is what skips them', () => {
  assert.deepEqual(preferRelated(['Q1', null, 'Q2'], new Map([['Q2', 0]])), ['Q2', 'Q1', null])
})

test('reordering the lede changes which section owns an anchor, and the lede wins', () => {
  // The end-to-end consequence: the lede claims the painter and the museum, so
  // "Creation" and "Reception" — which used to own them on document order —
  // backfill from their own later candidates.
  const related = new Map([['Q217434', 0], ['Q239303', 0]])
  const units = [
    ['Q174705', 'Q3155607', 'Q217434', 'Q239303'], // lede
    ['Q217434', 'Q186499'], // Creation
    ['Q239303', 'Q5095587'], // Reception
  ]
  const owned = claimAnchors(
    units.map((qs, i) => (i === 0 ? preferRelated(qs, related) : qs)),
    { perUnit: 2, seeded: new Map() },
  )
  assert.deepEqual(owned[0], ['Q217434', 'Q239303'])
  assert.deepEqual(owned[1], ['Q186499'])
  assert.deepEqual(owned[2], ['Q5095587'])
})
