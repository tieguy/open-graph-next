// The holder-flagship warm list: The Night Watch plus one article per wired
// museum holder — each lane's acceptance article, hand-picked and verified
// against its holder property (P4610 on American Gothic checked 2026-08-17;
// the others are the acceptance articles of the phases that wired them). The
// shared IIIF door has no flagship: it names no single institution, and its
// gate pass-rate is the QA window's question, not a warm list's.
//
// Next to the census tool on purpose: this list and the census file are the
// experiment's two checked-in populations, and neither is read at request
// time. warm.js walks this list only when HOLDER_FLAGSHIPS is set — the
// production showcase list (showcaseTitles) is untouched.
// Structured as (partner, title) so completeness is a test, not a comment:
// test/census.test.js asserts exactly one flagship per wired museum holder
// (every HOLDER_STATEMENT_VARS key), so a holder joining without a flagship
// is a red test rather than a silently uncovered lane.
export const HOLDER_FLAGSHIPS = [
  { partner: 'rijks', title: 'The Night Watch' },
  { partner: 'met', title: 'Washington Crossing the Delaware (1851 paintings)' },
  { partner: 'artic', title: 'American Gothic' },
  { partner: 'cleveland', title: 'The Brierwood Pipe' },
  { partner: 'getty', title: 'Irises (painting)' },
]
