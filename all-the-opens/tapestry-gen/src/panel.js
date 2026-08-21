// The merged infobox and holder record panel — structured rows from Wikipedia
// and attribution per source, conflicts shown side by side rather than resolved.
// Pure over sanitized infobox HTML and a holder record; builds HTML once.
//
// Traps: FIELD_LABELS is deliberately incomplete — unmapped labels pass through.
// A conflict is defined by normalized text (lowercase, whitespace-collapsed);
// trailing parentheticals are NOT stripped, so "363 cm × 437 cm" differs from
// "363 cm × 437 cm (142.9 in × 172.0 in)" — a real difference must show.
// Holder fields without a Wikipedia counterpart append in order — creator,
// date, medium, dimensions, then accession, credit line, rights.label — so
// an infobox-less page still shows the museum's description, not only its
// bookkeeping.

import { escapeHtml } from './html.js'
import { decodeEntities } from './wikipedia.js'

/**
 * Maps infobox labels (normalized: lowercase, whitespace-collapsed) to
 * record field names. Deliberately incomplete — an unmapped label passes
 * through. location maps to null (never merged; the holder IS the location).
 * accession and credit line merge with holder-only appends; rights never
 * merge with infobox rows (infobox rights rows are rare).
 */
export const FIELD_LABELS = new Map([
  ['artist', 'creator'],
  ['year', 'date'],
  ['medium', 'medium'],
  ['dimensions', 'dimensions'],
  ['type', 'medium'], // Only if medium absent from infobox rows
  ['location', null],
  ['accession', 'accession'],
  ['credit line', 'credit'],
])

/**
 * Normalize a string for comparison: lowercase, collapse whitespace.
 */
function normalizeText(text) {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Strip hidden-span subtrees from HTML before text extraction. Covers the
 * shape MediaWiki emits for microformats: a well-formed, double-quoted
 * <span style="display: none…"> — nesting handled by counting span
 * open/close tokens. Hidden elements of other kinds (single-quoted styles,
 * non-span tags, unclosed spans) are out of scope and pass through.
 */
function stripDisplayNone(html) {
  let result = html
  let changed = true

  // The token counter below handles nesting; this loop handles SIBLING
  // hidden spans — each pass removes one subtree.
  while (changed) {
    changed = false
    // Match <span with style containing "display:none" (tolerant of semicolons/spacing)
    const regex = /<span[^>]*style="[^"]*display\s*:\s*none[^"]*"[^>]*>/gi
    let match

    if ((match = regex.exec(result))) {
      const startPos = match.index
      let pos = match.index + match[0].length
      let spanCount = 1

      // Walk forward, counting span opens and closes
      while (pos < result.length && spanCount > 0) {
        const spanOpen = result.indexOf('<span', pos)
        const spanClose = result.indexOf('</span>', pos)

        if (spanClose === -1) break // No more closes

        if (spanOpen !== -1 && spanOpen < spanClose) {
          // Found another open span before the close
          spanCount++
          pos = spanOpen + 5
        } else {
          // Found a close
          spanCount--
          pos = spanClose + 7
        }
      }

      if (spanCount === 0) {
        // Found the matching close at pos
        result = result.slice(0, startPos) + result.slice(pos)
        changed = true
      }
    }
  }

  return result
}

/**
 * Strip HTML tags and normalize whitespace for comparison text.
 * Decodes all entities and removes display:none subtrees.
 */
function htmlToText(html) {
  // Remove display:none subtrees (sanitized HTML spans)
  let cleaned = stripDisplayNone(html)

  // Strip all HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, '')

  // Decode entities (numeric, hex, and named)
  cleaned = decodeEntities(cleaned)

  // Normalize whitespace
  return cleaned.replace(/\s+/g, ' ').trim()
}

/**
 * Remove every table nested INSIDE the infobox before row-scanning. A subbox
 * is a box, not a fact row — and the row regex cannot see nesting, so its
 * non-greedy </tr> would end an outer row inside a subbox and leak the
 * subbox’s later rows as top-level facts. Innermost complete tables are
 * removed first, looping, and the infobox’s own <table> always survives:
 * while more than one <table> remains, an innermost match is necessarily a
 * nested one (the outer table’s content still contains "<table").
 */
function stripInnerTables(html) {
  let result = html
  for (;;) {
    const opens = (result.match(/<table/gi) ?? []).length
    if (opens <= 1) return result
    const m = /<table[^>]*>(?:(?!<table)[\s\S])*?<\/table>/i.exec(result)
    if (!m) return result
    result = result.slice(0, m.index) + result.slice(m.index + m[0].length)
  }
}

/**
 * Parse the sanitized infobox HTML into an array of label/value rows.
 * Skips furniture rows (header-only or image-only).
 * Returns array of { label, valueHtml, valueText }.
 * Tables nested inside the infobox (subboxes) are stripped before scanning.
 */
export function infoboxRows(html) {
  if (!html || typeof html !== 'string') return []

  const rows = []
  html = stripInnerTables(html)
  const rowPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
  let match

  while ((match = rowPattern.exec(html))) {
    const rowContent = match[1]

    // Extract th and td as siblings
    // A data row contains both a <th> and a <td>
    const thMatch = /<th[^>]*>([\s\S]*?)<\/th>/i.exec(rowContent)
    const tdMatch = /<td[^>]*>([\s\S]*?)<\/td>/i.exec(rowContent)

    // Skip if no th or no td
    if (!thMatch || !tdMatch) continue

    const thHtml = thMatch[1]
    const tdHtml = tdMatch[1]

    // Extract label text (preserve original case, for display) and entity-decode
    const labelText = decodeEntities(thHtml.replace(/<[^>]+>/g, '').trim())

    // Skip empty td
    if (!tdHtml.trim()) continue

    // Skip image-only row (only img tags)
    if (/^\s*<img[^>]*>\s*$/i.test(tdHtml.trim())) continue

    // This is a data row
    rows.push({
      label: labelText,
      valueHtml: tdHtml,
      valueText: htmlToText(tdHtml),
    })
  }

  return rows
}

/**
 * Emit a single Wikipedia-only row with the given label and content.
 */
function emitWikipediaOnlyRow(html, label, valueHtml) {
  html.push('<tr><th scope="row" class="infobox-label">')
  html.push(escapeHtml(label))
  html.push('</th><td class="infobox-data">')
  html.push(valueHtml)
  html.push(' <span class="infobox-chip">Wikipedia</span>')
  html.push('</td></tr>')
}

/**
 * Emit a dual-attributed row (Wikipedia and institution agree).
 */
function emitMatchRow(html, label, valueHtml, institution) {
  html.push('<tr><th scope="row" class="infobox-label">')
  html.push(escapeHtml(label))
  html.push('</th><td class="infobox-data">')
  html.push(valueHtml)
  html.push(' <span class="infobox-chip">Wikipedia</span>')
  if (institution) {
    html.push(' <span class="infobox-chip">')
    html.push(escapeHtml(institution))
    html.push('</span>')
  }
  html.push('</td></tr>')
}

/**
 * Emit a conflict pair: first row with Wikipedia value, second with holder value.
 */
function emitConflictRows(html, label, wikiHtml, holderValue, institution) {
  html.push('<tr><th scope="row" class="infobox-label">')
  html.push(escapeHtml(label))
  html.push('</th><td class="infobox-data infobox-conflict">')
  html.push(wikiHtml)
  html.push(' <span class="infobox-chip">Wikipedia</span>')
  html.push('</td></tr>')

  html.push('<tr><th scope="row" class="infobox-label"></th><td class="infobox-data infobox-conflict">')
  html.push(escapeHtml(holderValue))
  if (institution) {
    html.push(' <span class="infobox-chip">')
    html.push(escapeHtml(institution))
    html.push('</span>')
  }
  html.push('</td></tr>')
}

/**
 * Emit a holder-only row (typically accession, credit, or rights).
 */
function emitHolderRow(html, label, value, institution) {
  html.push('<tr><th scope="row" class="infobox-label">')
  html.push(escapeHtml(label))
  html.push('</th><td class="infobox-data">')
  html.push(escapeHtml(value))
  if (institution) {
    html.push(' <span class="infobox-chip">')
    html.push(escapeHtml(institution))
    html.push('</span>')
  }
  html.push('</td></tr>')
}

/**
 * Merge infobox rows with holder record, detecting conflicts and creating
 * a merged panel. Returns HTML for one <table class="infobox holder-panel">.
 * Returns empty string if no rows are emitted.
 *
 * A <tr> contains both a <th> (label) and a <td> (value).
 * Accession and credit line may merge with infobox rows or append as
 * holder-only fields if no infobox row mapped to that field.
 *
 * `workRights` is the graph's copyright answer about the WORK, prebuilt by
 * the renderer as `{ line, fold }` (the same trusted-HTML contract as the
 * sanitized infobox valueHtml): the panel places the parts, it never builds
 * or judges them, so every copy rule about rights lives in one place. It
 * renders as the Copyright block's second voice — line, then the Wikidata
 * chip touching the claim it attributes, then the fold, so the attribution
 * never drifts below an opened fold.
 */
export function mergedPanel(rows, record, workRights = null) {
  if (!record || typeof record !== 'object') {
    return ''
  }

  const html = []
  let hasContent = false
  const consumedFields = new Set() // Track which holder fields were consumed by infobox rows

  // Check if there's a Medium row in the infobox
  const hasMediumRow = rows.some(row => normalizeText(row.label) === 'medium')

  // Process infobox rows
  for (const row of rows) {
    // Normalize label for lookup
    const normalizedLabel = normalizeText(row.label)
    let mappedField = FIELD_LABELS.get(normalizedLabel)

    // Special case: type→medium only if no Medium row exists
    if (normalizedLabel === 'type' && hasMediumRow) {
      mappedField = undefined // Force pass-through
    }

    // Get record value for this field (if any)
    const recordValue = mappedField ? record[mappedField] : undefined

    // A record field is spent the first time a row maps to it: a second row
    // mapping to the same field passes through Wikipedia-only, so the
    // holder’s single value never prints twice.
    const alreadyConsumed = mappedField ? consumedFields.has(mappedField) : false
    if (mappedField) {
      consumedFields.add(mappedField)
    }

    // If no mapping, no record value, or the field is spent: Wikipedia-only row
    if (!mappedField || !recordValue || alreadyConsumed) {
      emitWikipediaOnlyRow(html, row.label, row.valueHtml)
      hasContent = true
      continue
    }

    // Normalize both texts for comparison (lowercase, whitespace-collapsed)
    const wikiText = normalizeText(row.valueText)
    const recordText = normalizeText(String(recordValue))

    // If texts match: dual-attributed row
    if (wikiText === recordText) {
      emitMatchRow(html, row.label, row.valueHtml, record.institution)
      hasContent = true
      continue
    }

    // Conflict: show both values as adjacent rows
    emitConflictRows(html, row.label, row.valueHtml, recordValue, record.institution)
    hasContent = true
  }

  // Append holder-only fields (only if not already consumed by an infobox row)
  // Description before bookkeeping: an infobox-less page (the manuscript
  // population's usual shape — Template:Infobox artwork is near-universal
  // only on painting articles) must still show the record's creator, date,
  // medium and dimensions, not a bookkeeping-only panel beside a hero that
  // prints them. A field an infobox row already merged stays merged
  // (consumedFields below); these append only where Wikipedia offered no
  // counterpart, and the list is a closed set — holder facts outside it
  // are not shown.
  const holderOnlyFields = [
    { key: 'creator', label: 'Creator' },
    { key: 'date', label: 'Date' },
    { key: 'medium', label: 'Medium' },
    { key: 'dimensions', label: 'Dimensions' },
    { key: 'accession', label: 'Accession' },
    { key: 'credit', label: 'Credit line' },
  ]

  for (const { key, label } of holderOnlyFields) {
    const value = record[key]
    if (value && !consumedFields.has(key)) {
      emitHolderRow(html, label, value, record.institution)
      hasContent = true
    }
  }

  // The Copyright block closes the panel, two-voiced by design. The
  // institution's clause is about the image its record releases — what the
  // gate read — and says so; the graph's clause is about the work or its
  // creator and names its own subject (the renderer builds it from the
  // same view the lede status line renders elsewhere). Different objects,
  // so the rows are deliberately NOT a conflict pair: neither claim
  // contradicts the other, and styling them as a disagreement would
  // misstate the copy/work split this project keeps.
  const imageClause = record.rights?.label ? `This image: ${record.rights.label}` : null
  if (imageClause) {
    emitHolderRow(html, 'Copyright', imageClause, record.institution)
    hasContent = true
  }
  if (workRights?.line) {
    html.push('<tr><th scope="row" class="infobox-label">')
    // The label prints once for the block, visibly: on the image row when
    // the record states one, else here. A screen reader still hears this
    // row labeled — an empty header would leave the second claim nameless.
    html.push(imageClause ? '<span class="vh">Copyright</span>' : 'Copyright')
    html.push('</th><td class="infobox-data">')
    html.push(workRights.line)
    html.push(' <span class="infobox-chip">Wikidata</span>')
    html.push(workRights.fold ?? '')
    html.push('</td></tr>')
    hasContent = true
  }

  // Return empty string if no rows were emitted
  if (!hasContent) {
    return ''
  }

  // Wrap in table
  return '<table class="infobox holder-panel"><tbody>' + html.join('') + '</tbody></table>'
}
