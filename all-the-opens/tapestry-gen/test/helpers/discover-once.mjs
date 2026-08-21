// Runs one article through `discover` and prints a structural summary of the
// result as JSON on stdout. Diagnostics go to stderr, as they do in the server.
//
// A separate process on purpose: `CACHE` is resolved when `src/http.js` is
// first loaded, so `TAPESTRY_CACHE` has to be set before any import of it.
// Doing that inside a test file would depend on import order staying subtle.

import { discover } from '../../src/discover.js'

const page = process.argv[2]
const { bands, stats, reach, holder } = await discover(page)

const summary = {
  stats,
  reach: reach ? Object.keys(reach).sort() : null,
  holder: holder ? holder.partner : null,
  bands: bands.map((b) => ({
    id: b.id,
    title: b.title,
    entries: b.entries.length,
    // What each card claims to be, which is what the lede's own lookups set.
    standings: [...new Set(b.entries.map((e) => e.standing ?? null))].filter(Boolean).sort(),
    topics: [...new Set(b.entries.map((e) => e.topic ?? null))].filter(Boolean).sort(),
    sources: [...new Set(b.entries.map((e) => e.source))].sort(),
    footnotes: b.footnotes.length,
    citations: b.citations ? { total: b.citations.total, searched: b.citations.searched } : null,
    samples: b.samples.length,
  })),
}
process.stdout.write(JSON.stringify(summary, null, 2))
