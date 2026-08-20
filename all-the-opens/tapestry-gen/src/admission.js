// Who gets in when the demo is already busy.
//
// Every discovery fans out dozens of upstream requests, so inbound load is
// capped where it arrives (`MAX_CONCURRENT` in serve.js) and anything past the
// cap is answered with a 503 that says so in the site's own voice. That cap was
// applied to every `/wiki/` request alike, which quietly broke the promise the
// front page makes in print: the showcase articles are "already rendered
// and cached — they open at once", and a reader who arrived while four cold
// discoveries were in flight got the busy page for a page that would have been
// served entirely off the disk cache.
//
// So the showcase gets a small reserve of slots that general traffic cannot
// take. The argument for it is what warm means: `warm.js` walks exactly this
// list after every deploy, and a warm page's discovery is 100% offline — it
// makes no upstream request at all, which is the thing `MAX_CONCURRENT` exists
// to bound. **The reserve does not widen what this server does to anyone
// else's API**: the per-host queues in `src/mw.js` bound upstream concurrency
// globally and know nothing about how many discoveries are in flight here. The
// worst case — a cold volume, where the showcase is not warm after all — is a
// couple more discoveries waiting on those same per-host queues, which is
// bounded, small, and self-correcting the moment the cache fills.
//
// The reserve is finite on purpose. A showcase page is refused too, once even
// the reserve is full: the busy page is an honest answer, and a lane with no
// end is how a demo becomes someone else's traffic problem.

import { showcaseTitles } from './front-page.js'

/**
 * A requested path segment as MediaWiki would normalize it, so that the same
 * article asked for in the several ways a link can spell it lands in the same
 * bucket: `Apollo_11`, `apollo 11` and `Apollo  11` are all "Apollo 11".
 *
 * Only the FIRST letter is case-folded, because that is the only one enwiki
 * folds — `REMBRANDT` is not `Rembrandt` there and does not get the reserve
 * here either.
 */
export function titleKey(title) {
  const t = title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

const SHOWCASE = new Set(showcaseTitles().map(titleKey))

/**
 * Is this one of the pages the front page promises are ready?
 *
 * Asked of the reader's own request, before discovery, so a REDIRECT to a
 * showcase article does not get the reserve — the resolved title is not known
 * until the parse call has answered. That costs a redirect the fast lane and
 * never costs it a page.
 */
export const isShowcase = (title) => SHOWCASE.has(titleKey(title))

/**
 * May this request start a discovery right now?
 *
 * @param {{inFlight: number, showcase: boolean, max: number, reserve: number}} o
 */
export function admits({ inFlight, showcase, max, reserve }) {
  return inFlight < (showcase ? max + reserve : max)
}
