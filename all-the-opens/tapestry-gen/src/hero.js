// Which one of a section's finds is worth the slot the eye lands on first.
//
// Until 2026-08-05 that slot — the float at the top right of every section —
// held the references fold, closed, so the most prominent place on the page
// read "REFERENCES IN THIS SECTION · 18" and the prose indented around it for
// one line. The references moved to the foot of the section, where a reader
// goes looking for them, and the slot now holds the single best thing the
// section found.
//
// "Best" is not a quality judgment about the item — this pipeline cannot make
// one — but a statement about how directly the item answers the section. A
// partner's record OF THE THING THIS ARTICLE IS ABOUT beats a partner's record
// of something the section merely mentions, every time. That is what `standing`
// carries: it is set where the entry is made, by the code that knows whether
// the anchor was the subject, and never re-derived here by reading prose.

/**
 * How directly an entry answers the section, lowest first.
 *
 * The tiers, and why they are ordered this way:
 *
 * 0. The subject IS this document — a court's opinion, a scientist's thesis.
 *    Where the article is about a document, the document outranks every
 *    picture of it and every book about it. This is the front page's promise
 *    on Brown v. Board ("the primary document before any book about it") and
 *    it must not be beatable by a photograph that happens to have a thumbnail.
 * 1. A partner's own record of the subject, with something to look at — the
 *    Art Institute's American Gothic, iNaturalist's monarch.
 * 2. The same, without a picture.
 * 3. Something the subject made: a book it wrote, a paper under its ORCID.
 * 4. Any illustrated record of something the section links to.
 * 5. A map. Real, but it locates rather than shows, and a map hoisted over an
 *    illustrated record would trade the subject for its coordinates.
 * 6. Everything else — text-only records of things merely mentioned.
 */
export function heroRank(entry) {
  const visual = Boolean(entry.imageUrl || entry.media)
  if (entry.standing === 'subject-document') return 0
  if (entry.standing === 'subject-record') return visual ? 1 : 2
  if (entry.standing === 'subject-work') return 3
  if (entry.source === 'openstreetmap') return 5
  return visual ? 4 : 6
}

/**
 * The entry to hoist, and the rest in their original order — or no hero and
 * the entries untouched.
 *
 * A hero with neither a picture nor the standing of a primary document is not
 * worth the slot: a lone citation card blown up to 404px is a thin box with
 * three lines of text in it, which is what the references fold looked like and
 * is the thing being fixed. In that case the section simply has no float and
 * its prose runs full width, which is the correct rendering of "this section
 * found nothing worth leading with".
 *
 * Ties break on article order, which is already the order the pipeline pushes
 * entries in: subject lookups first, then citations, then anchored statements.
 */
export function pickHero(entries) {
  const list = entries ?? []
  if (!list.length) return { hero: null, rest: list }
  let best = null
  let bestRank = Infinity
  list.forEach((e, i) => {
    const rank = heroRank(e)
    if (rank < bestRank) {
      bestRank = rank
      best = i
    }
  })
  const pick = list[best]
  const worthIt = Boolean(pick.imageUrl || pick.media) || pick.standing === 'subject-document'
  if (!worthIt) return { hero: null, rest: list }
  return { hero: pick, rest: list.filter((_, i) => i !== best) }
}
