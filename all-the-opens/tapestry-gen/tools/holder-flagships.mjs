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
export const HOLDER_FLAGSHIPS = [
  'The Night Watch', // rijks
  'Washington Crossing the Delaware (1851 paintings)', // met
  'American Gothic', // artic
  'The Brierwood Pipe', // cleveland
  'Irises (painting)', // getty
]
