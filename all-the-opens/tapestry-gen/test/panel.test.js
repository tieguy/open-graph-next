import test from 'node:test'
import assert from 'node:assert/strict'
import { infoboxRows, mergedPanel } from '../src/panel.js'

// Minimal infobox fixture from the plan
const BOX = `<table class="infobox"><tbody>
  <tr><th>Artist</th><td><a href="/wiki/Rembrandt">Rembrandt</a></td></tr>
  <tr><th>Year</th><td>1642</td></tr>
  <tr><th>Medium</th><td>Oil on canvas</td></tr>
  <tr><th>Dimensions</th><td>363 cm × 437 cm (142.9 in × 172 in)</td></tr>
  <tr><th>Location</th><td>Rijksmuseum, Amsterdam</td></tr>
</tbody></table>`

// Fixture with furniture rows and nested table (based on plan requirements)
const FURNITURE_BOX = `<table class="infobox"><tbody>
  <tr><th colspan="2">The Night Watch</th></tr>
  <tr><td colspan="2"><img src="x"></td></tr>
  <tr><th>Artist</th><td>Rembrandt</td></tr>
  <tr><td colspan="2"><table><tr><td>Nested</td></tr></table></td></tr>
  <tr><th>Year</th><td>1642</td></tr>
</tbody></table>`

// Fixture with Type but no Medium (type should map to record.medium)
const TYPE_NO_MEDIUM = `<table class="infobox"><tbody>
  <tr><th>Artist</th><td>Rembrandt</td></tr>
  <tr><th>Type</th><td>Oil painting</td></tr>
</tbody></table>`

// Fixture with both Type and Medium (Type should pass through)
const TYPE_AND_MEDIUM = `<table class="infobox"><tbody>
  <tr><th>Artist</th><td>Rembrandt</td></tr>
  <tr><th>Medium</th><td>Oil on canvas</td></tr>
  <tr><th>Type</th><td>Oil painting</td></tr>
</tbody></table>`

// Real fixture from Night Watch (2026-08-16): Year with display:none span and nested span
// Tests C1 (nesting-aware display:none stripping)
const YEAR_WITH_DISPLAY_NONE = `<table class="infobox"><tbody>
  <tr><th scope="row" class="infobox-label">Year</th><td class="infobox-data">1642<span style="display: none;">&#160;(<span class="bday dtstart published updated itvstart">1642</span>)</span></td></tr>
  <tr><th scope="row" class="infobox-label">Dimensions</th><td class="infobox-data">363&#160;cm&#32;×&#160;437&#160;cm</td></tr>
</tbody></table>`

// Real fixture with entity-decoded label (NEW-2)
const LABEL_WITH_ENTITY = `<table class="infobox"><tbody>
  <tr><th>Alma&#160;mater</th><td>University</td></tr>
</tbody></table>`

// Fixture with two-row nested table (NEW-3)
const NESTED_TABLE_FIXTURE = `<table class="infobox"><tbody>
  <tr><th>Artist</th><td>Rembrandt</td></tr>
  <tr><th>Details</th><td>
    <table><tr><td>Outer row</td></tr><tr><td>Second row</td></tr></table>
  </td></tr>
  <tr><th>Medium</th><td>Oil on canvas</td></tr>
</tbody></table>`

// Hand-built in the real Nighthawks shape; the Accession row is VERBATIM
// extractInfobox output from .cache/91baff60c1937d4b.json (read 2026-08-17) —
// the &#160; and the Wikidata edit-pencil markup are what valueText must
// survive to yield "1942.51".
const NIGHTHAWKS_BOX = `<table class="infobox"><tbody>
  <tr><th scope="row" class="infobox-label">Artist</th><td class="infobox-data"><a href="/wiki/Edward_Hopper">Edward Hopper</a></td></tr>
  <tr><th scope="row" class="infobox-label">Year</th><td class="infobox-data">1942</td></tr>
  <tr><th scope="row" class="infobox-label">Medium</th><td class="infobox-data"><a href="/wiki/Oil_painting">Oil on canvas</a></td></tr>
  <tr><th scope="row" class="infobox-label">Dimensions</th><td class="infobox-data">84.1 cm (33.1 in) × 152.4 cm (60.0 in)</td></tr>
  <tr><th scope="row" class="infobox-label">Location</th><td class="infobox-data">Art Institute of Chicago</td></tr>
  <tr><th scope="row" class="infobox-label" style="padding-right:0.65em;">Accession</th><td class="infobox-data">1942.51&#160;<span class="penicon autoconfirmed-show"><span class="mw-valign-text-top" typeof="mw:File/Frameless"><a href="https://www.wikidata.org/wiki/Q83872?uselang=en#P217" title="Edit this on Wikidata"><img alt="Edit this on Wikidata" src="https://upload.wikimedia.org/wikipedia/en/thumb/8/8a/OOjs_UI_icon_edit-ltr-progressive.svg/20px-OOjs_UI_icon_edit-ltr-progressive.svg.png" decoding="async" width="10" height="10" class="mw-file-element" data-file-width="20" data-file-height="20" /></a></span></span></td></tr>
</tbody></table>`

test('infoboxRows reads each label/value pair and keeps the value markup', () => {
  const rows = infoboxRows(BOX)
  assert.equal(rows.length, 5)
  assert.equal(rows[0].label, 'Artist')
  assert.match(rows[0].valueHtml, /Rembrandt/)
  assert.equal(rows[1].valueText, '1642')
})

test('a header-only or image-only row is furniture, not a fact row', () => {
  const rows = infoboxRows(`<table><tbody>
    <tr><th colspan="2">The Night Watch</th></tr>
    <tr><td colspan="2"><img src="x"></td></tr>
    <tr><th>Year</th><td>1642</td></tr>
  </tbody></table>`)
  assert.deepEqual(rows.map((r) => r.label), ['Year'])
})

test('a row with a nested table is skipped (subbox, not a fact)', () => {
  const rows = infoboxRows(FURNITURE_BOX)
  // Should skip the header row, image row, and nested table row
  assert.deepEqual(rows.map((r) => r.label), ['Artist', 'Year'])
})

test('a field both sides state identically renders once, dual-attributed', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    partner: 'rijks', institution: 'Rijksmuseum',
    title: 'The Night Watch', creator: 'Rembrandt van Rijn',
    date: '1642', medium: 'Oil on canvas',
    dimensions: '379.5 cm × 453.5 cm', accession: 'SK-C-5',
    credit: null, rights: { publicDomain: true, label: 'Public domain' },
  })
  // Medium agrees: one row, both chips
  assert.match(html, /Oil on canvas/)
  assert.match(html, /Wikipedia/)
  assert.match(html, /Rijksmuseum/)
  // Dimensions disagree: both values present, each attributed
  assert.match(html, /363 cm/)
  assert.match(html, /379\.5 cm/)
  // Holder-only fields appear under the holder's name
  assert.match(html, /SK-C-5/)
})

test('dimension values with non-breaking spaces decode correctly (no false conflict)', () => {
  // Night Watch Wikipedia dimensions with potential entity encoding
  const boxWithEntity = `<table class="infobox"><tbody>
    <tr><th>Dimensions</th><td>363&#160;cm × 437&#160;cm</td></tr>
  </tbody></table>`
  const html = mergedPanel(infoboxRows(boxWithEntity), {
    institution: 'Museum', partner: 'test',
    dimensions: '363 cm × 437 cm'
  })
  // Should NOT have two rows (conflict) — should agree
  const rows = (html.match(/<tr>/g) || []).length
  assert.equal(rows, 1, 'identical dimensions should render as one dual-attributed row')
})

test('an infobox row with no holder counterpart passes through under Wikipedia’s name', () => {
  const html = mergedPanel(infoboxRows(BOX), { partner: 'rijks', institution: 'Rijksmuseum', rights: {} })
  assert.match(html, /Location/)
  assert.match(html, /Rijksmuseum, Amsterdam/)
})

test('a missing institution guard skips the chip rather than printing undefined', () => {
  const html = mergedPanel(infoboxRows(BOX), { partner: 'test', rights: {} })
  // Should not contain "undefined"
  assert(!html.includes('undefined'), 'Should not contain undefined when institution is missing')
})

test('Type maps to medium only when no Medium row exists', () => {
  const html = mergedPanel(infoboxRows(TYPE_NO_MEDIUM), {
    institution: 'Museum', partner: 'test', medium: 'Oil painting'
  })
  // Type should map to medium, comparing Wikipedia's Type value against record.medium
  // Since they both say "Oil painting" (when normalized), they should render as dual-attributed
  assert.match(html, /Oil painting/)
  // Type label should appear (it's the field name being displayed)
  assert.match(html, />Type</)
})

test('Type passes through when Medium row exists', () => {
  const html = mergedPanel(infoboxRows(TYPE_AND_MEDIUM), {
    institution: 'Museum', partner: 'test', medium: 'Oil on canvas'
  })
  // Both Type and Medium should appear as separate rows
  assert.match(html, /Oil on canvas/)
  assert.match(html, /Oil painting/)
  assert.match(html, />Type</)
})

test('conflict rows render as two adjacent rows, each with exactly one chip', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    institution: 'Museum', partner: 'test',
    dimensions: '379.5 cm × 453.5 cm'
  })
  // Find the Dimensions conflict
  const rows = html.split('<tr>')
  const dimensionRows = rows.filter(r => r.includes('363 cm') || r.includes('379.5 cm'))
  assert.equal(dimensionRows.length, 2, 'conflict should render as two rows')
  // Check that each has exactly one chip
  for (const row of dimensionRows) {
    const chipCount = (row.match(/<span class="infobox-chip">/g) || []).length
    assert.equal(chipCount, 1, 'each conflict row should have exactly one chip')
  }
})

test('conflict rows are adjacent (second carries an empty header cell)', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    institution: 'Museum', partner: 'test',
    dimensions: '379.5 cm × 453.5 cm'
  })
  // Parse HTML to check structure
  const trRows = html.split('</tr>').filter(r => r.trim().length > 0)
  // Find the conflict pair
  let foundConflict = false
  for (let i = 0; i < trRows.length - 1; i++) {
    if (trRows[i].includes('363 cm')) {
      const nextRow = trRows[i + 1]
      // The continuation row keeps the header-cell shape every other row
      // uses, empty — so assistive tech meets a labeled table, not a value
      // floating without a header.
      assert.match(nextRow, /<th scope="row" class="infobox-label"><\/th>/, 'second conflict row keeps the empty header cell')
      foundConflict = true
      break
    }
  }
  assert(foundConflict, 'should find conflict pair')
})

test('holder-only fields (accession, credit, rights) append at end', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    institution: 'Rijksmuseum', partner: 'rijks',
    creator: 'Rembrandt van Rijn',
    accession: 'SK-C-5',
    credit: 'Gift of the Dutch State, 1808',
    rights: { label: 'Public domain' }
  })
  // Should contain accession, credit, and rights labels
  assert.match(html, />Accession</)
  assert.match(html, />Credit line</)
  assert.match(html, />Rights</)
  assert.match(html, /SK-C-5/)
  assert.match(html, /Gift of the Dutch State/)
  assert.match(html, /Public domain/)
})

test('returns empty string when no rows are emitted', () => {
  // No rows, a record with nothing to append: the hasContent branch, not
  // the null-record guard.
  assert.equal(mergedPanel([], { institution: 'M' }), '')
  // The guard too, for completeness.
  assert.equal(mergedPanel(infoboxRows(BOX), null), '')
})

test('infobox rows render with Wikipedia chips when record has no matching fields', () => {
  const html = mergedPanel(infoboxRows(BOX), { institution: 'Museum', partner: 'test' })
  // Should still show the infobox rows with Wikipedia attribution
  assert.match(html, /Artist/)
  assert.match(html, /Wikipedia/)
  // Should still have content (not empty)
  assert.notEqual(html, '')
})

test('multiple simultaneous conflicts render with separate row pairs', () => {
  const multiConflictBox = `<table class="infobox"><tbody>
    <tr><th>Year</th><td>1642</td></tr>
    <tr><th>Medium</th><td>Oil on canvas</td></tr>
    <tr><th>Dimensions</th><td>363 cm × 437 cm</td></tr>
  </tbody></table>`
  const html = mergedPanel(infoboxRows(multiConflictBox), {
    institution: 'Museum', partner: 'test',
    date: '1641',  // conflict
    medium: 'Oil on wood',  // conflict
    dimensions: '400 cm × 500 cm'  // conflict
  })
  // Should have 6 rows (3 conflicts × 2 rows each)
  const trCount = (html.match(/<tr>/g) || []).length
  assert.equal(trCount, 6, 'three conflicts should render as six rows')
})

test('emits wiki-skin HTML attributes on rows and cells', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    institution: 'Museum', partner: 'test',
    creator: 'Rembrandt'
  })
  // Should have th with scope="row" and class="infobox-label"
  assert.match(html, /<th scope="row" class="infobox-label">/)
  // Should have td with class="infobox-data"
  assert.match(html, /<td class="infobox-data">/)
})

test('wraps output in table with holder-panel class', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    institution: 'Museum', partner: 'test',
    creator: 'Rembrandt'
  })
  assert.match(html, /<table class="infobox holder-panel">/)
  assert.match(html, /<\/table>$/)
})

test('all-null record fields render pass-through rows only', () => {
  const html = mergedPanel(infoboxRows(BOX), {
    institution: 'Museum', partner: 'test',
    creator: null, date: null, medium: null, dimensions: null
  })
  // Should still show the infobox rows, all with Wikipedia chip only
  assert.match(html, /Artist/)
  assert.match(html, /Rembrandt/)
  assert(html.includes('Wikipedia'), 'should have Wikipedia chip')
  // Should not have conflict rows
  assert(!html.includes('infobox-conflict'), 'all-null record should have no conflicts')
})

test('valueText is not lowercased in output (only for comparison)', () => {
  const boxWithCase = `<table class="infobox"><tbody>
    <tr><th>Artist</th><td>REMBRANDT</td></tr>
  </tbody></table>`
  const html = mergedPanel(infoboxRows(boxWithCase), {
    institution: 'Museum', partner: 'test',
    creator: 'rembrandt'  // same when lowercased
  })
  // Should render REMBRANDT, not lowercased
  assert.match(html, /REMBRANDT/)
  assert(!html.includes('rembrandt'), 'output should preserve case')
})

test('C1: Year with display:none nested span strips correctly (real Night Watch fixture)', () => {
  const rows = infoboxRows(YEAR_WITH_DISPLAY_NONE)
  const yearRow = rows.find(r => r.label === 'Year')
  // The display:none span and its nested content should be stripped
  assert.equal(yearRow.valueText, '1642', 'valueText should strip display:none and nested spans')
  // Verify that merging works correctly when record matches this cleaned value
  const html = mergedPanel(rows, {
    institution: 'Museum', partner: 'test',
    date: '1642'
  })
  // Should be a single match row with both chips, no conflict
  assert(!html.includes('infobox-conflict'), 'matching year should not create conflict')
  assert.match(html, /Wikipedia/)
  assert.match(html, /Museum/)
})

test('NEW-2: labels are entity-decoded before display', () => {
  const rows = infoboxRows(LABEL_WITH_ENTITY)
  const almaRow = rows.find(r => r.label.includes('mater'))
  // The label should have the entity decoded (&#160; → space)
  assert.match(almaRow.label, /Alma\s+mater/, 'label should have entity decoded')
})

test('NEW-3: nested tables are stripped from row content', () => {
  const rows = infoboxRows(NESTED_TABLE_FIXTURE)
  // Should find Artist and Medium rows
  const labels = rows.map(r => r.label)
  assert(labels.includes('Artist'), 'should have Artist row')
  assert(labels.includes('Medium'), 'should have Medium row')
  // Should NOT find a Details row with nested table content
  const detailsRow = rows.find(r => r.label === 'Details')
  assert(!detailsRow, 'row with nested table should be skipped after stripping')
})

test('NEW-1/NEW-5: accession field merges with infobox and holder values do not repeat', () => {
  const rows = infoboxRows(NIGHTHAWKS_BOX)
  const accessionRow = rows.find(r => r.label === 'Accession')
  assert.equal(accessionRow.valueText, '1942.51', 'infobox accession found')

  // Merge with record that has same accession
  const html = mergedPanel(rows, {
    institution: 'Art Institute of Chicago', partner: 'aic',
    creator: 'Edward Hopper', date: '1942', medium: 'Oil on canvas',
    accession: '1942.51'  // same as Wikipedia
  })

  // Should have exactly ONE Accession row (the merged one from infobox)
  const accessionCount = (html.match(/>Accession</g) || []).length
  assert.equal(accessionCount, 1, 'accession should appear only once (merged, not appended)')

  // That row should have both chips since values match
  assert.match(html, /Wikipedia/)
  assert.match(html, /Art Institute of Chicago/)
})

// The subbox leak case: a nested table whose rows carry <th> cells must not
// surface as top-level fact rows (the row regex cannot see nesting; the
// whole-body inner-table strip is what protects this).
test('a subbox with its own th rows contributes no fact rows', () => {
  const box = `<table class="infobox"><tbody>
    <tr><th>Artist</th><td>Rembrandt</td></tr>
    <tr><td colspan="2"><table class="infobox-subbox"><tbody>
      <tr><th>Height</th><td>363 cm</td></tr>
      <tr><th>Width</th><td>437 cm</td></tr>
    </tbody></table></td></tr>
    <tr><th>Medium</th><td>Oil on canvas</td></tr>
  </tbody></table>`
  assert.deepEqual(infoboxRows(box).map((r) => r.label), ['Artist', 'Medium'])
})

// A record field consumed by one row never repeats: the second row mapping
// to the same field passes through Wikipedia-only, so the museum\u2019s single
// figure is stated once.
test('two rows mapping to one record field print the holder\u2019s value once', () => {
  const box = `<table class="infobox"><tbody>
    <tr><th>Dimensions</th><td>363 cm \u00d7 437 cm</td></tr>
    <tr><th>Dimensions</th><td>142.9 in \u00d7 172 in</td></tr>
  </tbody></table>`
  const html = mergedPanel(infoboxRows(box), {
    institution: 'M',
    dimensions: '363 cm \u00d7 437 cm',
  })
  const holderChips = (html.match(/<span class="infobox-chip">M<\/span>/g) ?? []).length
  assert.equal(holderChips, 1)
  const rows = (html.match(/<tr>/g) ?? []).length
  assert.equal(rows, 2)
})
