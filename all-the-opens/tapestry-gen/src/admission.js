// Who gets in when the demo is already busy.
//
// Every discovery fans out dozens of upstream requests, so inbound load is
// capped where it arrives (`MAX_CONCURRENT` in serve.js) and anything past the
// cap is answered with a 503 that says so in the site's own voice. That cap was
// applied to every `/wiki/` request alike, which quietly broke the promise the
// front page makes in print: its ready-now chip says all ten articles, both
// grids, are "already rendered and cached — they open at once", and a reader
// who arrived while four cold
// discoveries were in flight got the busy page for a page that would have been
// served entirely off the disk cache.
//
// So the ready-now pages — the showcase grid and the held-works row alike — get
// a small reserve of slots that general traffic cannot take. The argument for
// it is what warm means: the server walks exactly this list at boot
// (`bootWarmTitles`, under WARM_ON_START), `warm.js` is the same walk by hand,
// and a warm page's discovery is 100% offline — it makes no upstream request at
// all, which is the thing `MAX_CONCURRENT` exists to bound. **The reserve does
// not widen what this server does to anyone else's API**: the per-host queues
// in `src/mw.js` bound upstream concurrency globally and know nothing about how
// many discoveries are in flight here. The worst case — a cold volume, where
// those pages are not warm after all — is a couple more discoveries waiting on
// those same per-host queues, which is bounded, small, and self-correcting the
// moment the cache fills.
//
// The reserve is finite on purpose. A showcase page is refused too, once even
// the reserve is full: the busy page is an honest answer, and a lane with no
// end is how a demo becomes someone else's traffic problem.

import { bootWarmTitles } from './warming.js'

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

// Every title the front page presents as ready — the showcase grid and the
// held-works row alike. Imported from the boot walk's own list rather than
// composed again, so the reserve backs the promise wherever it is made and
// cannot drift from the walk: a title added to bootWarmTitles is reserved
// here with no edit.
const SHOWCASE = new Set(bootWarmTitles().map(titleKey))

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
