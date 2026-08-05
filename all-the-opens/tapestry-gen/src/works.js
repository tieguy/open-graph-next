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

/** OpenLibrary writes "this work has no cover" as a cover id of -1. */
const coverUrl = (covers) => {
  const id = (covers ?? []).find((c) => typeof c === 'number' && c > 0)
  return id ? `https://covers.openlibrary.org/b/id/${id}-M.jpg` : null
}

/**
 * An author's works as renderable entries, best-presented first.
 *
 * Covered works lead: these render as a shelf, and a row of blank cards reads as
 * a broken page rather than as a catalogue. Coverless works still appear — the
 * point is what the person wrote, not what happens to be photographed — they
 * simply come after.
 *
 * @param {{size?: number, entries?: Array<object>}} response  OpenLibrary's works.json
 * @param {{cap: number}} options
 * @returns {{entries: Array<object>, total: number}} `total` is everything held,
 *   not everything shown, so the page can disclose the difference.
 */
export function authorWorkEntries(response, { cap }) {
  const all = (response?.entries ?? []).filter((w) => w?.title)
  const entries = all
    .map((w, i) => ({ w, i, cover: coverUrl(w.covers) }))
    // Stable within each group, so OpenLibrary's own order breaks ties.
    .sort((a, b) => Number(Boolean(b.cover)) - Number(Boolean(a.cover)) || a.i - b.i)
    .slice(0, cap)
    .map(({ w, cover }) => ({
      source: 'openlibrary',
      title: w.title,
      description: ['Book', w.first_publish_date].filter(Boolean).join(' · '),
      imageUrl: cover,
      attribution: { author: 'Open Library', license: null },
      _via: 'P648',
    }))
  return { entries, total: response?.size ?? all.length }
}
