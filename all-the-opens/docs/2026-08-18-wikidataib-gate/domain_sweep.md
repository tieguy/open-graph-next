# Domain sweep: is the data-model barrier widespread?

Read 2026-08-18, all pages current revisions via enwiki Action API (serial,
compliant UA). Question: does the taxon-domain barrier — Wikidata cannot
represent the editorial artifact the infobox needs, so references are beside
the point — recur in other domains? Objection classes: (a) data-model
mismatch, (b) sourcing/verifiability, (c) open-wiki politics/control,
(d) ergonomics/watchlist, (e) accepted / no objection found.

Method note: each verdict below rests on the discussions actually located by
the searches listed at the end; "no evidence found" means exactly that, not
"the community declined."

## Artwork — (b) + (c) dominant, (a) present at field level

`Wikipedia talk:WikiProject Visual arts/Archive 19`, section "Wikidata
infoboxes" (August 2018), on {{Infobox artwork/wikidata}} (then ~300 uses vs
~7,000 for the local template, per the discussion's own numbers; the
/wikidata variant is at 505 today per the main study — the local template's
current total was not re-verified):

- (b): "Do we like importing potentially unverified and possibly incorrect
  information without any additional review?" (IP nominator, 2018-08-10);
  "the accuracy of WD is so very low" (Johnbod, 2018-08-12).
- (c): "Not under Wikipedia's jurisdiction or control … uneditable by
  strictly-Wikipedia editors" (Randy Kryn, 2018-08-15/16).
- (a), field-semantics form: Outriggr (2018-08-15) — the template "adds lines
  like 'Owner=Sally Bequester' which are nonsense; adds inconsistent and
  poorly worded information about medium; sometimes adds a third dimension to
  paintings because, hey, depth has been bot-populated on Wikidata."
  A template defender concedes the medium case: "Wikidata's Materials used is
  a problem, it inserts the 'Oil paint, Canvas', but can be easily overwritten
  with medium = Oil on Canvas" (Vexations, 2018-08-17).

The item-to-article mapping itself (one painting, one item) is not disputed
in this thread; the model complaints are about property semantics vs
editorial phrasing, and were treated by both sides as workaroundable
(overwrite locally, suppress fields). Classification: b + c primary, a in a
weaker, field-level form.

## Books — (a) as the central, unresolved barrier

The FRBR work/edition split appears as the stated obstacle, repeatedly and
across nine years:

- Cite Q TfD, `Wikipedia:Templates for discussion/Log/2017 September 15`
  (closed no consensus): Francis Schonken (2017-09-25): "the Wikidata item
  linked from a Wikipedia page is disconnected from the latter (i.e.,
  speaking about a different topic: the *work* in Wikipedia, one single
  edition in the Wikidata item) … there is still a lot of work &
  decision-making ahead before a Cite Q-like template could be of broad
  practical use." The template's defender concedes the open problem: "This
  template represents the first steps in confronting problems like how to
  deal with multiple editions of a book" (RexxS, 2017-09-19). The same page
  records a live revert dispute (Q19231225) over whether the item should be
  work- or edition-shaped — the two sides literally edit the item back and
  forth under incompatible models.
- Still active 2026: `Wikipedia talk:WikiProject Books/Archive 21`
  (2026-01-09), routine repair guidance: "The English and Ukrainian editions
  should have separate items, but the 'written work' level item (which is
  always what should be linked to the articles) is about the general work"
  (PARAKANYAA) — i.e. editors must actively police the mapping for the
  sitelink itself to mean the right thing.

Classification: a, in the same strong form as taxa — the article's unit of
coverage (the work) and Wikidata's unit of description (often an edition)
diverge, and no amount of referencing fixes which item the infobox should
read. The WikidataIB fork ({{Infobox book/Wikidata}}) survives only as
sandbox/filtered experiments — but note, **corrected 2026-08-19**: the main
{{Infobox book}} template itself quietly fetches six fields from Wikidata
**ungated** via the 2013-era Module:Wikidata, each only when the local
parameter is empty (current wikitext, fetched 2026-08-18): P577 publication
date, P136 genre, P1104 pages, P1036 Dewey, P1149 LCC, P212 ISBN. So the
data-model barrier blocked the *fork* and the *item-mapping trust*, while an
ungated fallback path for edition-shaped facts shipped in the mainstream
template anyway — a live conditional consumer on every book article whose
infobox leaves those parameters blank.

## Settlements / population — no data-model objection found

- {{Infobox settlement}} reads coordinates, photos, website via Module:Wd;
  population is not wired. Stated plainly in
  `Wikipedia talk:Template namespace/Archive 4` (2019-03-16, Zache): "only
  thing what template:Infobox settlement reads from Wikidata is coordinates,
  photos and webpage so even if the census data is updated to Wikidata the
  infobox doesn't use it."
- A WikidataIB-based wrapper `Template:Infobox settlement/Wikidata` exists
  (current wikitext confirms it, via Module:Template wrapper). Its talk page
  (`Template talk:Infobox settlement/Wikidata`, March 2021) holds proposals
  (land/water area, population density, P242 maps) answered with "suggest you
  tackle this issue on the main template first" (Nikkimaria, 2021-03-20).
- No discussion was found where population autofill was proposed and rejected
  on point-in-time/census-vs-estimate grounds, or any other grounds.

Classification: e in the "no written objection located" sense — an absence,
not a decision. The hypothesized qualifier-modeling objection was not found
in the record examined.

## Music — no written objection found; the norms-mismatch quote lives next door

- `Template:Infobox musical artist` (117,980 articles) contains no
  WikidataIB invoke in its current wikitext (checked 2026-08-18); the 5,621
  articles where the module co-occurs are explained by other templates on the
  same pages, not by the infobox. Six hits for `intitle:"Infobox musical
  artist" Wikidata` on its template talk surfaced no proposal to fetch genre
  or any other field. Classification: e (no evidence found).
- The clearest written statement of the norms-vs-model gap is in the video
  game domain, `Wikipedia talk:WikiProject Video games/Archive 130`
  (2017-05-24, ferret): "As far as Wikidata goes, 'genre' does not obey the
  Enwiki Infobox video game rules. That is, in Wikidata eyes, there's no
  issue with setting 'science fiction' as the genre of a video game. … All we
  can really do is discuss how to utilize whats in Wikidata here on Enwiki.
  I.e. do we filter out genres we don't want when we pull the data." Note the
  resolution offered is consumer-side filtering — and the video game infobox
  subsequently *did* adopt gated default-on Wikidata fetch (P136 genre
  included), per the main study. So a norms mismatch at field level was
  treated as filterable, not disqualifying. Also present, same page
  (SharkD, 2017-05-29), a qualifier-granularity complaint: "there's no way to
  tell the country of origin just by looking at the Wikidata record. Or who
  published the game at what date if there are multiple dates."

## Genes (control) — (e), accepted wholesale

{{Infobox gene}} (12,838 articles) is fully Wikidata-fed and defended in
routine discussion as the better mechanism:
`Wikipedia:Bots/Requests for approval/Seppi333Bot` (2019-12-28, Boghog):
"{{Infobox gene}} pulls its data from Wikidata which is a much better
mechanism for storing this type of data compared to lists." The subject is
itself a database record with a curated upstream bot feed (Gene Wiki /
ProteinBoxBot pipeline), i.e. the article's unit and the item's unit
coincide by construction.

## Medical — tried wholesale, rolled back; (b) stated, with an (a)-flavored diagnosis

`Wikipedia talk:WikiProject Medicine/Archive 92`, "Wikidata for pneumonia
(failed experiment maybe)" (December 2016): {{Infobox medical condition
(new)}} briefly read medication/treatment fields from Wikidata; on
[[pneumonia]] this rendered a bot-imported drug list ("simvastatin,
ticagrelor, aztreonam, …") in place of editorial "antibiotics". Doc James
removed the Wikidata wiring (diff cited in-thread, 2016-12-11):

- (b): "If issues for basic content on such a major topic can exist in
  Wikidata for more than 7 month it is simply not a reliable source. We
  should not have it per WP:MEDRS."
- (a)-flavored: "Wikidata can do well handling discrete numerical data but
  as soon as one get into more nuanced text things become muddy."

The surviving P1995-only fetch in today's template is consistent with this
rollback; no discussion specifically justifying "only health specialty" was
found beyond it. This is the clearest tried-and-rolled-back case in the
sweep, and the trigger was a reliability incident whose diagnosis was
model-shaped (structured claims cannot carry the editorial abstraction the
infobox wants).

## Verdict

Data-model mismatch is **not taxon-specific, but it is not uniform either —
it clusters exactly where the hint predicted.** The strong, adoption-blocking
form appears where the article's unit of coverage differs from Wikidata's
unit of description: taxa vs taxon names, works vs editions. In both, the
consumers' own advocates concede the problem in writing, and it survives a
decade unresolved because referencing is orthogonal to it. A weaker,
field-level form (property semantics vs editorial phrasing: artwork medium,
video-game genre, medicine's "nuanced text") appears widely but is treated by
participants as manageable — filter, suppress, overwrite locally — and in the
video game case did not prevent gated adoption; in the medical case a
reliability incident plus this weakness ended the experiment. At the far end,
where the subject is itself a database record (genes; identifier bars
generally), the unit mismatch vanishes and adoption is wholesale and ungated.
Settlements and music show the other outcome the method must respect: no
written objection at all — absence, not decision.

## Searches and pages read (all 2026-08-18)

Searches (Cirrus, ns as noted): `"Infobox artwork/wikidata"` (ns 4|5|11, 20
hits); `"Infobox artwork" Wikidata objections OR revert OR oppose` (ns 11|5,
30); `"Infobox book" Wikidata edition` (ns 11|5, 34); `"Cite Q" edition work
Wikidata` (ns 11|4, 44); `"Infobox settlement" Wikidata population` (ns
11|5, 138); `intitle:"Infobox settlement" Wikidata population` (ns 11, 13);
`"Infobox musical artist" Wikidata genre` (ns 11|5, 42); `intitle:"Infobox
musical artist" Wikidata` (ns 11, 6); `"Infobox gene" Wikidata` (ns 11|5|4,
72); `"Infobox medical condition" Wikidata` (ns 11|5, 59); `genre Wikidata
infobox fetch OR import OR autofill musical` (ns 5|11, 182).

Pages read in full or in located sections: WT:WikiProject Visual
arts/Archive 19; WT:WikiProject Books/Archive 21;
Wikipedia:Templates for discussion/Log/2017 September 15 (Cite Q section);
WT:WikiProject Medicine/Archive 92; WT:Template namespace/Archive 4;
Template talk:Infobox settlement/Wikidata; Template:Infobox
settlement/Wikidata; WT:WikiProject Video games/Archive 130;
Wikipedia:Bots/Requests for approval/Seppi333Bot; Template:Infobox musical
artist (wikitext, from the main study's template snapshot).
