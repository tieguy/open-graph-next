// Whether a search-shape record is about the ARTICLE, or merely about the
// anchor that fetched it.
//
// The strict subject match (src/digitalnz.js, and DPLA's facet filter) makes
// every card's claim TRUE — this record really is filed under that heading —
// and Apollo 11 showed that truth is not relevance: a Fraggle Rock lunch box
// filed under "Smithsonian Institution", Trotsky under "Soviet Union", iPhone
// cartoons under "Adam (Biblical figure)". Each anchor genuinely appears in
// the article; each shelf was genuinely about its anchor; none of it was
// about Apollo 11.
//
// The breadth gate could not catch this, and the reason is worth keeping
// (measured 2026-08-08, LUI-145): `tooBroad`'s threshold is an ABSOLUTE item
// count, and an absolute count is partner-relative. DPLA holds tens of
// thousands of items under "New York (N.Y.)", so that shelf folds to a
// sentence; DigitalNZ holds eleven, so four of them sailed under the gate as
// cards. And no per-partner threshold exists either: within DigitalNZ the
// good shelves (Aldrin 9, Apollo 11 14) and the junk (Chicago 5, Tokyo 5,
// New York 11) have the same counts. The count was always a proxy for "is
// this anchor a box rather than a subject", and it only works when the
// partner's catalog is large and geographically local to the article.
//
// What separates good from junk is in the records themselves: their OWN
// subject fields, which the partner already returns. The Turnbull photos
// under "Aldrin, Buzz" also carry "Moon", "Space flight", "Astronauts" —
// all anchors of this article. The lunch box carries "Smithsonian
// Institution" and nothing else this article touches. So the rule: a record
// earns its card only if its subjects touch the article at least once
// BEYOND the anchor that fetched it. Shelves under the article's own
// subject are exempt, for the same reason tooBroad exempts them — items
// filed under this article's subject ARE about this article's subject.
//
// This is an internal relevance filter, never a printed claim. The card
// still says only the verified "filed under this heading"; corroboration
// decides whether the card appears, not what it asserts. That is why the
// matching here may be looser than anything the page prints: NZ partners
// file Armstrong as "Armstrong, Neil Alden, 1930-2012", a form that appears
// in LC's own record only as a fullerName, so exact-form matching would
// miss the connection a reader sees instantly. Token containment catches
// it without asserting anything a reader can't check.

import { parseEarthPoint } from './statements.js'

/**
 * A string as comparable tokens: lowercased, diacritics folded, split on
 * anything non-alphanumeric, naive plural fold. "Armstrong, Neil Alden,
 * 1930-2012" -> ['armstrong', 'neil', 'alden', '1930', '2012'].
 */
export function nameTokens(s) {
  if (typeof s !== 'string') return []
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

/**
 * Does a catalog subject string name this anchor?
 *
 * True when every token of the anchor's name appears among the subject's
 * tokens (order-free: "Neil Armstrong" is inside "Armstrong, Neil Alden,
 * 1930-2012"), or when the name's tokens joined are one of the subject's
 * adjacent-token joins ("Spaceflight" inside "Space flight to the Moon").
 * The joins run both ways because compounding does: label "Spaceflight"
 * against subject "Space flight", and label "New York City" against subject
 * "New York (N.Y.)" both have to work without caring which side fused its
 * words.
 */
export function subjectNamesAnchor(subject, name) {
  const nt = nameTokens(name)
  if (!nt.length) return false
  const st = nameTokens(subject)
  if (!st.length) return false
  const sset = new Set(st)
  for (let i = 0; i < st.length - 1; i++) sset.add(st[i] + st[i + 1])
  if (nt.every((t) => sset.has(t))) return true
  return sset.has(nt.join(''))
}

/**
 * Which topic-space anchors a record's subjects touch.
 *
 * `topic` is the page's anchor list, `[{qid, name, place}]` — every
 * candidate anchor holding an LC authority, with its English label. Each
 * anchor is counted once no matter how many subjects name it.
 */
export function anchorsTouched(subjects, topic) {
  const subs = (Array.isArray(subjects) ? subjects : []).filter((s) => typeof s === 'string')
  return topic.filter(({ name }) => subs.some((s) => subjectNamesAnchor(s, name)))
}

/**
 * The corroboration test: beyond the anchor that fetched it (`ownQid`),
 * does this record's own catalog entry connect to the article anywhere?
 * One other anchor is enough — the point is to tell "about the article"
 * from "about one thing the article mentions", not to demand density.
 *
 * PLACES DON'T CORROBORATE (`t.place`, measured into existence 2026-08-08).
 * The first version counted every anchor equally, and every junk record on
 * Apollo 11 that survived it had corroborated through a place: a cartoon
 * about Hamas touched "White House", the Tokyo bus thesis touched "Japan",
 * an NZ political cartoon touched "United States". A place subject on an
 * archival record says where, not what — half the catalogs of the world
 * are filed under "United States" without being about it. The one
 * exception is built into the topic space, not tested here: the article's
 * own subject corroborates even when it is a place, because a record that
 * touches Angkor Wat on an Angkor Wat page IS about the article.
 */
export function corroborated(subjects, topic, ownQid) {
  return anchorsTouched(subjects, topic).some((t) => t.qid !== ownQid && !t.place)
}

/**
 * The page's topic space, from maps the band already holds: every anchor
 * whose Wikidata entry states an LC authority (the same property the
 * search-shape lookups key on) and whose label is known. Pure and
 * deterministic — byte-reproducibility rides on that.
 *
 * `place` is "has an Earth coordinate": the same `parseEarthPoint` the map
 * cards use, so Tranquility Base and the Moon — lunar coordinates — remain
 * corroborators while Washington and Tokyo do not. The article's own
 * subject (`subjectQid`) is never a place here, whatever its P625 says —
 * see `corroborated` for why.
 */
export function topicSpace(statements, labels, { subjectQid } = {}) {
  const topic = []
  for (const [qid, st] of statements) {
    if (!st?.lc) continue
    const name = labels.get(qid)
    if (!name) continue
    const place = qid !== subjectQid && Boolean(parseEarthPoint(st.coord))
    topic.push({ qid, name, place })
  }
  return topic
}

// ---------------------------------------------------------------------------
// Composing the shelf: which of a heading's records are shown, and in what
// order. `corroborated` above decides whether a record may appear at all;
// these decide which of the survivors a reader actually sees.
//
// Shared across every search-shape partner (DPLA, DigitalNZ), which is why
// they live here rather than in one partner's module. They were written in
// `dpla.js` on 2026-08-08 and imported from there by `digitalnz.js` until
// 2026-08-10 — a shared mechanism carrying one partner's name while ranking
// another's shelves. Extracted, not rewritten; behavior is unchanged and the
// tests that pinned it still pass.

// Words too common to tell one record from another. Deliberately tiny: not a
// stoplist for English, only for the tokens that appear in so many headings and
// titles that scoring on them says nothing.
const STOP = new Set(['the', 'and', 'of', 'in', 'a', 'an', 'for', 'to', 'on', 'at'])

/**
 * Scoring tokens: `nameTokens` (diacritics folded, plurals folded) minus the
 * words and bare years that carry no signal.
 *
 * Years are dropped deliberately. The heading "Armstrong, Neil, 1930-2012"
 * tokenizes to include 1930 and 2012, and a photograph captioned "Street scene,
 * 1930" would otherwise score as if it were about the man.
 */
const scoreTokens = (s) => nameTokens(s).filter((w) => w.length > 2 && !STOP.has(w) && !/^\d{4}$/.test(w))

/**
 * The fold key for near-duplicates: a normalized title prefix, across holders.
 *
 * `uniqueEntries` folds an exact title per holder, which is not enough. The
 * Armstrong heading returns TEN records titled "Ceremony for Apollo 11
 * astronauts Armstrong, Aldrin, and Coll…" and five "Hollywood Blvd. and Vine
 * Street" — 60 items hold only 42 distinct title-prefixes — so ranking alone
 * would fill a shelf with four copies of one ceremony photo, which is a worse
 * shelf than the arbitrary one it replaced. Cross-holder because the duplicates
 * genuinely arrive from different contributors: Angkor Wat's Cambodia shelf was
 * shipping two identical "Inventaire descriptif des monuments du Cambodge"
 * records from two providers.
 *
 * 40 characters is a judgment call with a known failure: two genuinely different
 * items sharing a long prefix fold into one. That direction is the safe one —
 * the shelf shows one of them instead of both, and the count beside it still
 * says how many exist.
 */
const foldKey = (title) => nameTokens(title).join(' ').slice(0, 40)

/**
 * Multi-part records (an interview's reels, a scrapbook's pages) come back as
 * near-identical docs; one shelf showing the same title twice reads as a bug,
 * so only the first of each title-per-holder is kept.
 */
export function uniqueEntries(entries) {
  const seen = new Set()
  return entries.filter((e) => {
    const k = `${e.title}|${e.description}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/**
 * Which of a heading's records the shelf shows — the pick the partner's own
 * index order was making for us until 2026-08-08 (LUI-144).
 *
 * Score is `2 x (distinct anchor/heading tokens present in the title) + 1 if the
 * record has a thumbnail`, ties broken by the partner's own order, then folded
 * for near-duplicates and capped.
 *
 * **It reorders and dedupes; it never filters.** The caller's `total` stays the
 * heading's true count, so "4 of 60" remains true — which is why this is not
 * done with DPLA's `q=` parameter. Measured: `q="Neil Armstrong"` cuts that
 * count from 60 to 23, silently shrinking a denominator this project prints on
 * every shelf, and it still ranked "Bussed balloonist" fourth. Every record in a
 * facet carries the heading equally, so the partner's relevance has nothing to
 * discriminate on; the signal has to come from fields we already ask for.
 *
 * The thumbnail is worth less than one matching token, deliberately: an
 * illustrated near-miss beats a text-only near-miss, but no amount of picture
 * outranks being about the subject. The cost is real and named — the US
 * Government Publishing Office's text records ("Here men from the planet Earth
 * first set foot upon the Moon") rank below illustrated ones, and they are some
 * of the best items under that heading.
 *
 * Worst case, where no title shares a token with the anchor, every score is 0 or
 * 1 and the order falls back to the partner's own — no worse than before.
 */
export function rankShelfEntries(entries, { heading, anchorLabel, cap = 4 } = {}) {
  const want = new Set([...scoreTokens(anchorLabel), ...scoreTokens(heading)])
  const scored = entries.map((e, i) => {
    const hits = new Set(scoreTokens(e.title).filter((w) => want.has(w))).size
    return { e, i, score: hits * 2 + (e.imageUrl ? 1 : 0) }
  })
  scored.sort((a, b) => b.score - a.score || a.i - b.i)
  const seen = new Set()
  const picked = []
  for (const { e } of scored) {
    const k = foldKey(e.title)
    if (seen.has(k)) continue
    seen.add(k)
    picked.push(e)
    if (picked.length >= cap) break
  }
  return picked
}
