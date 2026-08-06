import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  derivedVisualItemId,
  digitalObjectId,
  imageBaseFrom,
  rijksDate,
  rijksEntryFrom,
  rijksIdFrom,
  rijksRights,
  rijksTitle,
  visualItemId,
} from '../src/rijks.js'

// Trimmed from the live responses for object 200107947 ("Old Woman Reading"),
// fetched 2026-08-06. The shapes — and specifically the SIX names in two
// languages and the two different Creative Commons URIs — are the museum's,
// not invented for the test.
const ENGLISH = { id: 'http://vocab.getty.edu/aat/300388277', type: 'Language' }
const DUTCH = { id: 'http://vocab.getty.edu/aat/300388256', type: 'Language' }
const PRIMARY = { id: 'http://vocab.getty.edu/aat/300404670', type: 'Type' }
const OTHER = { id: 'http://vocab.getty.edu/aat/22015528', type: 'Type' }

const object = {
  id: 'https://id.rijksmuseum.nl/200107947',
  type: 'HumanMadeObject',
  identified_by: [
    {
      type: 'Name',
      content: "An old woman, probably Rembrandt's mother, apparently in the guise of the prophetess Anna",
      language: [ENGLISH],
      classified_as: [OTHER],
    },
    { type: 'Name', content: 'Een oude vrouw', language: [DUTCH], classified_as: [OTHER] },
    {
      type: 'Name',
      content: 'Oude lezende vrouw',
      language: [DUTCH],
      classified_as: [PRIMARY],
    },
    {
      type: 'Name',
      content: 'Old Woman Reading, Probably the Prophetess Anna',
      language: [ENGLISH],
      classified_as: [PRIMARY],
    },
  ],
  produced_by: {
    timespan: { type: 'TimeSpan', identified_by: [{ type: 'Name', content: '1631', language: [ENGLISH] }] },
  },
  shows: [{ id: 'https://id.rijksmuseum.nl/202107947', type: 'VisualItem' }],
}

const visual = {
  id: 'https://id.rijksmuseum.nl/202107947',
  type: 'VisualItem',
  // The picture is PUBLIC DOMAIN...
  subject_to: [
    {
      type: 'Right',
      classified_as: [{ id: 'https://creativecommons.org/publicdomain/mark/1.0/', type: 'Type' }],
    },
  ],
  // ...while this CC0 licenses the catalogue TEXT about it. Different claim.
  subject_of: [
    {
      id: 'https://data.rijksmuseum.nl/202107947',
      type: 'LinguisticObject',
      subject_to: [
        {
          type: 'Right',
          classified_as: [{ id: 'https://creativecommons.org/publicdomain/zero/1.0/', type: 'Type' }],
        },
      ],
    },
  ],
  digitally_shown_by: [{ id: 'https://id.rijksmuseum.nl/5001145412210155756882', type: 'DigitalObject' }],
}

const digital = {
  id: 'https://id.rijksmuseum.nl/5001145412210155756882',
  type: 'DigitalObject',
  access_point: [{ id: 'https://iiif.micr.io/CNSQg/full/max/0/default.jpg', type: 'DigitalObject' }],
}

test('the English title the museum marks primary wins over its own long one', () => {
  // Both are English and both are true; only one is a card title.
  assert.equal(rijksTitle(object), 'Old Woman Reading, Probably the Prophetess Anna')
})

test('a record with no English name still yields a card rather than none', () => {
  const dutchOnly = { identified_by: [{ type: 'Name', content: 'Oude lezende vrouw', language: [DUTCH] }] }
  assert.equal(rijksTitle(dutchOnly), 'Oude lezende vrouw')
})

test('an untitled record yields null — an untitled card says nothing', () => {
  assert.equal(rijksTitle({ identified_by: [] }), null)
  assert.equal(rijksTitle(null), null)
})

test('the date is the museum’s own string, not a reformatted one', () => {
  assert.equal(rijksDate(object), '1631')
  // "in or after 1643" is a real value; anything that parsed it into a year
  // would be claiming a precision the museum did not state.
  const vague = { produced_by: { timespan: { identified_by: [{ type: 'Name', content: 'in or after 1643' }] } } }
  assert.equal(rijksDate(vague), 'in or after 1643')
})

test('the walk reads the ids the museum states', () => {
  assert.equal(rijksIdFrom('https://id.rijksmuseum.nl/200107947'), '200107947')
  assert.equal(rijksIdFrom({ id: 'https://data.rijksmuseum.nl/202107947' }), '202107947')
  assert.equal(rijksIdFrom('https://example.com/200107947'), null)
  assert.equal(visualItemId(object), '202107947')
  assert.equal(digitalObjectId(visual), '5001145412210155756882')
})

test('the derived VisualItem id matches what the museum states, at both id lengths', () => {
  // Observed on 6/6 objects 2026-08-06. It is a FALLBACK; these assertions
  // exist so a change in the rule is noticed rather than silently relied on.
  assert.equal(derivedVisualItemId('200107947'), '202107947')
  assert.equal(derivedVisualItemId('20026161'), '20226161')
  // Anything not shaped like the ids the rule was observed on is refused.
  assert.equal(derivedVisualItemId('12345'), null)
  assert.equal(derivedVisualItemId('219107947'), null)
  assert.equal(derivedVisualItemId(null), null)
})

test('the rights read the PICTURE, never the CC0 on the catalogue text', () => {
  // The single most important assertion in this file: printing the metadata's
  // CC0 as the card's licence would promise CC0 over an image the museum
  // marked public-domain instead.
  const mark = rijksRights(visual)
  assert.equal(mark.url, 'https://creativecommons.org/publicdomain/mark/1.0/')
  assert.notEqual(mark.url, 'https://creativecommons.org/publicdomain/zero/1.0/')
})

test('unrecognized rights vocabulary yields null rather than a guessed mark', () => {
  const odd = { subject_to: [{ type: 'Right', classified_as: [{ id: 'https://example.com/terms' }] }] }
  assert.equal(rijksRights(odd), null)
  assert.equal(rijksRights({}), null)
})

test('the IIIF base is taken from access_point, and a non-IIIF URL is refused', () => {
  assert.equal(imageBaseFrom(digital), 'https://iiif.micr.io/CNSQg')
  assert.equal(imageBaseFrom({ access_point: [{ id: 'https://example.com/a.jpg' }] }), null)
  assert.equal(imageBaseFrom({}), null)
})

test('the three resources become one card the renderer can place', () => {
  const e = rijksEntryFrom(object, visual, digital, '200107947')
  assert.equal(e.source, 'rijks')
  assert.equal(e.title, 'Old Woman Reading, Probably the Prophetess Anna')
  assert.equal(e.description, 'Rijksmuseum, Amsterdam · 1631')
  assert.equal(e.imageUrl, 'https://iiif.micr.io/CNSQg/full/400,/0/default.jpg')
  assert.match(e.href, /rijksmuseum\.nl\/en\/collection\/object\/200107947/)
  assert.equal(e.attribution.author, 'Rijksmuseum · public domain')
  assert.equal(e._via, 'P13234')
  assert.equal(e.rights.copy.url, 'https://creativecommons.org/publicdomain/mark/1.0/')
})

test('an object whose image hops failed still makes a truthful text card', () => {
  // Better than dropping the object: the museum does hold it, and the card
  // saying so with no picture is not a false claim.
  const e = rijksEntryFrom(object, null, null, '200107947')
  assert.equal(e.title, 'Old Woman Reading, Probably the Prophetess Anna')
  assert.equal(e.imageUrl, null)
  // With no rights statement read, the credit must not assert public domain.
  assert.equal(e.attribution.author, 'Rijksmuseum')
  assert.equal(e.rights, undefined)
})
