import test from 'node:test'
import assert from 'node:assert/strict'
import {
  censusQuery,
  censusRows,
  claimsFromRows,
  subclassControlQuery,
} from '../tools/census-holder-articles.mjs'
import { HOLDERS, HOLDER_STATEMENT_VARS, WORK_CLASSES, selectHolder } from '../src/holder.js'
import { HOLDER_FLAGSHIPS } from '../tools/holder-flagships.mjs'

test('the census query carries one UNION branch per HOLDERS row, generated not typed', () => {
  const q = censusQuery()
  for (const h of HOLDERS) {
    const branch = `{ ?item wdt:${h.property} ?value . BIND("${h.property}" AS ?property) }`
    assert.equal(q.split(branch).length - 1, 1, `${h.property} exactly once`)
  }
  // Generated from WORK_CLASSES, so a class joining the map joins the
  // census with no edit here.
  const values = [...WORK_CLASSES.keys()].map((c) => `wd:${c}`).join(' ')
  assert.ok(q.includes(`VALUES ?class { ${values} }`), 'census VALUES from WORK_CLASSES')
  assert.match(q, /schema:isPartOf <https:\/\/en\.wikipedia\.org\/>/)
})

test('a new holder row grows a new branch with no edit to the builder', () => {
  const stub = [...HOLDERS, { partner: 'fake', property: 'P99999', collection: 'Q1' }]
  const q = censusQuery(stub)
  assert.match(q, /\{ \?item wdt:P99999 \?value \. BIND\("P99999" AS \?property\) \}/)
})

test('the subclass control excludes direct members and walks P279+', () => {
  const q = subclassControlQuery()
  assert.match(q, /wdt:P31 \?sub \. \?sub wdt:P279\+ \?class/)
  const values = [...WORK_CLASSES.keys()].map((c) => `wd:${c}`).join(' ')
  assert.ok(q.includes(`FILTER NOT EXISTS { VALUES ?direct { ${values} } ?item wdt:P31 ?direct . }`), 'control excludes every direct class')
  assert.match(q, /COUNT\(DISTINCT \?item\)/)
  // The control counts holder-property carriers, same branches as the census.
  for (const h of HOLDERS) assert.match(q, new RegExp(`wdt:${h.property} `))
})

const binding = (qid, property, value, { collection, name = 'An Article' } = {}) => ({
  item: { value: `http://www.wikidata.org/entity/${qid}` },
  articleName: { value: name },
  property: { value: property },
  value: { value },
  ...(collection ? { collection: { value: `http://www.wikidata.org/entity/${collection}` } } : {}),
})

test('rows deduplicate the value × collection cross product WDQS returns', () => {
  const byItem = censusRows([
    binding('Q1', 'P13234', '200107928', { collection: 'Q190804' }),
    binding('Q1', 'P13234', '200107928', { collection: 'Q1820897' }),
    binding('Q1', 'P3634', '456', { collection: 'Q190804' }),
  ])
  const item = byItem.get('Q1')
  assert.equal(item.pairs.size, 2)
  assert.deepEqual([...item.collections].sort(), ['Q1820897', 'Q190804'])
})

test('claims rebuilt from census rows drive the real selectHolder — P195 tiebreak included', () => {
  // The Night Watch shape: rijks id, a second museum id, and P195 naming
  // the Met. selectHolder must run its actual precedence, not a
  // census-side re-implementation of it.
  const byItem = censusRows([
    binding('Q219831', 'P3634', '456', { collection: 'Q160236' }),
    binding('Q219831', 'P13234', '200107928', { collection: 'Q160236' }),
  ])
  const picked = selectHolder(claimsFromRows(byItem.get('Q219831')))
  // P195 = the Met here, so the Met wins over rijks precedence — proof the
  // tiebreak runs on the fabricated shape.
  assert.deepEqual(picked, { partner: 'met', property: 'P3634', id: '456' })
})

test('a fabricated statement without a rank would vanish — the shape carries rank normal', () => {
  const byItem = censusRows([binding('Q2', 'P6108', 'https://example.org/manifest')])
  const claims = claimsFromRows(byItem.get('Q2'))
  assert.equal(claims.P6108[0].rank, 'normal')
  assert.equal(selectHolder(claims)?.partner, 'iiif')
})

test('every wired museum holder has exactly one gate-clearing flagship — completeness is a test', () => {
  // The manifest convention (test/partners.test.js): an uncovered lane is a
  // red test, never a silent state. The iiif door has no flagship on
  // purpose — it names no single institution. Entries with a stated `role`
  // are each warmed for the one behavior they demonstrate (the
  // rights-disagreement refusal, the manuscript more-pages door) and sit
  // outside the one-per-lane rule, but must still name a wired lane.
  const clearing = HOLDER_FLAGSHIPS.filter((f) => !f.role).map((f) => f.partner)
  assert.deepEqual(new Set(clearing).size, clearing.length, 'no lane holds two gate-clearing flagships')
  assert.deepEqual([...new Set(clearing)].sort(), [...HOLDER_STATEMENT_VARS.keys()].sort())
  for (const f of HOLDER_FLAGSHIPS) {
    assert.ok(f.title?.length, `${f.partner} flagship has a title`)
    assert.ok(HOLDER_STATEMENT_VARS.has(f.partner), `${f.partner} is a wired lane`)
  }
})
