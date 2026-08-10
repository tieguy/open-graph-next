// When a source says "too many requests", stop asking it.
//
// Measured on production, 2026-08-10: every render cost 214–240s, and the whole
// of it was one pivot — `openalex batch settled in 234.1s`, while every other
// source settled in under 1.6s. OpenAlex was answering 429, and the client did
// the textbook thing with it: honor `Retry-After`, sleep, try again. Correct per
// request and wrong per page, because a page's identifiers are chunked forty at
// a time and the chunks are serialized per host, so each one slept its own
// minute to be refused again. Three chunks, four minutes, no data.
//
// The fix is to remember the refusal for the host rather than re-earning it per
// request. A 429 arms a cool-off; every later request to that host inside the
// interval fails immediately instead of queueing behind another sleep. One
// refusal per page instead of one per chunk, and the page renders without that
// source — which it already knew how to do, since `openAlexLookups` catches a
// failed batch and moves on.
//
// This is *more* compliant, not less. WMF etiquette (and every other host's
// published policy) asks that `Retry-After` be honored, which means not sending
// another request before the interval is up — declining to send one at all
// satisfies that strictly, where sleeping-then-retrying inside a reader's
// request satisfies it only per-connection while spending a minute of their
// time. What must NOT change is 503: that is "I am busy, come back shortly",
// the shape MediaWiki's maxlag protocol uses, and waiting is the right answer to
// it. A lagging Wikimedia should make this site slow, not blank. So only 429 —
// the "you, specifically, are asking too much" signal — arms a cool-off.

/** Host → the epoch ms at which we may ask it again. */
const cooling = new Map()

/**
 * The longest a single header may silence a source.
 *
 * `Retry-After` is whatever the other end says, and a typo, a misconfiguration
 * or a hostile value should not take a partner out of every page for a day. At
 * fifteen minutes a genuine rate limit is respected for as long as it is likely
 * to matter, and a nonsense one costs one probe a quarter of an hour.
 */
export const MAX_COOLOFF_MS = 900_000

/**
 * How long to stay quiet when a 429 names no interval.
 *
 * Zero would be a hot loop against a host that just asked for room, so a
 * refusal always buys something — but not more than the cap, because we were
 * not told anything and should not invent a long silence.
 */
export const DEFAULT_COOLOFF_MS = 60_000

/**
 * Record that a host refused us, and until when.
 *
 * The newest refusal wins even when it is shorter: it is the most recent thing
 * the host actually said about its own capacity.
 *
 * @param {string} host
 * @param {number|null} retryAfter interval the host asked for, ms, or null
 * @param {number} now epoch ms, passed in so this is testable and deterministic
 * @returns {number} the epoch ms at which this host may be asked again
 */
export function noteRateLimited(host, retryAfter, now) {
  const wait = Math.min(retryAfter ?? DEFAULT_COOLOFF_MS, MAX_COOLOFF_MS)
  const until = now + wait
  cooling.set(host, until)
  return until
}

/**
 * Milliseconds left on a host's cool-off — 0 when it may be asked again.
 *
 * @param {string} host
 * @param {number} now epoch ms
 */
export function coolingFor(host, now) {
  const until = cooling.get(host)
  if (until === undefined) return 0
  if (until <= now) {
    // Expired: drop it rather than keep a growing map of hosts that are fine.
    cooling.delete(host)
    return 0
  }
  return until - now
}

/**
 * Every host currently refusing us.
 *
 * This is what lets a render say it was degraded, which the page cache needs to
 * know: a page rendered while a source was rate-limited is missing whatever
 * that source would have contributed, and storing it would make the thin
 * version the answer to every later request until the next deploy. A five
 * minute rate limit should not cost an article its open-access copies for a
 * week. Serve the page, decline to enshrine it.
 *
 * Deliberately global rather than per-render: attributing a refusal to the one
 * request that earned it would need a context threaded through every pivot, and
 * the conservative reading — if anybody is refusing us right now, this render
 * may be thin — errs toward rendering again, which is only ever a cost in time.
 *
 * @param {number} now epoch ms
 * @returns {string[]} hosts, empty when everyone is answering
 */
export function coolingHosts(now) {
  return [...cooling.keys()].filter((host) => coolingFor(host, now) > 0)
}

/** Tests only. The server's cool-offs expire on their own. */
export function resetCooloffs() {
  cooling.clear()
}
