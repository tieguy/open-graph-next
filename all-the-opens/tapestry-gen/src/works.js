// Works *by* the subject, rather than works that cite the subject.
//
// Every other pivot in this project answers "what did this article cite?" — it
// follows the article outward through its own references. For a person that
// leaves the most obvious thing missing: what they wrote. A biography's page can
// end up showing a shelf of books about the subject and none by them.
//
// Wikidata's P648 is an OpenLibrary author identifier, so this is an identifier
// pivot like the ISBN ones, not a name search: no disambiguation, no guessing
// between people who share a name.
//
// **Read from `search.json`, not `/authors/<id>/works.json` (2026-08-06).**
// Both see the same corpus — Kafka's OL33146A reports 1,852 either way — but
// works.json answers with catalog records carrying a title and almost nothing
// else, while search.json answers the same question with `ebook_access` per
// work. That field is the whole reason for the change: it is how a card learns
// that the edition it shows is LENT rather than free, which is what stops a 1991
// classroom anthology from wearing a public-domain mark because its author died
// in 1924. See `accessRights` in src/rights.js.
//
// Two things came along for free, and both change what the shelf looks like.
// The order is by relevance rather than by catalog accident: Kafka's shelf now
// opens with Metamorphosis, Der Proceß and Das Schloß where works.json led with
// "Gezar-ha-din" and a Russian edition of the diaries. And `first_publish_year`
// is populated where works.json's `first_publish_date` usually was not, so the
// cards carry dates.

import { accessRights } from './rights.js'

/** One request: the author's works, each with the state of its scan. */
export function authorWorksUrl(olid, limit = 40) {
  return (
    'https://openlibrary.org/search.json?author_key=' +
    encodeURIComponent(olid) +
    '&fields=key,title,ebook_access,first_publish_year,cover_i' +
    `&limit=${limit}`
  )
}

/** OpenLibrary omits `cover_i` entirely when a work has no cover. */
const coverUrl = (id) =>
  typeof id === 'number' && id > 0 ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : null

/**
 * An author's works as renderable entries, best-presented first.
 *
 * Covered works lead: these render as a shelf, and a row of blank cards reads as
 * a broken page rather than as a catalog. Coverless works still appear — the
 * point is what the person wrote, not what happens to be photographed — they
 * simply come after. Ties keep OpenLibrary's own relevance order.
 *
 * Each entry carries `access`, which `discover.js` consults before handing the
 * entry the subject's copyright status: an edition that is lent gets the lending
 * statement instead of a public-domain mark.
 *
 * @param {{numFound?: number, docs?: Array<object>}} response  OpenLibrary's search.json
 * @param {{cap: number}} options
 * @returns {{entries: Array<object>, total: number}} `total` is everything held,
 *   not everything shown, so the page can disclose the difference.
 */
export function authorWorkEntries(response, { cap }) {
  const all = (response?.docs ?? []).filter((w) => w?.title)
  const entries = all
    .map((w, i) => ({ w, i, cover: coverUrl(w.cover_i) }))
    // Stable within each group, so OpenLibrary's own order breaks ties.
    .sort((a, b) => Number(Boolean(b.cover)) - Number(Boolean(a.cover)) || a.i - b.i)
    .slice(0, cap)
    .map(({ w, cover }) => ({
      source: 'openlibrary',
      title: w.title,
      description: ['Book', w.first_publish_year].filter(Boolean).join(' · '),
      imageUrl: cover,
      // OpenLibrary's own page for the work, so the card is a door rather than
      // a mention — the same argument the Internet Archive cards settled.
      href: typeof w.key === 'string' ? `https://openlibrary.org${w.key}` : null,
      attribution: { author: 'Open Library', license: null },
      access: accessRights(w.ebook_access),
      _via: 'P648',
    }))
  return { entries, total: response?.numFound ?? all.length }
}
