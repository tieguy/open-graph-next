import { test } from 'node:test'
import assert from 'node:assert/strict'

import { corroborate, matchesName, sameYear, sameInstitution } from '../src/corroborate.js'

// --- institutions -----------------------------------------------------------

test('a holding record and a Wikidata label for one university agree', () => {
  // The Internet Archive record and Wikidata disagree on "Ludwigs" vs "Ludwig"
  // and on the inserted "zu". Exact comparison would reject a correct match.
  assert.ok(
    sameInstitution('Ludwigs-Maximilians-Universität zu München', 'Ludwig-Maximilians-Universität München'),
  )
})

test('two different universities do not agree', () => {
  assert.equal(sameInstitution('Universität Göttingen', 'Ludwig-Maximilians-Universität München'), false)
})

test('a missing institution on either side is not agreement', () => {
  assert.equal(sameInstitution(null, 'Ludwig-Maximilians-Universität München'), false)
  assert.equal(sameInstitution('Universität Göttingen', undefined), false)
})

// --- dates ------------------------------------------------------------------

test('a full holding date agrees with a year-precision Wikidata date', () => {
  // IA has 1899-11-14; Wikidata P577 is year-precision, +1899-00-00T00:00:00Z.
  assert.ok(sameYear('1899-11-14T00:00:00Z', '+1899-00-00T00:00:00Z'))
})

test('a year that differs does not agree', () => {
  assert.equal(sameYear('1906-01-28T00:00:00Z', '+1899-00-00T00:00:00Z'), false)
})

test('an unparseable date does not agree with anything', () => {
  assert.equal(sameYear('n.d.', '+1899-00-00T00:00:00Z'), false)
  assert.equal(sameYear(null, '+1899-00-00T00:00:00Z'), false)
})

// --- names ------------------------------------------------------------------

test('a holding creator in surname-comma-given form matches the person', () => {
  assert.ok(matchesName('Prandtl, Ludwig', 'Ludwig Prandtl'))
})

test('a different given name with the same surname does not match', () => {
  // The collection holds theses by Hans Prandtl and Antonius Prandtl too.
  assert.equal(matchesName('Prandtl, Hans', 'Ludwig Prandtl'), false)
  assert.equal(matchesName('Prandtl, Antonius Monacensis', 'Ludwig Prandtl'), false)
})

test('a surname alone does not match a person with a known given name', () => {
  assert.equal(matchesName('Prandtl', 'Ludwig Prandtl'), false)
})

// --- the described-object match --------------------------------------------

const THESIS = {
  personName: 'Ludwig Prandtl',
  year: '+1899-00-00T00:00:00Z',
  institution: 'Ludwig-Maximilians-Universität München',
}

const REAL = {
  identifier: 'IA41548318_0126',
  title: 'Kipp-Erscheinungen',
  creator: 'Prandtl, Ludwig',
  date: '1899-11-14T00:00:00Z',
  institution: 'Ludwigs-Maximilians-Universität zu München',
}

test('the thesis Wikidata describes is corroborated by all three signals', () => {
  const got = corroborate(REAL, THESIS)
  assert.ok(got.matched)
  assert.deepEqual(got.corroboratedBy.map((s) => s.field).sort(), ['creator', 'date', 'institution'])
})

test('a same-surname thesis from another year is rejected', () => {
  const hans = { ...REAL, identifier: 'IA41552318_0101', creator: 'Prandtl, Hans', date: '1906-01-28T00:00:00Z' }
  assert.equal(corroborate(hans, THESIS).matched, false)
})

test('a right-person right-year thesis from the wrong institution is rejected', () => {
  const elsewhere = { ...REAL, institution: 'Universität Göttingen' }
  assert.equal(corroborate(elsewhere, THESIS).matched, false)
})

test('a holding with no institution stated cannot be corroborated at this level', () => {
  // Two signals is the person-level fallback's business, not this one's.
  const bare = { ...REAL, institution: null }
  assert.equal(corroborate(bare, THESIS).matched, false)
})

test('a date signal reads as a date, not as a wire format', () => {
  // The raw pair is "1899-11-14T00:00:00Z" against "+1899-00-00T00:00:00Z".
  // Neither belongs on a page a person reads.
  const signal = corroborate(REAL, THESIS).corroboratedBy.find((s) => s.field === 'date')
  assert.equal(signal.holding, '14 November 1899')
  assert.equal(signal.claimed, '1899')
})

test('each corroborating signal names both sides, so the page can show its work', () => {
  const signal = corroborate(REAL, THESIS).corroboratedBy.find((s) => s.field === 'institution')
  assert.match(signal.holding, /Ludwigs-Maximilians/)
  assert.match(signal.claimed, /Ludwig-Maximilians/)
})
