// The holder-flagship warm list: one gate-clearing article per wired museum
// holder — a page that renders the two-party treatment — plus role-carrying
// entries, each warmed for the one behavior it demonstrates. American Gothic
// is the rights-disagreement exemplar: the Art Institute's record flags it
// not-public-domain while the graph records the work as public domain, so
// its page renders the sr-conflict disclosure rather than a holder page.
// The Hours of Jeanne d'Evreux is the manuscript more-pages exemplar.
// The shared IIIF door has no flagship: it names no single institution, and
// its gate pass-rate is the QA window's question, not a warm list's.
//
// Next to the census tool on purpose: this list and the census file are the
// experiment's two checked-in populations, and neither is read at request
// time. warm.js walks this list only when HOLDER_FLAGSHIPS=1 — the
// production showcase list (showcaseTitles) is untouched.
// Structured as (partner, title) so completeness is a test, not a comment:
// test/census.test.js asserts exactly one flagship per wired museum holder
// (every HOLDER_STATEMENT_VARS key), so a holder joining without a flagship
// is a red test rather than a silently uncovered lane.
export const HOLDER_FLAGSHIPS = [
  { partner: 'rijks', title: 'The Night Watch' },
  { partner: 'met', title: 'Washington Crossing the Delaware (1851 paintings)' },
  { partner: 'artic', title: 'A Sunday Afternoon on the Island of La Grande Jatte' },
  { partner: 'cleveland', title: 'The Brierwood Pipe' },
  { partner: 'getty', title: 'Irises (painting)' },
  { partner: 'artic', title: 'American Gothic', role: 'rights-disagreement exemplar' },
  // The Met's record states 210 images (read 2026-08-20), the deepest in the
  // manuscript lane, so its door reads "High resolution and more pages at".
  { partner: 'met', title: "Hours of Jeanne d'Evreux", role: 'manuscript more-pages exemplar' },
]
