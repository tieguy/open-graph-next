import test from 'node:test'
import assert from 'node:assert/strict'
import {
  metRecordFrom,
  aicRecordFrom,
  rijksRecordFrom,
  iiifRecordFrom,
} from '../src/holder-record.js'

test('metRecordFrom carries the catalog fields and the museum-stated page and image', () => {
  const record = metRecordFrom({
    objectID: 11417,
    title: 'Washington Crossing the Delaware',
    artistDisplayName: 'Emanuel Leutze',
    objectDate: '1851',
    medium: 'Oil on canvas',
    dimensions: '149 x 255 in. (378.5 x 647.7 cm)',
    accessionNumber: '97.34',
    creditLine: 'Gift of John Stewart Kennedy, 1897',
    isPublicDomain: true,
    primaryImage: 'https://images.metmuseum.org/CRDImages/ad/original/DP215410.jpg',
    primaryImageSmall: 'https://images.metmuseum.org/CRDImages/ad/web-large/DP215410.jpg',
    objectURL: 'https://www.metmuseum.org/art/collection/search/11417',
  })
  assert.equal(record.partner, 'met')
  assert.equal(record.accession, '97.34')
  assert.equal(record.rights.publicDomain, true)
  // primaryImageSmall (web-large) preferred; the full-res master stays behind the zoom link
  assert.match(record.imageUrl, /web-large/)
  assert.equal(record.href, 'https://www.metmuseum.org/art/collection/search/11417')
})

test('a rights-reserved object fails the gate: publicDomain false, no image claim', () => {
  const record = metRecordFrom({
    objectID: 1,
    title: 'X',
    isPublicDomain: false,
    primaryImage: '',
    objectURL: 'https://www.metmuseum.org/art/collection/search/1',
  })
  assert.equal(record.rights.publicDomain, false)
  assert.equal(record.imageUrl, null)
})

test('aicRecordFrom reads the AIC envelope and builds the record image at width 800', () => {
  const record = aicRecordFrom({
    data: {
      id: 111628,
      title: 'Nighthawks',
      artist_display: 'Edward Hopper\nAmerican, 1882–1967',
      date_display: '1942',
      medium_display: 'Oil on canvas',
      dimensions: '84.1 × 152.4 cm (33 1/8 × 60 in.)',
      main_reference_number: '1942.51',
      credit_line: 'Friends of American Art Collection',
      is_public_domain: true,
      image_id: '831a05de-d3f6-f4fa-a460-23008dd58dda',
    },
    config: { iiif_url: 'https://www.artic.edu/iiif/2' },
  })
  assert.equal(record.partner, 'artic')
  assert.equal(record.accession, '1942.51')
  assert.equal(record.rights.publicDomain, true)
  assert.match(record.imageUrl, /831a05de/)
  assert.match(record.imageUrl, /full\/800/)
  assert.equal(record.href, 'https://www.artic.edu/artworks/111628')
})

test('rijksRecordFrom composes from existing helpers', () => {
  const record = rijksRecordFrom(
    {
      identified_by: [
        {
          type: 'Name',
          content: 'The Night Watch',
          language: [{ id: 'http://vocab.getty.edu/aat/300388277' }],
          classified_as: [{ id: 'http://vocab.getty.edu/aat/300404670' }],
        },
        {
          type: 'Identifier',
          content: 'SK-C-5',
          classified_as: [{ id: 'http://vocab.getty.edu/aat/300312355' }],
        },
      ],
      produced_by: {
        timespan: [
          {
            identified_by: [
              {
                type: 'Name',
                content: '1642',
                language: [{ id: 'http://vocab.getty.edu/aat/300388277' }],
              },
            ],
          },
        ],
      },
      subject_of: [
        {
          digitally_carried_by: [
            {
              format: 'text/html',
              access_point: [
                {
                  id: 'https://www.rijksmuseum.nl/en/collection/SK-C-5',
                },
              ],
            },
          ],
        },
      ],
      shows: [
        {
          id: 'https://id.rijksmuseum.nl/202107928',
        },
      ],
    },
    {
      subject_to: [
        {
          classified_as: [
            {
              id: 'https://creativecommons.org/publicdomain/mark/1.0/',
            },
          ],
        },
      ],
    },
    {
      access_point: [
        {
          id: 'https://iiif.micr.io/rijks/CNSQg/full/max/0/default.jpg',
        },
      ],
    },
    '200107928'
  )
  assert.equal(record.partner, 'rijks')
  assert.equal(record.title, 'The Night Watch')
  assert.equal(record.accession, 'SK-C-5')
  assert.equal(record.rights.publicDomain, true)
  assert.equal(record.href, 'https://www.rijksmuseum.nl/en/collection/SK-C-5')
})

test('iiifRecordFrom passes a v3 manifest with all gate legs', () => {
  const manifest = {
    label: { en: ['A Painting'] },
    homepage: [{ id: 'https://example.org/object/123' }],
    provider: [
      {
        label: { en: ['Example Museum'] },
      },
    ],
    rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
    requiredStatement: {
      label: { en: ['Attribution'] },
      value: { en: ['Museum of Example'] },
    },
    items: [
      {
        items: [
          {
            items: [
              {
                body: {
                  service: {
                    '@id': 'https://iiif.example.org/image/base',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  const record = iiifRecordFrom(manifest)
  assert.equal(record.partner, 'iiif')
  assert.equal(record.title, 'A Painting')
  assert.equal(record.institution, 'Example Museum')
  assert.equal(record.rights.publicDomain, true)
  assert.match(record.imageUrl, /full\/800/)
  assert.equal(record.href, 'https://example.org/object/123')
})

test('iiifRecordFrom fails v2-only manifest: no-institution', () => {
  const manifest = {
    '@context': 'http://iiif.io/api/presentation/2/context.json',
    label: 'A v2 Painting',
    related: 'https://example.org/object/123',
    license: 'https://creativecommons.org/publicdomain/zero/1.0/',
    attribution: 'Museum of Example',
    sequences: [
      {
        canvases: [
          {
            images: [
              {
                resource: {
                  service: {
                    '@id': 'https://iiif.example.org/image/base',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  const record = iiifRecordFrom(manifest)
  assert.equal(record, null)
})

test('iiifRecordFrom fails v3 manifest with no rights statement', () => {
  const manifest = {
    label: { en: ['A Painting'] },
    homepage: [{ id: 'https://example.org/object/123' }],
    provider: [
      {
        label: { en: ['Example Museum'] },
      },
    ],
    // no rights
    items: [
      {
        items: [
          {
            items: [
              {
                body: {
                  service: {
                    '@id': 'https://iiif.example.org/image/base',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  const record = iiifRecordFrom(manifest)
  assert.equal(record, null)
})

test('iiifRecordFrom fails v3 manifest with two providers', () => {
  const manifest = {
    label: { en: ['A Painting'] },
    homepage: [{ id: 'https://example.org/object/123' }],
    provider: [
      {
        label: { en: ['Example Museum'] },
      },
      {
        label: { en: ['Another Museum'] },
      },
    ],
    rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
    items: [
      {
        items: [
          {
            items: [
              {
                body: {
                  service: {
                    '@id': 'https://iiif.example.org/image/base',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  const record = iiifRecordFrom(manifest)
  assert.equal(record, null)
})

test('iiifRecordFrom fails v3 manifest with no homepage', () => {
  const manifest = {
    label: { en: ['A Painting'] },
    // no homepage or related
    provider: [
      {
        label: { en: ['Example Museum'] },
      },
    ],
    rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
    items: [
      {
        items: [
          {
            items: [
              {
                body: {
                  service: {
                    '@id': 'https://iiif.example.org/image/base',
                  },
                },
              },
            ],
          },
        ],
      },
    ],
  }
  const record = iiifRecordFrom(manifest)
  assert.equal(record, null)
})
