import test from 'node:test'
import assert from 'node:assert/strict'
import {
  metRecordFrom,
  aicRecordFrom,
  rijksRecordFrom,
  iiifRecordFrom,
  gateFailure,
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
  assert.equal(record.institution, 'The Met')
  assert.equal(gateFailure(record), null)
})

test('a rights-reserved object fails the gate on non-pd-rights', () => {
  const record = metRecordFrom({
    objectID: 1,
    title: 'X',
    isPublicDomain: false,
    primaryImage: '',
    objectURL: 'https://www.metmuseum.org/art/collection/search/1',
  })
  assert.equal(record.rights.publicDomain, false)
  assert.equal(record.imageUrl, null)
  assert.equal(gateFailure(record), 'non-pd-rights')
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
  assert.equal(record.institution, 'Art Institute of Chicago')
  assert.equal(gateFailure(record), null)
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
  assert.equal(record.institution, 'Rijksmuseum')
  assert.match(record.imageUrl, /800/)
  assert.equal(gateFailure(record), null)
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
  const manifestUrl = 'https://example.org/manifest/123'
  const record = iiifRecordFrom(manifest, manifestUrl)
  assert.equal(record.partner, 'iiif')
  assert.equal(record.id, manifestUrl)
  assert.equal(record.title, 'A Painting')
  assert.equal(record.institution, 'Example Museum')
  assert.equal(record.rights.publicDomain, true)
  assert.match(record.imageUrl, /full\/800/)
  assert.equal(record.href, 'https://example.org/object/123')
  // v3 requiredStatement composes label and value when both exist
  assert.equal(record.requiredStatement, 'Attribution: Museum of Example')
  assert.equal(gateFailure(record), null)
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
  assert.equal(gateFailure(record), 'no-institution')
  // v2 attribution is free text and never yields an institution
  // but v2 does capture requiredStatement from attribution
  assert.equal(record.requiredStatement, 'Museum of Example')
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
  assert.equal(gateFailure(record), 'non-pd-rights')
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
  assert.equal(gateFailure(record), 'several-institutions')
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
  assert.equal(gateFailure(record), 'no-object-page')
})

test('iiifRecordFrom fails v3 manifest with no image', () => {
  const manifest = {
    label: { en: ['A Painting'] },
    homepage: [{ id: 'https://example.org/object/123' }],
    provider: [
      {
        label: { en: ['Example Museum'] },
      },
    ],
    rights: 'https://creativecommons.org/publicdomain/zero/1.0/',
    // no items — no image
  }
  const record = iiifRecordFrom(manifest)
  assert.equal(record.imageUrl, null)
  assert.equal(gateFailure(record), 'no-image')
})

test('gateFailure returns no-record for null or non-object input', () => {
  assert.equal(gateFailure(null), 'no-record')
  assert.equal(gateFailure(undefined), 'no-record')
  assert.equal(gateFailure({}), 'no-institution')
})

test('metRecordFrom with null returns null', () => {
  const record = metRecordFrom(null)
  assert.equal(record, null)
})

test('aicRecordFrom with null returns null', () => {
  const record = aicRecordFrom(null)
  assert.equal(record, null)
})

test('rijksRecordFrom with null returns null', () => {
  const record = rijksRecordFrom(null)
  assert.equal(record, null)
})

test('iiifRecordFrom with null returns null', () => {
  const record = iiifRecordFrom(null)
  assert.equal(record, null)
})

test('metRecordFrom with primaryImageSmall absent uses primaryImage', () => {
  const record = metRecordFrom({
    objectID: 11417,
    title: 'Washington Crossing the Delaware',
    isPublicDomain: true,
    primaryImage: 'https://images.metmuseum.org/CRDImages/ad/original/DP215410.jpg',
    // primaryImageSmall absent
    objectURL: 'https://www.metmuseum.org/art/collection/search/11417',
  })
  assert.equal(record.imageUrl, 'https://images.metmuseum.org/CRDImages/ad/original/DP215410.jpg')
  assert.equal(gateFailure(record), null)
})

test('aicRecordFrom with is_public_domain false has no imageUrl', () => {
  const record = aicRecordFrom({
    data: {
      id: 111628,
      title: 'Nighthawks',
      is_public_domain: false,
      image_id: '831a05de-d3f6-f4fa-a460-23008dd58dda',
    },
    config: { iiif_url: 'https://www.artic.edu/iiif/2' },
  })
  assert.equal(record.imageUrl, null)
  assert.equal(gateFailure(record), 'non-pd-rights')
})

test('aicRecordFrom with data.id absent has href null', () => {
  const record = aicRecordFrom({
    data: {
      // id absent
      title: 'Nighthawks',
      is_public_domain: true,
      image_id: '831a05de-d3f6-f4fa-a460-23008dd58dda',
    },
    config: { iiif_url: 'https://www.artic.edu/iiif/2' },
  })
  assert.equal(record.href, null)
})

test('rijksRecordFrom with non-PD rights has no imageUrl', () => {
  const record = rijksRecordFrom(
    {
      identified_by: [
        {
          type: 'Name',
          content: 'The Night Watch',
          language: [{ id: 'http://vocab.getty.edu/aat/300388277' }],
          classified_as: [{ id: 'http://vocab.getty.edu/aat/300404670' }],
        },
      ],
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
      // Non-PD rights: CC0 on the metadata, not the visual content
      subject_to: [
        {
          classified_as: [
            {
              id: 'https://creativecommons.org/licenses/by/4.0/',
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
  assert.equal(record.imageUrl, null)
  assert.equal(gateFailure(record), 'non-pd-rights')
})

test('rijksRecordFrom distinguishes public-domain mark from CC0 on catalogue text', () => {
  const record = rijksRecordFrom(
    {
      identified_by: [
        {
          type: 'Name',
          content: 'The Night Watch',
          language: [{ id: 'http://vocab.getty.edu/aat/300388277' }],
          classified_as: [{ id: 'http://vocab.getty.edu/aat/300404670' }],
        },
      ],
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
      // Public-domain mark on the visual item (subject_to)
      subject_to: [
        {
          classified_as: [
            {
              id: 'https://creativecommons.org/publicdomain/mark/1.0/',
            },
          ],
        },
      ],
      // The decoy: CC0 over the catalogue text (AAT 300379475), on the SAME VisualItem that carries the public-domain mark above.
      subject_of: [
        {
          classified_as: [
            {
              id: 'http://vocab.getty.edu/aat/300379475',
            },
          ],
          subject_to: [
            {
              classified_as: [
                {
                  id: 'https://creativecommons.org/publicdomain/zero/1.0/',
                },
              ],
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
  // Rights should read the public-domain mark, not CC0
  assert.equal(record.rights.label, 'public domain')
  assert.equal(gateFailure(record), null)
})
