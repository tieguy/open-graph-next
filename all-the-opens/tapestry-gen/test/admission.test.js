import test from 'node:test'
import assert from 'node:assert/strict'

import { admits, isShowcase, titleKey } from '../src/admission.js'
import { busyPage, holderShowcaseTitles, showcaseTitles } from '../src/front-page.js'

const CAP = { max: 4, reserve: 2 }
const ordinary = (inFlight) => admits({ inFlight, showcase: false, ...CAP })
const showcase = (inFlight) => admits({ inFlight, showcase: true, ...CAP })

// The whole point of the reserve: the front page prints "already rendered and
// cached — they open at once", and before this a reader who arrived while four
// cold discoveries were in flight got the busy page for a page that would have
// been served entirely off disk.
test('a showcase page opens where ordinary traffic is already turned away', () => {
  assert.equal(ordinary(3), true)
  assert.equal(ordinary(4), false)
  assert.equal(showcase(4), true)
  assert.equal(showcase(5), true)
})

// A lane with no end is how a demo becomes someone else's traffic problem. The
// reserve buys the showcase two slots, not an exemption.
test('the reserve is finite — even the showcase is refused once it is full', () => {
  assert.equal(showcase(6), false)
  assert.equal(showcase(40), false)
})

test('showcase pages take the general slots first, and leave none idle', () => {
  assert.equal(showcase(0), true)
  assert.equal(ordinary(0), true)
})

test('a request is matched the several ways a link can spell the same title', () => {
  const [first] = showcaseTitles()
  assert.equal(isShowcase(first), true)
  assert.equal(isShowcase(first.replace(/ /g, '_')), true)
  assert.equal(isShowcase(first.charAt(0).toLowerCase() + first.slice(1)), true)
  assert.equal(isShowcase(`  ${first}  `), true)
})

// enwiki folds the first letter of a title and no other, so neither does this:
// SHOUTING a showcase title is a different (and missing) article, and must not
// buy its way into the lane kept for warm pages.
test('only the first letter is case-folded, as on enwiki', () => {
  assert.equal(titleKey('apollo_11'), 'Apollo 11')
  assert.equal(isShowcase('REMBRANDT'), false)
  assert.equal(isShowcase('Rembrandt van Rijn'), false)
  assert.equal(isShowcase('Angkor Wat'), false)
})

// The busy page's offer and the reserve are one change, not two: a busy page
// linking to pages that would themselves answer 503 is a worse dead end than
// the bare sentence it replaced.
test('the busy page links every page the reserve keeps room for', () => {
  const html = busyPage()
  for (const title of showcaseTitles()) {
    assert.ok(isShowcase(title), `${title} rides the reserve`)
    const href = `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`
    assert.ok(html.includes(`href="${href}"`), `busy page links ${title}`)
  }
  assert.equal(showcaseTitles().length, (html.match(/<a class="show"/g) ?? []).length)
})

test('the busy page still says why it is busy, and offers a way out', () => {
  const html = busyPage()
  assert.match(html, /busy discovering other pages right now/)
  assert.match(html, /fetches politely, a few at a/)
  assert.ok(html.includes('href="/"'), 'the front page is one click away')
})

// The held-works cards make the same ready-now promise, so they ride the
// same reserve — asserted per row, mirroring the boot-walk pins in
// render.test.js. They are deliberately NOT on the busy page, whose grid is
// the showcase's; only the reserve claim is theirs to pass here.
test('every held-works title rides the reserve', () => {
  for (const title of holderShowcaseTitles()) {
    assert.ok(isShowcase(title), `${title} rides the reserve`)
  }
})
