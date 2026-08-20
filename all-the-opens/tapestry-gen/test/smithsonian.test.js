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
  siScanEntryFrom,
  siSpecimenNumber,
  siSearchUrl,
  siTaxonRows,
  siTaxonSearchUrl,
  SI_TAXON_ROWS,
  smithsonianScansForTaxon,
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

// ---------------------------------------------------------------------------
// The taxon anchor: P225 → the Smithsonian's 3D scans
// ---------------------------------------------------------------------------

// Trimmed from the live Open Access record for USNM 143590, fetched
// 2026-08-20. The ARK, the scientific name, the collection date and the three
// Voyager packages are the Smithsonian's own; nothing is invented.
const orangutan = {
  title: 'Pongo abelii',
  unitCode: 'NMNHMAMMALS',
  url: 'edanmdm:nmnhvz_7251575',
  content: {
    freetext: {
      date: [{ label: 'Collection Date', content: '30 Dec 1905' }],
      identifier: [
        { label: 'Accession Number', content: '046089' },
        { label: 'Other Numbers', content: 'Mammals Field Number : 4606' },
        { label: 'USNM Number', content: '143590' },
      ],
    },
    indexedStructured: { scientific_name: ['Pongo abelii'] },
    descriptiveNonRepeating: {
      data_source: 'NMNH - Vertebrate Zoology - Mammals Division',
      record_link: 'http://n2t.net/ark:/65665/389dc210f-f5b3-4910-ae87-a26700227801',
      online_media: {
        media: [
          {
            type: 'Images',
            content: 'https://ids.si.edu/ids/deliveryService/id/ark:/65665/m328a61fcaf4984482951cea45d',
            usage: { access: 'CC0' },
          },
          {
            type: '3d_voyager',
            content: 'https://3d-api.si.edu/voyager/3d_package:0047afa8-1ec0-4e3c-a9f5-03330d96cc47',
            usage: { access: 'CC0' },
          },
        ],
      },
    },
  },
}

/** The same record with its parts swapped out, so each test states one change. */
const like = (over) => ({
  ...orangutan,
  content: {
    ...orangutan.content,
    ...(over.indexedStructured ? { indexedStructured: over.indexedStructured } : {}),
    descriptiveNonRepeating: {
      ...orangutan.content.descriptiveNonRepeating,
      ...(over.media
        ? { online_media: { media: over.media } }
        : {}),
    },
  },
})

test('the search is a net for the taxon and the scan token, and the name is quoted', () => {
  // Unquoted, "Pongo abelii" is two words and EDAN matches either.
  const url = siTaxonSearchUrl('Pongo abelii', 'k3y')
  assert.ok(url.includes(encodeURIComponent('"Pongo abelii" AND 3d_voyager')))
  assert.ok(url.includes(`rows=${SI_TAXON_ROWS}`))
  assert.ok(url.includes('api_key=k3y'))
})

test('a row is accepted on its OWN stated name, not on the search that found it', () => {
  // EDAN's free text matches a collector's note as readily as a species, so the
  // query is never what decides. This row was returned by a Pongo abelii search
  // and states a different animal: it is somebody else's specimen.
  const body = {
    response: {
      rowCount: 2,
      rows: [orangutan, like({ indexedStructured: { scientific_name: ['Pongo pygmaeus'] } })],
    },
  }
  const { rows } = siTaxonRows(body, 'Pongo abelii')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].content.indexedStructured.scientific_name[0], 'Pongo abelii')
})

test('a record of the right animal with no scan is not a scan', () => {
  const body = {
    response: {
      rowCount: 1,
      rows: [like({ media: [{ type: 'Images', content: 'https://ids.si.edu/x', usage: { access: 'CC0' } }] })],
    },
  }
  assert.equal(siTaxonRows(body, 'Pongo abelii').rows.length, 0)
})

test('names compare on case and interior spacing, and nothing else', () => {
  const body = { response: { rowCount: 1, rows: [orangutan] } }
  assert.equal(siTaxonRows(body, 'pongo  ABELII').rows.length, 1)
  // No genus fallback: a scan of some other orangutan is not a scan of this
  // species, and a card claiming otherwise would be the guess this project
  // refuses to make.
  assert.equal(siTaxonRows(body, 'Pongo').rows.length, 0)
  assert.equal(siTaxonRows(body, '').rows.length, 0)
})

test('a full search window makes the count a floor, not a total', () => {
  const rows = Array.from({ length: 20 }, () => orangutan)
  assert.equal(siTaxonRows({ response: { rowCount: 81, rows } }, 'Pongo abelii').truncated, true)
  assert.equal(siTaxonRows({ response: { rowCount: 3, rows } }, 'Pongo abelii').truncated, false)
})

test('a scan card says the join was a name and shows both sides of it', () => {
  // The whole disclosure: this edge is not an identifier, and a reader must be
  // able to see what actually agreed. `emit-html` renders it as the dashed
  // card with a signal row.
  const e = siScanEntryFrom(orangutan, 'Pongo abelii')
  assert.equal(e.evidence, 'corroborated')
  assert.deepEqual(e.corroboratedBy, [
    { field: 'scientific name', holding: 'Pongo abelii', claimed: 'Pongo abelii' },
  ])
  assert.equal(e._via, 'P225')
  // A partner's own record of the thing the article is about.
  assert.equal(e.standing, 'subject-record')
  assert.equal(e.source, 'smithsonian')
  assert.equal(e.media3d, 'https://3d-api.si.edu/voyager/3d_package:0047afa8-1ec0-4e3c-a9f5-03330d96cc47')
  // The ARK the museum states, never a URL we built.
  assert.equal(e.href, orangutan.content.descriptiveNonRepeating.record_link)
  assert.equal(e.rights.copy.label, 'CC0')
})

test('a record with no scan makes no scan card, whatever else it has', () => {
  const still = like({ media: [{ type: 'Images', content: 'https://ids.si.edu/x', usage: { access: 'CC0' } }] })
  assert.equal(siScanEntryFrom(still, 'Pongo abelii'), null)
})

test('the taxon lookup spends nothing without a key or a name', async () => {
  // Keyless is graceful degradation, not a policy — production runs keyed. What
  // matters is that it costs no request and claims nothing.
  assert.deepEqual(await smithsonianScansForTaxon('Pongo abelii', undefined), {
    entries: [],
    total: 0,
    truncated: false,
  })
  assert.deepEqual(await smithsonianScansForTaxon('', 'k3y'), {
    entries: [],
    total: 0,
    truncated: false,
  })
})

test('a specimen card is told apart by the museum\u2019s number for it', () => {
  // The museum titles every one of these records with the species, so a shelf
  // of three reads as one card printed three times. The number leads the
  // description; the title stays the museum's own, never invented.
  assert.equal(siSpecimenNumber(orangutan), 'USNM 143590')
  const e = siScanEntryFrom(orangutan, 'Pongo abelii')
  assert.equal(e.title, 'Pongo abelii')
  assert.match(e.description, /^USNM 143590 · NMNH/)
  // The acquisition event and the field-number grab-bag are not the specimen.
  assert.equal(siSpecimenNumber(like({})), 'USNM 143590')
  assert.equal(
    siSpecimenNumber({ content: { freetext: { identifier: [{ label: 'Accession Number', content: '046089' }] } } }),
    null,
  )
  assert.equal(siSpecimenNumber({}), null)
})
