import test from 'node:test'
import assert from 'node:assert/strict'
import { bestRankValues, workClass, selectHolder, holderStatements, HOLDERS, HOLDER_STATEMENT_VARS } from '../src/holder.js'
import { MUSEUM_LOOKUPS } from '../src/statements.js'

// Claims fixtures in wbgetentities shape. nightWatch mirrors Q219831 as read
// 2026-08-16: P31 painting, Rijksmuseum id, two collections.
const statement = (value, rank = 'normal') => ({
  mainsnak: { datavalue: { value } },
  rank,
})
const item = (qid) => ({ id: qid })

const nightWatch = {
  P31: [statement(item('Q3305213'))],
  P13234: [statement('200107928')],
  P195: [statement(item('Q190804')), statement(item('Q1820897'))],
}

test('workClass: a painting article is detected as one', () => {
  assert.equal(workClass(nightWatch), 'painting')
})

test('workClass: a sculpture is a work; a person and an empty item are not', () => {
  assert.equal(workClass({ P31: [statement(item('Q860861'))] }), 'sculpture')
  assert.equal(workClass({ P31: [statement(item('Q5'))] }), null)
  assert.equal(workClass({}), null)
})

test('bestRankValues: preferred beats normal, deprecated never surfaces', () => {
  const claims = {
    P31: [
      statement(item('Q5'), 'deprecated'),
      statement(item('Q3305213'), 'normal'),
      statement(item('Q860861'), 'preferred'),
    ],
  }
  assert.deepEqual(bestRankValues(claims, 'P31'), ['Q860861'])
  assert.deepEqual(bestRankValues({ P31: [statement(item('Q5'), 'deprecated')] }, 'P31'), [])
})

test('selectHolder: the Night Watch selects the Rijksmuseum by its stated id', () => {
  assert.deepEqual(selectHolder(nightWatch), {
    partner: 'rijks',
    property: 'P13234',
    id: '200107928',
  })
})

test('selectHolder: with several museum ids, the museum in P195 wins over precedence', () => {
  const twoMuseums = {
    P31: [statement(item('Q3305213'))],
    P13234: [statement('123')], // rijks outranks met in HOLDERS order…
    P3634: [statement('456')],
    P195: [statement(item('Q160236'))], // …but the work hangs at the Met
  }
  assert.equal(selectHolder(twoMuseums).partner, 'met')
})

test('selectHolder: no P195 match falls back to precedence order', () => {
  const noCollection = {
    P31: [statement(item('Q3305213'))],
    P3634: [statement('456')],
    P4610: [statement('789')],
  }
  assert.deepEqual(selectHolder(noCollection), {
    partner: 'met',
    property: 'P3634',
    id: '456',
  })
})

test('selectHolder: Cleveland is selected by P195 and yields to the Met on bare precedence', () => {
  const inCleveland = {
    P31: [statement(item('Q3305213'))],
    P3634: [statement('456')],
    P11110: [statement('1944.524')],
    P195: [statement(item('Q657415'))],
  }
  assert.deepEqual(selectHolder(inCleveland), {
    partner: 'cleveland',
    property: 'P11110',
    id: '1944.524',
  })
  // Without the collection statement, HOLDERS order decides: met before cleveland.
  const noCollection = { P31: [statement(item('Q3305213'))], P3634: [statement('456')], P11110: [statement('1944.524')] }
  assert.equal(selectHolder(noCollection).partner, 'met')
})

test('selectHolder: a work with no holder identifier honestly gets none', () => {
  const inventoryOnly = {
    P31: [statement(item('Q3305213'))],
    P217: [statement('SK-C-5')],
    P195: [statement(item('Q190804'))],
  }
  assert.equal(selectHolder(inventoryOnly), null)
})

test('selectHolder: a deprecated museum id never selects a holder', () => {
  const retracted = {
    P31: [statement(item('Q3305213'))],
    P13234: [statement('999', 'deprecated')],
  }
  assert.equal(selectHolder(retracted), null)
})

test('bestRankValues: a statement with no datavalue is filtered out', () => {
  const claims = {
    P31: [
      { mainsnak: { datavalue: { value: item('Q3305213') } }, rank: 'normal' },
      { mainsnak: {}, rank: 'normal' }, // somevalue or novalue snak
    ],
  }
  assert.deepEqual(bestRankValues(claims, 'P31'), ['Q3305213'])
})

test('bestRankValues: non-entity object datavalues are filtered out', () => {
  const claims = {
    P585: [ // point in time property
      { mainsnak: { datavalue: { value: { time: '+2000-01-01T00:00:00Z' } } }, rank: 'normal' },
      { mainsnak: { datavalue: { value: item('Q123') } }, rank: 'normal' },
    ],
  }
  // Only the entity item should be returned; the time object is filtered
  assert.deepEqual(bestRankValues(claims, 'P585'), ['Q123'])
})

test('a manifest-only work selects the iiif candidate, which museums always outrank', () => {
  const manifestOnly = {
    P31: [statement(item('Q3305213'))],
    P6108: [statement('https://example.org/iiif/manifest.json')],
  }
  assert.equal(selectHolder(manifestOnly).partner, 'iiif')
  const both = { ...manifestOnly, P3634: [statement('456')] }
  assert.equal(selectHolder(both).partner, 'met')
})

test('holderStatements keeps only the museum holder’s own lookup, before any request is built', () => {
  const stmts = { met: '11417', aic: '111628', rijks: '200107928', iiif: 'https://x/m.json', inat: '1', gbif: '2', si: 'q', siName: 'NASM', coord: 'Point(1 2)' }
  // The aic seam: partner ‘artic’ binds as ‘aic’ in statements.js.
  assert.deepEqual(holderStatements(stmts, { partner: 'artic' }), { aic: '111628' })
  assert.deepEqual(holderStatements(stmts, { partner: 'rijks' }), { rijks: '200107928' })
  // A manifest holder dispatches nothing — an anchor’s P6108 points at
  // whatever institution holds THAT object.
  assert.deepEqual(holderStatements(stmts, { partner: 'iiif' }), {})
  // No holder: everything passes through untouched.
  assert.equal(holderStatements(stmts, null), stmts)
  // Holder property absent on this anchor: nothing to dispatch.
  assert.deepEqual(holderStatements({ inat: '1' }, { partner: 'met' }), {})
})

test('every museum holder has a real statement binding, and the manifest door has none', () => {
  // Three lists must agree or a holder\u2019s own anchor cards silently vanish:
  // HOLDERS (who can hold), HOLDER_STATEMENT_VARS (what may dispatch), and
  // statements.js\u2019s bindings (what CAN dispatch). Completeness is a test,
  // per the repo convention \u2014 a missing entry is a red test, never a silent
  // degradation.
  for (const h of HOLDERS) {
    if (h.partner === 'iiif') {
      assert.equal(HOLDER_STATEMENT_VARS.has('iiif'), false, 'iiif deliberately dispatches nothing')
      continue
    }
    const v = HOLDER_STATEMENT_VARS.get(h.partner)
    assert.ok(v, `${h.partner} missing from HOLDER_STATEMENT_VARS`)
    const lookup = MUSEUM_LOOKUPS.find((p) => p.var === v)
    assert.ok(lookup, `${v} is not a statements.js binding`)
    assert.equal(lookup.property, h.property, `${h.partner}: property mismatch`)
  }
})
