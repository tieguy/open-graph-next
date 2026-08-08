// Library of Congress name authorities, read as a record rather than a
// header.
//
// `lcHeading` in src/dpla.js deliberately reads ONLY the authorized heading,
// from the `x-preflabel-encoded` header of a HEAD request, because that is
// all DPLA's subject search needs and the record body is 88–120 KB. DigitalNZ
// needs more: New Zealand institutions catalog under NACO-form headings that
// LC stores as VARIANTS. An NLNZ-contributed record carries NLNZ's own form —
// verified live 2026-08-08 on no2008188470, where the altLabel "Yeates, John
// Stuart, 1900-1986" is exactly the subject Alexander Turnbull Library's
// records state, while the authorized "Yeates, J. S. (John Stuart), 1900-1986"
// matches nothing in DigitalNZ at all (LUI-145). Variants ride only in the
// body, so this pays the GET the DPLA pivot avoids — about once per
// identifier ever, given the URL-keyed cache and LC's own 28-day max-age.
//
// `id.loc.gov` stays at hostLimit 1 (its robots.txt asks Crawl-delay 3 — see
// the partner-limits section in CLAUDE.md); the cache, not concurrency, is
// what makes this affordable.

import { getJson, readFacts, writeFacts } from './http.js'

const PREF = 'http://www.w3.org/2004/02/skos/core#prefLabel'
const ALT = 'http://www.w3.org/2004/02/skos/core#altLabel'

/**
 * The authorized heading and variant forms of one LC name authority, from
 * the record's own expanded JSON-LD. Pure; the fixture test rides this.
 * @returns {{heading: string, variants: string[]}|null}
 */
export function lcLabelsFromGraph(graph, id) {
  // Match the full authority URI, never `endsWith('/' + id)` — LC ships the
  // identifier twice (the authority record and `/rwo/agents/<id>` for the
  // real-world thing it names) and which comes first varies per record. The
  // same coin flip cost `lcHeadingFromGraph` 8 of 14 sampled ids before its
  // 2026-08-05 fix.
  const uri = `http://id.loc.gov/authorities/names/${id}`
  const record = (Array.isArray(graph) ? graph : []).find((n) => n['@id'] === uri)
  if (!record) return null
  const value = (v) => (v && typeof v === 'object' ? v['@value'] : v)
  const heading = value(record[PREF]?.[0])
  if (!heading) return null
  const variants = (record[ALT] ?? []).map(value).filter(Boolean)
  return { heading, variants }
}

/**
 * Fetch + parse. Null on any failure — same semantic as `lcHeading`: a
 * heading that cannot be resolved is an anchor that does not pivot, never an
 * error that costs the page.
 *
 * A PERMANENT failure is cached as a null fact, because `getJson` caches only
 * bodies and a P244 value that is not a name authority (a subject id lives
 * under `/authorities/subjects/`, not `/names/`) would otherwise re-404 on
 * every render — the one host this repo promises to ask about once ever.
 * Found live on the Yeates fixture: one warm re-render still made exactly
 * one id.loc.gov request. Same rule as the class walk's "reaches nothing is
 * a real answer, or it is re-asked forever." Transient failures (timeouts,
 * 5xx) stay uncached and are retried next run.
 */
export async function lcLabels(id) {
  try {
    const known = await readFacts('lc-labels', [id])
    if (known.has(id)) return known.get(id)
    let labels = null
    try {
      labels = lcLabelsFromGraph(await getJson(`https://id.loc.gov/authorities/names/${id}.json`), id)
    } catch (e) {
      if (!e.permanent) return null
    }
    await writeFacts('lc-labels', [[id, labels]])
    return labels
  } catch {
    return null
  }
}
