// What this server offers crawlers, which is almost nothing.
//
// Rendering one article spends other people's API capacity: dozens of upstream
// requests across fifteen hosts, some of them serialized behind a published
// crawl delay. A crawler walking the English Wikipedia's article space through
// this server would spend all of it, on pages nobody asked to read. So the
// render space is closed to every agent, and the only thing on offer is the
// front page — which costs nothing to serve, makes no upstream request at all,
// and is the page a share or a search result should land on anyway.
//
// This used to disallow `/wiki/` alone, which left `/img/` and any future path
// open by default. Closing everything and naming the one exception fails the
// safe way when a path is added.
//
// It is advisory, of course: robots.txt asks. It is worth having because the
// crawlers that honor it are most of the volume, and worth remembering that it
// is not a bound on anything — `MAX_CONCURRENT` and the per-host queues are.

/**
 * @param {{disallowAll?: boolean}} o `disallowAll` (staging's
 *   ROBOTS_DISALLOW_ALL) offers nothing at all, front page included: staging
 *   exists for one reviewer, and an indexed staging render is a wrong answer
 *   that outlives the review.
 */
export function robotsTxt({ disallowAll = false } = {}) {
  if (disallowAll) return 'User-agent: *\nDisallow: /\n'
  // `Allow: /$` — the front page exactly, not the paths beneath it. The anchor
  // is an extension rather than part of the original standard, so a crawler
  // that does not understand it reads only `Disallow: /` and indexes nothing.
  // That is the right way for this to fail.
  // `/og-cover.png` is the share-card image (2026-08-11): committed bytes,
  // zero upstream cost, and the robots-honoring share crawlers (Twitterbot,
  // LinkedIn) refuse a disallowed og:image — without this line even the
  // front page's card renders imageless on those platforms.
  return 'User-agent: *\nAllow: /$\nAllow: /og-cover.png\nDisallow: /\n'
}
