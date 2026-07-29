// Phase 6: the corroborated pivot — reaching material that carries no shared
// identifier at all.
//
// Most of this project's edges are made of identifiers: an ISBN is an ISBN on
// both sides, and the join is exact. Digitised archival material often has no
// such handle. Prandtl's 1899 dissertation is scanned in the Internet Archive's
// Leiden collection with a creator, a date and an institution — and no ISBN, no
// OCLC, no Wikidata QID.
//
// What makes that reachable without guessing is that Wikidata *describes the
// object*: P1026 points at a thesis entity carrying its author, its year and the
// university it was submitted to. Matching a described object is a far stronger
// claim than matching a name, and this module is the part that decides whether a
// candidate satisfies the description. The edge it supports is `corroborated`,
// not `identifier`, and the page must say so.

/** Fold diacritics so "München" and "Munchen" compare equal. */
const fold = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()

// Words that carry no distinguishing weight in an institution's name. German
// records vary freely on these; two names differing only here are one name.
const NOISE = new Set(['zu', 'zur', 'der', 'die', 'das', 'des', 'den', 'und', 'the', 'of', 'at', 'in', 'a'])

/**
 * An institution's name reduced to the words that distinguish it. Genitive and
 * plural endings are trimmed because the same university is written both ways:
 * the Internet Archive record says *Ludwigs-Maximilians-Universität zu München*
 * where Wikidata's label says *Ludwig-Maximilians-Universität München*.
 */
function institutionTokens(name) {
  return new Set(
    fold(name)
      .split(/[^a-z0-9]+/)
      .filter(Boolean)
      .map((w) => w.replace(/s$/, ''))
      .filter((w) => w.length > 1 && !NOISE.has(w)),
  )
}

/**
 * Whether two institution names denote the same institution. Deliberately not
 * string equality — see the Ludwigs/Ludwig case above — but not fuzzy either:
 * every distinguishing word of the shorter name must appear in the longer.
 */
export function sameInstitution(holding, claimed) {
  if (!holding || !claimed) return false
  const a = institutionTokens(holding)
  const b = institutionTokens(claimed)
  if (!a.size || !b.size) return false
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  return [...small].every((w) => large.has(w))
}

/** The four-digit year in a date, however the source writes it, or null. */
function yearOf(value) {
  if (typeof value !== 'string') return null
  const m = /(\d{4})/.exec(value.replace(/^\+/, ''))
  return m ? m[1] : null
}

/**
 * Whether two dates name the same year. Year is the right granularity: the
 * holding record has a full date (1899-11-14) while Wikidata's P577 is
 * year-precision, so comparing any finer would reject every correct match.
 */
export function sameYear(holding, claimed) {
  const a = yearOf(holding)
  const b = yearOf(claimed)
  return Boolean(a && b && a === b)
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

/**
 * A date as a reader would write it. Sources disagree on precision — a holding
 * record states the day, Wikidata often only the year — and the rendering says
 * exactly as much as each source knew, rather than padding one to match.
 */
function readableDate(value) {
  if (typeof value !== 'string') return null
  const m = /(\d{4})-(\d{2})-(\d{2})/.exec(value.replace(/^\+/, ''))
  if (!m) return yearOf(value)
  const [, year, month, day] = m
  // Wikidata zeroes the parts it does not assert: +1899-00-00 means "1899".
  if (month === '00' || day === '00') return year
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`
}

/**
 * Whether a holding's creator is the person named. Surname alone is not enough —
 * this very collection holds theses by Ludwig, Hans and Antonius Prandtl — so a
 * given name must be present on both sides and agree.
 */
export function matchesName(creator, personName) {
  if (!creator || !personName) return false
  // Catalogue form is "Surname, Given"; a person's label is "Given Surname".
  const parts = fold(creator).split(',')
  const surname = parts[0].trim()
  const given = (parts[1] ?? '').trim().split(/\s+/).filter(Boolean)
  const person = fold(personName).split(/\s+/).filter(Boolean)
  if (!surname || !given.length || person.length < 2) return false
  if (person[person.length - 1] !== surname) return false
  // The first given name must appear; extra names on either side are allowed
  // ("Antonius Monacensis" fails on Antonius, not on the epithet).
  return person.slice(0, -1).some((p) => p === given[0])
}

/**
 * Whether a candidate holding satisfies the object Wikidata describes.
 *
 * All three signals are required. Two of them — a surname and a year — are
 * satisfied by coincidence often enough that a two-signal match would put a
 * wrong document on the page and label it evidence. The returned signals name
 * both sides of each agreement so the render can show its work rather than
 * assert a conclusion.
 *
 * @param {{creator?: string, date?: string, institution?: string}} candidate
 * @param {{personName: string, year: string, institution: string}} described
 */
export function corroborate(candidate, described) {
  const corroboratedBy = []
  if (matchesName(candidate.creator, described.personName))
    corroboratedBy.push({ field: 'creator', holding: candidate.creator, claimed: described.personName })
  if (sameYear(candidate.date, described.year))
    corroboratedBy.push({
      field: 'date',
      holding: readableDate(candidate.date),
      claimed: readableDate(described.year),
    })
  if (sameInstitution(candidate.institution, described.institution))
    corroboratedBy.push({ field: 'institution', holding: candidate.institution, claimed: described.institution })
  return { matched: corroboratedBy.length === 3, corroboratedBy }
}
