import test from 'node:test'
import assert from 'node:assert/strict'

import { MW_FETCH_TIMEOUT_MS, mwSession } from '../src/mw.js'

// m3api sends no abort signal and undici's fallback timeouts did not fire in
// four days of a stalled request (see QUEUE_DEADLINE_MS in src/mw.js). Every
// MediaWiki fetch therefore carries its own deadline, the way every partner
// fetch in src/http.js already does.
test('every MediaWiki fetch carries an abort signal with a deadline', () => {
  process.env.WIKIMEDIA_UA_CONTACT ??= 'test@example.com'
  const opts = mwSession('en.wikipedia.org').getFetchOptions({ method: 'GET' })
  assert.ok(opts.signal instanceof AbortSignal, 'a signal is attached')
  assert.equal(opts.signal.aborted, false, 'and it has not fired yet')
  assert.equal(opts.method, 'GET', 'the rest of the options survive')
  assert.ok(MW_FETCH_TIMEOUT_MS > 0)
  assert.ok(MW_FETCH_TIMEOUT_MS < 120_000, 'shorter than the queue deadline, so the fetch fails first and says why')
})
