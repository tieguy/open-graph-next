import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { PARTNERS } from '../src/partners.js'
import { ICONS } from '../src/icons.js'
import { frontPage } from '../src/front-page.js'

// The manifest exists so that "the partner fetches but is never credited"
// is a red test instead of a checklist item — DigitalNZ shipped exactly that
// way (first commit deferred the friends entry and the icon). These tests
// assert the reader-facing half of adding a source, the half the pipeline
// works fine without.

test('every partner descriptor is complete', () => {
  for (const [slug, p] of Object.entries(PARTNERS)) {
    assert.equal(typeof p.name, 'string', `${slug}: name`)
    assert.ok(p.name.length, `${slug}: name is empty`)
    assert.match(p.icon ?? '', /^https:\/\//, `${slug}: icon must be a URL`)
    assert.ok(Array.isArray(p.hosts), `${slug}: hosts must be an array (may be empty — IIIF)`)
    assert.equal(typeof p.friend?.gives, 'string', `${slug}: friend.gives`)
    assert.equal(typeof p.friend?.terms, 'string', `${slug}: friend.terms`)
    if (p.friend.cite !== undefined)
      assert.match(p.friend.cite, /^https:\/\//, `${slug}: friend.cite must be a URL`)
    if (p.hostLimits !== undefined)
      for (const [host, limit] of Object.entries(p.hostLimits)) {
        assert.ok(Number.isInteger(limit), `${slug}: hostLimits.${host} must be an integer`)
        assert.ok(limit > 1, `${slug}: hostLimits.${host} must be above 1`)
      }
  }
})

test('every partner icon has committed bytes', () => {
  // `src/icons.js` is generated (tools/build-icons.mjs); a manifest icon URL
  // with no entry there renders as a blank square on every page. Regenerate
  // after adding a partner — this is the test that remembers.
  for (const [slug, p] of Object.entries(PARTNERS)) {
    assert.ok(ICONS.has(p.icon), `${slug}: icon URL has no bytes in src/icons.js — run tools/build-icons.mjs`)
  }
})

test('every partner is credited on the front page', () => {
  // FRIEND_GROUPS in front-page.js is an editorial ordering over manifest
  // slugs; a partner missing from every group would do the work and get no
  // credit, silently.
  const html = frontPage({})
  for (const slug of Object.keys(PARTNERS)) {
    assert.ok(html.includes(`fav fav-${slug}`), `${slug}: not in any FRIEND_GROUPS list in front-page.js`)
  }
})

test('the front page lists no friend the manifest does not know', () => {
  const src = readFileSync(new URL('../src/front-page.js', import.meta.url), 'utf8')
  const listed = [...src.matchAll(/slugs: \[([^\]]*)\]/g)]
    .flatMap((m) => m[1].match(/'([a-z_]+)'/g) ?? [])
    .map((q) => q.slice(1, -1))
  assert.ok(listed.length >= Object.keys(PARTNERS).length, 'FRIEND_GROUPS parse failed')
  for (const slug of listed) {
    assert.ok(slug in PARTNERS, `front-page.js lists '${slug}', which has no descriptor in src/partners.js`)
  }
})

test('the manifest is data only — it imports nothing', () => {
  // Anything may import partners.js (shared infrastructure included)
  // precisely because it can never drag partner code along. An import here
  // would quietly make every consumer depend on whatever it names.
  const src = readFileSync(new URL('../src/partners.js', import.meta.url), 'utf8')
  assert.equal(src.match(/^import /m), null, 'src/partners.js grew an import')
})
