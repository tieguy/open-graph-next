#!/usr/bin/env node
/**
 * The offline holder census: every English Wikipedia work-article whose
 * subject carries a HOLDERS property, materialized to a dated JSON file
 * under ../docs/data/. Nothing at request time reads it — it exists so the
 * QA window can sample from a checked-in population and so coverage claims
 * cite a file rather than a memory.
 *
 *   WIKIMEDIA_UA_CONTACT=you@example.com node tools/census-holder-articles.mjs
 *
 * The query is GENERATED from HOLDERS + WORK_CLASSES so the census can
 * never drift from what the pipeline detects; a new holder row grows a new
 * UNION branch with no edit here. A re-run writes a new dated file and
 * overwrites nothing — the doc that cites a number cites the file that
 * produced it.
 *
 * Per-holder attribution imports selectHolder rather than re-implementing
 * precedence: each item's rows are folded back into the minimal claims
 * shape it reads (rank 'normal' is load-bearing — bestRankValues drops
 * rankless statements silently, and 'normal' is correct because wdt:
 * already served best-rank values only).
 *
 * The subclassControl count is the measured cost of the direct-P31
 * narrowing: articles whose subject is P31 of a SUBCLASS of a work class
 * (never the class itself) while carrying a holder property. The
 * flag-default writeup must cite it.
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { HOLDERS, WORK_CLASSES, selectHolder } from '../src/holder.js'
import { getJson } from '../src/http.js'
import { wdqsSparqlUrl } from '../src/statements.js'

const OUT_DIR = fileURLToPath(new URL('../../docs/data/', import.meta.url))

/** One UNION branch per holder row — generated, never typed. */
const unionBranches = (holders) =>
  holders
    .map((h) => `{ ?item wdt:${h.property} ?value . BIND("${h.property}" AS ?property) }`)
    .join(' UNION ')

const classValues = (classes) => [...classes.keys()].map((q) => `wd:${q}`).join(' ')

/** The census query: every enwiki work-article carrying a HOLDERS property. */
export function censusQuery(holders = HOLDERS, classes = WORK_CLASSES) {
  return (
    `SELECT ?item ?articleName ?property ?value ?collection WHERE { ` +
    `VALUES ?class { ${classValues(classes)} } ` +
    `?item wdt:P31 ?class . ` +
    `?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> ; schema:name ?articleName . ` +
    `OPTIONAL { ?item wdt:P195 ?collection } ` +
    unionBranches(holders) +
    ` }`
  )
}

/**
 * The narrowing control: enwiki articles whose subject is P31 of a
 * SUBCLASS of a work class — direct members excluded — carrying a holder
 * property. A count, not rows: its job is one number in the census file.
 */
export function subclassControlQuery(holders = HOLDERS, classes = WORK_CLASSES) {
  const values = classValues(classes)
  return (
    `SELECT (COUNT(DISTINCT ?item) AS ?n) WHERE { ` +
    `VALUES ?class { ${values} } ` +
    `?item wdt:P31 ?sub . ?sub wdt:P279+ ?class . ` +
    `FILTER NOT EXISTS { VALUES ?direct { ${values} } ?item wdt:P31 ?direct . } ` +
    `?article schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> . ` +
    unionBranches(holders) +
    ` }`
  )
}

const wdqs = wdqsSparqlUrl

const qidFromUri = (uri) => uri?.split('/').pop() ?? null

/**
 * Fold WDQS rows back into per-(item, property, value) census rows plus a
 * per-item collections set. WDQS returns the cross product of values and
 * collections, so rows deduplicate on (qid, property, value).
 */
export function censusRows(bindings) {
  const byItem = new Map()
  for (const b of bindings) {
    const qid = qidFromUri(b.item?.value)
    if (!qid || !b.property?.value || b.value?.value == null) continue
    const item = byItem.get(qid) ?? { title: b.articleName?.value ?? null, collections: new Set(), pairs: new Map() }
    if (b.collection?.value) item.collections.add(qidFromUri(b.collection.value))
    const key = `${b.property.value} ${b.value.value}`
    if (!item.pairs.has(key)) item.pairs.set(key, { property: b.property.value, id: b.value.value })
    byItem.set(qid, item)
  }
  return byItem
}

/**
 * The minimal claims shape selectHolder reads, rebuilt from census rows.
 * The rank field is load-bearing: bestRankValues keeps preferred/normal
 * only, so a statement without one silently yields nothing.
 */
export function claimsFromRows(item) {
  const claims = {}
  for (const { property, id } of item.pairs.values()) {
    claims[property] ??= []
    claims[property].push({ mainsnak: { datavalue: { value: id } }, rank: 'normal' })
  }
  claims.P195 = [...item.collections].map((qid) => ({
    mainsnak: { datavalue: { value: { id: qid } } },
    rank: 'normal',
  }))
  return claims
}

async function main() {
  const query = censusQuery()
  const control = subclassControlQuery()
  const body = await getJson(wdqs(query), { timeoutMs: 60000 })
  const byItem = censusRows(body?.results?.bindings ?? [])

  const articles = []
  const perHolder = {}
  for (const [qid, item] of [...byItem.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const collections = [...item.collections].sort((a, b) => a.localeCompare(b))
    for (const { property, id } of item.pairs.values()) {
      articles.push({ title: item.title, qid, property, id, collections })
    }
    const picked = selectHolder(claimsFromRows(item))
    if (picked) perHolder[picked.partner] = (perHolder[picked.partner] ?? 0) + 1
  }

  const controlBody = await getJson(wdqs(control), { timeoutMs: 60000 })
  const subclassControl = Number(controlBody?.results?.bindings?.[0]?.n?.value ?? NaN)

  const queried = new Date().toISOString().slice(0, 10)
  const out = {
    queried,
    sparql: query,
    subclassControlSparql: control,
    holders: Object.fromEntries(HOLDERS.map((h) => [h.partner, h.property])),
    items: byItem.size,
    perHolderRule: 'each ITEM attributed to the holder selectHolder picks from its rows',
    perHolder,
    subclassControl,
    articles,
  }

  await mkdir(OUT_DIR, { recursive: true })
  const path = join(OUT_DIR, `${queried}-holder-census.json`)
  await writeFile(path, JSON.stringify(out, null, 1) + '\n')
  console.log(
    `${path}\n${byItem.size} items / ${articles.length} rows; per holder ` +
      JSON.stringify(perHolder) +
      `; subclass control ${subclassControl}`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
