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
// The order is no longer catalog accident: Kafka's shelf now opens with
// Metamorphosis, Der Proceß and Das Schloß where works.json led with
// "Gezar-ha-din" and a Russian edition of the diaries. (First by relevance;
// since 2026-08-07 by edition count — see `authorWorksUrl` — which agrees with
// relevance on Kafka and beats it on authors whose records are shattered into
// shards, see `dedupeShards`.) And `first_publish_year` is populated where
// works.json's `first_publish_date` usually was not, so the cards carry dates.

import { accessRights } from './rights.js'

/** One request: the author's works, each with the state of its scan. */
export function authorWorksUrl(olid, limit = 40) {
  return (
    'https://openlibrary.org/search.json?author_key=' +
    encodeURIComponent(olid) +
    // `author_key` rides along for `soleAuthor`, `edition_count` for the shard
    // fold — see below. Each was a one-time cache miss at an unchanged request
    // count, the same trade as the `ebook_access` change that brought this
    // pivot to search.json.
    '&fields=key,title,ebook_access,first_publish_year,cover_i,ia,author_key,edition_count' +
    // Sorted by edition count rather than relevance (2026-08-07): the books
    // the world kept printing are the books the shelf is for, and the sort
    // happens server-side so a 134-edition work cannot sit beyond the fetch
    // window while a 1-edition shard makes the page. Kafka, the case the
    // relevance order was chosen on, is unchanged by this: Metamorphosis,
    // Der Proceß and Das Schloß lead either way.
    '&sort=editions' +
    `&limit=${limit}`
  )
}

/**
 * Whether the article's subject is this work's ONLY author.
 *
 * A creator-level copyright ruling — CopyClear's "this person's copyrights have
 * expired" — is a ruling about what that person made. It says nothing about
 * what somebody else made with them, and Open Library files plenty of such
 * books under the historical figure they are ABOUT.
 *
 * Found on a live card 2026-08-06: *Rembrandt, the Master & His Workshop*
 * (1991) lists Rembrandt Harmenszoon van Rijn alongside Holm Bevers, Peter
 * Schatborn and Barbara Welzel, so a modern scholarly catalogue by three living
 * authors came out wearing a public-domain mark. `ebook_access` could not save
 * it — Open Library answers `no_ebook`, which is silence, not a statement, and
 * the rule is that silence changes nothing.
 *
 * **This generalizes the Kafka fix rather than duplicating it.** That case
 * (a 1991 anthology) was caught only because the edition happened to be
 * borrowable; the test here catches the same class structurally, whether or
 * not anyone digitized it.
 *
 * **A translator counts, and that is the point, not a side effect.** Kafka's
 * 1915 *Metamorphosis* is co-credited because the English translation is a new
 * work with its own living rights holder — exactly the case where the author's
 * expired copyright settles nothing. Measured across three authors, co-authored
 * works are about 20% of a shelf, and only those with no lending statement
 * change at all.
 */
export const soleAuthor = (work, olid) =>
  !(work?.author_key ?? []).some((k) => k && k !== olid)

/**
 * The archive.org record for one scan — its own title plus the
 * `openlibrary_edition` / `openlibrary_work` backlink. The trailing
 * `/metadata` asks for just that section rather than the full item record,
 * whose file list can run to hundreds of KB. The body arrives as
 * `{ result: {...} }`; callers pass `result` into `authorWorkEntries` as
 * `iaMeta[id]`.
 */
export const iaMetadataUrl = (id) => `https://archive.org/metadata/${encodeURIComponent(id)}/metadata`

/** The scan the access verdict rests on, when there is one. */
const scanId = (w) => {
  const scanned = w?.ebook_access && w.ebook_access !== 'no_ebook'
  const ia = Array.isArray(w?.ia) ? w.ia[0] : w?.ia
  return scanned && typeof ia === 'string' && ia ? ia : null
}

/** OpenLibrary's representative cover for the work, when one is on file. */
const olCover = (w) =>
  typeof w?.cover_i === 'number' && w.cover_i > 0 ? `https://covers.openlibrary.org/b/id/${w.cover_i}-M.jpg` : null

/**
 * The cover to show — and it must depict the same object the card's rights
 * claim is about.
 *
 * `cover_i` is OpenLibrary's REPRESENTATIVE cover for a work, chosen across
 * every edition of it, while `ebook_access` is a work-level rollup meaning
 * "some edition is free". Pair the two blindly and you get the bug this
 * function exists to fix: Macbeth has **1,867 editions**, so the card came out
 * as a public-domain mark over the jacket of Harold Bloom's 1999 critical
 * edition — a book that is emphatically not public domain. Neither field was
 * wrong; pairing them was.
 *
 * So whenever the access verdict came from a SCAN, the cover comes from that
 * same scan: `ia` names it, and `archive.org/services/img/<id>` is the
 * thumbnail this project already uses for Internet Archive cards. Macbeth then
 * shows `macbethfacsimile0000will` — an old edition that genuinely is free.
 * A work with no scan at all keeps the representative cover, because there is
 * no better one and its card makes no claim about an edition.
 */
const coverUrl = (w) => {
  const ia = scanId(w)
  return ia ? `https://archive.org/services/img/${ia}` : olCover(w)
}

/** Case, diacritics and punctuation folded away, for title comparison only. */
const normTitle = (t) =>
  String(Array.isArray(t) ? (t[0] ?? '') : (t ?? ''))
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

/**
 * The scan's own short title — what its cover actually says, roughly. IA
 * titles carry MARC residue a caption must not: subtitles after `;` or `:`,
 * a ` / edited by …` statement of responsibility, stray newlines, and
 * sometimes a bare trailing year.
 */
const scanTitle = (meta) => {
  const t = Array.isArray(meta?.title) ? meta.title[0] : meta?.title
  if (typeof t !== 'string') return ''
  return t
    .split(/[;:/]/)[0]
    .replace(/\s+/g, ' ')
    .replace(/[,\s]*\b\d{4}\b$/, '')
    .trim()
}

/**
 * Is this scan actually a copy of this work? Open Library says so — but Open
 * Library can be wrong, and when it is, the Macbeth rule above amplifies the
 * error into the whole card.
 *
 * Found on a live card 2026-08-07: von Braun's *Das Marsprojekt* wore an 1874
 * pamphlet against a railroad franchise as its cover, with a free-to-read
 * claim resting on the pamphlet's scan. The edition record's `ocaid` names
 * `reviewshowingwhy00unse` — somebody else's book, bound to the edition by an
 * automated import (its `source_records` list both that scan and the real
 * one). search.json then rolled the pamphlet up into the work as
 * `ebook_access: public`. See docs/internet-archive-issues.md #8.
 *
 * Two signals, either of which vouches for the scan:
 *
 * - **The archive's own backlink.** IA items carry `openlibrary_work`; when it
 *   names this work, the archive agrees with Open Library and that settles it.
 *   This is what keeps Rizal's *Noli Me Tangere*, scanned as its English
 *   translation *The Social Cancer* — the titles share nothing, the backlink
 *   is exact.
 * - **Title overlap**, folded for case, diacritics and punctuation. This is
 *   the fallback because the backlink goes stale: `marsproject0000vonb` — the
 *   RIGHT scan for Das Marsprojekt — points at a work key that no longer
 *   resolves, so a mismatched backlink alone must not condemn a scan.
 *
 * Both silent means the scan is somebody else's book. The caller then falls
 * back to the representative cover and drops the scan's access verdict —
 * rejection only ever withholds a claim, never asserts one, so the failure
 * mode of a false rejection is an understated card, not a wrong one.
 *
 * No metadata (`null`/absent) is no verdict: unfetched is not disproven.
 */
const scanMatchesWork = (meta, w) => {
  if (!meta) return null
  const workKey = typeof w?.key === 'string' ? w.key.split('/').pop() : null
  if (workKey && meta.openlibrary_work === workKey) return true
  const scan = normTitle(meta.title)
  const work = normTitle(w?.title)
  if (scan && work && (scan.includes(work) || work.includes(scan))) return true
  return false
}

/**
 * A work's title folded to what it would share with its shard records.
 * Open Library multiplies one book into many work records — Rizal is 186
 * works for a shelf of ten — and the shards differ from the real record by
 * exactly the things `normTitle` already folds (case, diacritics,
 * punctuation) plus a leading article: *El filibusterismo* / *Filibusterismo*,
 * *Noli Me Tangere* / *Noli me tángere*. The article list is deliberately
 * short and leading-only; folding words mid-title would start merging
 * different books.
 */
const foldedTitle = (title) => {
  const folded = normTitle(title).replace(/^(the|a|an|el|la|los|las|der|die|das|le|les|il|lo) /, '')
  return folded || normTitle(title)
}

/**
 * One record speaks for each shard group: the one with the most editions,
 * which for a genuine work beats its shards by one or two orders of
 * magnitude (Noli: 134 editions against shards of 1–4). Max is taken
 * explicitly rather than trusting the response order, so a disk-cached
 * response from the relevance-sorted era folds correctly too. Translations
 * filed as their own works under their own titles (*The Social Cancer*,
 * *An eagle flight*) are beyond a title fold — only external knowledge could
 * merge those, so they stay, ranked down by their own edition counts.
 */
const dedupeShards = (docs) => {
  const best = new Map()
  for (const w of docs) {
    const key = foldedTitle(w.title)
    const kept = best.get(key)
    if (!kept || (w.edition_count ?? 0) > (kept.edition_count ?? 0)) best.set(key, w)
  }
  return docs.filter((w) => best.get(foldedTitle(w.title)) === w)
}

/** Docs worth a card, best-presented first, capped — one selection for both
 * `authorWorkEntries` and `scanIdsToVerify`, so they cannot drift. */
const selectDocs = (response, cap) =>
  dedupeShards((response?.docs ?? []).filter((w) => w?.title))
    .map((w, i) => ({ w, i }))
    // Covered works lead; stable within each group, so the server's own
    // editions order breaks ties.
    .sort((a, b) => Number(Boolean(coverUrl(b.w))) - Number(Boolean(coverUrl(a.w))) || a.i - b.i)
    .slice(0, cap)

/**
 * The scans whose word the shelf is about to take — the ones worth one
 * archive.org metadata request each before render. Only scans that will
 * actually face the reader qualify: a work beyond the cap, or one whose `ia`
 * carries no access verdict, is not worth the request.
 */
export const scanIdsToVerify = (response, { cap }) => [
  ...new Set(
    selectDocs(response, cap)
      .map(({ w }) => scanId(w))
      .filter(Boolean),
  ),
]

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
 * `iaMeta` maps scan ids to their archive.org metadata (`result` of
 * `iaMetadataUrl`), for the scans the caller chose to verify — see
 * `scanIdsToVerify` and `scanMatchesWork`. A scan disowned by the check loses
 * both its cover AND its access verdict: the evidence was about somebody
 * else's book, so the work reverts to the no-scan posture — representative
 * cover, no edition-level claim. A kept scan whose own title reads differently
 * from the work's says so on the card, because Rizal's reader is looking at a
 * cover that plainly says "The Social Cancer" under a card that says *Noli Me
 * Tangere*, and the card should own the difference rather than hope nobody
 * notices.
 *
 * @param {{numFound?: number, docs?: Array<object>}} response  OpenLibrary's search.json
 * @param {{cap: number, olid?: string, iaMeta?: Record<string, object|null>}} options
 * @returns {{entries: Array<object>, total: number}} `total` is everything held,
 *   not everything shown, so the page can disclose the difference.
 */
export function authorWorkEntries(response, { cap, olid, iaMeta = {} }) {
  const all = (response?.docs ?? []).filter((w) => w?.title)
  const entries = selectDocs(response, cap)
    .map(({ w }) => {
      const ia = scanId(w)
      const meta = ia ? iaMeta[ia] : undefined
      const disowned = meta !== undefined && scanMatchesWork(meta, w) === false
      // A caption is for a DIFFERENT title — a translation the reader would
      // otherwise take for a wrong image — not for the work's own title
      // wearing cataloging residue (series statements, date ranges, MARC
      // shouting). Containment either way means same title: no caption.
      const scanned = scanTitle(meta)
      const alien = (() => {
        if (disowned || !meta || !scanned) return false
        const s = normTitle(scanned)
        const t = normTitle(w.title)
        return Boolean(s && t) && !s.includes(t) && !t.includes(s)
      })()
      const caption = alien ? `scanned as “${scanned}”` : null
      return {
        source: 'openlibrary',
        title: w.title,
        description: ['Book', w.first_publish_year, caption].filter(Boolean).join(' · '),
        imageUrl: disowned ? olCover(w) : coverUrl(w),
        // OpenLibrary's own page for the work, so the card is a door rather than
        // a mention — the same argument the Internet Archive cards settled.
        href: typeof w.key === 'string' ? `https://openlibrary.org${w.key}` : null,
        attribution: { author: 'Open Library', license: null },
        // Two independent reasons to withhold the subject's creator status, and
        // either one is enough: the edition is lent rather than free, or somebody
        // else helped write it. `copy` is untouched — a lent co-authored book
        // still says it is lent, because that describes the object on the card.
        access: (() => {
          const access = accessRights(disowned ? 'no_ebook' : w.ebook_access)
          return soleAuthor(w, olid) ? access : { ...access, trustsCreator: false }
        })(),
        _via: 'P648',
      }
    })
    // A disowned scan can null an image after the shelf order was decided, so
    // "covered works lead" is re-established here. The slot itself is not
    // re-auctioned — a work beyond the cap stays beyond it — which errs on the
    // side of showing what the person wrote.
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Number(Boolean(b.e.imageUrl)) - Number(Boolean(a.e.imageUrl)) || a.i - b.i)
    .map(({ e }) => e)
  return { entries, total: response?.numFound ?? all.length }
}
