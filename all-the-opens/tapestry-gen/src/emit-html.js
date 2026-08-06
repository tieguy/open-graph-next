import { citationHeadline, pageCitations } from './citations.js'
import { gapCounts, partnerTally, visibilityReport } from './gap.js'
import { pickHero } from './hero.js'
import { escapeHtml } from './html.js'
import { CC_MARKS, CC_SPRITE, CC_TITLES } from './cc-icons.js'

// A second rendering of the same model (bands, entries, citations) as a single
// scrolling HTML page. Where the Tapestry emitter reserves fixed pixel lanes and
// leaves dead canvas when the prose dwarfs the media, HTML lets the prose reflow
// around and below floated media/citation rails — so the layout costs nothing to
// balance. This is a comparison spike, not the finished thing.

// Each source identified by its own site's icon, not a color key. The two logos
// hosted on Wikimedia are pulled at a width its thumbnail allowlist still serves
// (32px is rejected now — the same restriction that broke the dataset thumbnails).
const SOURCE = {
  internet_archive: { name: 'Internet Archive', icon: 'https://archive.org/favicon.ico' },
  wikipedia: { name: 'Wikipedia', icon: 'https://en.wikipedia.org/favicon.ico' },
  openlibrary: { name: 'Open Library', icon: 'https://openlibrary.org/favicon.ico' },
  smithsonian: {
    name: 'Smithsonian',
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Smithsonian_sun_logo_no_text.svg/120px-Smithsonian_sun_logo_no_text.svg.png',
  },
  openstreetmap: { name: 'OpenStreetMap', icon: 'https://www.openstreetmap.org/favicon.ico' },
  // free.law, not courtlistener.com: CourtListener's favicon answers 403 to
  // every non-browser fetch, so the partner this page names most confidently
  // was the one arriving with no picture. Free Law Project is the organization
  // the credit line already says, and its own site serves the icon.
  free_law: { name: 'Free Law Project', icon: 'https://free.law/favicon.ico' },
  inaturalist: { name: 'iNaturalist', icon: 'https://www.inaturalist.org/favicon.ico' },
  gbif: { name: 'GBIF', icon: 'https://www.gbif.org/favicon.ico' },
  // favicon.ico here answers 200 with an HTML error page, which passed the old
  // size-only check and shipped a 4 KB text/html blob as OpenAlex's icon — a
  // broken image on every page that cited an open paper. This is the file the
  // site's own <link rel="icon"> names.
  openalex: { name: 'OpenAlex', icon: 'https://openalex.org/favicon.png' },
  arxiv: { name: 'arXiv', icon: 'https://arxiv.org/favicon.ico' },
  met: {
    name: 'The Met',
    // The museum's own favicon answers 429 to non-browser fetches; the logo
    // hosted on Commons serves at an allowlisted thumb width instead.
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/The_Metropolitan_Museum_of_Art_Logo.svg/120px-The_Metropolitan_Museum_of_Art_Logo.svg.png',
  },
  artic: { name: 'Art Institute of Chicago', icon: 'https://www.artic.edu/favicon.ico' },
  // Unlike the Met's, the Rijksmuseum's own favicon serves 200 to non-browser
  // clients, so this one needs no Commons stand-in.
  rijks: { name: 'Rijksmuseum', icon: 'https://www.rijksmuseum.nl/favicon.ico' },
  // Not one institution but a door many institutions share: P6108 manifests
  // arrive from whichever library or museum holds the object.
  iiif: { name: 'IIIF collections', icon: 'https://iiif.io/favicon.ico' },
  dpla: { name: 'DPLA', icon: 'https://dp.la/favicon.ico' },
  europeana: {
    name: 'Europeana',
    // europeana.eu's own favicon now 404s and the live one sits behind a
    // content-hashed Nuxt path that changes on every redeploy of their site.
    // The logo on Commons is stable and serves at an allowlisted thumb width —
    // the same reason the Met and Smithsonian icons come from there.
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Europeana_logo_2015_basic.svg/120px-Europeana_logo_2015_basic.svg.png',
  },
}

const iaEmbed = (source) => {
  const m = /archive\.org\/(?:details|embed)\/([^/?#]+)/.exec(source ?? '')
  return m ? `https://archive.org/embed/${m[1]}` : null
}

/**
 * A source's icon as an inlined data: URI, or nothing.
 *
 * Never a live hotlink. Two of these sites refuse them — CourtListener answers
 * 403, GBIF varies by referrer — so a page built on live URLs shows broken
 * images for exactly the sources a reader is least likely to recognize by name.
 * The generator fetches what it can into `inline`; whatever failed renders as a
 * named entry with no picture, which is the honest degradation.
 */
function favicon(slug, inline) {
  const url = SOURCE[slug]?.icon
  // A class, never the bytes: Apollo 11 has ~100 carousels, and inlining the
  // data URI at each one added 242 KB of the same few images repeated. The
  // bytes go in the stylesheet once (see faviconStyle) and every use is a
  // 30-byte class reference.
  return url && inline.has(url) ? `<span class="fav fav-${slug}" aria-hidden="true"></span>` : ''
}

/** Each used icon's bytes, exactly once, as background-image rules. */
function faviconStyle(slugs, inline) {
  const rules = slugs
    .map((s) => [s, inline.get(SOURCE[s]?.icon)])
    .filter(([, data]) => data)
    .map(([s, data]) => `.fav-${s}{background-image:url("${data}")}`)
  return rules.length ? `\n${rules.join('\n')}\n` : ''
}

function sourceTag(source, inline = new Map()) {
  const meta = SOURCE[source] ?? { name: source.replace(/_/g, ' '), icon: null }
  return `<span class="src">${favicon(source, inline)}${escapeHtml(meta.name)}</span>`
}

/**
 * The source slugs this page actually shows, in the order SOURCE declares them.
 * Counted by `partnerTally`, which also credits a partner whose contribution is
 * a footnote's borrow link rather than a card — a page whose references borrow
 * through Open Library twenty times is using Open Library, and a legend that
 * omits it is describing the carousels rather than the page.
 */
export function sourcesUsed(bands) {
  const tally = partnerTally(bands)
  return Object.keys(SOURCE).filter((s) => tally.has(s))
}

/** Every icon URL a page will need, so the generator can prefetch them. */
export const iconUrls = () => Object.values(SOURCE).map((m) => m.icon).filter(Boolean)

/**
 * The full source legend — every partner this pipeline can reach — with the
 * same inlined icons the article pages use. For pages ABOUT the system (the
 * front page), where the legend describes capability rather than one page's
 * findings; article pages keep building theirs from `sourcesUsed`.
 */
export function sourceLegend(inline = new Map()) {
  const keys = Object.keys(SOURCE)
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(SOURCE[s].name)}</span>`)
    .join('')
  return { html: keys, style: faviconStyle(Object.keys(SOURCE), inline) }
}

// Small numbers read better as words in a sentence about a handful of
// institutions; past a dozen the digit is clearer than the word.
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
  'eleven', 'twelve']
const spell = (n) => WORDS[n] ?? String(n)
const Cap = (s) => s.charAt(0).toUpperCase() + s.slice(1)

const TIER_LABEL = {
  shown: 'shown, and credited',
  link: 'a link only',
  invisible: 'invisible',
}

/**
 * The finding, in a sentence. Built clause by clause because the zero cases
 * are real — an article with no map has nothing in the `shown` tier, and a
 * stock sentence with a "0" in it would read as a bug rather than a result.
 */
// Never the bare phrase "the article" in this panel. A reader is looking at a
// page that shows all of these partners, so "the article shows you one of them"
// reads as a flat contradiction until you know which article is meant.
// "Original" is the word that does it: it pairs with "this page" a sentence
// earlier and names the thing on Wikipedia without a second clause.
const THE_ARTICLE = 'the original Wikipedia article'

function gapLead({ total, shown, link, invisible }) {
  // Not "everything here was published openly": the Met answers with
  // rights-reserved objects as well as CC0 ones, the Internet Archive lends
  // books that are still in copyright, and a IIIF manifest sets its own terms.
  // License claims belong on the cards, per item, where they are true. The
  // panel counts organizations, which it can count exactly.
  const out = [
    `${Cap(spell(total))} ${total === 1 ? 'organization' : 'organizations'} outside Wikipedia ` +
      `contributed rich content to this enhanced version of the article.`,
  ]
  // With nothing shown AND nothing linked there is no contrast to draw, so the
  // blunt sentence beats the clause list.
  if (!shown && !link) {
    const none =
      total === 1 ? 'It does not reach' : total === 2 ? 'Neither reaches' : 'None of them reaches'
    out.push(`${none} ${THE_ARTICLE} at all — not a picture, not a link, not a mention.`)
    return out.join(' ')
  }
  // All three tiers in one sentence. They were dropped from the lead once as
  // duplicating the table, and put back when the panel folded shut: opening it
  // now, this is the first line, and it should carry the whole finding before
  // the reader starts on rows. Verbs, not capability — "credits", "links to",
  // "does not surface" — because the premise is that Wikipedia could do more
  // and does not. "The rest" only reads after a clause it can be the rest OF,
  // and "more" likewise, so a first clause never uses either.
  const parts = []
  if (shown) parts.push(`credits ${spell(shown)} of them`)
  if (link)
    parts.push(parts.length ? `links to ${spell(link)} more` : `links to ${spell(link)} of them`)
  if (invisible)
    parts.push(
      parts.length
        ? 'does not surface the rest'
        : `does not surface ${invisible === 1 ? 'it' : 'any of them'}`,
    )
  const list =
    parts.length > 2
      ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
      : parts.join(' and ')
  out.push(`${Cap(THE_ARTICLE)} ${list}.`)
  return out.join(' ')
}

/**
 * Who this article can and cannot show — the page's own headline finding, made
 * where the reader is already looking at what is missing.
 *
 * Nothing here is a request or a to-do. It is a report: these collections
 * exist, they are open, Wikidata records them, and no established route puts
 * them in front of a reader on this page. A request would walk straight into
 * Wikipedia's rule that a disputed external link stays out until someone
 * argues it in; a measurement does not.
 */
export function gapPanel(bands, reach, inline = new Map()) {
  if (!reach) return ''
  const report = visibilityReport(bands, reach)
  if (!report.length) return ''
  const counts = gapCounts(report)
  // Two columns, because there are two different questions and running them
  // together in prose is exactly what confused a reader: what did this partner
  // give the page in front of you, and how much of it can Wikipedia show? The
  // column headings carry the distinction so the cells do not have to.
  const rows = report
    .map((r) => {
      const name = SOURCE[r.slug]?.name ?? r.slug.replace(/_/g, ' ')
      // Two countable things, never added together — a reader looking at six
      // cards must not be told there are thirteen. Each number names what it
      // counts, so both can be checked against the page.
      const items = [
        r.count.cards && `${r.count.cards} ${r.count.cards === 1 ? 'card' : 'cards'}`,
        r.count.notes && `${r.count.notes} footnote${r.count.notes === 1 ? '' : 's'}`,
      ]
        .filter(Boolean)
        .join('<br>')
      const where = r.where ? `<span class="gap-where">${escapeHtml(r.where)}</span>` : ''
      return (
        `<tr class="gap-${r.tier}">` +
        `<th scope="row" class="gap-who">${favicon(r.slug, inline)}${escapeHtml(name)}</th>` +
        `<td class="gap-gave">${items}</td>` +
        `<td class="gap-seen"><span class="gap-tier">${TIER_LABEL[r.tier]}</span>${where}</td></tr>`
      )
    })
    .join('')
  // The same finding measured on citations instead of institutions, said once
  // for the whole page. It sits under the table because it is the second half
  // of one argument, not a separate box.
  const cites = citationHeadline(pageCitations(bands))
  // Shut by default (2026-08-04 review). The masthead's job is to say what the
  // page is and credit the friends who filled it; the measurement answers a
  // question a reader has to ask first, and one who has not asked it should
  // meet a single quiet line rather than a table. The "why" is plain prose
  // inside — a second fold nested in a fold nobody has opened buys nothing.
  return (
    `<details class="gap"><summary>Who helped, and who Wikipedia doesn’t show</summary>` +
    `<div class="gap-body">` +
    `<p class="gap-lead">${escapeHtml(gapLead(counts))}</p>` +
    `<table class="gap-list"><thead><tr><th scope="col">Who</th>` +
    `<th scope="col">Helping here</th><th scope="col">On Wikipedia</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>` +
    (cites ? `<p class="gap-cites">${escapeHtml(cites)}</p>` : '') +
    `</div></details>`
  )
}

/**
 * The license glyphs, as a row of `<use>` references into the sprite.
 *
 * Marks are validated against the sprite's own vocabulary rather than trusted:
 * a mark id with no symbol renders as an empty box, and an empty box beside a
 * credit line reads as "there is a license here" while saying nothing. Better
 * to drop it.
 *
 * The row carries the words too, in a visually-hidden span. A screen reader
 * that met four unlabeled icons would get nothing, and the whole point of the
 * row is to say what a reader may do with the thing.
 */
export function rightsMarks(marks, label) {
  const known = (marks ?? []).filter((m) => CC_MARKS.includes(m))
  if (!known.length) return ''
  const glyphs = known
    .map(
      (m) =>
        `<svg class="ccmark" role="img" aria-hidden="true" focusable="false">` +
        `<use href="#cc-${m}"></use></svg>`,
    )
    .join('')
  const words = label ?? known.map((m) => CC_TITLES[m]).filter(Boolean).join(', ')
  return (
    `<span class="ccrow" title="${escapeHtml(words)}">${glyphs}` +
    `<span class="vh">${escapeHtml(words)}</span></span>`
  )
}

/**
 * Which verdict the card leads with: the copy's own license, else the work's
 * status. The copy's is a promise the host actually made about these bytes.
 */
function shownRights(entry) {
  const r = entry.rights ?? {}
  return r.copy ?? r.work ?? null
}

/**
 * The licence marks, on the ITEM — beside its title, not beside its source.
 *
 * They used to lead the credit line, which put them immediately before the
 * institution's name: "⊘ Open Library" reads as a claim about Open Library, and
 * the one thing the mark is never about is who handed you the bytes. Beside the
 * title it sits on the thing it describes.
 */
function itemMarks(entry) {
  const shown = shownRights(entry)
  return shown ? rightsMarks(shown.marks, shown.label) : ''
}

/**
 * The credit line: who to thank, followed by their own icon.
 *
 * The icon trails the name for the same reason the licence mark trails the
 * title — both are marks ON a thing, and a card whose every line opens with a
 * glyph has a column of glyphs down its left edge and no obvious place to start
 * reading. Name first, then the badge that qualifies it.
 */
function credit(entry, inline = new Map(), withSource = true) {
  if (!entry.attribution) return ''
  const words = escapeHtml(
    [entry.attribution.author, entry.attribution.license].filter(Boolean).join(' · '),
  )
  if (!words) return ''
  // The hero already carries a full source tag of its own; a second icon on the
  // line below it would be the same fact twice.
  const icon = withSource ? favicon(entry.source, inline) : ''
  return `<p class="credit">${words}${icon}</p>`
}

/**
 * The rights line: shown ONLY when the answer is not the same everywhere, or
 * when it came from the creator rather than from the work.
 *
 * A card whose answer is simple does not get this — the glyphs and the credit
 * already said it, and a line repeating them would be the thin box this page
 * keeps deleting. What earns the space is a disagreement: public domain in one
 * country and in copyright in another is a fact the article it sits beside
 * cannot tell you, and it is the reason this feature exists.
 *
 * The free clause leads. That is a deliberate editorial choice with a cost — a
 * reader in a longer-term country could stop after the first clause — and the
 * mitigation is structural: `src/rights.js` never emits the free clause alone,
 * and the Paulina link in the fold is how a reader gets the answer for where
 * they actually are.
 */
function rightsLine(entry) {
  // A copy-level NOTE is the lending case, and it earns the same line a
  // work-level contrast does: "lent, not free" is the whole substance of what
  // the card knows, and a glyph alone would leave the reader to infer it. Most
  // copy verdicts have no note — their license is already in the credit words
  // beside the glyphs, and repeating it would be the thin box this page keeps
  // deleting.
  const line = entry.rights?.work?.line ?? entry.rights?.copy?.note
  return line ? `<p class="rights-line">${escapeHtml(line)}</p>` : ''
}

// A compact card for a horizontal carousel. The source is not repeated here — it
// labels the whole carousel — so the card carries only the item and why it landed.
function card(entry, inline) {
  const embed = entry.media ? iaEmbed(entry.media.source) : null
  let visual = ''
  if (embed) {
    const tall = entry.media.webpageType === 'iaAudio' ? ' audio' : ''
    visual =
      `<div class="frame${tall}"><iframe src="${escapeHtml(embed)}" loading="lazy" ` +
      `allowfullscreen title="${escapeHtml(entry.title)}"></iframe></div>`
  } else if (entry.imageUrl) {
    const src = inline.get(entry.imageUrl) ?? entry.imageUrl
    // Partner thumbnails rot and hotlink-block (DPLA's `object` URLs point at
    // the provider, not at DPLA). A broken-icon card is worse than a text
    // card, so a thumbnail that fails to load takes itself off the page.
    visual = `<img class="shot" src="${escapeHtml(src)}" loading="lazy" onerror="this.remove()" alt="${escapeHtml(entry.title)}">`
  }
  // An edge made by matching a description is a weaker claim than one made by a
  // shared identifier, and must not look the same. The card says so and shows
  // the agreeing signals, so a reader can judge the match rather than trust it.
  const evidence =
    entry.evidence === 'corroborated'
      ? `<p class="evidence">corroborated — no shared identifier</p>` +
        `<ul class="signals">${(entry.corroboratedBy ?? [])
          .map(
            (s) =>
              `<li><span class="sig-field">${escapeHtml(s.field)}</span>` +
              `<span class="sig-pair">${escapeHtml(String(s.holding))}</span>` +
              `<span class="sig-vs">matches</span>` +
              `<span class="sig-pair">${escapeHtml(String(s.claimed))}</span></li>`,
          )
          .join('')}</ul>`
      : ''
  // A card with an href is an open door, and the whole card says so: the
  // title links out. Cards without one stay as they were.
  // The clamp can ellipsize the visible title; the tooltip always has all of it.
  // Name, licence mark, and the mark's own "why" — see titleRow. The clamp can
  // ellipsize the visible title; the tooltip always has all of it.
  const heading = titleRow(entry)
  return (
    `<figure class="card${entry.evidence === 'corroborated' ? ' corroborated' : ''}">${visual}<figcaption>` +
    heading +
    (entry.description ? `<p class="desc">${escapeHtml(entry.description)}</p>` : '') +
    evidence +
    credit(entry, inline) +
    rightsLine(entry) +
    provenance(entry) +
    `</figcaption></figure>`
  )
}

/**
 * Why this item is here, and how we know — one control, not two.
 *
 * These were separate until 2026-08-05: a `why` line ("This is American
 * Gothic's own record of it") and, under it, a 12px grey ⓘ that opened the
 * exact chain behind the card and the door to fix it on Wikidata. Three
 * quarters of the cards on a showcase page carry that chain and a "Check or
 * fix it on Wikidata" link, which makes it the most useful thing on the card
 * and it was the least visible.
 *
 * They answer the same question at two depths, so the line that states the
 * answer is now the thing you click for the working. That costs no vertical
 * space, turns a 12px target into a full-width one, and puts the affordance
 * where a reader who has just read "why" is already looking.
 *
 * The three shapes are all real. A card in a topic-labeled shelf has its why
 * hoisted to the shelf head (see `carousel`) and keeps only the chain, so the
 * bare form has to name itself rather than relying on a glyph alone.
 */
/**
 * The rights working, for the fold: why anybody says the status is what it is,
 * and where to get the answer for the country the reader is actually in.
 *
 * This is the part that was asked for explicitly — the determination method,
 * not just the verdict. `P459` on a copyright statement holds phrases like
 * "copyright not renewed" and "70 years or more after author(s) death", which
 * are the whole argument compressed to five words, and they are the difference
 * between a page asserting a status and a page showing its working.
 *
 * Named sources, because the words are theirs: the statuses are maintained in
 * Wikidata by CopyClear and by the Dominio Público en América Latina project,
 * and Paulina is the tool that turns them into a per-country answer. None of
 * them is a content partner — they contribute no cards — so they are credited
 * here, where their work is actually being used, rather than in the friends
 * list, which counts collections.
 */
function rightsDetail(entry) {
  const work = entry.rights?.work
  const copy = entry.rights?.copy
  const parts = []
  if (copy?.url) {
    parts.push(
      `<p class="rd-lic">This copy is offered under ` +
        `<a href="${escapeHtml(copy.url)}" target="_blank" rel="noopener">${escapeHtml(copy.label)}</a>` +
        `, stated by whoever is serving it.</p>`,
    )
  }
  // Anything the card already says out loud is dropped here. On a creator-level
  // card the only detail IS the visible line ("Franz Kafka: copyrights on works
  // have expired"), so without this the panel opened by repeating, word for
  // word, the sentence sitting two lines above it.
  const said = (work?.line ?? '').replace(/[.\s]+$/, '')
  const detail = (work?.detail ?? []).filter((d) => d.replace(/[.\s]+$/, '') !== said)
  if (detail.length) {
    parts.push(
      `<p class="rd-work">${detail.map((d) => escapeHtml(d)).join(' ')} ` +
        `<span class="rd-src">Copyright status from Wikidata, where it is maintained by ` +
        `<a href="https://www.wikidata.org/wiki/Wikidata:CopyClear" target="_blank" rel="noopener">CopyClear</a>` +
        ` and the <a href="https://www.wikidata.org/wiki/Wikidata:WikiProject_Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina" target="_blank" rel="noopener">Dominio Público en América Latina</a> project.</span></p>`,
    )
  }
  // The maintainers are credited wherever their data is used, including on a
  // card whose only detail was deduped away above.
  if (work && !detail.length && work.line) {
    parts.push(
      `<p class="rd-work"><span class="rd-src">Copyright status from Wikidata, where it is maintained by ` +
        `<a href="https://www.wikidata.org/wiki/Wikidata:CopyClear" target="_blank" rel="noopener">CopyClear</a>` +
        ` and the <a href="https://www.wikidata.org/wiki/Wikidata:WikiProject_Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina" target="_blank" rel="noopener">Dominio Público en América Latina</a> project.</span></p>`,
    )
  }
  if (work?.paulina) {
    parts.push(
      `<p class="rd-ask"><a class="fixlink" href="${escapeHtml(work.paulina.url)}" target="_blank" rel="noopener">` +
        `${escapeHtml(work.paulina.label)} ↗</a></p>`,
    )
  }
  return parts.join('')
}

/**
 * The title line: the item's name, its licence mark, and the mark's own "why".
 *
 * The working belongs HERE rather than in the connection fold below, and that
 * is the point of the arrangement: a reader who wants to know why a card claims
 * public domain should find the answer beside the claim, not inside a disclosure
 * about how the item reached the page. Two different questions, two controls.
 *
 * A flex row rather than markup inside the `<h4>`: `<details>` is flow content
 * and is not valid inside a heading. `.rwhy[open]` takes the full basis so the
 * panel drops below the title instead of squeezing it.
 */
function titleRow(entry, tag = 'h4') {
  const attr = tag === 'h4' && entry.title ? ` title="${escapeHtml(entry.title)}"` : ''
  const name = entry.href
    ? `<a href="${escapeHtml(entry.href)}" target="_blank" rel="noopener">${escapeHtml(entry.title)}</a>`
    : escapeHtml(entry.title)
  const marks = itemMarks(entry)
  const working = rightsDetail(entry)
  // No marks and nothing to explain: the plain heading, exactly as before.
  if (!marks && !working) return `<div class="title-row"><h4${attr}>${name}</h4></div>`
  // Marks but no working — a partner stated a licence and gave no reasoning —
  // so the marks ride the heading and there is no control to offer.
  if (!working) return `<div class="title-row"><h4${attr}>${name}${marks}</h4></div>`
  return (
    `<div class="title-row"><h4${attr}>${name}</h4>` +
    `<details class="rwhy"><summary title="Where these terms come from">${marks}` +
    `<span class="rinfo" aria-hidden="true">ⓘ</span>` +
    `<span class="vh">Where these terms come from</span></summary>${working}</details></div>`
  )
}

function provenance(entry) {
  const why = entry.why ? escapeHtml(entry.why) : ''
  if (!entry.trace) return why ? `<p class="why">${why}</p>` : ''
  const fix = entry.fix
    ? ` <a class="fixlink" href="${escapeHtml(entry.fix.url)}" target="_blank" rel="noopener">${escapeHtml(entry.fix.label)} ↗</a>`
    : ''
  const body = `<p>${escapeHtml(entry.trace)}${fix}</p>`
  // "How we know" named the act and not the subject — it never said WHAT is
  // known. What this fold actually answers is how the item reached the page:
  // which identifier or statement tied it to this article.
  const summary = why
    ? `<summary class="why" title="How this got here">${why}<span class="info">ⓘ</span></summary>`
    : `<summary class="why bare" title="How this got here"><span class="info">ⓘ</span>How is it connected?</summary>`
  return `<details class="prov">${summary}${body}</details>`
}

/**
 * The section's single best find, in the slot the references used to occupy.
 *
 * Bigger than a deck card because it is doing a different job: the deck is a
 * shelf to browse, this is the one thing the section wants a passing reader to
 * see. It keeps the same caption apparatus — title, description, credit, the
 * merged why/ⓘ — so nothing about a card becomes untrue when it is hoisted.
 */
function heroCard(entry, inline) {
  const embed = entry.media ? iaEmbed(entry.media.source) : null
  let visual = ''
  if (embed) {
    const tall = entry.media.webpageType === 'iaAudio' ? ' audio' : ''
    visual =
      `<div class="frame${tall}"><iframe src="${escapeHtml(embed)}" loading="lazy" ` +
      `allowfullscreen title="${escapeHtml(entry.title)}"></iframe></div>`
  } else if (entry.imageUrl) {
    const src = inline.get(entry.imageUrl) ?? entry.imageUrl
    visual = `<img class="shot" src="${escapeHtml(src)}" loading="lazy" onerror="this.remove()" alt="${escapeHtml(entry.title)}">`
  }
  const heading = titleRow(entry, 'hero')
  return (
    `<figure class="card hero-card">${visual}<figcaption>` +
    `<div class="hero-src">${sourceTag(entry.source, inline)}</div>` +
    heading +
    (entry.description ? `<p class="desc">${escapeHtml(entry.description)}</p>` : '') +
    credit(entry, inline, false) +
    rightsLine(entry) +
    provenance(entry) +
    `</figcaption></figure>`
  )
}

/**
 * An anchor whose holdings are too broad to sample, said rather than shown.
 *
 * The count is the finding — six thousand openly licensed oil paintings is a
 * fact about how much is out there, which is the page's whole argument — and
 * the link is the browse this page declined to fake with four arbitrary
 * thumbnails. See src/breadth.js for why the shelf is not simply dropped.
 */
function broadNotes(notes, inline) {
  if (!notes?.length) return ''
  return notes
    .map((n) => {
      const name = SOURCE[n.source]?.name ?? n.source
      const total = n.total.toLocaleString()
      // Each partner's count means a different thing and has to say which:
      // DPLA's is everything its partners cataloged under an authorized
      // heading, Europeana's is only the openly licensed items — the API asks
      // for `reusability=open` and the browse link carries that filter, so
      // dropping the word here would misdescribe the number and the link both.
      const what =
        n.source === 'europeana'
          ? `the ${total} openly licensed items Europeana’s partners link to ` +
            `“${n.label ?? 'this'}”`
          : n.heading
            ? `the ${total} items ${name}’s partners catalog under “${n.heading}”`
            : `the ${total} items ${name} holds under “${n.label ?? 'this'}”`
      return (
        `<p class="broad">${favicon(n.source, inline)}` +
        `<span class="broad-text"><b>Not shown here:</b> ${escapeHtml(what)} — a heading ` +
        `too broad for this page to choose four that would belong. ` +
        `<a href="${escapeHtml(n.url)}" target="_blank" rel="noopener">Browse them at ${escapeHtml(name)} ↗</a>` +
        `</span></p>`
      )
    })
    .join('')
}

// One horizontal, scroll-snapping carousel per source: the strip is labeled with
// the source's own icon, and its items scroll sideways rather than stacking into a
// tall column. When a band draws one source's media through several anchors, the
// renderer splits it into one carousel per topic (the anchor's label) — a strip
// mixing the suspension-bridge files with the strait's reads as one confused box.
function carousel(source, items, inline, topic = null, sample = null) {
  // The count badge carries the sample claim when there is one: "4 of 54",
  // not "4". This IS the disclosure, attached to the thing it discloses.
  //
  // It used to be a paragraph at the top of the deck, naming a shelf that
  // might be two shelves further down — on Brown v. Board it counted the DPLA
  // cards from above the Internet Archive and OpenStreetMap shelves, which
  // made it an unattributable claim.
  //
  // A badge and nothing else, deliberately: the shelf's own why line already
  // says what the 54 ARE ("Filed under 'Brown v. Board of Education of
  // Topeka' — the subject heading American libraries use…"), so a sentence
  // here would say the heading twice and the number three times. The full
  // sentence rides on the title for a hover, and any sample whose shelf did
  // not render falls back to a deck-level line (see bandParts) — nothing is
  // silently dropped, which is the whole point of disclosing at all.
  //
  // "1" alone in the corner is noise, but "1 of 83" is the finding.
  const count = sample
    ? `<span class="count" title="${escapeHtml(sample.text)}">${items.length} of ${sample.total.toLocaleString()}</span>`
    : items.length > 1
      ? `<span class="count">${items.length}</span>`
      : ''
  const topicTag = topic ? `<span class="topic">${escapeHtml(topic)}</span>` : ''
  // A strip whose cards all share one why line says it once, under the head —
  // four cards each repeating "Depicts X" is noise.
  //
  // This used to require a topic label too, so it only ever fired on a source
  // split across several anchors. That left the common case — one source, one
  // anchor — repeating the same line on every card AND left the count badge
  // ("6 of 10") with nothing beside it saying ten of WHAT. Hoisting whenever
  // the line is shared fixes both: the head now reads "Open Library · 6 of 10"
  // over "Written by Ludwig Prandtl".
  let shared = ''
  if (items.length > 1 && items[0].why && items.every((e) => e.why === items[0].why)) {
    shared = `<p class="carousel-why">${escapeHtml(items[0].why)}</p>`
    items = items.map((e) => ({ ...e, why: null }))
  }
  // The shelf's flex-basis is what its cards actually need (capped at three) —
  // so a one-card shelf shares its deck row with the next shelf instead of
  // claiming the whole width; wider shelves grow into whatever is left and
  // scroll for the rest.
  const basis = Math.min(items.length, 3) * 192
  return (
    `<div class="carousel" style="flex:1 1 ${basis}px"><div class="carousel-head">${sourceTag(source, inline)}${topicTag}${count}</div>` +
    shared +
    `<div class="carousel-track">${items.map((e) => card(e, inline)).join('')}</div></div>`
  )
}

/**
 * Prose and footnote HTML keeps its links as `/wiki/…`; on the streaming
 * server that IS the right href — the reader clicks from Apollo 11 to JFK and
 * gets this render of JFK. A batch file opened anywhere else re-bases them on
 * the deployed demo so the same journey still works.
 */
const relink = (html, wikiBase) =>
  wikiBase && wikiBase !== '/wiki/' ? html.replaceAll('href="/wiki/', `href="${wikiBase}`) : html

/**
 * One footnote, as Wikipedia rendered it — author, date, work, links, the
 * article's own citation — plus, when the note cites a book the open
 * ecosystem holds, the access link on the end. The id is what the prose
 * marker points at.
 */
function footnote(fn, wikiBase) {
  const access = fn.access
    ? ` <a class="fn-access" href="${escapeHtml(fn.access.url)}" target="_blank" rel="noopener">${escapeHtml(fn.access.label)} ↗</a>`
    : ''
  return (
    `<li class="fn" id="${escapeHtml(fn.id)}"><span class="fn-num">${escapeHtml(fn.num)}.</span>` +
    `<span class="fn-text">${relink(fn.html, wikiBase)}${access}</span></li>`
  )
}

/**
 * The band's references, closed by default behind one quiet line: a lede can
 * carry fifty notes, and a wall of citations must never be the first thing a
 * section shows. Clicking a marker in the prose still lands on its note —
 * `__open` (and, in newer browsers, the platform itself) expands a <details>
 * whose anchor target is inside it before the jump.
 */
function footnoteList(fns, wikiBase) {
  const items = fns.map((f) => footnote(f, wikiBase))
  return (
    `<details class="fn-fold"><summary>References in this section · ${items.length}</summary>` +
    `<ol class="fnlist">${items.join('')}</ol></details>`
  )
}

/**
 * A band's enrichment in three parts: the section's best find as a floated
 * right rail, the media shelves as a full-width deck below it (they need the
 * page's width — stacked in a narrow rail they build a column two or three
 * times taller than the text, and everything left of it is blank), and the
 * references at the foot. Each part is '' when the band has nothing for it.
 *
 * The rail held the references until 2026-08-05, which meant the most
 * prominent place in every section was a closed fold reading "REFERENCES IN
 * THIS SECTION · 18", with the prose indenting around it for a line and a
 * half. References belong where a reader goes looking for them, which is the
 * bottom; the slot belongs to whatever the section actually found.
 */
export function bandParts(b, inline = new Map(), wikiBase = '/wiki/') {
  // The hero comes out of the entries before they are shelved, so it is never
  // both hoisted and carded. A section whose only find becomes its hero has no
  // deck at all, which is the right rendering of one good thing.
  const { hero, rest } = pickHero(b.entries)
  // Group the band's media by source, in first-appearance order — then, within
  // a source, by topic (the anchor that asked for each item). A source whose
  // items all share one topic keeps a single plain carousel; one that mixes
  // topics gets one labeled carousel per topic, so "suspension bridge" media
  // never shares an undifferentiated box with "Golden Gate" media.
  const bySource = new Map()
  for (const e of rest) {
    if (!bySource.has(e.source)) bySource.set(e.source, new Map())
    const byTopic = bySource.get(e.source)
    const topic = e.topic ?? null
    if (!byTopic.has(topic)) byTopic.set(topic, [])
    byTopic.get(topic).push(e)
  }
  // Each sample claim, keyed the way shelves are keyed. `unused` is what did
  // not find a shelf — a partner whose entries were all capped away, or
  // hoisted into the hero, leaves a claim with nothing to sit on, and that
  // claim still has to be made somewhere rather than quietly disappearing.
  const shelfKey = (source, topic) => `${source}::${topic ?? ''}`
  const sampleFor = new Map((b.samples ?? []).map((s) => [shelfKey(s.source, s.topic), s]))
  const unused = new Set(sampleFor.keys())
  const media = [...bySource]
    .flatMap(([source, byTopic]) => {
      const split = byTopic.size > 1
      return [...byTopic].map(([topic, items]) => {
        const key = shelfKey(source, topic)
        unused.delete(key)
        return carousel(source, items, inline, split ? topic : null, sampleFor.get(key) ?? null)
      })
    })
    .join('')
  // The section's references, and nothing else. The coverage line that used to
  // sit under them is now one page-level sentence in the visibility panel: per
  // section it repeated a negative far more often than it reported a find, and
  // its total ("27 works") sat directly under a different total ("18 notes")
  // counting a different thing, which read as a contradiction.
  const sources = (b.footnotes ?? []).length
    ? `<div class="refs">${footnoteList(b.footnotes, wikiBase)}</div>`
    : ''
  // The fallback, and ONLY the fallback: sample claims whose shelf is not on
  // the page. Every shelf here is a sample of something larger, and a page
  // that shows six of six hundred without saying so is claiming a selection it
  // never made — so a claim that cannot reach its shelf still gets said, in
  // the paragraph these all used to live in. In the ordinary case this is
  // empty and the counts ride on the shelf heads.
  const orphans = [...unused].map((k) => sampleFor.get(k).text)
  const disclosure = orphans.length
    ? `<p class="disclosure"><b>A sample, not the whole shelf:</b> ${escapeHtml(orphans.join('. '))}</p>`
    : ''
  // The broad notes close the deck, after the shelves. They are statements
  // about an ABSENCE, and putting them above the shelves made a reader meet a
  // paragraph about cards that are not there before reaching the cards that
  // are — on Brown v. Board it landed directly under the disclosure, so two
  // grey boxes sat side by side saying "here is a sample of 54" and "1,409 is
  // too many to sample", with the DPLA shelf one of them described two shelves
  // further down. Last, and in a different voice, they cannot be confused.
  const broad = broadNotes(b.broad, inline)
  const deckBody = disclosure + media + broad
  return {
    // Both go before the prose, the status first: it is about the whole
    // article, while the hero is about one find inside it.
    rail: subjectRights(b) + (hero ? `<aside class="rail">${heroCard(hero, inline)}</aside>` : ''),
    deck: deckBody ? `<div class="deck">${deckBody}</div>` : '',
    refs: sources,
  }
}

/**
 * The article's OWN copyright status, for the case where no card can carry it.
 *
 * A page about The Great Gatsby has the richest rights data on the site —
 * public domain in the United States, still in copyright where terms run 70
 * years from the author's death — and, before this, nowhere to put it. The
 * cards that carry a work-level status are records OF a work: the Met's object,
 * a taxon, an author's own shelves. A novel has no such partner record here, so
 * the best data on the page rendered as nothing at all.
 *
 * It goes at the head of the lede, above the article's first paragraph, because
 * that is the one place a statement about "this article's subject" is not
 * free-floating — the subject is named directly above it and its prose begins
 * directly below. `discover.js` sets it ONLY when no card on the lede already
 * carries the same claim, so an article whose subject a museum does hold (where
 * the hero card already says it) never says it twice.
 */
function subjectRights(b) {
  const r = b.subjectRights
  if (!r) return ''
  const marks = rightsMarks(r.marks, r.label)
  const words = r.line ?? r.label
  if (!marks && !words) return ''
  const detail = rightsDetail({ rights: { work: r } })
  const body = detail
    ? `<details class="sr-why"><summary>Why, and what it means where you are</summary>${detail}</details>`
    : ''
  return (
    `<div class="subject-rights">` +
    `<p class="sr-line">${marks}${escapeHtml(words ?? '')}</p>${body}</div>`
  )
}

/** All three parts as one fragment — what the stream ships and the tests read. */
export function bandRail(b, inline = new Map(), wikiBase = '/wiki/') {
  const { rail, deck, refs } = bandParts(b, inline, wikiBase)
  return rail + deck + refs
}

function band(b, inline, wikiBase = '/wiki/') {
  // The prose keeps the article's own inline apparatus — wikilinks (which on
  // this site lead to more of these renders) and footnote markers pointing at
  // the gutter. No section numbering: Wikipedia doesn't number, so neither
  // does the enriched version of it.
  const prose = b.blocks
    ? b.blocks
        .map((x) => {
          const inner = x.html ? relink(x.html, wikiBase) : escapeHtml(x.text)
          return x.kind === 'h' ? `<h3>${inner}</h3>` : `<p>${inner}</p>`
        })
        .join('')
    : `<p class="note-lead">${escapeHtml(b.text ?? '')}</p>`
  // The hero floats right and the prose wraps it. The media deck comes after,
  // full-width: shelves pack side by side and wrap, instead of stacking into a
  // tall narrow column beside blank page. The references close the section.
  const { rail, deck, refs } = bandParts(b, inline, wikiBase)
  const id = b.id ? ` id="${escapeHtml(b.id)}"` : ''
  return (
    `<section class="band ${b.blocks ? 'section' : 'note'}"${id}>` +
    `<header class="band-head"><h2>${escapeHtml(b.title)}</h2></header>` +
    `<div class="band-body">${rail}<div class="prose">${prose}</div>${deck}${refs}</div>` +
    `</section>`
  )
}

/**
 * The masthead, deliberately short: the project's name (linked to the
 * explainer when the page knows where it lives), the article's, and one
 * sentence that hands the credit to the sources — then the article. The
 * verbiage about how it all works lives on the main page, not here.
 */
function hero({ title, home, legend, panel = '', extras = '' }) {
  const name = 'Help From Our Friends: An Open Knowledge Web Experiment'
  const kicker = home
    ? `<a href="${escapeHtml(home)}">${name}</a>`
    : name
  const note = home
    ? `<p class="hero-note">This is an experiment — for more detail, including the hard problems,
  see <a href="${escapeHtml(home)}">the main page</a>.</p>`
    : ''
  return `<header class="hero">
  <p class="kicker">${kicker}</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="thesis">A Wikipedia article, with what the rest of the open web holds about it
    alongside — found while you waited, by following the article’s own links and footnotes
    out to the collections that published it. Today, help came from:</p>
  <div class="legend">${legend}</div>
  <div class="gap-slot">${panel}</div>
  ${note}
  ${extras}
</header>`
}

// `inline` maps a fragile image URL (OpenLibrary covers, which redirect through
// archive.org) to a pre-fetched data: URI, so those covers render without a live
// dependency on the Internet Archive being up.
export function buildHtml({ title, bands, inline = new Map(), provenance = '', home = '', reach = null }) {
  // Intra-wiki links in a batch file re-base onto the deployed demo (or
  // whatever `home` names), so clicking through to another article still
  // lands on an enriched render rather than a broken relative path.
  const wikiBase = home ? `${home.replace(/\/$/, '')}/wiki/` : 'https://en.wikipedia.org/wiki/'
  const body = bands.map((b) => band(b, inline, wikiBase)).join('\n')

  const used = sourcesUsed(bands)
  const legend = used
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(SOURCE[s].name)}</span>`)
    .join('')

  // Explain the one visual distinction that carries an argument, and only when
  // the page actually uses it — a key to a style nothing on the page has is
  // noise, and worse, implies a rigour this render did not exercise.
  const hasCorroborated = bands.some((b) => (b.entries ?? []).some((e) => e.evidence === 'corroborated'))
  const evidenceKey = hasCorroborated
    ? `<p class="evidence-key"><span class="swatch"></span>A dashed card is a <b>corroborated</b> match. ` +
      `No identifier is shared by the two records — none exists on either side — so it was matched on the ` +
      `object Wikidata <i>describes</i>: an author, a date and an institution that all agree. The agreeing ` +
      `values are printed on the card, because a description that agrees is a weaker claim than an ` +
      `identifier that matches, and must not be read as one.</p>`
    : ''

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}${faviconStyle(used, inline)}
</style>
${FOLD_JS}
</head>
<body>
${CC_SPRITE}
${hero({ title, home, legend, panel: gapPanel(bands, reach, inline), extras: evidenceKey })}
<main>
${body}
</main>
<footer class="foot">
  <p>${provenance ? `${provenance} ` : ''}Article text CC BY-SA 4.0;
  media under their own licenses, shown on each item. Copyright status from Wikidata, maintained
  there by <a href="https://www.wikidata.org/wiki/Wikidata:CopyClear">CopyClear</a> and the
  <a href="https://www.wikidata.org/wiki/Wikidata:WikiProject_Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina">Dominio
  Público en América Latina</a> project; per-country answers from
  <a href="https://paulina.toolforge.org">Paulina</a>.</p>
</footer>
</body>
</html>
`
}

// ---------------------------------------------------------------------------
// Streaming (Phase 7): the same page, delivered as one chunked response. The
// shell and full spine go out first — the article renders before any pivot
// answers — and each band's rail follows as a <template> plus a one-line
// script that moves it into place as the browser parses it. No framework, no
// client round-trips: the stream IS the page.

// The references fold closed, and a prose marker must still land on its note:
// before the jump, open every <details> above the target. Newer engines do
// this natively for fragment targets; this covers the rest, and re-scrolls
// because the browser measured the jump while the fold was still closed.
const FOLD_JS = `<script>
function __open(){var e=location.hash&&document.getElementById(location.hash.slice(1));
var d=e&&e.closest("details");while(d){d.open=true;d=d.parentElement&&d.parentElement.closest("details")}
if(e)e.scrollIntoView()}
window.addEventListener("hashchange",__open);
window.addEventListener("load",function(){if(location.hash)__open()})
</script>`

// The relocation helpers, inlined into the head so they exist before the
// first fragment arrives. `__thb` mounts a band's enrichment — the floated
// hero goes before the prose, everything after it (deck, then references)
// appends in template order, which is why the fragment's own order is the
// rendered order. `__fill`/`__append` place the masthead's legend and notes
// once the page knows its sources.
const RELOCATE_JS = `<script>
function __thb(t,b){var p=document.getElementById(t),s=document.getElementById(b);
if(p&&s){var bb=s.querySelector(".band-body"),pr=s.querySelector(".prose"),e;
while((e=p.content.firstElementChild)){if(e.classList.contains("rail")||e.classList.contains("subject-rights"))bb.insertBefore(e,pr);else bb.appendChild(e)}p.remove()}}
function __fill(t,q){var p=document.getElementById(t),e=document.querySelector(q);
if(p&&e){e.replaceChildren(p.content.cloneNode(true));p.remove()}}
function __append(t,q){var p=document.getElementById(t),e=document.querySelector(q);
if(p&&e){e.appendChild(p.content.cloneNode(true));p.remove()}}
function __before(t,q){var p=document.getElementById(t),e=document.querySelector(q);
if(p&&e){e.parentNode.insertBefore(p.content.cloneNode(true),e);p.remove()}}
window.addEventListener("load",function(){if(!window.__tapdone){
var f=document.querySelector(".finding");if(f)f.textContent="Stopped before the search finished.";
document.body.insertAdjacentHTML("beforeend",'<div class="stream-cut">The stream was interrupted before every section finished — what you see is real but incomplete. <a href="javascript:location.reload()">Reload</a> to run it again.</div>')}})
</script>`

/**
 * Everything up to and including the spine: head, hero (with an empty legend
 * the stream fills later), and every band with its prose but no rail. Icon
 * styles for ALL sources are emitted up front — a streaming page cannot know
 * yet which it will use, and the unused rules cost bytes, not correctness.
 */
/**
 * What stands in the legend's place while the pivots are still answering.
 *
 * A streamed page knows its sources only when every band has landed, so
 * between the spine (~1s) and the last rail (up to a minute cold) the masthead
 * said "Today, help came from:" above an empty strip — which reads as broken
 * rather than busy. `__fill` replaces the legend's children when the real list
 * arrives, so this needs no teardown of its own.
 *
 * No counter and no percentage: the page cannot know how many friends it will
 * find until it has found them, and a progress bar that invents a denominator
 * is a lie told in the one place this project is about not telling them.
 */
const FINDING =
  '<span class="finding" role="status">Asking libraries, museums, archives and mapmakers…</span>'

export function streamOpen({ title, units, inline = new Map(), home = '/' }) {
  const spine = units
    .map((u) =>
      band({ id: u.index === '0' ? 'slede' : `s${u.index}`, title: u.title, blocks: u.blocks }, inline),
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLE}${faviconStyle(Object.keys(SOURCE), inline)}
</style>
${FOLD_JS}
${RELOCATE_JS}
</head>
<body>
${CC_SPRITE}
${hero({ title, home, legend: FINDING })}
<main>
${spine}
`
}

/**
 * One band's enrichment as a stream fragment: the rail in a template, and the
 * instruction to mount it. Empty string when the band has nothing to add —
 * a band with no findings needs no bytes, and its absence IS the finding.
 */
export function streamBand(b, inline = new Map()) {
  const rail = bandRail(b, inline)
  if (!rail) return ''
  return `<template id="tpl-${escapeHtml(b.id)}">${rail}</template><script>__thb("tpl-${escapeHtml(b.id)}","${escapeHtml(b.id)}")</script>\n`
}

/**
 * The hero's legend and per-page notes, streamed once every band has landed —
 * only then does the page know which sources it used and whether any anchor
 * drew arbitrarily.
 */
export function streamHeroExtras(bands, { inline = new Map(), home = '', reach = null } = {}) {
  const used = sourcesUsed(bands)
  const legend = used
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(SOURCE[s].name)}</span>`)
    .join('')
  const evidenceKey = bands.some((b) => (b.entries ?? []).some((e) => e.evidence === 'corroborated'))
    ? `<p class="evidence-key"><span class="swatch"></span>A dashed card is a <b>corroborated</b> match. ` +
      `No identifier is shared by the two records — none exists on either side — so it was matched on the ` +
      `object Wikidata <i>describes</i>: an author, a date and an institution that all agree. The agreeing ` +
      `values are printed on the card, because a description that agrees is a weaker claim than an ` +
      `identifier that matches, and must not be read as one.</p>`
    : ''
  // The visibility panel can only be built once every band has landed: it is a
  // statement about the whole page, and a partial one would undercount who is
  // missing — the one number on the page that must never be flattering. It
  // mounts into `.hero-body`, the masthead's second column — beside what the
  // page says about itself, never ahead of it. A finding about the page must
  // not be the first thing a reader meets, before they know what the page is.
  const panel = gapPanel(bands, reach, inline)
  return (
    `<template id="tpl-legend">${legend}</template><script>__fill("tpl-legend",".legend")</script>\n` +
    // Into its own slot, which the shell already carries empty. The panel is
    // shut by default, so where it lands costs the masthead no height.
    (panel
      ? `<template id="tpl-gap">${panel}</template><script>__fill("tpl-gap",".gap-slot")</script>\n`
      : '') +
    (evidenceKey
      ? `<template id="tpl-notes">${evidenceKey}</template><script>__append("tpl-notes",".hero")</script>\n`
      : '')
  )
}

/** The close of the stream: footer and document end. The flag tells the
 * shell's load listener the stream finished on purpose — without it, a page
 * whose connection died mid-stream would look merely sparse, and a reader
 * cannot tell honest absence from a cut wire. */
export function streamClose({ provenance = '' } = {}) {
  return `<script>window.__tapdone=1</script>
</main>
<footer class="foot">
  <p>${provenance ? `${provenance} ` : ''}Article text CC BY-SA 4.0;
  media under their own licenses, shown on each item. Copyright status from Wikidata, maintained
  there by <a href="https://www.wikidata.org/wiki/Wikidata:CopyClear">CopyClear</a> and the
  <a href="https://www.wikidata.org/wiki/Wikidata:WikiProject_Dominio_P%C3%BAblico_en_Am%C3%A9rica_Latina">Dominio
  Público en América Latina</a> project; per-country answers from
  <a href="https://paulina.toolforge.org">Paulina</a>.</p>
</footer>
</body>
</html>
`
}

const STYLE = `
:root{
  --bg:#f8f9fa; --paper:#ffffff; --ink:#202122; --head:#0b0d0f; --muted:#54595d;
  --rule:#d5d8dc; --faint:#eceef0; --link:#3366cc;
  --serif:Charter,"Bitstream Charter","Iowan Old Style","Palatino Linotype",Palatino,Georgia,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--serif);
  font-size:19px;line-height:1.7;text-rendering:optimizeLegibility}
a{color:var(--link)}
img{max-width:100%;display:block}

.hero{max-width:1180px;margin:0 auto;padding:40px 40px 30px;border-bottom:1px solid var(--rule)}
.kicker{font-family:var(--sans);font-size:.72rem;letter-spacing:.18em;text-transform:uppercase;
  color:var(--muted);margin:0 0 18px}
.kicker a{color:inherit;text-decoration:none}
.kicker a:hover{color:var(--link)}
.hero h1{font-size:clamp(2.1rem,4.5vw,3.4rem);line-height:1.05;letter-spacing:-.02em;
  margin:0 0 14px;color:var(--head);font-weight:600}
.hero .thesis{font-family:var(--sans);font-size:.95rem;line-height:1.6;max-width:70ch;color:var(--muted);margin:0 0 12px}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-family:var(--sans);font-size:.75rem;color:var(--muted);
  min-height:16px;margin:0 0 12px}
.hero-note{font-family:var(--sans);font-size:.78rem;line-height:1.55;color:var(--muted);margin:0}
.key{display:inline-flex;align-items:center;gap:8px}
/* The legend's stand-in while the pivots answer. A slow pulse, not a spinner:
   the work is a polite serial crawl of other people's APIs, and it should look
   like patience rather than a progress bar counting to a number nobody knows. */
.finding{font-style:italic;animation:finding 1.9s ease-in-out infinite}
@keyframes finding{0%,100%{opacity:.45}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.finding{animation:none;opacity:.7}}
.fav{width:16px;height:16px;flex:none;border-radius:2px;background:#fff no-repeat center;background-size:contain;display:inline-block}

main{max-width:1180px;margin:0 auto;padding:0 40px}
.band{padding:32px 0}
.band+.band{border-top:1px solid var(--rule)}
.band:first-child{padding-top:28px}
.band-head{margin:0 0 22px}
.band-head h2{font-size:clamp(1.6rem,2.8vw,2.2rem);line-height:1.1;letter-spacing:-.01em;
  margin:0;color:var(--head);font-weight:600}
.note .band-head h2{font-style:italic}

/* Wikipedian inline apparatus: quiet blue links, superscript footnote markers. */
.prose a{color:var(--link);text-decoration:none}
.prose a:hover{text-decoration:underline}
.prose a.ext::after{content:"\\2197";font-size:.7em;margin-left:2px;color:#8a8f95}
sup.ref{font-size:.72em;line-height:0}
sup.ref a{color:var(--link);text-decoration:none}
sup.ref a:hover{text-decoration:underline}

/* The load-bearing layout choice: the body is a flow-root, media and citations
   float to the rails, and the prose reflows around and below them — no reserved
   empty column, so a long section with sparse media has no dead space. */
.band-body{display:flow-root}
.prose{}
.prose p{margin:0 0 1.05em;max-width:42em}
.prose h3{font-family:var(--sans);font-size:1.05rem;letter-spacing:.01em;font-weight:700;
  color:var(--head);margin:1.8em 0 .5em}
.note-lead{font-size:1.15rem;font-style:italic;color:#3a3f45;max-width:46em}

/* The rail (the section's best find) narrows in steps so the two-column layout
   survives well below a full desktop width — a hi-DPI laptop at default scaling
   reports a narrow CSS width, and it should still read as article + margin. */
.rail{float:right;width:330px;margin:4px 0 26px 46px}
@media(max-width:1040px){.rail{width:300px;margin-left:38px}}
@media(max-width:860px){.rail{width:260px;margin-left:28px}}

/* The hero: the one thing the section wants a passing reader to see. It is a
   card, so everything true of a card stays true of it — it is just given the
   room to be looked at rather than scanned past. */
.hero-card{flex:none;width:100%;margin:0}
.hero-card .shot{border-radius:5px;box-shadow:0 2px 8px rgba(0,0,0,.16)}
.hero-card figcaption{padding-top:10px}
.hero-src{margin:0 0 6px}
/* No line clamp here: the hero has the room, and a hero whose title is cut off
   mid-word is a worse advertisement for the find than a title on three lines. */
.hero-card h4{font-size:1.08rem;line-height:1.3;margin:0 0 5px;display:block;-webkit-line-clamp:none}
.hero-card .desc{font-size:.8rem;-webkit-line-clamp:3}
.hero-card .credit{font-size:.72rem;-webkit-line-clamp:3}

/* The media deck: full-width, below the prose. Shelves size to their cards and
   pack side by side, wrapping — a one-card shelf shares its row with the next
   shelf instead of claiming a full-width (or full-column) band of its own. */
.deck{clear:both;display:flex;flex-wrap:wrap;align-items:flex-start;gap:20px 44px;padding-top:10px}
.deck .disclosure{flex:1 1 100%;margin:0}
.deck .carousel{flex:0 1 auto;min-width:0;max-width:100%;margin:0}

/* One scroll-snapping strip per source; items scroll sideways instead of stacking. */
.carousel{margin:0 0 22px}
.carousel-head{display:flex;align-items:center;gap:8px;margin:0 0 10px}
/* "4" is decoration; "4 of 54" is the disclosure — that a shelf is a sample of
   something larger, said on the shelf rather than in a paragraph above the
   deck. So it is darker than the old bare count, and it does not wrap. */
.carousel-head .count{margin-left:auto;font-family:var(--sans);font-size:.7rem;font-weight:600;
  color:var(--muted);white-space:nowrap;flex:none}
.carousel-head .count[title]{cursor:help}
.carousel-head .topic{font-family:var(--serif);font-size:.8rem;font-weight:600;color:var(--head);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.carousel-why{font-family:var(--sans);font-size:.67rem;color:var(--muted);margin:-6px 0 8px}
.carousel-track{display:flex;gap:14px;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x proximity;
  padding-bottom:10px;scrollbar-width:thin;scrollbar-color:#c1c6cc transparent;overscroll-behavior-x:contain}
.carousel-track::-webkit-scrollbar{height:8px}
.carousel-track::-webkit-scrollbar-thumb{background:#c1c6cc;border-radius:4px}
.card{flex:0 0 178px;scroll-snap-align:start}
.src{display:inline-flex;align-items:center;gap:7px;font-size:.68rem;letter-spacing:.08em;
  text-transform:uppercase;font-weight:700;color:var(--muted)}
.frame{position:relative;aspect-ratio:16/9;background:#111;border-radius:5px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.14)}
.frame.audio{aspect-ratio:auto;height:52px;background:#1d1d20;border-radius:5px}
.frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.frame.audio iframe{position:static;height:52px}
.shot{width:100%;border-radius:5px;box-shadow:0 1px 3px rgba(0,0,0,.14);background:var(--faint)}
.card figcaption{padding-top:8px;font-family:var(--sans)}
/* Three lines before the ellipsis: archival titles spend their first line on
   throat-clearing ("Tentative statement of philosophy for the…"), and the
   deck has the vertical room the old narrow rail did not. The full title
   rides on the tooltip. */
.card h4{font-family:var(--serif);font-size:.95rem;line-height:1.22;margin:0 0 4px;color:var(--head);font-weight:600;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.card h4 a{color:inherit;text-decoration:none;border-bottom:1px solid var(--rule)}
.card h4 a:hover{color:var(--link);border-bottom-color:var(--link)}
.card .desc{font-size:.76rem;line-height:1.4;color:var(--muted);margin:0 0 5px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
/* Some credits are whole paragraphs of reuse instructions; the card shows two
   lines and keeps the rest in the DOM (and on the linked page). */
.card .credit{font-size:.68rem;color:#7a7f85;margin:0 0 4px;
  display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}

/* License marks. They ride INSIDE the credit line rather than above it, so the
   glyphs and the institution that granted them are one statement — a floating
   row of icons is a claim with no subject. currentColor is why the sprite was
   normalized: the marks take the credit's own grey and sit in the type instead
   of shouting over it. --ccmark-hole is the knocked-out center of the ring
   glyphs, which needs the card's background rather than a fixed white.
   (No backticks in this stylesheet: it is a JS template literal.) */
.ccrow{--ccmark-hole:#fff;display:inline-flex;align-items:center;gap:2px;
  vertical-align:-1px;margin-right:5px}
.ccmark{width:1.05em;height:1.05em;flex:0 0 auto;fill:currentColor}
/* On the title the marks sit in the heading's own size and weight, but not in
   its ink: full-strength black glyphs would compete with the title for the
   first look, and the title is what a reader came for. Both badges TRAIL their
   text, so the margin is on the left — a leading glyph put a column of icons
   down the card's left edge with no obvious place to start reading. */
.card h4 .ccrow{color:#7a7f85;vertical-align:-2px;margin:0 0 0 6px}
.card h4 .ccmark{width:.9em;height:.9em}
.card .credit .fav{width:13px;height:13px;vertical-align:-2px;margin-left:5px}

/* Title, mark and the mark's own control on one line. A flex row because
   <details> is flow content and is not valid inside a heading; when it opens it
   claims the full basis so the panel drops BELOW the title rather than
   squeezing it into a column. */
.title-row{display:flex;flex-wrap:wrap;align-items:baseline;column-gap:6px}
.title-row>h4{margin:0}
.rwhy{min-width:0}
.rwhy>summary{list-style:none;cursor:pointer;display:inline-flex;align-items:center;
  gap:3px;color:#7a7f85}
.rwhy>summary::-webkit-details-marker{display:none}
.rwhy>summary:hover,.rwhy[open]>summary{color:var(--link)}
.rwhy>summary .ccrow{margin:0}
.rwhy .ccmark{width:1em;height:1em}
/* A circled i, matching the connection fold below rather than avoiding it. A
   question mark was tried first, on the reasoning that two identical glyphs
   would read as one control — but "?" beside a licence mark reads as doubt
   ABOUT the licence, and casting doubt on the claim is a far worse cost than
   repeating an icon. Both controls offer more information; that they look
   alike is honest. */
.rinfo{font-weight:700;font-size:.82rem;color:var(--link);line-height:1}
.rwhy[open] .rinfo{opacity:.55}
.rwhy[open]{flex:1 1 100%}
.rwhy p{font-size:.65rem;line-height:1.5;color:var(--muted);background:var(--faint);
  border-radius:3px;padding:6px 8px;margin:6px 0 0}
.rwhy a{font-weight:600}
.rwhy .rd-src{color:#8b9096}
/* The glyphs are a summary of the words beside them; a screen reader gets the
   words. Clipped rather than display:none, which would take it out of the
   accessibility tree along with the visual. */
.vh{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}

/* The rights line: only ever present when the answer differs by country, or
   when it is the author's status rather than the work's. It is allowed to wrap
   to three lines where the credit is clamped to two, because the whole content
   of it is a distinction that a truncated sentence would invert — "public
   domain in the United States" with the second clause cut off is worse than
   not saying it. The left rule marks it as a different kind of claim from the
   credit above without adding a heading nobody asked for. */
.card .rights-line{font-size:.68rem;color:#5d6469;margin:0 0 4px;
  padding-left:6px;border-left:2px solid #d8dcdf;line-height:1.35}
.hero-card .rights-line{font-size:.72rem}

/* The article's own copyright status, at the head of the lede. Full width and
   above the prose, never floated: it is a statement about the whole subject,
   and a floated one would read as a caption for whatever wrapped around it.
   It clears the hero so the two never collide on a narrow column.
   (No backticks in this stylesheet: it is a JS template literal.) */
.subject-rights{clear:both;margin:0 0 14px;padding:9px 12px;
  background:#f6f8f8;border-left:3px solid #b9c4c6;border-radius:2px}
.subject-rights .sr-line{margin:0;font-size:.86rem;line-height:1.45;color:#3c4448}
.subject-rights .ccrow{--ccmark-hole:#f6f8f8}
.subject-rights .ccmark{width:1.25em;height:1.25em}
.sr-why{margin:5px 0 0}
.sr-why>summary{font-size:.74rem;color:#6a7176;cursor:pointer}
.sr-why p{font-size:.74rem;color:#5d6469;line-height:1.45}

/* The rights working, inside the ⓘ fold. */
.prov .rd-lic,.prov .rd-work,.prov .rd-ask{margin:6px 0 0}
.prov .rd-src{color:#8b9096}
/* The visibility panel, shut by default: one quiet line under the credit bar,
   opening into the measurement. A reader who has not yet wondered whether
   Wikipedia can show any of this should not be handed a table about it, and a
   measurement that shouts reads as a campaign either way.
   (No backticks in this stylesheet: it is a JS template literal.) */
.gap-slot:empty{display:none}
.gap{max-width:640px;margin:0 0 12px}
.gap summary{font-family:var(--sans);font-size:.72rem;letter-spacing:.04em;font-weight:700;
  color:var(--muted);cursor:pointer;width:fit-content}
.gap summary:hover{color:var(--link)}
.gap[open] summary{margin:0 0 12px;color:var(--head)}
.gap-body{padding:14px 16px;background:var(--paper);border:1px solid var(--rule);border-radius:5px}
.gap-lead{font-family:var(--sans);font-size:.78rem;line-height:1.5;color:var(--ink);margin:0 0 11px}
/* Two questions, two columns: what this partner gave the page in front of you,
   and how much of it Wikipedia can show. Running them together in prose is
   what made "the article can show you one of them" read as a contradiction. */
.gap-list{width:100%;border-collapse:collapse;margin:0 0 10px;font-family:var(--sans)}
.gap-list thead th{font-size:.58rem;letter-spacing:.09em;text-transform:uppercase;color:#9aa0a6;
  font-weight:700;text-align:left;padding:0 0 5px 10px;border-bottom:1px solid var(--rule)}
.gap-list tbody tr{border-left:3px solid var(--rule)}
.gap-list td,.gap-list tbody th{vertical-align:top;padding:6px 8px 6px 10px;text-align:left}
.gap-list tbody tr+tr th,.gap-list tbody tr+tr td{border-top:1px dotted var(--faint)}
.gap-who{font-size:.72rem;font-weight:700;color:var(--head);line-height:1.35}
/* The icon rides inline with the name so a wrapped name keeps its hanging edge. */
.gap-who .fav{width:14px;height:14px;margin-right:5px;vertical-align:-2px}
.gap-gave{color:var(--muted);font-size:.66rem;line-height:1.45;white-space:nowrap}
.gap-seen{font-size:.66rem;line-height:1.4}
.gap-tier{display:block;font-size:.58rem;letter-spacing:.07em;text-transform:uppercase;font-weight:700}
.gap-where{display:block;color:var(--muted);margin-top:2px}
.gap-shown{border-left-color:#2a7d4f}.gap-shown .gap-tier{color:#2a7d4f}
.gap-link{border-left-color:#9aa0a6}.gap-link .gap-tier{color:#6e7378}
.gap-invisible{border-left-color:#b32424}.gap-invisible .gap-tier{color:#b32424}
.gap-cites{font-family:var(--sans);font-size:.72rem;line-height:1.55;color:var(--ink);
  margin:0;padding-top:9px;border-top:1px dotted var(--rule)}
@media(max-width:640px){.gap-gave{white-space:normal}}
.evidence-key{display:flex;align-items:baseline;gap:9px;font-family:var(--sans);font-size:.72rem;line-height:1.55;color:var(--muted);max-width:62ch;margin:14px 0 0}
.evidence-key .swatch{flex:none;width:22px;height:14px;border:1px dashed #c9a227;border-radius:3px;background:#fffdf5;transform:translateY(2px)}
/* Corroborated edges read differently on purpose: a dashed rule and a stated
   reason, so a described-object match is never mistaken for a shared identifier. */
.card.corroborated{border:1px dashed #c9a227;border-radius:4px;padding:6px;background:#fffdf5}
.card .evidence{font-size:.62rem;letter-spacing:.08em;text-transform:uppercase;color:#8a6d1f;margin:0 0 5px;font-weight:600}
.card .signals{list-style:none;margin:0 0 6px;padding:0;font-size:.66rem;line-height:1.45;color:#6b6f75}
.card .signals li{display:block;margin-bottom:3px}
.card .sig-field{display:block;font-size:.58rem;letter-spacing:.08em;text-transform:uppercase;color:#a0a4a9}
.card .sig-pair{color:#4a4f55}
.card .sig-vs{color:#a0a4a9;margin:0 4px}
/* Why this item is here — and, where there is a chain behind it, the control
   that opens the chain. One line doing both jobs: the ⓘ used to sit under this
   line as its own 12px target and was the least visible thing on the card
   despite opening the most useful. */
.card .why{font-size:.67rem;color:var(--muted);margin:0;padding-top:6px;border-top:1px dotted var(--rule)}
.card .prov{margin:0}
.card .prov summary.why{list-style:none;cursor:pointer;display:block;margin:0}
.card .prov summary::-webkit-details-marker{display:none}
.card .prov summary.why:hover,.card .prov[open] summary.why{color:var(--link)}
/* The affordance, in the link color and heavier than the line it ends: a grey
   ⓘ reads as decoration, a blue one reads as a control. */
.card .prov .info{color:var(--link);font-weight:700;font-size:.82rem;margin-left:5px;
  vertical-align:-1px;line-height:1}
.card .prov summary.bare .info{margin:0 4px 0 0}
.card .prov[open] .info{opacity:.55}
.card .prov p{font-size:.65rem;line-height:1.5;color:var(--muted);background:var(--faint);
  border-radius:4px;padding:6px 8px;margin:5px 0 0}
.card .prov a{font-weight:600}
/* The one link on the card a reader can act on, rather than merely follow. */
.card .prov .fixlink{display:inline-block;margin-top:3px}
.hero-card .why,.hero-card .prov summary.why{font-size:.72rem}
.hero-card .prov p{font-size:.68rem}

/* An anchor too broad to sample: the count, and the door. Deliberately NOT a
   filled slab like .disclosure — that one describes shelves the reader can
   see, this one describes shelves that are not there, and rendering the two
   alike made them read as contradicting each other. A hairline above and open
   air behind it: a note about an absence, closing the deck. */
.broad{display:flex;gap:9px;align-items:baseline;flex:1 1 100%;font-family:var(--sans);
  font-size:.7rem;line-height:1.5;color:var(--muted);margin:4px 0 0;padding:9px 0 0;
  border-top:1px dotted var(--rule)}
.broad+.broad{margin-top:0}
.broad b{color:var(--ink);font-weight:700}
.broad .fav{flex:none;width:14px;height:14px;transform:translateY(2px);opacity:.75}
.broad-text{min-width:0}
.broad a{font-weight:600;white-space:nowrap}

.disclosure{font-family:var(--sans);font-size:.68rem;line-height:1.45;color:var(--muted);
  margin:0 0 14px;padding:7px 9px;background:var(--faint);border-left:2px solid var(--rule);border-radius:3px}
/* The references: Wikipedia's own footnotes, at the foot of the section they
   belong to. Small, hanging-numbered, with the marker's number so the prose
   and the notes agree. They floated at the TOP RIGHT of every section until
   2026-08-05, which put a closed fold in the most prominent slot on the page
   and made the prose indent around one line of small caps. */
.refs{clear:both;margin-top:30px;padding-top:16px;border-top:1px solid var(--rule)}
.fnlist{list-style:none;margin:0;padding:0;font-family:var(--sans)}
.fn{display:flex;gap:7px;font-size:.73rem;line-height:1.5;color:#54595d;margin:0 0 9px}
.fn:target{background:#eaf3ff;outline:4px solid #eaf3ff;border-radius:2px}
.fn-num{flex:none;min-width:1.7em;text-align:right;color:#8a8f95}
.fn-text{min-width:0;overflow-wrap:break-word}
.fn-text a{color:var(--link);text-decoration:none}
.fn-text a:hover{text-decoration:underline}
.fn-text cite{font-style:italic}
/* A book you can actually borrow or read gets a quiet but firm call. */
.fn-access{white-space:nowrap;font-weight:600}
/* Closed by default: one line where the wall of citations used to be. */
.fn-fold summary{font-family:var(--sans);font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;
  color:var(--muted);cursor:pointer}
.fn-fold summary:hover{color:var(--link)}
.fn-fold[open] summary{margin:0 0 12px}

/* Shown only when a streamed page's connection died before streamClose. */
.stream-cut{position:fixed;left:0;right:0;bottom:0;z-index:9;background:#fff3cd;color:#5c4a03;
  border-top:1px solid #e2ce7f;font-family:var(--sans);font-size:.8rem;line-height:1.5;
  padding:10px 20px;text-align:center}
.stream-cut a{color:#5c4a03;font-weight:600}

.foot{max-width:1180px;margin:0 auto;padding:40px;border-top:1px solid var(--rule);
  font-family:var(--sans);font-size:.8rem;color:var(--muted)}
.foot code{background:var(--faint);padding:1px 5px;border-radius:3px}

@media(max-width:900px){main{padding:0 26px}.hero{padding:32px 26px 24px}}
@media(max-width:640px){
  .hero{padding:26px 20px 20px}
  main{padding:0 20px}
  /* Stacked order: the section's best find, the article, the rest of the
     media, then the references. The DOM order already says this, but the
     float has to be undone and the flex order stated so a future DOM change
     cannot silently reshuffle a one-column page. */
  .band-body{display:flex;flex-direction:column}
  .rail{float:none;width:auto;margin:0 0 22px;order:1}
  .prose{order:2}
  .deck{order:3}
  .refs{order:4}
  .broad{display:block}
  .broad .fav{display:inline-block;margin-right:6px}
}
`
