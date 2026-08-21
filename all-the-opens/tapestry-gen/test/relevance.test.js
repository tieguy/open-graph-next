import test from 'node:test'
import assert from 'node:assert/strict'

import { heroRank, pickHero } from '../src/hero.js'
import { BROAD_ABOVE, broadNote, tooBroad } from '../src/breadth.js'
import { claimAnchors, hookRank, preferRelated, preferYielding, subjectAnchors } from '../src/dedup.js'
import {
  applyVerdicts,
  classVerdicts,
  mappable,
  mergePlaceDefunct,
  resolveMappability,
} from '../src/statements.js'
import { readFacts, writeFacts } from '../src/http.js'
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

test('a rotatable scan is something to look at, and can lead a section', () => {
  // 576 of the Smithsonian's 1,937 scanned objects have a Voyager package and
  // no still image (measured 2026-08-20). Reading only imageUrl/media dropped
  // every one of them to the text tiers, where nothing can float or lead.
  const scan = {
    source: 'smithsonian',
    title: 'Pongo abelii',
    standing: 'subject-record',
    media3d: 'https://3d-api.si.edu/voyager/3d_package:0047afa8',
  }
  const text = { source: 'dpla', title: 'A catalog record' }
  assert.equal(heroRank(scan), 1)
  assert.ok(heroRank(scan) < heroRank(text))
  assert.equal(pickHero([text, scan]).hero.title, 'Pongo abelii')
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

test('the holder’s record of the work outranks every other standing, even a subject document', () => {
  const holder = { standing: 'holder-work', imageUrl: 'x' }
  const doc = { standing: 'subject-document' }
  assert.ok(heroRank(holder) < heroRank(doc))
  assert.equal(pickHero([doc, holder]).hero, holder)
})

test('a holder record without an image does not take the float', () => {
  const bare = { standing: 'holder-work' }
  assert.equal(pickHero([bare]).hero, null)
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
  assert.ok(BROAD_ABOVE > 190, 'threshold must sit above the largest kept heading')
  assert.ok(BROAD_ABOVE < 465, 'threshold must sit below the smallest dropped heading')
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

// --- the expensive half stays bounded ---------------------------------------

test('mappability is decided only for the anchors asked about, and answers nobody asked stay unset', async () => {
  // The partner query now covers every candidate on the page; the class walk
  // must NOT follow it. On Apollo 11 that is the difference between 16
  // location-bearing items and 95. An item outside the subset is left with
  // place/defunct undefined, which mappable() reads as a refusal — the honest
  // state for a question nobody put. No network: with an empty subset there is
  // nothing to ask.
  const asked = { coord: 'Point(-87.62 41.87)', lc: 'n78096940' }
  const notAsked = { coord: 'Point(2.35 48.85)' }
  const map = new Map([['Q239303', asked], ['Q90', notAsked]])
  const out = await resolveMappability(map, [])
  assert.equal(out, map) // the same map, enriched in place
  assert.equal(asked.place, undefined)
  assert.equal(notAsked.place, undefined)
  assert.equal(mappable(notAsked), false)
})

test('a class verdict keeps only the two booleans, and says so even when nothing matched', () => {
  const row = (c, s) => ({
    class: { value: `http://www.wikidata.org/entity/${c}` },
    super: { value: `http://www.wikidata.org/entity/${s}` },
  })
  const v = classVerdicts([
    row('Q515', 'Q515'), // a city, which is itself
    row('Q515', 'Q486972'), // …and a human settlement — locatable
    row('Q3024240', 'Q3024240'), // the historical-country class itself
    row('Q7889', 'Q7889'), // video game: reaches neither
    row('Q7889', 'Q386724'),
  ])
  assert.deepEqual(v.get('Q515'), { place: true, defunct: false })
  assert.deepEqual(v.get('Q3024240'), { place: false, defunct: true })
  // The point of caching: a class that reaches nothing is an ANSWER, not an
  // absence. Stored as false it is never asked about again.
  assert.deepEqual(v.get('Q7889'), { place: false, defunct: false })
})

test('items are judged from verdicts, however those verdicts were obtained', () => {
  // applyVerdicts is what lets the class half come from a cache rather than a
  // query; mergePlaceDefunct is now just this with the rows parsed first.
  const city = { coord: 'Point(0 0)' }
  const empire = { coord: 'Point(1 1)' }
  const items = new Map([['Q_city', city], ['Q_empire', empire]])
  applyVerdicts(
    items,
    new Map([['Q515', { place: true, defunct: false }], ['Q3024240', { place: true, defunct: true }]]),
    new Map([['Q_city', new Set(['Q515'])], ['Q_empire', new Set(['Q3024240'])]]),
    new Set(),
  )
  assert.equal(mappable(city), true)
  assert.equal(mappable(empire), false) // locatable, but ended
})

test('the fact cache round-trips, and refuses a key it cannot store safely', async () => {
  // Keys become filenames. A sanitized key could collide with another key and
  // hand back the wrong fact, so anything unsafe is refused outright.
  await writeFacts('testkind', new Map([['Q999999901', { place: true, defunct: false }]]))
  const got = await readFacts('testkind', ['Q999999901', 'Q999999902'])
  assert.deepEqual(got.get('Q999999901'), { place: true, defunct: false })
  assert.equal(got.has('Q999999902'), false) // never written
  await writeFacts('testkind', new Map([['../escape', { place: true }]]))
  assert.equal((await readFacts('testkind', ['../escape'])).size, 0)
})

test('a later, wider mappability pass never undoes an earlier verdict', () => {
  // The lede resolves its own anchors first so its band can render first; the
  // page-wide pass that follows covers those anchors again. mergePlaceDefunct
  // writes place='false' onto any location-bearing item it is handed with no
  // class binding — and a previously-settled item has none in the new batch —
  // so handing it anything wider than what THIS pass queried silently reverses
  // the earlier answer. It cost Brown v. Board the map in its lede, as a race
  // against the band still reading the object.
  const court = { coord: 'Point(-77.00 38.89)', place: 'true', defunct: 'false' }
  const fresh = { coord: 'Point(2.35 48.85)' }
  const pending = new Map([['Q_fresh', fresh]]) // only what this pass asked about
  mergePlaceDefunct(
    pending,
    [{ class: { value: 'http://www.wikidata.org/entity/Q515' }, super: { value: 'http://www.wikidata.org/entity/Q486972' } }],
    new Map([['Q_fresh', new Set(['Q515'])]]),
    new Set(),
  )
  assert.equal(fresh.place, 'true') // newly decided
  assert.equal(court.place, 'true') // untouched, because it was not handed over
  assert.equal(mappable(court), true)
})

// --- which of a section's links is worth asking about --------------------

test('an item-level identifier outranks every other hook, which outrank nothing', () => {
  assert.equal(hookRank({ met: '1' }), 0)
  assert.equal(hookRank({ aic: '1' }), 0)
  assert.equal(hookRank({ iiif: 'x' }), 0)
  assert.equal(hookRank({ inat: '1' }), 0)
  assert.equal(hookRank({ gbif: '1' }), 0)
  assert.equal(hookRank({ lc: 'sh1' }), 1)
  assert.equal(hookRank({ eu: 'concept/1' }), 1)
  assert.equal(hookRank({ coord: 'Point(0 0)' }), 1)
  assert.equal(hookRank({ osmr: '1' }), 1)
  assert.equal(hookRank({}), 2)
  assert.equal(hookRank(undefined), 2)
})

test('a heading and a coordinate are NOT ranked against each other', () => {
  // Ranking headings above coordinates cost American Gothic's lede the map of
  // the house in the painting — Nan Wood Graham (a heading, contents unknown)
  // displaced the American Gothic House (a coordinate on a place the subject
  // names). Ranking coordinates above headings turns Apollo 11, which has 95
  // location-bearing candidates, into wallpaper. Document order breaks the tie.
  assert.equal(hookRank({ lc: 'sh1' }), hookRank({ coord: 'Point(0 0)' }))
  const heading = 'Q_heading'
  const place = 'Q_place'
  const stmts = new Map([
    [heading, { lc: 'sh1' }],
    [place, { coord: 'Point(0 0)' }],
  ])
  assert.deepEqual(preferYielding([heading, place], stmts), [heading, place])
  assert.deepEqual(preferYielding([place, heading], stmts), [place, heading])
})

test('candidates that hold something come first, article order inside each tier', () => {
  const stmts = new Map([
    ['Q2', { lc: 'sh1' }],
    ['Q3', { met: '4' }],
    ['Q5', { coord: 'Point(0 0)' }],
  ])
  // Q1 and Q4 are absent from the map entirely — nothing was found for them.
  assert.deepEqual(preferYielding(['Q1', 'Q2', 'Q3', 'Q4', 'Q5'], stmts), [
    'Q3', // the only item-level identifier
    'Q2', // has a hook, and precedes Q5 in the article
    'Q5',
    'Q1', // nothing, in article order
    'Q4',
  ])
})

test('nulls sink with the empty-handed, because claimAnchors is what skips them', () => {
  assert.deepEqual(preferYielding(['Q1', null, 'Q2'], new Map([['Q2', { met: '1' }]])), [
    'Q2',
    'Q1',
    null,
  ])
})

test('the lede composes both rankings: relevance dominates, yield breaks ties', () => {
  // The composition order is load-bearing. preferYielding runs FIRST and
  // preferRelated SECOND, so the result is sorted by (subject tier, hook rank)
  // — not the reverse, which would let an unrelated anchor that happens to
  // hold something outrank the painter.
  const stmts = new Map([
    ['Q_wood', { lc: 'n50014999' }], // named by the subject, holds something
    ['Q_nan', {}], // named by the subject, holds nothing
    ['Q_oil', { eu: 'concept/222' }], // never named, holds something
  ])
  const related = new Map([['Q_wood', 0], ['Q_nan', 0]])
  const order = preferRelated(preferYielding(['Q_oil', 'Q_nan', 'Q_wood'], stmts), related)
  assert.deepEqual(order, ['Q_wood', 'Q_nan', 'Q_oil'])
  // The reverse composition would promote the thing nobody named.
  assert.deepEqual(preferYielding(preferRelated(['Q_oil', 'Q_nan', 'Q_wood'], related), stmts), [
    'Q_wood',
    'Q_oil',
    'Q_nan',
  ])
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

// --- corroboration: about the article, or about one thing it mentions -------

import { anchorsTouched, corroborated, nameTokens, subjectNamesAnchor, topicSpace } from '../src/relevance.js'

// The Apollo 11 topic space, abridged: LC-bearing anchors and their labels,
// exactly what topicSpace() builds from the maps a band already holds.
const TOPIC = [
  { qid: 'Q2252', name: 'Buzz Aldrin', place: false },
  { qid: 'Q1615', name: 'Neil Armstrong', place: false },
  // The Moon's P625 is on the lunar globe, which parseEarthPoint refuses —
  // so it is NOT a place here, and stays the best corroborator on the page.
  { qid: 'Q405', name: 'Moon', place: false },
  { qid: 'Q5916', name: 'Spaceflight', place: false },
  { qid: 'Q11631', name: 'Astronaut', place: false },
  { qid: 'Q131626', name: 'Smithsonian Institution', place: true },
  { qid: 'Q1297', name: 'Chicago', place: true },
  { qid: 'Q30', name: 'United States', place: true },
  { qid: 'Q61', name: 'Washington, D.C.', place: true },
]

test('nameTokens folds case, punctuation, diacritics and plurals', () => {
  assert.deepEqual(nameTokens('Armstrong, Neil Alden, 1930-2012'), [
    'armstrong', 'neil', 'alden', '1930', '2012',
  ])
  assert.deepEqual(nameTokens('Astronauts'), ['astronaut'])
  // A ligature is not a combining mark, so œ splits the token — a known
  // limit, harmless because both sides of every comparison fold the same way.
  assert.deepEqual(nameTokens('Cœdès, George'), ['c', 'des', 'george'])
  assert.deepEqual(nameTokens(null), [])
})

test('a subject names an anchor when the anchor’s tokens are inside it, in any order', () => {
  // The NZ partners' own fuller form — 'Alden' appears in LC's record only as
  // a fullerName, so exact-form matching can never connect these two.
  assert.ok(subjectNamesAnchor('Armstrong, Neil Alden, 1930-2012', 'Neil Armstrong'))
  assert.ok(subjectNamesAnchor('Aldrin, Buzz', 'Buzz Aldrin'))
  assert.ok(subjectNamesAnchor('Moon--Exploration', 'Moon'))
})

test('compounding works both ways: “Space flight” names Spaceflight and vice versa', () => {
  assert.ok(subjectNamesAnchor('Space flight', 'Spaceflight'))
  assert.ok(subjectNamesAnchor('Spaceflight', 'Space flight'))
  assert.ok(subjectNamesAnchor('Space flight to the moon', 'Spaceflight'))
})

test('a near-miss is not a match: Apollo 12 does not name Apollo 11', () => {
  assert.ok(!subjectNamesAnchor('Apollo 12 (Spacecraft)', 'Apollo 11'))
  assert.ok(!subjectNamesAnchor('', 'Moon'))
  assert.ok(!subjectNamesAnchor('Moon', ''))
})

test('the Turnbull moon-landing photo corroborates: its subjects touch the article past its own anchor', () => {
  // Verbatim from the live record under "Aldrin, Buzz" (2026-08-08).
  const subjects = ['Moon', 'Space flight', 'Aldrin, Buzz', 'Spaceships', 'Astronauts']
  const touched = anchorsTouched(subjects, TOPIC).map((t) => t.name)
  assert.ok(touched.includes('Moon'))
  assert.ok(touched.includes('Spaceflight'))
  assert.ok(touched.includes('Astronaut'))
  assert.ok(corroborated(subjects, TOPIC, 'Q2252'))
})

test('the lunch box does not: about its anchor, about the article nowhere', () => {
  // The record filed under "Smithsonian Institution" whose subjects touch
  // Apollo 11's article at exactly one point — the anchor that fetched it.
  assert.ok(!corroborated(['Smithsonian Institution', 'Lunch boxes'], TOPIC, 'Q131626'))
  // And an anchor's own touch never counts for another shelf either.
  assert.ok(!corroborated(['Chicago (Ill.)'], TOPIC, 'Q1297'))
})

test('topicSpace takes every LC-bearing anchor with a label, and marks the Earthbound as places', () => {
  const statements = new Map([
    // The Moon: coordinates on another globe, which is not a place here.
    ['Q405', { lc: 'sh85087107', coord: '<http://www.wikidata.org/entity/Q405> Point(0 0)' }],
    ['Q2252', { lc: 'n88056905' }],
    ['Q61', { lc: 'n79018774', coord: 'Point(-77.03 38.9)' }],
    ['Q_nolc', { met: '123', coord: 'Point(1 2)' }],
    ['Q_nolabel', { lc: 'n00000000' }],
  ])
  const labels = new Map([
    ['Q405', 'Moon'],
    ['Q2252', 'Buzz Aldrin'],
    ['Q61', 'Washington, D.C.'],
    ['Q_nolc', 'A Museum Piece'],
  ])
  assert.deepEqual(topicSpace(statements, labels), [
    { qid: 'Q405', name: 'Moon', place: false },
    { qid: 'Q2252', name: 'Buzz Aldrin', place: false },
    { qid: 'Q61', name: 'Washington, D.C.', place: true },
  ])
})

test('the article’s own subject corroborates even when it is a place', () => {
  // Angkor Wat's page: a record filed under "Cambodia" whose subjects also
  // state the temple is about the article, coordinates and all.
  const statements = new Map([
    ['Q43473', { lc: 'sh85004955', coord: 'Point(103.86 13.41)' }],
    ['Q424', { lc: 'n80014970', coord: 'Point(104.9 12.5)' }],
  ])
  const labels = new Map([
    ['Q43473', 'Angkor Wat'],
    ['Q424', 'Cambodia'],
  ])
  const topic = topicSpace(statements, labels, { subjectQid: 'Q43473' })
  assert.deepEqual(topic.find((t) => t.qid === 'Q43473'), { qid: 'Q43473', name: 'Angkor Wat', place: false })
  assert.ok(corroborated(['Cambodia', 'Angkor Wat (Angkor)'], topic, 'Q424'))
  // ...while Cambodia alone — the own anchor plus nothing — does not.
  assert.ok(!corroborated(['Cambodia'], topic, 'Q424'))
})

test('places don’t corroborate: the survivors of the first version stay dead', () => {
  // Verbatim subject lists from the records that corroborated through
  // places before the place rule existed (2026-08-08).
  const hamas = ['Bush, George Walker, 1946-', 'Hamas', 'Elections', 'United States', 'White House (Washington, D.C.)']
  assert.ok(!corroborated(hamas, TOPIC, 'Q61'))
  const holyoake = ['Holyoake, Keith Jacka (Sir), 1904-1983', 'Johnson, Lyndon Baines, 1908-1973', 'New Zealand', 'United States', 'Washington (D.C.)']
  assert.ok(!corroborated(holyoake, TOPIC, 'Q_lbj'))
})
