// When an anchor is a category rather than a subject.
//
// The anchors a section pivots on are its prose links, and an encyclopedia's
// first sentence is a definition — so the earliest links in a lede are very
// often the class the subject belongs to, not the subject. "American Gothic is
// a 1930 oil painting on beaverboard by Grant Wood" offers `oil painting` and
// `beaverboard` before it offers Grant Wood. Pivoting on those asks a partner
// "what do you hold about oil painting?", and the partner answers honestly and
// uselessly: four of Europeana's 6,123 openly licensed oil paintings, all four
// Finnish, all four titled "öljymaalaus", in the lede of an article about an
// American one. Measured across the six showcase articles on 2026-08-05, every
// unhelpful shelf on every page came from an anchor of this kind.
//
// The signal was already on the page, printed in the disclosure line nobody
// had read as a diagnostic: the DENOMINATOR. Every shelf worth showing came
// from a heading holding tens or low hundreds of items — 54 for Brown v. Board
// of Education of Topeka, 83 for the monarch butterfly, 126 for Apollo 11, 190
// for the Art Institute of Chicago. Every shelf worth dropping came from one
// holding thousands — 465, 652, 831, 1,409, 3,016, 6,123. The partners already
// return that count and this page already prints it, so the test costs nothing:
// no extra request, no extra query, no new judgment about the items themselves.
//
// What follows is a threshold fitted to twelve observations from six articles.
// It is a heuristic and should be read as one. It will misjudge a genuinely
// well-served niche subject whose catalog runs deep, and it will let through a
// narrow-looking heading that happens to be vague. The consequence of either
// mistake is bounded: a shelf becomes a sentence, or a sentence stays a shelf.

/**
 * Above this many items under one heading, a four-item sample stops being a
 * sample of anything a reader can use. See the module comment for the
 * observations behind the number; the gap between the widest heading worth
 * keeping (190) and the narrowest worth dropping (465) is wide enough that the
 * exact value inside it does not matter much.
 */
export const BROAD_ABOVE = 300

/**
 * Whether a partner's holdings under this anchor are too broad to sample.
 *
 * The subject's own heading is exempt at any size. A thousand items filed
 * under this article's own subject ARE about this article's subject, and four
 * of them is a real sample of a real thing; a thousand items filed under the
 * category the subject belongs to are about a thousand other things. That
 * distinction — is this anchor the article, or the box the article sits in —
 * is the whole of what this function decides, and the count is only how it
 * tells them apart when nobody has said outright.
 */
export function tooBroad(total, { isSubject = false } = {}) {
  if (isSubject) return false
  return Number(total) > BROAD_ABOVE
}

/**
 * The shelf that will not be shown, said as a fact instead.
 *
 * Not a refusal and not an apology: the collection is real, it is open, and
 * the number is worth knowing — it is the same argument the rest of the page
 * makes, which is that there is far more out there than any article shows. The
 * link hands the reader the browse the page declined to fake. Deliberately no
 * card, no thumbnail and no title: the point is that this pipeline cannot tell
 * which four of six thousand belong here, and inventing four would say it can.
 */
export function broadNote({ source, label, heading, total, url }) {
  return { source, label, heading: heading ?? null, total: Number(total), url }
}
