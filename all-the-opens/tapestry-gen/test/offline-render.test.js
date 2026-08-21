// The one test that runs `discover` end to end.
//
// Everything else here checks a function against data already in the shape it
// expects. That left a gap: a refactor moved a `return` into a helper, the
// lede's extras promise resolved to `undefined`, every lede silently lost its
// thesis and its author's books — and all 678 tests passed. Nothing joined
// discover to a finished band.
//
// `test/fixtures/ludwig-prandtl-cache.tar.gz` is that article's upstream
// answers, recorded once. `getJson` reads the disk cache before it fetches, so
// with the fixture in place the whole discovery replays without a network. The
// article earns its place by exercising the part that broke: Wikidata states a
// thesis for Prandtl (P724) and an Open Library author id (P648), so the lede
// extras produce a subject-document card and a shelf of the subject's books.
//
// The fixture records what partners answered on the day it was made, and will
// drift from what they answer now. That is fine and is not what it is for: it
// tests our wiring, not their JSON.

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)
const HERE = fileURLToPath(new URL('.', import.meta.url))
const FIXTURE = join(HERE, 'fixtures', 'ludwig-prandtl-cache.tar.gz')
const MANIFEST = join(HERE, 'fixtures', 'ludwig-prandtl-cache.json')

async function discoverOffline() {
  const manifest = JSON.parse(await readFile(MANIFEST, 'utf8'))
  const dir = await mkdtemp(join(tmpdir(), 'tapestry-offline-'))
  try {
    await run('tar', ['xzf', FIXTURE, '-C', dir])
    const cache = join(dir, 'ludwig-prandtl-cache')
    const before = (await readdir(cache)).length
    const { stdout } = await run(
      process.execPath,
      [join(HERE, 'helpers', 'discover-once.mjs'), manifest.page],
      {
        env: {
          ...process.env,
          TAPESTRY_CACHE: cache,
          // Not cosmetic: OpenAlex carries this in the query string as its
          // politeness `mailto`, so it is part of that request's cache key.
          // A different address here is a cache miss and a live request.
          WIKIMEDIA_UA_CONTACT: manifest.contact,
          // The keyed partners stay out: a key would send real requests, and
          // the recording was made without one.
          DPLA_API_KEY: '',
          EUROPEANA_API_KEY: '',
          SMITHSONIAN_API_KEY: '',
        },
        maxBuffer: 32 * 1024 * 1024,
      },
    )
    const after = (await readdir(cache)).length
    return { summary: JSON.parse(stdout), before, after }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

test('a recorded article discovers into bands without touching the network', async () => {
  const { summary, before, after } = await discoverOffline()
  // A cache miss writes a file. Nothing new means nothing was fetched, which
  // is the only honest way to say this ran offline.
  assert.equal(after, before, `discovery wrote ${after - before} cache files, so it went to the network`)
  assert.ok(summary.bands.length >= 5, `expected the article's sections, got ${summary.bands.length} bands`)
  const lede = summary.bands.find((b) => b.id === 'slede')
  assert.ok(lede, 'the lede band is missing')
})

test('the lede carries what its own lookups found', async () => {
  const { summary } = await discoverOffline()
  const lede = summary.bands.find((b) => b.id === 'slede')
  // This is the assertion the silent bug fails. With the extras promise
  // resolving to undefined, `extras?.thesis` is undefined, nothing is pushed,
  // and the lede renders without a word of complaint.
  assert.ok(
    lede.standings.includes('subject-document'),
    `the lede lost its thesis card — standings were ${JSON.stringify(lede.standings)}`,
  )
  assert.ok(
    lede.standings.includes('subject-work'),
    `the lede lost the subject's own works — standings were ${JSON.stringify(lede.standings)}`,
  )
  assert.ok(
    lede.topics.includes('By Ludwig Prandtl'),
    `the subject's shelf lost its topic — topics were ${JSON.stringify(lede.topics)}`,
  )
  // A shelf that samples something larger has to say so, on the shelf.
  assert.ok(lede.samples > 0, 'the lede made no sample claim for a shelf it sampled')
})

test('every band reports a citation tally, whether or not it found anything', async () => {
  const { summary } = await discoverOffline()
  for (const b of summary.bands) {
    assert.ok(b.citations, `band ${b.id} has no citation tally`)
    assert.equal(typeof b.citations.total, 'number', `band ${b.id} has no citation total`)
    // "We could not look" must never be indistinguishable from "there is
    // nothing there" — the tally carries the fact, not an inference.
    assert.equal(typeof b.citations.searched, 'boolean', `band ${b.id} does not say whether it looked`)
  }
})
