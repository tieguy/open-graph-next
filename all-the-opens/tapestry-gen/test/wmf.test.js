import { test } from 'node:test'
import assert from 'node:assert/strict'

import { retryAfterMs, userAgent, withMaxlag } from '../src/wmf.js'

// --- User-Agent -------------------------------------------------------------

const CONTACT = 'luis@lu.is'

test('the User-Agent names the component, a contact and the library', () => {
  const ua = userAgent('tapestry-gen', { contact: CONTACT })
  assert.match(ua, /^all-the-opens-tapestry-gen\/\d/)
  assert.ok(ua.includes(CONTACT))
  assert.match(ua, /node\/\d+/)
})

test('a missing contact is a startup failure, not a placeholder', () => {
  // Traffic attributed to nobody is the failure mode this prevents; a default
  // would attribute a forker's traffic to whoever wrote the default.
  //
  // The environment is cleared explicitly: an operator who has set the variable
  // must not see this test pass for the wrong reason, and one who has not must
  // not see it fail for one.
  const saved = process.env.WIKIMEDIA_UA_CONTACT
  delete process.env.WIKIMEDIA_UA_CONTACT
  try {
    assert.throws(() => userAgent('tapestry-gen'), /WIKIMEDIA_UA_CONTACT/)
    assert.throws(() => userAgent('tapestry-gen', { contact: '   ' }), /WIKIMEDIA_UA_CONTACT/)
  } finally {
    if (saved !== undefined) process.env.WIKIMEDIA_UA_CONTACT = saved
  }
})

test('an explicitly configured contact wins over the environment', () => {
  const saved = process.env.WIKIMEDIA_UA_CONTACT
  process.env.WIKIMEDIA_UA_CONTACT = 'wrong@example.test'
  try {
    assert.ok(userAgent('tapestry-gen', { contact: CONTACT }).includes(CONTACT))
  } finally {
    if (saved === undefined) delete process.env.WIKIMEDIA_UA_CONTACT
    else process.env.WIKIMEDIA_UA_CONTACT = saved
  }
})

test('the User-Agent is never a browser string or a bare library default', () => {
  const ua = userAgent('tapestry-gen', { contact: CONTACT })
  assert.doesNotMatch(ua, /Mozilla|Windows NT|AppleWebKit/)
  assert.notEqual(ua.trim(), 'node-fetch')
})

// --- maxlag -----------------------------------------------------------------

test('an Action API call carries maxlag so it yields when replication is behind', () => {
  const url = withMaxlag('https://en.wikipedia.org/w/api.php?action=query&titles=Earth')
  assert.match(url, /[?&]maxlag=5(&|$)/)
})

test('maxlag is not added twice when a caller already set it', () => {
  const url = withMaxlag('https://en.wikipedia.org/w/api.php?action=query&maxlag=2')
  assert.equal(url.match(/maxlag=/g).length, 1)
  assert.match(url, /maxlag=2/)
})

test('non-Wikimedia hosts are left alone — maxlag means nothing to them', () => {
  const ia = 'https://archive.org/advancedsearch.php?q=isbn:123'
  assert.equal(withMaxlag(ia), ia)
  const ol = 'https://openlibrary.org/api/volumes/brief/isbn/0670814466.json'
  assert.equal(withMaxlag(ol), ol)
})

test('Wikimedia URLs that are not the Action API are left alone', () => {
  // Commons/Wikidata REST and image URLs take no maxlag parameter.
  const img = 'https://upload.wikimedia.org/wikipedia/commons/9/9c/X.jpg'
  assert.equal(withMaxlag(img), img)
})

test('Wikidata and Commons Action APIs get maxlag too, not just Wikipedia', () => {
  assert.match(withMaxlag('https://www.wikidata.org/w/api.php?action=wbgetentities'), /maxlag=5/)
  assert.match(withMaxlag('https://commons.wikimedia.org/w/api.php?action=query'), /maxlag=5/)
})

// --- Retry-After ------------------------------------------------------------

test('a Retry-After given in seconds is honoured', () => {
  assert.equal(retryAfterMs({ get: () => '30' }), 30000)
})

test('a response with no Retry-After yields null, so the caller backs off its own way', () => {
  assert.equal(retryAfterMs({ get: () => null }), null)
})

test('an absurd Retry-After is capped rather than trusted', () => {
  // A hostile or broken header must not park the process for a day.
  assert.equal(retryAfterMs({ get: () => '86400' }), 60000)
})

test('a malformed Retry-After is ignored rather than parsed into nonsense', () => {
  assert.equal(retryAfterMs({ get: () => 'soon' }), null)
  assert.equal(retryAfterMs({ get: () => '-5' }), null)
})
