import test from 'node:test'
import assert from 'node:assert/strict'

import { ogMeta } from '../src/emit-html.js'
import { busyPage } from '../src/front-page.js'
import { robotsTxt } from '../src/robots.js'
import { buildId } from '../src/page-cache.js'

// The share-card review findings (2026-08-11), pinned.

test('no origin means no absolute claims — the offline-batch contract holds', () => {
  const tags = ogMeta({ title: 'T', description: 'D' })
  assert.match(tags, /og:title/)
  assert.doesNotMatch(tags, /og:url/)
  assert.doesNotMatch(tags, /og:image/)
})

test('a trailing slash on the origin does not become a double-slash URL', () => {
  // SITE_HOME's default ends in a slash, so this is the copy an operator
  // will actually make — and `https://host//wiki/…` 404s at the route regex.
  const tags = ogMeta({ title: 'T', description: 'D', path: '/wiki/X', siteOrigin: 'https://x.test/' })
  assert.match(tags, /content="https:\/\/x\.test\/wiki\/X"/)
  assert.match(tags, /content="https:\/\/x\.test\/og-cover\.png"/)
})

test('the busy page carries the card but claims no canonical URL', () => {
  // It answers for many article URLs at once; og:url would misdirect the
  // share to the front page. Scrapers that cache its scrape still get the
  // title, description and image.
  const busy = busyPage({ siteOrigin: 'https://x.test' })
  assert.match(busy, /og:title/)
  assert.match(busy, /og:image/)
  assert.doesNotMatch(busy, /og:url/)
})

test('robots offers the share image alongside the front page', () => {
  const txt = robotsTxt()
  assert.match(txt, /Allow: \/og-cover\.png/)
  // Staging still offers nothing at all.
  assert.doesNotMatch(robotsTxt({ disallowAll: true }), /Allow/)
})

test('the build id changes when SITE_ORIGIN does — stored pages carry it', () => {
  const before = process.env.SITE_ORIGIN
  try {
    process.env.SITE_ORIGIN = 'https://a.test'
    const a = buildId()
    process.env.SITE_ORIGIN = 'https://b.test'
    const b = buildId()
    assert.notEqual(a, b)
  } finally {
    if (before === undefined) delete process.env.SITE_ORIGIN
    else process.env.SITE_ORIGIN = before
  }
})
