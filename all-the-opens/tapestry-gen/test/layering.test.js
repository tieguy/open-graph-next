import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'

// One rule, enforced rather than remembered: a partner module never imports
// another partner module.
//
// It is a real temptation and the right instinct pointed at the wrong file.
// The second partner of a shape correctly wants the first one's mechanism —
// VALUES.md asks for exactly that ("a learning generalizes across sources, or
// it waits") — and the cheap way to get it is to import from the neighbour.
// That is what happened between 2026-08-08 and 2026-08-10: `digitalnz.js`
// imported `rankDplaEntries` from `dpla.js`, so a shelf ranker shared by two
// partners carried one partner's name and lived in its file. Nothing broke;
// it was simply misfiled, and misfiled code is what the third partner copies.
//
// The fix is always the same, so the failure message states it: move the
// shared thing into a module that belongs to neither — `relevance.js` for
// shelf composition, `rights.js` for licence vocabulary, `http.js` for
// transport, `lc.js` for authority headings.

const SRC = new URL('../src/', import.meta.url)

// Modules that fetch and shape ONE external partner's records. Add a new
// partner here when you add its module — the list is short on purpose, and a
// missing entry only weakens the check, never breaks the build.
const PARTNERS = new Set([
  'dpla',
  'digitalnz',
  'europeana',
  'rijks',
  'iiif',
  'smithsonian',
  'artworks',
  'works',
  'scholarly',
])

/** Every `./x.js` a module imports, as bare names. */
function localImports(file) {
  const src = readFileSync(new URL(file, SRC), 'utf8')
  return [...src.matchAll(/from\s+'\.\/([a-z-]+)\.js'/g)].map((m) => m[1])
}

test('a partner module never imports another partner module', () => {
  const offenders = []
  for (const name of PARTNERS) {
    for (const dep of localImports(`${name}.js`)) {
      if (PARTNERS.has(dep)) offenders.push(`src/${name}.js imports src/${dep}.js`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `A shared mechanism is living in one partner's module.\n` +
      `${offenders.join('\n')}\n\n` +
      `Move it somewhere that belongs to neither partner — relevance.js for shelf\n` +
      `composition (ranking, folding, corroboration), rights.js for licence\n` +
      `vocabulary, http.js for transport, lc.js for authority headings — and give\n` +
      `it a name without a partner in it. See docs/adding-a-source.md.`,
  )
})

// Shared infrastructure: modules that exist to be used BY partners. The
// dependency runs one way, and the reverse is the same mistake wearing a
// different hat — `lc.js` imported `lcBranch` from `dpla.js` until 2026-08-10,
// so DigitalNZ's heading lookup depended on DPLA's file, and LC authority code
// lived in two places at once. Nothing broke; it just meant a reader had to
// know both modules to know which of the two lookups they wanted.
const SHARED = new Set(['relevance', 'rights', 'http', 'lc', 'batch', 'citations', 'html'])

test('shared infrastructure never imports a partner module', () => {
  const offenders = []
  for (const name of SHARED) {
    for (const dep of localImports(`${name}.js`)) {
      if (PARTNERS.has(dep)) offenders.push(`src/${name}.js imports src/${dep}.js`)
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Shared code is depending on one partner's module, so every other partner\n` +
      `now inherits that partner.\n${offenders.join('\n')}\n\n` +
      `Move the shared thing down into the shared module. See docs/adding-a-source.md.`,
  )
})

test('the module lists still name real modules', () => {
  // A renamed or retired partner would otherwise silently stop being checked.
  const present = new Set(
    readdirSync(SRC)
      .filter((f) => f.endsWith('.js'))
      .map((f) => f.slice(0, -3)),
  )
  const missing = [...PARTNERS, ...SHARED].filter((p) => !present.has(p))
  assert.deepEqual(missing, [], `Named modules that no longer exist: ${missing.join(', ')}`)
})
