import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  isSmithsonianCollection,
  si3dModels,
  siCollectionName,
  siDate,
  siEntryFrom,
  siImageUrl,
  siQid,
  siRights,
  siRowFor,
  siSearchUrl,
} from '../src/smithsonian.js'

// Trimmed from the live Open Access record for A19700102000 (the Apollo 11
// command module), fetched 2026-08-06. The two 3D packages and the ARK are the
// Smithsonian's own; nothing here is invented for the test.
const columbia = {
  title: 'Command Module, Apollo 11',
  unitCode: 'NASM',
  url: 'edanmdm:nasm_A19700102000',
  content: {
    freetext: { date: [{ label: 'Date', content: '1969' }] },
    descriptiveNonRepeating: {
      data_source: 'National Air and Space Museum',
      record_link: 'http://n2t.net/ark:/65665/nv9ce74610f-62de-46b6-904f-58abfecb555c',
      online_media: {
        media: [
          {
            type: 'Images',
            content: 'https://ids.si.edu/ids/deliveryService?id=NASM-NASM2022-05013-000003',
            usage: { access: 'CC0' },
          },
          {
            type: '3d_voyager',
            id: '3d_package:d8c6457e-4ebc-11ea-b77f-2e728ce88125',
            content: 'https://3d-api.si.edu/voyager/3d_package:d8c6457e-4ebc-11ea-b77f-2e728ce88125',
            usage: { access: 'CC0' },
          },
          {
            type: '3d_voyager',
            id: '3d_package:d8c63e8a-4ebc-11ea-b77f-2e728ce88125',
            content: 'https://3d-api.si.edu/voyager/3d_package:d8c63e8a-4ebc-11ea-b77f-2e728ce88125',
            usage: { access: 'CC0' },
          },
        ],
      },
    },
  },
}

const body = { response: { rows: [columbia] } }

test('a Smithsonian collection is recognized through the URI WDQS actually binds', () => {
  // Every other var in that query is a literal; this one arrives as an entity
  // URI, and reading it as a bare QID would silently never match.
  assert.equal(siQid('http://www.wikidata.org/entity/Q752669'), 'Q752669')
  assert.equal(siQid('Q752669'), 'Q752669')
  assert.equal(siCollectionName('http://www.wikidata.org/entity/Q752669'), 'National Air and Space Museum')
  assert.ok(isSmithsonianCollection('http://www.wikidata.org/entity/Q1192305'))
})

test('a museum that is not the Smithsonian is not looked up', () => {
  // The Rijksmuseum states P217 on its objects too. An inventory number belongs
  // to whichever museum assigned it, so the collection is what makes it askable.
  assert.equal(isSmithsonianCollection('http://www.wikidata.org/entity/Q190804'), false)
  assert.equal(isSmithsonianCollection(null), false)
  assert.equal(siCollectionName('nonsense'), null)
})

test('a row is accepted only when its OWN id ends with the inventory number', () => {
  // The single most important assertion here. A bare accession number is a weak
  // query — "1993.9" matches plenty that is not the object — so the match is
  // confirmed against what the Smithsonian states, never assumed from the query.
  assert.equal(siRowFor(body, 'A19700102000'), columbia)
  assert.equal(siRowFor(body, 'A19500100000'), null)
})

test('punctuation differences between Wikidata and EDAN do not lose the match', () => {
  // EDAN writes `nasm_A19700102000`; elsewhere it normalizes dots and spaces.
  const dotted = { response: { rows: [{ ...columbia, url: 'edanmdm:chndm_1993-9' }] } }
  assert.ok(siRowFor(dotted, '1993.9'))
  assert.equal(siRowFor(dotted, ''), null)
  assert.equal(siRowFor({}, 'A19700102000'), null)
})

test('the search URL quotes the number and carries the key', () => {
  const url = siSearchUrl('31588 D', 'KEY123')
  assert.match(url, /q=%22 ?31588(%20| )D%22/)
  assert.match(url, /api_key=KEY123/)
})

test('the 3D scans the museum states are read, both of them', () => {
  const models = si3dModels(columbia)
  assert.equal(models.length, 2)
  assert.equal(models[0].content, 'https://3d-api.si.edu/voyager/3d_package:d8c6457e-4ebc-11ea-b77f-2e728ce88125')
})

test('the thumbnail asks for a card-sized image, not the full-size default', () => {
  assert.equal(
    siImageUrl(columbia),
    'https://ids.si.edu/ids/deliveryService?id=NASM-NASM2022-05013-000003&max=800',
  )
  assert.equal(siImageUrl({}), null)
})

test('CC0 is read where the museum states it, and never guessed', () => {
  assert.equal(siRights(columbia).url, 'https://creativecommons.org/publicdomain/zero/1.0/')
  const unclear = { content: { descriptiveNonRepeating: { online_media: { media: [{ type: 'Images', usage: { access: 'Usage conditions apply' } }] } } } }
  assert.equal(siRights(unclear), null)
  assert.equal(siRights({}), null)
})

test('the date is the record’s own string', () => {
  assert.equal(siDate(columbia), '1969')
  assert.equal(siDate({}), null)
})

test('the record becomes a card whose door is the ARK the museum states', () => {
  const e = siEntryFrom(columbia, 'National Air and Space Museum')
  assert.equal(e.source, 'smithsonian')
  assert.equal(e.title, 'Command Module, Apollo 11')
  // NOT 3d.si.edu/object/3d/<slug>:<uuid> — that slug cannot be derived from
  // anything the API returns, and inventing it is the Rijksmuseum 404 again.
  assert.equal(e.href, 'http://n2t.net/ark:/65665/nv9ce74610f-62de-46b6-904f-58abfecb555c')
  assert.equal(e.media3d, 'https://3d-api.si.edu/voyager/3d_package:d8c6457e-4ebc-11ea-b77f-2e728ce88125')
  assert.equal(e.plate, '3D scan')
  assert.equal(e.attribution.author, 'National Air and Space Museum · CC0')
  assert.equal(e.rights.copy.url, 'https://creativecommons.org/publicdomain/zero/1.0/')
  assert.equal(e._via, 'P217')
})

test('a record with no ARK yields no card — a door we would have to invent is no door', () => {
  const noArk = { ...columbia, content: { ...columbia.content, descriptiveNonRepeating: { data_source: 'X' } } }
  assert.equal(siEntryFrom(noArk, 'X'), null)
  assert.equal(siEntryFrom({ title: '' }, 'X'), null)
})

test('an object with no 3D scan is still a card, just without the embed', () => {
  const flat = {
    ...columbia,
    content: {
      ...columbia.content,
      descriptiveNonRepeating: {
        ...columbia.content.descriptiveNonRepeating,
        online_media: { media: [columbia.content.descriptiveNonRepeating.online_media.media[0]] },
      },
    },
  }
  const e = siEntryFrom(flat, 'National Air and Space Museum')
  assert.equal(e.media3d, undefined)
  assert.equal(e.plate, undefined)
  assert.ok(e.imageUrl)
})
