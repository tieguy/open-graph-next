import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ccFromUri,
  ccFromSlug,
  ccFromLabel,
  statusFromQid,
  rightsUrl,
  parseRightsRows,
  rightsView,
  jurisdictionPhrase,
  paulinaUrl,
  accessRights,
} from '../src/rights.js'

// ---------------------------------------------------------------- licenses

test('a rights URI becomes a verdict a reader can see and a glyph row', () => {
  assert.deepEqual(ccFromUri('http://creativecommons.org/publicdomain/zero/1.0/'), {
    code: 'CC0',
    label: 'CC0',
    marks: ['cc', 'zero'],
    rank: 0,
    url: 'https://creativecommons.org/publicdomain/zero/1.0/',
  })
  assert.equal(ccFromUri('http://creativecommons.org/publicdomain/mark/1.0/').code, 'PDM')
  assert.deepEqual(ccFromUri('https://creativecommons.org/licenses/by-sa/4.0/').marks, [
    'cc',
    'by',
    'sa',
  ])
  assert.deepEqual(ccFromUri('https://creativecommons.org/licenses/by-nc-nd/4.0/').marks, [
    'cc',
    'by',
    'nc',
    'nd',
  ])
})

test('a rights URI nobody recognizes yields nothing, never a guessed glyph', () => {
  // rightsstatements.org InC is a real and common Europeana value. It is NOT a
  // CC license and must never render CC glyphs — but it is still a true thing
  // to say, so it gets the copyright mark and its own words.
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/InC/1.0/').code, 'INC')
  assert.deepEqual(ccFromUri('http://rightsstatements.org/vocab/InC/1.0/').marks, ['copyright'])
  assert.equal(ccFromUri('http://example.org/some/local/terms'), null)
  assert.equal(ccFromUri(null), null)
  assert.equal(ccFromUri(''), null)
})

test('OpenAlex slugs that are not licenses do not become licenses', () => {
  assert.equal(ccFromSlug('cc-by').code, 'CC BY')
  assert.deepEqual(ccFromSlug('cc-by-nc-sa').marks, ['cc', 'by', 'nc', 'sa'])
  assert.equal(ccFromSlug('cc0').code, 'CC0')
  assert.equal(ccFromSlug('public-domain').code, 'PDM')
  // `other-oa` means OpenAlex knows the copy is free but not on what terms.
  // A glyph here would promise a permission nobody granted.
  assert.equal(ccFromSlug('other-oa'), null)
  assert.equal(ccFromSlug(null), null)
})

test('a Wikidata license item is read from its label, however it is versioned', () => {
  assert.equal(ccFromLabel('Creative Commons Attribution-ShareAlike 4.0 International').code, 'CC BY-SA')
  assert.equal(ccFromLabel('Creative Commons Attribution 3.0 Unported').code, 'CC BY')
  assert.equal(ccFromLabel('Creative Commons Zero v1.0 Universal').code, 'CC0')
  assert.equal(ccFromLabel('Creative Commons Attribution-NonCommercial-NoDerivatives 4.0 International').code, 'CC BY-NC-ND')
  assert.equal(ccFromLabel('Open Database License'), null)
  assert.equal(ccFromLabel(null), null)
})

// ------------------------------------------------------------ copyright status

test('the closed status vocabulary maps to marks, words, and a freedom rank', () => {
  const pd = statusFromQid('Q19652')
  assert.equal(pd.label, 'public domain')
  assert.deepEqual(pd.marks, ['pd'])
  assert.equal(pd.free, true)

  const inc = statusFromQid('Q50423863')
  assert.equal(inc.free, false)
  assert.deepEqual(inc.marks, ['copyright'])

  // The freest answer sorts first — that is the whole ordering contract.
  assert.ok(pd.rank < inc.rank)

  // A creator-level value (P7763), which is Copyclear's bot output.
  assert.equal(statusFromQid('Q71887839').free, true)
  assert.equal(statusFromQid('Q73555012').free, false)

  // "not yet determined" is a statement that nobody knows, which must never
  // render as either an answer or an absence of data.
  assert.equal(statusFromQid('Q59496158').known, false)

  assert.equal(statusFromQid('Q99999999999'), null)
  assert.equal(statusFromQid(null), null)
})

// ------------------------------------------------------------------- the query

test('the query asks one narrow question per branch, never a cross product', () => {
  const url = rightsUrl(['Q1', 'Q2'])
  const q = decodeURIComponent(url.split('query=')[1])
  assert.match(q, /VALUES \?item \{ wd:Q1 wd:Q2 \}/)
  assert.match(q, /p:P6216/)
  assert.match(q, /pq:P1001/)
  assert.match(q, /pq:P459/)
  assert.match(q, /wdt:P275/)
  assert.match(q, /wdt:P7763/)
  // UNION, not stacked OPTIONALs: five OPTIONAL blocks over a multi-valued
  // property multiply rows against each other, and one work with four
  // jurisdictions and two licenses would come back as eight rows saying
  // nothing extra. Each branch answers alone.
  assert.match(q, /UNION/)
  assert.doesNotMatch(q, /P279/, 'no transitive walk is ever asked of items')
})

test('a copyright status Wikidata has deprecated is refused, not ranked', () => {
  // A deprecated statement is an editor's record that a claim is WRONG — not
  // that it is old. Every other property here is bound through `wdt:`, which
  // serves best-rank values and so cannot return one; this branch reaches the
  // statement node directly for its qualifiers, so it has to say no itself.
  //
  // Without the filter the freest-answer-leads rule ranks disproven claims
  // alongside real ones, and a page contradicts itself: `Happy Birthday to You`
  // (Q167545) carries both `public domain [United States]` and a deprecated
  // `in copyright [United States]` — the claim a 2016 US settlement disproved —
  // and would print them in one sentence. Wikidata holds 50 such statements
  // across 47 items (measured 2026-08-15). Refusing them withholds rather than
  // misstates, which is the stance every rights rule here takes.
  const q = decodeURIComponent(rightsUrl(['Q167545']).split('query=')[1])
  assert.match(q, /wikibase:rank/)
  assert.match(q, /DeprecatedRank/)
})

test('the copyright status is the ONLY thing here read at every rank', () => {
  // Everywhere else in this repo a property is bound through `wdt:`, which
  // serves best-rank values and so can never hand back a deprecated statement
  // (test/lookups.test.js states that invariant for the partner queries). This
  // query is the single exception, and it has to be: the two qualifiers that
  // make a copyright status readable — which country it holds in, and how
  // anyone decided — hang off the statement node, which is reachable only
  // through `p:`/`ps:`.
  //
  // Reaching the statement node costs the rank guarantee `wdt:` gives for
  // free, which is why the branch buys it back with its own rank filter (the
  // test above). What THIS test settles is that the exception stays this size:
  // a new `p:`/`ps:`/`pq:` binding added for some other property fails here,
  // and has to answer the rank question for itself before it can pass.
  const q = decodeURIComponent(rightsUrl(['Q1']).split('query=')[1])
  const everyRank = [...q.matchAll(/([a-z]+):(P\d+)/g)]
    .filter(([, prefix]) => prefix !== 'wdt')
    .map(([binding]) => binding)
  assert.deepEqual(
    [...new Set(everyRank)].sort(),
    ['p:P6216', 'pq:P1001', 'pq:P459', 'ps:P6216'],
    'a new binding reads statements of every rank — filter on wikibase:rank, or read it as wdt:',
  )
})

// ---------------------------------------------------------------- row parsing

const uri = (q) => ({ type: 'uri', value: `http://www.wikidata.org/entity/${q}` })
const lit = (v) => ({ type: 'literal', value: v })

test('rows become one record per item, jurisdictions kept apart', () => {
  const rows = [
    { item: uri('Q151599'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States'), how: uri('Q1'), howLabel: lit('copyright not renewed') },
    { item: uri('Q151599'), cs: uri('Q50423863'), csLabel: lit('copyrighted'), juris: uri('Q73560261'), jurisLabel: lit('countries with 70 years pma') },
    { item: uri('Q151599'), creator: uri('Q3305213'), creatorLabel: lit('F. Scott Fitzgerald'), ccs: uri('Q73555012'), ccsLabel: lit('works protected by copyrights') },
  ]
  const map = parseRightsRows(rows)
  const rec = map.get('Q151599')
  assert.equal(rec.work.length, 2)
  assert.equal(rec.work[0].status.code, 'PD')
  assert.equal(rec.work[0].jurisdiction, 'United States')
  assert.equal(rec.work[0].how, 'copyright not renewed')
  assert.equal(rec.work[1].status.free, false)
  assert.equal(rec.creator?.status.code, 'PROTECTED')
})

test('the same statement twice is one statement, not two', () => {
  // WDQS returns a row per qualifier combination; a status with two
  // determination methods is one status. Counting rows would print the same
  // jurisdiction twice on the card.
  const rows = [
    { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States') },
    { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States'), how: uri('Q2'), howLabel: lit('copyright not renewed') },
  ]
  const rec = parseRightsRows(rows).get('Q1')
  assert.equal(rec.work.length, 1)
  assert.equal(rec.work[0].how, 'copyright not renewed')
})

test('an item nobody has answered for gets no record at all', () => {
  assert.equal(parseRightsRows([]).size, 0)
  assert.equal(parseRightsRows([{ item: uri('Q1') }]).size, 0)
})

// ------------------------------------------------------------- reader-facing

test('Wikidata jurisdiction shorthand becomes English', () => {
  assert.equal(
    jurisdictionPhrase('countries with 70 years pma'),
    'countries where copyright lasts 70 years after the author’s death',
  )
  assert.equal(
    jurisdictionPhrase('countries with 70 years pma or shorter'),
    'countries where copyright lasts 70 years after the author’s death or less',
  )
  // A plain country name is already English.
  assert.equal(jurisdictionPhrase('United States'), 'the United States')
  assert.equal(jurisdictionPhrase(null), null)
})

test('the freest answer leads, and the contrast is stated, never implied', () => {
  const rec = parseRightsRows([
    { item: uri('Q1'), cs: uri('Q50423863'), csLabel: lit('copyrighted'), juris: uri('Q183'), jurisLabel: lit('Germany') },
    { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States'), how: uri('Q2'), howLabel: lit('copyright not renewed') },
  ]).get('Q1')
  const view = rightsView(rec, { qid: 'Q1' })
  assert.deepEqual(view.marks, ['pd'], 'the glyph follows the freest answer')
  assert.match(view.line, /^public domain in the United States/)
  assert.match(view.line, /still in copyright in Germany/)
  // Short place names lead the list. "in countries where copyright lasts 80
  // years after the author's death or less and the United States" is a real
  // sentence an earlier version produced, and its tail reads as part of the
  // clause before it.
  const many = rightsView(
    parseRightsRows([
      { item: uri('Q2'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q59542795'), jurisLabel: lit('countries with 80 years pma or shorter') },
      { item: uri('Q2'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States') },
    ]).get('Q2'),
    { qid: 'Q2' },
  )
  assert.equal(
    many.line,
    'public domain in the United States and countries where copyright lasts 80 years after the author’s death or less',
  )
  // The reason lives in the fold, because the user asked for it there.
  assert.ok(view.detail.some((d) => /copyright not renewed/.test(d)))
  assert.match(view.paulina.url, /paulina\.toolforge\.org\/work\/Q1$/)
})

test('a free answer that names a country still says which country', () => {
  // Caught on a real card. American Gothic is public domain in countries whose
  // terms run 70 years or less from the author's death, and Wikidata records no
  // contrary status — so the disagreement test found nothing and the card
  // rendered a bare public-domain mark next to the museum's name, which reads
  // as a worldwide answer. A status that arrived qualified is shown qualified.
  const one = rightsView(
    parseRightsRows([
      { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States') },
    ]).get('Q1'),
    { qid: 'Q1' },
  )
  assert.equal(one.line, 'public domain in the United States')
  assert.equal(one.label, 'public domain')
  assert.deepEqual(one.marks, ['pd'])
})

test('an unqualified answer gets no line, because there is nothing to narrow', () => {
  const bare = rightsView(
    parseRightsRows([
      { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain') },
    ]).get('Q1'),
    { qid: 'Q1' },
  )
  assert.equal(bare.line, null)
  assert.deepEqual(bare.marks, ['pd'])
})

test('a creator-level answer is trusted for its mark, and still says whose it is', () => {
  // Copyclear's bots answer about PEOPLE, and that ruling is good enough to
  // mark a card with — it is a deliberate determination, recorded in the graph
  // where anyone can check it. What the mark may not do is stand alone: the
  // line names the author, so a reader cannot take it for a separate finding
  // about this particular book.
  const rec = parseRightsRows([
    { item: uri('Q217434'), self: uri('Q71887839'), selfLabel: lit('copyrights on works have expired') },
  ]).get('Q217434')
  const view = rightsView(rec, { qid: 'Q217434', kind: 'author', label: 'Grant Wood' })
  assert.deepEqual(view.marks, ['pd'])
  // No visible LINE, though: on a card whose mark already says public domain, a
  // line reading "Grant Wood: copyrights on works have expired" is the same
  // fact in a second container, and that is how it read on a live card.
  assert.equal(view.line, null)
  // The attribution survives in two places that cost nothing: the mark's own
  // label (its tooltip and screen-reader text) and the panel behind it.
  assert.equal(view.label, 'Grant Wood: copyrights on works have expired')
  assert.match(view.detail.join(' '), /Grant Wood/)
  assert.match(view.paulina.url, /paulina\.toolforge\.org\/author\/Q217434$/)
})

test('a line survives only when it says what the mark cannot', () => {
  // Jurisdiction is the case that earns one — no glyph can say "here but not
  // there", and that contrast is the whole finding.
  const split = rightsView(
    parseRightsRows([
      { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q30'), jurisLabel: lit('United States') },
      { item: uri('Q1'), cs: uri('Q50423863'), csLabel: lit('copyrighted'), juris: uri('Q183'), jurisLabel: lit('Germany') },
    ]).get('Q1'),
    { qid: 'Q1' },
  )
  assert.match(split.line, /public domain in the United States/)
  assert.match(split.line, /still in copyright in Germany/)
})

test('a work-level answer still gets its glyph even when the author is known too', () => {
  // The complement of the rule above: the mark follows the work's own status,
  // and the author's status rides along in the fold as supporting evidence.
  const rec = parseRightsRows([
    { item: uri('Q464782'), cs: uri('Q19652'), csLabel: lit('public domain'), juris: uri('Q59542795'), jurisLabel: lit('countries with 70 years pma or shorter'), how: uri('Q1'), howLabel: lit('70 years or more after author(s) death') },
    { item: uri('Q464782'), creator: uri('Q217434'), creatorLabel: lit('Grant Wood'), ccs: uri('Q71887839'), ccsLabel: lit('copyrights on works have expired') },
  ]).get('Q464782')
  const view = rightsView(rec, { qid: 'Q464782' })
  assert.deepEqual(view.marks, ['pd'])
  assert.equal(view.label, 'public domain')
  assert.match(view.detail.join(' '), /Grant Wood: copyrights on works have expired/)
})

test('a status nobody has determined surfaces as the ? mark when it is all anyone recorded', () => {
  // Until 2026-08-08 this rendered as nothing; now an honestly recorded open
  // question is shown as one — the ? mark, a label that says so, and never a
  // license glyph.
  const rec = parseRightsRows([
    { item: uri('Q1'), cs: uri('Q59496158'), csLabel: lit('not yet determined') },
  ]).get('Q1')
  const v = rightsView(rec, { qid: 'Q1' })
  assert.deepEqual(v.marks, ['unknown'])
  assert.equal(v.label, 'copyright not yet determined')
  assert.equal(v.line, null)
  assert.match(v.detail.join(' '), /not yet determined/)
  assert.match(v.detail.join(' '), /not a permission and not a restriction/)
})

test('an open question never competes with an answer', () => {
  // The same "not yet determined" beside a real status adds nothing: the
  // known answer's view is unchanged, no ? mark anywhere.
  const rec = parseRightsRows([
    { item: uri('Q1'), cs: uri('Q59496158'), csLabel: lit('not yet determined') },
    { item: uri('Q1'), cs: uri('Q19652'), csLabel: lit('public domain') },
  ]).get('Q1')
  const v = rightsView(rec, { qid: 'Q1' })
  assert.deepEqual(v.marks, ['pd'])
  assert.ok(!v.marks.includes('unknown'))
})

test('an empty record is not a view', () => {
  assert.equal(rightsView(null, { qid: 'Q1' }), null)
  assert.equal(rightsView({ work: [], licenses: [] }, { qid: 'Q1' }), null)
})

test('Paulina links name a route Paulina actually serves', () => {
  assert.equal(paulinaUrl('Q42', 'work'), 'https://paulina.toolforge.org/work/Q42')
  assert.equal(paulinaUrl('Q42', 'author'), 'https://paulina.toolforge.org/author/Q42')
  assert.equal(paulinaUrl('Q42', 'term'), 'https://paulina.toolforge.org/term/Q42')
  assert.equal(paulinaUrl('not-a-qid', 'work'), null)
  assert.equal(paulinaUrl('Q42', 'nonsense'), null)
})

// ------------------------------------------------- Open Library lending status

test('a lendable edition contradicts a creator-level public-domain ruling', () => {
  // Observed on a real card: Open Library files "Prentice Hall
  // Literature--World Masterpieces" (1991) under Franz Kafka, and Kafka's
  // creator status is "copyrights on works have expired" — so the card carried
  // a public-domain mark for a modern anthology. The Internet Archive lends
  // that edition one copy at a time, which is the mechanism for works still in
  // copyright, and the lending status is about the EDITION the card is showing
  // rather than about a body of work. It wins.
  const lent = accessRights('borrowable')
  assert.equal(lent.trustsCreator, false)
  assert.deepEqual(lent.copy.marks, ['copyright'])
  assert.match(lent.copy.label, /lent, not free/i)

  // printdisabled is the same fact, more restricted.
  assert.equal(accessRights('printdisabled').trustsCreator, false)
})

test('a freely readable edition lets the creator ruling stand', () => {
  const free = accessRights('public')
  assert.equal(free.trustsCreator, true)
  assert.equal(free.copy, null, 'nothing to state — the work status already says it')
})

test('no scan is no evidence, not evidence of copyright', () => {
  // An edition nobody has digitized tells us nothing about its status. It must
  // not be treated as lendable, and it must not suppress what Copyclear knows.
  const none = accessRights('no_ebook')
  assert.equal(none.trustsCreator, true)
  assert.equal(none.copy, null)
  // An unrecognized value behaves the same way: refuse to conclude.
  assert.equal(accessRights('something_new').trustsCreator, true)
  assert.equal(accessRights(null).trustsCreator, true)
})

test('the rightsstatements vocabulary is read where it is unambiguous', () => {
  // Sampled across DPLA 2026-08-06, rightsstatements values outnumbered CC ones
  // about three to one — dropping the whole vocabulary left most DPLA cards
  // silent.
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/NoC-US/1.0/').code, 'NOCUS')
  assert.deepEqual(ccFromUri('http://rightsstatements.org/vocab/NoC-US/1.0/').marks, ['pd'])
  assert.match(ccFromUri('http://rightsstatements.org/vocab/NoC-US/1.0/').label, /United States/)
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/NKC/1.0/').code, 'NKC')
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/InC-EDU/1.0/').code, 'INC')
})

test('a status that withholds a freedom never gets a public-domain mark', () => {
  // NoC-OKLR / NoC-CR / NoC-NC all mean "copyright expired, and something else
  // still restricts you" — a contract, a donor agreement, a non-commercial
  // condition. A pd glyph would promise what the statement explicitly denies.
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/NoC-OKLR/1.0/'), null)
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/NoC-CR/1.0/'), null)
  assert.equal(ccFromUri('http://rightsstatements.org/vocab/NoC-NC/1.0/'), null)
})

test('CNE and UND carry the ? mark and keep their own distinction', () => {
  // The rightsstatements twins of "not yet determined". They rendered as
  // nothing until 2026-08-08; now each is shown as the honest non-answer it
  // is — the ? mark, never a license glyph, and labels that keep CNE
  // ("nobody has looked") apart from UND ("looked, and could not tell").
  const cne = ccFromUri('http://rightsstatements.org/vocab/CNE/1.0/')
  assert.equal(cne.code, 'CNE')
  assert.deepEqual(cne.marks, ['unknown'])
  assert.equal(cne.label, 'copyright not evaluated')
  const und = ccFromUri('http://rightsstatements.org/vocab/UND/1.0/')
  assert.equal(und.code, 'UND')
  assert.deepEqual(und.marks, ['unknown'])
  assert.equal(und.label, 'copyright undetermined')
})

// ------------------------------------------------- partner audit, 2026-08-06

test('the license forms the Internet Archive actually uses are recognized', () => {
  // Found by auditing every partner rather than the ones already wired. Across
  // a 400-item archive.org sample, 81% of the values that WERE stated used two
  // forms this parser dropped:
  //   creativecommons.org/licenses/publicdomain/  (33) — CC's retired
  //     pre-CC0 dedication URL, still the commonest value in the index
  //   usa.gov/government-works                    (22) — a US federal work,
  //     which 17 USC §105 puts in the public domain outright
  assert.equal(ccFromUri('http://creativecommons.org/licenses/publicdomain/').code, 'PDM')
  assert.deepEqual(ccFromUri('http://creativecommons.org/licenses/publicdomain/').marks, ['pd'])
  assert.equal(ccFromUri('https://www.usa.gov/government-works').code, 'USGOV')
  assert.deepEqual(ccFromUri('https://www.usa.gov/government-works').marks, ['pd'])
})

test('a software license on a book is still refused', () => {
  // The same archive.org sample carried a GPL URL on a novel — uploader-supplied
  // metadata is messy, and widening the parser must not widen it into guessing.
  assert.equal(ccFromUri('http://www.gnu.org/licenses/gpl.html'), null)
  assert.equal(ccFromUri('https://opensource.org/licenses/MIT'), null)
})
