// Library of Congress authorities: the single home for turning a P244 id into
// the heading strings partners catalog under. Shared infrastructure, not a
// partner module — DPLA and DigitalNZ both key on it.
//
// **Two entry points, and the difference is cost, not duplication. Pick
// deliberately:**
//
// - `lcHeading(id)` — the AUTHORIZED form only, from the `x-preflabel-encoded`
//   header of a HEAD request. Cheap. All DPLA's subject search needs.
// - `lcLabels(id)` — the authorized form AND its variants, which ride only in
//   the 88–120 KB record body. Pays a GET.
//
// Consolidated here 2026-08-10: `lcBranch`/`decodeLcHeading`/
// `lcHeadingFromGraph`/`lcHeading` lived in `dpla.js` and this module imported
// `lcBranch` back out of it, so shared LC code depended on one partner's file
// and a reader had to know both to know which lookup they wanted.
//
// Why the cheap one exists: the LC lookup is the single longest serial chain on
// a cold page (27 requests on Angkor Wat), and DigitalNZ needs more: New Zealand institutions catalog under NACO-form headings that
// LC stores as VARIANTS. An NLNZ-contributed record carries NLNZ's own form —
// verified live 2026-08-08 on no2008188470, where the altLabel "Yeates, John
// Stuart, 1900-1986" is exactly the subject Alexander Turnbull Library's
// records state, while the authorized "Yeates, J. S. (John Stuart), 1900-1986"
// matches nothing in DigitalNZ at all (LUI-145). Variants ride only in the
// body, so this pays the GET the DPLA lookup avoids — about once per
// identifier ever, given the URL-keyed cache and LC's own 28-day max-age.
//
// `id.loc.gov` stays at hostLimit 1 (its robots.txt asks Crawl-delay 3 — see
// the partner-limits section in CLAUDE.md); the cache, not concurrency, is
// what makes this affordable.

import { getHeader, getJson, readFacts, writeFacts } from './http.js'

const PREF = 'http://www.w3.org/2004/02/skos/core#prefLabel'
const ALT = 'http://www.w3.org/2004/02/skos/core#altLabel'

/** Subject ids (sh…, sj…, gf…) live under /subjects/, name authorities under /names/. */
export const lcBranch = (id) => (/^(sh|sj|gf)/.test(id) ? 'subjects' : 'names')

const lcUrl = (id) => `https://id.loc.gov/authorities/${lcBranch(id)}/${id}`

/**
 * The authorized heading for an LC authority id, read off the JSON-LD graph.
 * Returns null when the service answers strangely — a missing heading just
 * means no lookup, never a guessed one.
 *
 * Matched on the WHOLE authority URI, never on "@id ends with /<id>". LC ships
 * the identifier twice: once as the authority record, which carries the
 * heading, and once as `id.loc.gov/rwo/agents/<id>` for the real-world thing it
 * names, which carries none. The loose match hit both and `find` took whichever
 * came first — and that order varies per record, so n80014970 (Cambodia)
 * resolved while n79006404 (France) returned null, silently costing the page
 * every DPLA card under that anchor. 8 of 14 sampled ids lost that coin flip.
 */
export function lcHeadingFromGraph(graph, id) {
  if (!Array.isArray(graph) || typeof id !== 'string') return null
  const uri = `/authorities/${lcBranch(id)}/${id}`
  const node = graph.find((n) => typeof n?.['@id'] === 'string' && n['@id'].endsWith(uri))
  const label =
    node?.['http://www.w3.org/2004/02/skos/core#prefLabel']?.[0]?.['@value'] ??
    node?.['http://www.loc.gov/mads/rdf/v1#authoritativeLabel']?.[0]?.['@value'] ??
    null
  return typeof label === 'string' ? label : null
}

/**
 * The percent-encoded heading LC sends beside the plain one, as text.
 *
 * `x-preflabel` is unusable for anything but ASCII: HTTP headers are Latin-1
 * and LC writes UTF-8 bytes, so "Cœdès, George" arrives as "CÅdÃ¨s, George"
 * and would go to DPLA as a subject-name query matching nothing — a silent
 * empty shelf that reads exactly like an anchor nobody holds anything under.
 * `x-preflabel-encoded` is LC's own answer to that, and round-trips exactly.
 */
export function decodeLcHeading(encoded) {
  if (typeof encoded !== 'string' || !encoded) return null
  try {
    return decodeURIComponent(encoded)
  } catch {
    // A malformed sequence is not a heading, and must not throw mid-page.
    return null
  }
}

/**
 * The authorized heading, asked the cheap way first.
 *
 * id.loc.gov answers a HEAD with the heading in a header, on a 303, so the
 * usual 88–120 KB of JSON-LD buys nothing this caller reads. That matters
 * because the LC lookup is the single longest serial chain on a cold page (27
 * requests on Angkor Wat) and `id.loc.gov` publishes `Crawl-delay: 3` — the
 * request has to get cheaper rather than more concurrent. The body is fetched
 * only when the header is missing, which is the rare case.
 */
export async function lcHeading(id) {
  const fromHeader = decodeLcHeading(await getHeader(lcUrl(id), 'x-preflabel-encoded'))
  if (fromHeader) return fromHeader
  return lcHeadingFromGraph(await getJson(`${lcUrl(id)}.json`), id)
}

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
  const uri = `http://id.loc.gov/authorities/${lcBranch(id)}/${id}`
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
 * heading that cannot be resolved is an anchor that is not looked up, never an
 * error that costs the page.
 *
 * A PERMANENT failure is cached as a null fact, because `getJson` caches only
 * bodies and a retracted or malformed P244 value would otherwise re-404 on
 * every render — the one host this repo promises to ask about once ever.
 * Found live on the Yeates fixture: one warm re-render still made exactly
 * one id.loc.gov request. Same rule as the class walk's "reaches nothing is
 * a real answer, or it is re-asked forever." Transient failures (timeouts,
 * 5xx) stay uncached and are retried next run.
 *
 * Topical ids (sh…) branch to `/authorities/subjects/` via `lcBranch`, the
 * same routing `lcHeading` already does. Until 2026-08-08 this module
 * hardcoded `/names/`, so every topical anchor — Moon, Astronauts, Space
 * flight — 404ed silently and was fact-cached as null: the DigitalNZ lookup
 * never fired on a topical heading at all, and nobody saw it fail. A stale
 * null for an sh id may linger in a pre-fix cache; deleting `.cache/` is,
 * as ever, the whole reset.
 */
export async function lcLabels(id) {
  try {
    const known = await readFacts('lc-labels', [id])
    if (known.has(id)) return known.get(id)
    let labels = null
    try {
      labels = lcLabelsFromGraph(await getJson(`https://id.loc.gov/authorities/${lcBranch(id)}/${id}.json`), id)
    } catch (e) {
      if (!e.permanent) return null
    }
    await writeFacts('lc-labels', [[id, labels]])
    return labels
  } catch {
    return null
  }
}
