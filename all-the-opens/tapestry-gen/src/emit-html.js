import { citationHeadline, pageCitations } from './citations.js'
import { gapCounts, partnerTally, visibilityReport } from './gap.js'
import { heroRank, pickHero } from './hero.js'
import { escapeHtml } from './html.js'
import { CC_MARKS, CC_SPRITE, CC_TITLES } from './cc-icons.js'
import { PARTNERS } from './partners.js'
import { infoboxRows, mergedPanel } from './panel.js'

/**
 * Open Graph / Twitter Card tags, shared by the front page and every article
 * page. One image for the whole site — the sheet-music cover of "With a
 * Little Help From My Friends", src/og-cover.png, served at `/og-cover.png` —
 * rather than a per-article render: a share card is read at thumbnail size on
 * someone else's timeline, where a generated collage would be illegible
 * anyway, and one recognizable image makes every shared link read as the same
 * project. `siteOrigin` (e.g. `https://friendsof.wiki`) makes the image and
 * page URLs absolute, which the Open Graph spec requires; callers with no
 * known origin (an offline batch render) omit it and get a page with no
 * og:image rather than a broken relative one.
 */
export function ogMeta({ title, description, path = '/', siteOrigin = '' }) {
  // A trailing slash on the origin would emit `https://host//wiki/…`, which
  // the server's route regex 404s — and the sibling SITE_HOME default DOES
  // end in a slash, so the copy mistake is one an operator will make.
  siteOrigin = siteOrigin.replace(/\/+$/, '')
  // `path: null` is the busy page's case: it stands in for MANY urls, so a
  // canonical og:url would misdirect the share to the front page — it gets
  // the title, description and image, and no canonical claim.
  const url = siteOrigin && path ? `${siteOrigin}${path}` : ''
  const image = siteOrigin ? `${siteOrigin}/og-cover.png` : ''
  return `<meta property="og:type" content="website">
<meta property="og:site_name" content="Help From Our Friends">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
${url ? `<meta property="og:url" content="${escapeHtml(url)}">\n` : ''}${
    image
      ? `<meta property="og:image" content="${escapeHtml(image)}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
`
      : ''
  }`
}

/** The description every article page's share card carries — the project's
 * own words for what it did to the page, not the article's own subject. */
const ogArticleDescription = (title) =>
  `A version of the Wikipedia page for ${title}, enhanced by links to other open knowledge.`

// A second rendering of the same model (bands, entries, citations) as a single
// scrolling HTML page. Where the Tapestry emitter reserves fixed pixel lanes and
// leaves dead canvas when the prose dwarfs the media, HTML lets the prose reflow
// around and below floated media/citation rails — so the layout costs nothing to
// balance. This is a comparison spike, not the finished thing.

// Each source identified by its own site's icon, not a color key (icon notes —
// which host lies, which logo comes from Commons and why — live with each
// partner in src/partners.js). Wikipedia is the spine, not a friend, so it is
// the one source declared here rather than in the manifest; it sits second
// because this map's declaration order is the legend's display order.
const SOURCE = (() => {
  const out = {}
  for (const [slug, p] of Object.entries(PARTNERS)) {
    out[slug] = { name: p.name, icon: p.icon }
    if (slug === 'internet_archive')
      out.wikipedia = { name: 'Wikipedia', icon: 'https://en.wikipedia.org/favicon.ico' }
  }
  return out
})()

// A Smithsonian object with a 3D scan carries `media3d` — the Voyager package
// URL the museum states. It is embedded rather than linked because the scan IS
// the thing worth seeing, and 3d-api.si.edu sets neither X-Frame-Options nor a
// frame-ancestors CSP (checked 2026-08-06), so it is embeddable by design. This
// is the only partner here that ships a rotatable object; a still of it would
// be a worse card than the Met's still of a painting.
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

function sourceTag(source, inline = new Map(), nameFor = null) {
  const name = nameFor ? nameFor(source) : (SOURCE[source]?.name ?? source.replace(/_/g, ' '))
  return `<span class="src">${favicon(source, inline)}${escapeHtml(name)}</span>`
}

/**
 * Build a nameFor closure that overrides partner display names for the holder's partner.
 * If holder is provided and the source matches the holder's partner, returns the institution name.
 * Otherwise falls back to the standard PARTNERS display name.
 */
function buildNameFor(holder) {
  if (!holder) return null
  const holderPartner = holder.partner
  const institutionName = holder.record.institution
  return (source) => {
    if (source === holderPartner) return institutionName
    return SOURCE[source]?.name ?? source.replace(/_/g, ' ')
  }
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
export function gapPanel(bands, reach, inline = new Map(), nameFor = null) {
  // The holder override reaches this table's iiif row (for the museum
  // holders the two names are identical, so it changes nothing there). On an
  // iiif-held page that also carries another institution's manifest card —
  // live-reachable today through any non-subject anchor's P6108 statement —
  // the renamed row attributes the merged count to the holder. Closed by
  // the single-source suppression: holderStatements has no iiif entry, so an
  // iiif-held page renders no anchor statement cards at all and the state
  // this guarded against cannot occur.
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
      const name = nameFor ? nameFor(r.slug) : (SOURCE[r.slug]?.name ?? r.slug.replace(/_/g, ' '))
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
 * The labeled door to the holder's own viewer. Text names the museum so the
 * link reads as the partnership gesture it is. Copy is medium-aware: paintings
 * get brushwork copy, other media get house-voice language.
 */
export function zoomLink(entry, institutionName, medium = null) {
  if (entry.standing !== 'holder-work' || !entry.href) return ''
  const copy = medium === 'painting'
    ? `Zoom into the brushwork at ${escapeHtml(institutionName)} →`
    : `See every detail at ${escapeHtml(institutionName)} →`
  // New tab like every other outbound link here: the door to the museum must
  // not discard the enriched render the reader is standing on.
  return `<a class="zoom" href="${escapeHtml(entry.href)}" target="_blank" rel="noopener">${copy}</a>`
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

/**
 * What stands where the picture would be, when there is no picture.
 *
 * Cards with no thumbnail used to render as a caption floating under nothing,
 * which reads as an image that failed rather than as an item that has none —
 * and the difference matters, because these are overwhelmingly TEXTS. A link
 * audit on 2026-08-06 measured it: 229 of 435 DPLA cards across the six
 * showcase pages carry no thumbnail (53%), and 168 of those 229 are HathiTrust
 * books. On Brown v. Board the Free Law opinion — the HERO card, the article
 * whose subject IS a public-domain document — was one of them.
 *
 * Why this is a design answer and not a data one: DPLA has no thumbnail for
 * those items to give. Open Library's cover service, keyed on the OCLC numbers
 * those records carry, missed 7 out of 7 — they are 1914 municipal reports, not
 * trade books. HathiTrust does serve a page-1 scan, keylessly, at
 * /cgi/imgsrv/thumbnail — and its robots.txt says `Disallow: /cgi/` for
 * `User-agent: *`, granting /cgi/imgsrv to Twitterbot alone. So the images that
 * would fill 73% of this gap are ones HathiTrust has asked us not to take, and
 * a project whose whole argument is about respecting what institutions publish
 * does not help itself to them. (They allow it for link previews, so they may
 * well say yes if asked. Asking is the move, not taking.)
 *
 * So the plate asserts NOTHING it was not given. When an entry supplies its own
 * short identifying string it is set large, like a spine label — the reporter
 * citation on an opinion is a better emblem of the thing than any photograph
 * would be. With no such string it is a plain tinted panel: quiet, obviously
 * intentional, and making no claim about an object it cannot see. No stock
 * imagery, no generic "document" icon standing in for a specific book.
 */
function plate(entry) {
  const label = typeof entry.plate === 'string' && entry.plate.trim() ? entry.plate.trim() : null
  // A bare plate is decorative and stays that way: it carries no information, so
  // it is hidden from assistive technology and is NOT wrapped in a link. An
  // anchor around an aria-hidden panel is a link with no accessible name, and
  // the title directly beneath already opens the same door.
  if (!label) return `<div class="plate bare" aria-hidden="true"></div>`
  const body = `<div class="plate"><span class="plate-mark">${escapeHtml(label)}</span></div>`
  // A plate that says something is worth clicking, and it has text, so the link
  // has a name. Same door as the title and the image.
  return entry.href
    ? `<a href="${escapeHtml(entry.href)}" target="_blank" rel="noopener">${body}</a>`
    : body
}

/**
 * The description line — unless the credit already says all of it.
 *
 * DPLA, Europeana and DigitalNZ all fill `description` with the holding
 * institution, the same name their credit line leads with, so a text-only
 * card spent four of its lines naming the holder twice (both clamped) while
 * the title — the only text that says what the ITEM is — clipped at three
 * (2026-08-09, from an Apollo 11 DPLA shelf review). The rule is
 * containment, not a partner list: a description the credit line contains
 * IN FULL adds nothing and is dropped; one that says anything more
 * survives. So does the no-provider fallback ("A DPLA partner
 * institution"): with no provider named the credit renders empty, the
 * prefix test fails, and the description stays the card's only naming.
 */
function descLine(entry) {
  if (!entry.description) return ''
  const author = entry.attribution?.author ?? ''
  if (author.startsWith(entry.description)) return ''
  return `<p class="desc">${escapeHtml(entry.description)}</p>`
}

// A compact card for a horizontal carousel. The source is not repeated here — it
// labels the whole carousel — so the card carries only the item and why it landed.
function card(entry, inline, { head = '' } = {}) {
  const embed = entry.media3d ?? (entry.media ? iaEmbed(entry.media.source) : null)
  let visual = ''
  if (embed) {
    const tall = entry.media?.webpageType === 'iaAudio' ? ' audio' : ''
    visual =
      `<div class="frame${tall}"><iframe src="${escapeHtml(embed)}" loading="lazy" ` +
      `allowfullscreen title="${escapeHtml(entry.title)}"></iframe></div>`
  } else if (entry.imageUrl) {
    const src = inline.get(entry.imageUrl) ?? entry.imageUrl
    // Partner thumbnails rot and hotlink-block (DPLA's `object` URLs point at
    // the provider, not at DPLA). A broken-icon card is worse than a text
    // card, so a thumbnail that fails to load takes itself off the page.
    const img = `<img class="shot" src="${escapeHtml(src)}" loading="lazy" onerror="this.remove()" alt="${escapeHtml(entry.title)}">`
    // The title already opens the same door (see titleRow); the image is the
    // larger target and a reader's first instinct to click, so it opens the
    // same door rather than doing nothing.
    visual = entry.href
      ? `<a href="${escapeHtml(entry.href)}" target="_blank" rel="noopener">${img}</a>`
      : img
  } else {
    visual = plate(entry)
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
  // The head rides ABOVE the visual (2026-08-09, review): galleries lead
  // with the friend's icon and name, and a singleton that led with the
  // object instead made the same fact land in a different place on every
  // card shape. The friend now opens every box; the object follows.
  return (
    `<figure class="card${entry.evidence === 'corroborated' ? ' corroborated' : ''}">${head}${visual}<figcaption>` +
    heading +
    descLine(entry) +
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
// The ? mark's fold, one sentence per vocabulary — each names exactly which
// non-answer was recorded, because CNE ("nobody has looked") and UND
// ("looked, and could not tell") are different facts and flattening them
// would lose the honesty the mark exists to show. All three end the same
// way: an open question is not a permission and not a restriction.
const UNKNOWN_COPY = {
  UNKNOWN:
    'The institution holding this item records its rights as unknown — an open ' +
    'question, honestly recorded. That is not a permission and not a restriction; ' +
    'ask the holder before reusing it.',
  CNE:
    'The institution serving this copy states that its copyright has not been ' +
    'evaluated — nobody has looked yet. That is not a permission and not a ' +
    'restriction; ask the holder before reusing it.',
  UND:
    'The institution serving this copy states that its copyright is undetermined — ' +
    'someone looked, and could not tell. That is not a permission and not a ' +
    'restriction; ask the holder before reusing it.',
}

function rightsDetail(entry) {
  const work = entry.rights?.work
  const copy = entry.rights?.copy
  const parts = []
  if (copy?.marks?.includes('unknown')) {
    const said = UNKNOWN_COPY[copy.code] ?? UNKNOWN_COPY.UNKNOWN
    const link = copy.url
      ? ` <a href="${escapeHtml(copy.url)}" target="_blank" rel="noopener">${escapeHtml(copy.label)} ↗</a>`
      : ''
    parts.push(`<p class="rd-lic">${escapeHtml(said)}${link}</p>`)
  } else if (copy?.url) {
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
 * The "look closer" mark on every disclosure fold: a small magnifying glass,
 * inline SVG so it takes the surrounding text color rather than rendering as
 * a platform emoji. It replaced the ⓘ on 2026-08-08 (review): a magnifier
 * says "examine this" where an i said "information", and examining — the
 * chain, the statement, the terms — is what each of these folds offers.
 */
const LENS = (cls) =>
  `<svg class="${cls}" aria-hidden="true" viewBox="0 0 12 12" width="12" height="12">` +
  `<circle cx="4.8" cy="4.8" r="3.3" fill="none" stroke="currentColor" stroke-width="1.5"/>` +
  `<line x1="7.4" y1="7.4" x2="10.9" y2="10.9" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`

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
  const rlens = LENS('rinfo')
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
    rlens +
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
    ? `<summary class="why" title="How this got here">${why}${LENS('info')}</summary>`
    : `<summary class="why bare" title="How this got here">${LENS('info')}How is it connected?</summary>`
  return `<details class="prov">${summary}${body}</details>`
}

/**
 * The section's single best find, in the slot the references used to occupy.
 *
 * Bigger than a deck card because it is doing a different job: the deck is a
 * shelf to browse, this is the one thing the section wants a passing reader to
 * see. It keeps the same caption apparatus — title, description, credit, the
 * merged why/ⓘ — so nothing about a card becomes untrue when it is hoisted.
 *
 * That is also why it takes a `sample`: the hoist REMOVES a shelf from the
 * deck, so a claim about that shelf had nowhere to sit and fell to the
 * deck-level paragraph — on Apollo 11's "Apollo program" section, "A sample:
 * 1 of the 17 items DPLA's partners catalog under 'Apollo 15 (Spacecraft)'"
 * sat in a grey slab below the prose while the card it described floated at
 * the top right, with nothing tying the two together. Same badge the shelf
 * head and the gutter thumb carry, for the same reason.
 */
function heroCard(entry, inline, sample = null, holder = null, nameFor = null) {
  const embed = entry.media3d ?? (entry.media ? iaEmbed(entry.media.source) : null)
  let visual = ''
  if (embed) {
    const tall = entry.media?.webpageType === 'iaAudio' ? ' audio' : ''
    visual =
      `<div class="frame${tall}"><iframe src="${escapeHtml(embed)}" loading="lazy" ` +
      `allowfullscreen title="${escapeHtml(entry.title)}"></iframe></div>`
  } else if (entry.imageUrl) {
    const src = inline.get(entry.imageUrl) ?? entry.imageUrl
    visual = `<img class="shot" src="${escapeHtml(src)}" loading="lazy" onerror="this.remove()" alt="${escapeHtml(entry.title)}">`
  } else {
    // The hero needs this more than a deck card does, not less: it is the one
    // thing the section is pointing at, and on Brown v. Board the hero was the
    // Free Law opinion — hoisted to the top of the page with nothing above its
    // caption at all.
    visual = plate(entry)
  }
  const heading = titleRow(entry, 'hero')
  const claim = sampleBadge(sample, 1)
  const zoom = holder ? zoomLink(entry, holder.record.institution, holder.medium) : ''
  // The IIIF requiredStatement is a mandatory attribution for THIS resource,
  // so it renders only on the holder's own card — and in its own element,
  // never inside `.credit`, whose line clamp may hide exactly the text the
  // spec obliges a client to show.
  const statement =
    holder && entry.standing === 'holder-work' && holder.record.requiredStatement
      ? `<p class="req-statement">${escapeHtml(holder.record.requiredStatement)}</p>`
      : ''
  // Source tag first, same as card(): the friend opens every box.
  return (
    `<figure class="card hero-card"><div class="hero-src">${sourceTag(entry.source, inline, nameFor)}${claim}</div>` +
    `${visual}<figcaption>` +
    heading +
    descLine(entry) +
    credit(entry, inline, false) +
    statement +
    (zoom ? `<p class="zoom-link">${zoom}</p>` : '') +
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
// Deliberately NO display-name override here: broad notes are pushed only by
// the search-shape partners (DPLA, Europeana, DigitalNZ), never by a holder
// partner, and the override reaching one would caption another partner's
// holdings with the holder institution's name.
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
/**
 * The manila sample badge, the one shape all three heads share — a shelf head,
 * a floated single's caption head, the hero's source bar.
 *
 * **The badge is the door when there is one** (2026-08-10). "4 of 54" states
 * that fifty of these exist somewhere the reader cannot see, and until now the
 * page said so and offered no way there — the browse link existed on the
 * partner's side and was spent only on the shelves this page FOLDS ("Not shown
 * here: 1,409 items … Browse them at DPLA ↗"), so a reader was handed the door
 * exactly when there was nothing to look at first. Making the number itself
 * the link adds no furniture to a 178px card: the badge was already there, and
 * it was already the thing making the claim.
 *
 * `sample.url` is absent wherever this project cannot name a page that makes
 * the SAME claim as the number — see the two comments in `discover.js` on
 * OpenAlex and the museum artwork counts. Those badges stay plain, which is
 * the honest render of "the rest exists and we cannot point at it".
 */
function sampleBadge(sample, shown) {
  if (!sample) return ''
  const text = `${shown} of ${sample.total.toLocaleString()}`
  const title = escapeHtml(sample.text)
  if (!sample.url) return `<span class="count" title="${title}">${text}</span>`
  return (
    `<a class="count" href="${escapeHtml(sample.url)}" target="_blank" rel="noopener" ` +
    `title="${title} — see the rest">${text} ↗</a>`
  )
}

/** One find as a framed thumb: source tag, topic and sample claim in the caption. */
function singleThumb(source, entry, inline, topic = null, sample = null) {
  const claim = sampleBadge(sample, 1)
  const topicTag = topic ? `<span class="topic">${escapeHtml(topic)}</span>` : ''
  const head = `<div class="single-head">${sourceTag(source, inline)}${topicTag}${claim}</div>`
  return card(entry, inline, { head })
}

function carousel(source, items, inline, topic = null, sample = null) {
  // One card is a THUMB, not a gallery of one (2026-08-08, deck review).
  // MediaWiki's idiom draws exactly this line — a single image gets a frame
  // and a caption, a group gets a gallery — and a one-card shelf wearing a
  // full shelf head read as a crate beside the real galleries. The source
  // tag and any sample claim move INTO the caption (the hero's move), so
  // the disclosure still rides the thing it describes.
  if (items.length === 1) {
    return `<div class="carousel single" style="flex:0 1 200px">${singleThumb(source, items[0], inline, topic, sample)}</div>`
  }
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
    ? sampleBadge(sample, items.length)
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
  // wrap to a second row for the rest.
  //
  // 200 = the card's own 178px, plus the 3px padding and 1px border on each
  // side that the wiki skin's thumb frame added (2026-08-07), plus the 14px
  // gap. It was 192 while the cards were unframed and the track scrolled, and
  // 8px short is not cosmetic now that shelves wrap: a three-card shelf whose
  // basis is under its cards' real width drops the third card to its own row.
  // Capped at FOUR since 2026-08-08 (was three): the commonest shelf size is
  // exactly four (DPLA's and DigitalNZ's pick), and a cap of three orphaned
  // every fourth card onto a row of its own beside 400px of nothing.
  const basis = Math.min(items.length, 4) * 200
  return (
    // No flex-grow (changed 2026-08-07). A stretched shelf keeps its cards
    // left-aligned, so a row's leftover width opened as a hole INSIDE each
    // shelf — a one-card shelf stretched to 446px showed 246px of white between
    // its card and the next shelf. At grow 0 the shelves sit at their true
    // width and the leftover collects at the right margin, where it reads as
    // page margin rather than as gaps in a gallery.
    `<div class="carousel" style="flex:0 1 ${basis}px"><div class="carousel-head">${sourceTag(source, inline)}${topicTag}${count}</div>` +
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
/** Characters of prose a section needs before its best find may float. */
const FLOAT_MIN_PROSE = 700

/**
 * The section's prose as plain text length — tags stripped, because a paragraph
 * that is mostly wikilink markup has far fewer characters on the page than in
 * the source. Headings count: they occupy a line beside the float too.
 */
function proseLength(b) {
  if (!b.blocks) return (b.text ?? '').length
  return b.blocks.reduce(
    (n, x) => n + (x.html ? x.html.replace(/<[^>]*>/g, '').length : (x.text ?? '').length),
    0,
  )
}

export function bandParts(b, inline = new Map(), wikiBase = '/wiki/') {
  // Holder context comes off the band itself — discover attaches it to the
  // lede only — so the holder's furniture (zoom link, requiredStatement,
  // renamed source bar) can never reach a band that has no holder context.
  // Both renderers therefore agree by construction; page-level furniture
  // (masthead, legends, panel) reads the page-level holder instead.
  // Defense in depth beside discover's lede-only attach: holder furniture
  // (the zoom link, the requiredStatement, the renamed source bar, the
  // merged panel) belongs to the lede band alone, whatever a band object
  // carries — both renderers read b.holder, so anything attached to a band
  // is page furniture unless this guard says otherwise.
  const holder = b.id === 'slede' ? (b.holder ?? null) : null
  const nameFor = buildNameFor(holder)
  // The hero comes out of the entries before they are shelved, so it is never
  // both hoisted and carded. A section whose only find becomes its hero has no
  // deck at all, which is the right rendering of one good thing.
  let { hero, rest } = pickHero(b.entries)
  // A float needs text beside it, or it is not a float — it is an ornament
  // stuck to a heading, with the whole left column blank beneath it until the
  // deck clears. Apollo 11's "Multimedia" section is the case that forced this
  // (2026-08-07): ten characters of prose against a floated thumbnail, 365px of
  // dead column, and no width tweak can fix a section that has no text.
  //
  // The arithmetic: beside a 220px thumb the text column runs about 96
  // characters a line, so 700 characters is roughly seven lines — about the
  // height of a thumbnail with its caption. Below that the hole is bigger than
  // the picture.
  //
  // This is the same rule pickHero already applies for a different reason (a
  // find with no picture and no standing gets no float), and it is deliberately
  // implemented the same way: the hero goes back into `rest` and is shelved as
  // an ordinary card, so there is no third rendering to maintain. It leads its
  // shelf because it was the section's best find and still is.
  //
  // A heuristic, fitted to one article's distribution, and safely so: the cost
  // either way is bounded — a float becomes a card, or a short section keeps a
  // small hole. Real Wikipedia sections do keep small holes, and the residual
  // ones here are that, not a defect.
  // A holder-work entry must float even if the lede is short — the page exists
  // to show the holder's record of the subject, and a stub wrapping under its
  // hero is what a real stub with an infobox looks like (see the infobox
  // precedent nearby).
  if (hero && proseLength(b) < FLOAT_MIN_PROSE && hero.standing !== 'holder-work') {
    rest = [hero, ...rest]
    hero = null
  }
  // The lede's fallback: the Wikipedia article's own infobox, standing in
  // when no find with subject standing earned the slot (design:
  // docs/design-plans/2026-08-08-infobox-retention.md). Only the lede band
  // carries `infobox`, so no other section can trip this. A find ABOUT the
  // subject (heroRank <= 3: the subject as a document, a partner's record of
  // it, something it made) beats the box; anything weaker — a map, a picture
  // of something merely linked — yields and leads its shelf instead, the same
  // demotion the prose rule above uses. The box is deliberately NOT exempt
  // from losing to a subject find, and deliberately IS exempt from
  // FLOAT_MIN_PROSE: a stub's short prose wrapping beneath its infobox is
  // exactly what a real stub looks like.
  //
  // On a holder page the hero and the panel are NOT alternatives: the hero
  // float is the work, the merged panel (Wikipedia infobox facts + holder
  // record, each row attributed) takes the infobox's seat BELOW it, and both
  // render — the merge is the point, not a fallback. A panel with nothing to
  // say renders nothing: the slot behaves exactly as before the panel existed.
  let infobox = b.infobox ?? null
  let holderPanelHtml = null
  if (holder) {
    // On a holder page: build the merged panel from the infobox (if any) and the record
    const rows = infoboxRows(infobox?.html)
    const panel = mergedPanel(rows, holder.record)
    if (panel) {
      holderPanelHtml = panel
      infobox = null // The merged panel takes the box's seat
    }
    // A panel with nothing to say falls through to the ordinary suppression
    // below — the holder hero (rank -1) suppresses the plain box exactly as
    // it did before the panel existed. (Unreachable today: every gate-passed
    // record carries a rights label, so the panel always has at least that
    // row. Kept honest for the partner that changes it.)
  }
  if (!holderPanelHtml && infobox && hero) {
    // The normal rank-based suppression
    if (heroRank(hero) <= 3) {
      infobox = null
    } else {
      rest = [hero, ...rest]
      hero = null
    }
  }
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
  // The gutter rule, whole (2026-08-09, Prime crew review): SINGLE finds
  // float right beneath the hero, the way thumbs run down a real article's
  // margin; GALLERIES go in the deck below the section. A per-700-characters
  // float budget briefly lived here (2026-08-08 to 2026-08-09) and its last
  // revision sent "Carrying the Fire" — one of Prime crew's two cited
  // books — to the deck as a lone card beside blank space while its twin
  // floated: an arbitrary-looking difference, because it was one. The
  // budget had been fitted against the phantom prose of the
  // section-duplication bug (parent bands carrying their whole subtree);
  // with real bands a section holds a few image-bearing singles at most,
  // and the operator chose the simple rule over the arithmetic, knowing the
  // cost: a stack can trail somewhat below a short section's last line,
  // which real articles' margins also do.
  //
  // What stays gated, stays for its own measured reason. A section under
  // FLOAT_MIN_PROSE floats nothing — the Multimedia hole above; ten
  // characters of prose cannot wrap anything. A text-only single stays
  // shelved: the margin is for things to LOOK at, the same rule pickHero
  // applies to the hero slot. And the LEDE takes no gutter (2026-08-09,
  // from a hole on Apollo 11): its rail is 330px against the sections'
  // 220px — a wider float is a TALLER card and a narrower text column at
  // once — and the longest lede this site draws (3,264 characters,
  // measured) could not wrap a portrait hero plus one map thumb. The lede's
  // margin has exactly one slot, and the hero or the infobox already owns
  // it.
  //
  // Group order is article order, so the earliest singles float first, and
  // a floated shelf's sample claim rides its caption — the disclosure moves
  // WITH the card, never dropped.
  const gutter = []
  if (b.id !== 'slede' && proseLength(b) >= FLOAT_MIN_PROSE) {
    for (const [source, byTopic] of bySource) {
      const split = byTopic.size > 1
      for (const [topic, items] of byTopic) {
        if (items.length !== 1) continue
        if (!(items[0].imageUrl || items[0].media)) continue
        const key = shelfKey(source, topic)
        gutter.push(singleThumb(source, items[0], inline, split ? topic : null, sampleFor.get(key) ?? null))
        unused.delete(key)
        byTopic.delete(topic)
      }
      if (!byTopic.size) bySource.delete(source)
    }
  }
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
  // The hero is the last shelf a claim can ride, and until 2026-08-10 it was
  // the biggest hole: `pickHero` takes its entry out of `rest` BEFORE anything
  // is grouped, so a one-entry shelf that got hoisted left its sample with no
  // head to sit on and it fell to the paragraph below. Only when the key is
  // still unused — a hero hoisted off a shelf whose other cards did render
  // must not make the same claim twice, once on the float and once on the
  // shelf head three inches below it.
  const heroKey = hero ? shelfKey(hero.source, hero.topic) : null
  const heroSample = heroKey && unused.has(heroKey) ? sampleFor.get(heroKey) : null
  if (heroSample) unused.delete(heroKey)
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
  // The hero and the merged panel stack in the rail (the panel aside clears
  // the float). On non-holder pages hero and infobox are already mutually
  // exclusive (the suppression branch above), so the concatenation emits
  // exactly what the old either/or did.
  const heroAside = hero
    ? `<aside class="rail">${heroCard(hero, inline, heroSample, holder, nameFor)}</aside>`
    : ''
  const boxAside = holderPanelHtml
    ? mergedPanelAside(holderPanelHtml, b.infobox, inline, wikiBase)
    : infobox
      ? infoboxAside(infobox, inline, wikiBase)
      : ''
  const float = heroAside + boxAside
  const more = gutter.length ? `<aside class="rail-more">${gutter.join('')}</aside>` : ''
  return {
    // Both go before the prose, the status first: it is about the whole
    // article, while the hero is about one find inside it.
    rail: subjectRights(b) + float + more,
    deck: deckBody ? `<div class="deck">${deckBody}</div>` : '',
    refs: sources,
  }
}

/**
 * Where the partner list lives, derived from the wiki base — or null when
 * there is no answer. `/wiki/` (the streaming server) and a demo base
 * (`https://friendsof.wiki/wiki/`) both have a front page one level up; the
 * batch default is en.wikipedia.org, whose front page is NOT where the
 * partner list lives, so a standalone file keeps the words and drops the
 * link rather than pointing a reader at Wikipedia for our own roster.
 */
function frontPage(wikiBase) {
  if (wikiBase === '/wiki/') return '/'
  const m = /^(.*\/)wiki\/$/.exec(wikiBase ?? '')
  return m && !m[1].includes('en.wikipedia.org') ? m[1] : null
}

/**
 * The Wikipedia article's own infobox, standing in the lede rail. Furniture,
 * not a find: no source tag, no favicon, never counted in `sourcesUsed` — the
 * footer's CC BY-SA line credits it like the prose it sits beside. The ⓘ-fold
 * explains the SLOT, in the house voice: an absence is a measurement ("no
 * friend has one yet"), never a verdict.
 */
function infoboxAside(box, inline, wikiBase) {
  let html = relink(box.html, wikiBase)
  for (const url of box.images ?? []) {
    const swapped = inline.get(url)
    if (swapped) html = html.replaceAll(`src="${url}"`, `src="${escapeHtml(swapped)}"`)
  }
  const front = frontPage(wikiBase)
  const list = front
    ? `<a href="${escapeHtml(front)}">the collections this page draws on</a>`
    : 'the collections this page draws on'
  const fold =
    `<details class="ib-why"><summary>${LENS('rinfo')}` +
    `<span class="vh">Why this box is here</span></summary>` +
    `<p>This is the Wikipedia article’s own infobox. This slot usually holds a friend’s ` +
    `record of the subject — none of ${list} has one for this subject yet, so the ` +
    `article’s own summary stands in.</p></details>`
  // The fold rides INSIDE the box, as its last row — the seat the v·t·e
  // navbar held before extraction stripped it, which is where a wiki reader
  // already expects a box's own apparatus to sit.
  const row = `<tr class="ib-why-row"><td colspan="2">${fold}</td></tr>`
  const seated = /<\/tbody>\s*<\/table>\s*$/.test(html)
    ? html.replace(/<\/tbody>\s*<\/table>\s*$/, `${row}</tbody></table>`)
    : html.replace(/<\/table>\s*$/, `${row}</table>`)
  return `<aside class="rail"><div class="ib-slot">${seated}</div></aside>`
}

/**
 * The merged panel on holder pages: Wikipedia infobox facts + holder record,
 * each row attributed to its source, conflicts shown side by side. Built from
 * the sanitized infobox HTML and the holder record using mergedPanel().
 */
function mergedPanelAside(panelHtml, box, inline, wikiBase) {
  // The panel's Wikipedia rows carry the article's own markup, so they get
  // the same treatment the plain box gets: hrefs re-based for standalone
  // renders, and a labelled image row's src swapped to inline bytes where
  // the box recorded one. No fold — every row is already attributed. The
  // rail-panel class clears the hero float above it so the two stack.
  let html = relink(panelHtml, wikiBase)
  for (const url of box?.images ?? []) {
    const swapped = inline.get(url)
    if (swapped) html = html.replaceAll(`src="${url}"`, `src="${escapeHtml(swapped)}"`)
  }
  return `<aside class="rail rail-panel"><div class="ib-slot">${html}</div></aside>`
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
  const conflict = holderConflict(b)
  if (!r) {
    // The says-it-twice guard can hand the status line itself to a card that
    // IS the subject; a rights disagreement still needs its box, quoting the
    // graph's answer inline since nothing renders above it.
    return conflict ? `<div class="subject-rights">${conflict}</div>` : ''
  }
  const marks = rightsMarks(r.marks, r.label)
  const words = r.line ?? r.label
  if (!marks && !words) return conflict ? `<div class="subject-rights">${conflict}</div>` : ''
  const detail = rightsDetail({ rights: { work: r } })
  const body = detail
    ? `<details class="sr-why"><summary>Why, and what it means where you are</summary>${detail}</details>`
    : ''
  return (
    `<div class="subject-rights">` +
    `<p class="sr-line">${marks}${escapeHtml(words ?? '')}</p>${conflict}${body}</div>`
  )
}

/**
 * The museum's side of a rights disagreement. `discover.js` attaches
 * `holderRefusal` only when a museum lane's record was refused on its
 * rights flag alone AND the graph states a free answer about the work
 * itself — gate and quoted words both from `workFreeStatus`, one source,
 * so this line can never attribute a creator ruling or a copy's license
 * to the work. A refusal everyone agrees with (a Picasso) stays a plain
 * refusal. Both claims are stated, neither is called wrong, and the
 * institution's record is the labeled door — the reader can check the flag
 * themselves. The line states no consequence for the page's layout: the
 * museum's image may still appear on an ordinary card (the card path
 * has its own rules), so the only claims here are the two records'.
 * American Gothic is the living exemplar: PD in the US since 2026-01-01
 * by publication age, community-recorded PD by term on work and creator
 * both, and the Art Institute's is_public_domain still false.
 */
function holderConflict(b) {
  if (b.id !== 'slede' || !b.holderRefusal) return ''
  const { phrase, href, statusLine, mixed } = b.holderRefusal
  const door = href
    ? ` <a class="ext" href="${escapeHtml(href)}" target="_blank" rel="noopener">See the institution’s record →</a>`
    : ''
  // Each clause stays at its own level — the copy/work rule ("neither is
  // ever printed as the other"): what the gate read is the record's flag
  // over the IMAGE it releases (true of every lane — imageUrl is gated on
  // that flag in every normalizer), and Wikidata's clause says "the work
  // itself". "Institution", not "museum": the door lane's holder can be a
  // library or an archive. On a MIXED record the graph itself says "still
  // in copyright" somewhere and the flag may simply agree with that
  // somewhere, so the verdict renders only on `mixed === false`, strictly —
  // an absent flag must not default to the assertion.
  const verdict = mixed === false ? ' The two records disagree.' : ''
  return (
    `<p class="sr-conflict">` +
    `${escapeHtml(sentenceCase(phrase))} holds this work. The institution’s record ` +
    `doesn’t release an image of it as public domain, while Wikidata records the ` +
    `work itself as ${escapeHtml(statusLine)}.${verdict}${door}</p>`
  )
}

/** First letter up, for a phrase that opens a sentence ("the Met" → "The Met"). */
function sentenceCase(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

/** All three parts as one fragment — what the stream ships and the tests read.
 * The holder context rides the band itself (`b.holder`, set by discover on the
 * lede) because a streamed band arrives through the emit callback before
 * `discover()` has resolved — there is no outer holder value to thread. */
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
  // The lede gets no heading of its own (2026-08-08, mobile review): the
  // masthead's h1 already says the title, and on a phone the repetition
  // stacked three deep — h1, band h2, then the infobox's own title row. A
  // real article page starts its lede directly under the firstHeading.
  const head =
    b.id === 'slede' ? '' : `<header class="band-head"><h2>${escapeHtml(b.title)}</h2></header>`
  return (
    `<section class="band ${b.blocks ? 'section' : 'note'}"${id}>` +
    head +
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
function hero({ title, home, legend, panel = '', extras = '', holder = null }) {
  const name = 'Help From Our Friends · an experiment in visualizing open knowledge, by'
  const byline = `<a href="https://lu.is">Luis Villa</a>`
  const kicker = home ? `<a href="${escapeHtml(home)}">${name}</a> ${byline}` : `${name} ${byline}`
  const note = home
    ? `<p class="hero-note">This is an experiment — for more detail, including the hard problems,
  see <a href="${escapeHtml(home)}">the main page</a>.</p>`
    : ''
  // The span is the streaming path's mount point: streamOpen renders this
  // before the holder record can resolve, and streamHeroExtras fills it late.
  const creditLine = holder
    ? `This page: Wikipedia + ${escapeHtml(holder.record.institution)}`
    : 'Today, help came from:'
  return `<header class="hero">
  <p class="kicker">${kicker}</p>
  <h1>${escapeHtml(title)}</h1>
  <p class="thesis">A Wikipedia article, with what the rest of the open web holds about it
    alongside — found while you waited, by following the article’s own links and footnotes
    out to the collections that published it. <span class="credit-line">${creditLine}</span></p>
  <div class="legend">${legend}</div>
  <div class="gap-slot">${panel}</div>
  ${note}
  ${extras}
</header>`
}

// `inline` maps a fragile image URL (OpenLibrary covers, which redirect through
// archive.org) to a pre-fetched data: URI, so those covers render without a live
// dependency on the Internet Archive being up.
export function buildHtml({
  title,
  bands,
  inline = new Map(),
  provenance = '',
  home = '',
  reach = null,
  siteOrigin = '',
  holder = null,
}) {
  // Intra-wiki links in a batch file re-base onto the deployed demo (or
  // whatever `home` names), so clicking through to another article still
  // lands on an enriched render rather than a broken relative path.
  const wikiBase = home ? `${home.replace(/\/$/, '')}/wiki/` : 'https://en.wikipedia.org/wiki/'
  // `holder` must be the same object discover attached to the lede band —
  // this page-level copy feeds only the masthead, legend and panel, while
  // every per-band furniture read comes from `b.holder`. A caller passing a
  // different value here renames the page furniture but not the cards.
  const nameFor = buildNameFor(holder)
  const body = bands.map((b) => band(b, inline, wikiBase)).join('\n')

  const used = sourcesUsed(bands)
  const legend = used
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(nameFor ? nameFor(s) : SOURCE[s].name)}</span>`)
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
${ogMeta({ title, description: ogArticleDescription(title), path: `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, siteOrigin })}
<style>
${STYLE}${faviconStyle(used, inline)}
</style>
${FOLD_JS}
</head>
<body>
${CC_SPRITE}
${hero({ title, home, legend, panel: gapPanel(bands, reach, inline, nameFor), extras: evidenceKey, holder })}
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
// shell and full spine go out first — the article renders before any lookup
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
// first fragment arrives. `__thb` mounts a band's enrichment — every float
// (the rail's hero, the rail-more gutter thumbs, the subject-rights box)
// goes BEFORE the prose, everything else (deck, then references) appends in
// template order, which is why the fragment's own order is the rendered
// order. rail-more was missing from the before-prose list until 2026-08-09,
// and the miss was invisible in every batch render: a right float anchored
// AFTER the prose can only sit below its last line, so on streamed pages —
// the deployed site — every gutter thumb stacked under the section beside
// blank margin while spike output put the same thumb beside the text. The
// two renderers must place these identically or neither can vouch for the
// other.
const RELOCATE_JS = `<script>
function __thb(t,b){var p=document.getElementById(t),s=document.getElementById(b);
if(p&&s){var bb=s.querySelector(".band-body"),pr=s.querySelector(".prose"),e;
while((e=p.content.firstElementChild)){if(e.classList.contains("rail")||e.classList.contains("rail-more")||e.classList.contains("subject-rights"))bb.insertBefore(e,pr);else bb.appendChild(e)}p.remove()}}
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
 * What stands in the legend's place while the lookups are still answering.
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

export function streamOpen({ title, units, inline = new Map(), home = '/', siteOrigin = '' }) {
  const spine = units
    .map((u) =>
      band({ id: u.index === '0' ? 'slede' : `s${u.index}`, title: u.title, blocks: u.blocks }, inline, '/wiki/'),
    )
    .join('\n')
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
${ogMeta({ title, description: ogArticleDescription(title), path: `/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, siteOrigin })}
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
export function streamHeroExtras(bands, { inline = new Map(), home = '', reach = null, holder = null } = {}) {
  const nameFor = buildNameFor(holder)
  const used = sourcesUsed(bands)
  const legend = used
    .map((s) => `<span class="key">${favicon(s, inline)}${escapeHtml(nameFor ? nameFor(s) : SOURCE[s].name)}</span>`)
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
  const panel = gapPanel(bands, reach, inline, nameFor)
  return (
    `<template id="tpl-legend">${legend}</template><script>__fill("tpl-legend",".legend")</script>\n` +
    // The two-party credit, late-filled into the span the masthead rendered
    // before the holder record could resolve — the streamed twin of the line
    // `hero()` prints directly on the batch path.
    (holder
      ? `<template id="tpl-credit">This page: Wikipedia + ${escapeHtml(holder.record.institution)}</template><script>__fill("tpl-credit",".credit-line")</script>\n`
      : '') +
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

/* The page wears MediaWiki's Vector skin, deliberately (2026-08-07).
   The argument this render makes is "here is the article, and here is what the
   open ecosystem holds about it that the article does not show" — which lands
   only if the first half LOOKS like the article. An editorial magazine skin
   made the whole page read as somebody's essay ABOUT Wikipedia; Vector's own
   furniture makes it read as the encyclopedia page plus additions, and the
   additions are then the thing a reader notices.

   What is borrowed is the DESIGN LANGUAGE, which is MediaWiki's and is worn by
   thousands of wikis: the type scale, the hairline-ruled serif headings, the
   #36c links, the bordered thumb and infobox frames. What is NOT borrowed is
   anybody's identity — no Wikipedia wordmark, no globe, no article/talk tabs,
   and the masthead still says whose experiment this is in the first line. A
   page that looked like Wikipedia AND claimed to be it would be a forgery, and
   the whole project depends on being trusted about what it found. */
const STYLE = `
:root{
  --bg:#f8f9fa; --paper:#ffffff; --ink:#202122; --head:#000000; --muted:#54595d;
  /* MediaWiki's two border weights, and they are used for different jobs:
     base rules structure (heading underlines, the content edge, infoboxes),
     subtle rules frame content (thumbnails, table hairlines). */
  --rule:#c8ccd1; --rule-strong:#a2a9b1; --faint:#eaecf0; --link:#3366cc;
  --link-visited:#6b4ba1;
  /* The experiment's own voice (2026-08-08, "Wikipedian but friendly"):
     everything that is THE ARTICLE stays in the Vector values above — gray
     ground, #36c wikilinks, square frames — and everything that is OURS (the
     kicker, the folds, badges, the visibility panel, the footer) speaks in
     warm paper, reading-room lamp green, and catalog-card manila. Color marks
     whose voice is speaking. Deliberately not WMF's palette: the green is
     yellow-cast, apart from Codex #14866d and logo #339966; no red at all. */
  --warm:#faf9f6; --accent:#33684b; --accent-ink:#4d5a51;
  --manila:#f2e8d5; --manila-rule:#d8c9a4; --manila-ink:#5c5233;
  --warm-rule:#cfcac0;
  --serif:"Linux Libertine","Georgia","Times New Roman",Times,serif;
  --sans:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
/* Sans body, serif headings — the inversion of the old skin, and the single
   change that does most of the work. 15px sits between MediaWiki's 14px content
   default and the 16px its larger reading preference serves; both ship, and
   neither is worth matching to the pixel at the cost of legibility here. */
body{margin:0;background:var(--warm);color:var(--ink);font-family:var(--sans);
  font-size:15px;line-height:1.65}
a{color:var(--link);text-decoration:none}
a:visited{color:var(--link-visited)}
a:hover{text-decoration:underline}
img{max-width:100%;display:block}

/* The content block: white, on the grey page, at roughly Vector's own content
   width. 1000px against Vector 2022's 960px — the extra 40px is what keeps a
   media shelf from dropping a card, and at this width the floated rail below
   (330px) is 22em, which is exactly an infobox. */
.hero{max-width:1000px;margin:0 auto;padding:0 32px 12px;background:var(--paper);
  border:1px solid var(--rule-strong);border-bottom:1px solid var(--rule-strong);border-width:0 1px 1px}
/* The site strip: who made this and where to read about it. It stands where a
   wiki's header sits and is styled as chrome rather than as a kicker — small,
   grey, ruled off — because everything below it is pretending to be an article
   and this line is the one that must not. */
.kicker{font-size:.8rem;line-height:1.5;color:var(--accent-ink);margin:0 -32px 18px;
  padding:9px 32px;border-bottom:1px solid var(--warm-rule);background:var(--warm)}
.kicker a{color:var(--accent);font-weight:600}
/* Serif, normal weight, no tightened tracking: MediaWiki's firstHeading. The
   old skin set this in a 3.4rem semibold sans, which is a magazine cover. */
.hero h1{font-family:var(--serif);font-size:1.9rem;line-height:1.25;
  margin:0 0 .15em;color:var(--head);font-weight:400}
/* The tagline slot — where an article says "From Wikipedia, the free
   encyclopedia", this says what the page actually is. Same size, same grey,
   same place, and it is doing the same job. */
.hero .thesis{font-size:.82rem;line-height:1.55;max-width:80ch;color:var(--muted);margin:0 0 12px}
.legend{display:flex;flex-wrap:wrap;gap:8px 20px;font-family:var(--sans);font-size:.75rem;color:var(--accent-ink);
  min-height:16px;margin:0 0 12px}
.hero-note{font-family:var(--sans);font-size:.78rem;line-height:1.55;color:var(--muted);margin:0}
.key{display:inline-flex;align-items:center;gap:8px}
/* The legend's stand-in while the lookups answer. A slow pulse, not a spinner:
   the work is a polite serial crawl of other people's APIs, and it should look
   like patience rather than a progress bar counting to a number nobody knows. */
.finding{font-style:italic;animation:finding 1.9s ease-in-out infinite}
@keyframes finding{0%,100%{opacity:.45}50%{opacity:1}}
@media(prefers-reduced-motion:reduce){.finding{animation:none;opacity:.7}}
.fav{width:16px;height:16px;flex:none;border-radius:2px;background:#fff no-repeat center;background-size:contain;display:inline-block}

main{max-width:1000px;margin:0 auto;padding:4px 32px 0;background:var(--paper);
  border:1px solid var(--rule-strong);border-width:0 1px}
.band{padding:8px 0 18px}
/* No rule BETWEEN sections: the heading's own underline is the separator, which
   is how a wiki page divides itself. Two rules a few pixels apart was the first
   thing that looked wrong when the h2 gained its border. */
.band:first-child{padding-top:4px}
.band-head{margin:0 0 14px}
/* MediaWiki's section heading, and the detail that carries most of the
   resemblance: serif, normal weight, and a hairline the full width of the
   content. */
.band-head h2{font-family:var(--serif);font-size:1.5rem;line-height:1.3;
  margin:1em 0 0;padding-bottom:.17em;color:var(--head);font-weight:400;
  border-bottom:1px solid var(--rule-strong)}
.band:first-child .band-head h2{margin-top:.4em}
.note .band-head h2{font-style:italic}

/* Wikipedian inline apparatus: quiet blue links, superscript footnote markers.
   The external-link arrow stands in for MediaWiki's own 12px glyph — same
   convention, no sprite to ship. */
.prose a{color:var(--link)}
.prose a:visited{color:var(--link-visited)}
.prose a.ext::after{content:"\\2197";font-size:.75em;margin-left:1px;color:#3366cc}
sup.ref{font-size:.8em;line-height:1}
sup.ref a{color:var(--link)}

/* The load-bearing layout choice: the body is a flow-root, media and citations
   float to the rails, and the prose reflows around and below them — no reserved
   empty column, so a long section with sparse media has no dead space. */
.band-body{display:flow-root}
.prose{}
/* No measure cap. MediaWiki does not set one, and an article's text running the
   full column and wrapping under the infobox is part of what the page is
   imitating — a 42em ribbon down the left was the old editorial skin. */
.prose p{margin:0 0 .5em}
/* h3 and below are sans and bold in Vector, and carry no rule — only h1 and h2
   are serif. */
.prose h3{font-size:1.13rem;font-weight:700;color:var(--head);margin:1em 0 .3em}
.note-lead{font-style:italic;color:#3a3f45}

/* The rail (the section's best find) narrows in steps so the two-column layout
   survives well below a full desktop width — a hi-DPI laptop at default scaling
   reports a narrow CSS width, and it should still read as article + margin. */
/* Two widths, because MediaWiki has two things here and we had been rendering
   both as the wider one (fixed 2026-08-07, after Apollo 11 measured 365px of
   dead column in one section).

   220px is MediaWiki's DEFAULT THUMBNAIL, which is what a picture in a section
   is. 330px is 22em, the INFOBOX, and an article gets one of those, at the top.
   Every section rail was wearing infobox width, which cost twice: the card was
   taller, and the prose beside it was 110px narrower and so ran out sooner. A
   float taller than the text it displaces leaves the whole left column blank
   until the deck clears it, and on a 36-section article that adds up to the
   page reading as mostly margin.

   Margins are the thumb's: 0.5em top, 1.4em against the text it displaces. */
.rail,.rail-more{float:right;width:220px;margin:.5em 0 1.3em 1.4em}
/* The gutter clears the rail so it stacks beneath the hero, one column of
   thumbs down the right margin — a real article's arrangement. */
.rail-more{clear:right;margin-top:.2em;display:flex;flex-direction:column;gap:14px}
.rail-more .card{width:100%;flex:none}
.band:first-child .rail,.band:first-child .rail-more{width:330px}
@media(max-width:1040px){.band:first-child .rail,.band:first-child .rail-more{width:300px}}
@media(max-width:860px){.band:first-child .rail,.band:first-child .rail-more{width:260px}}

/* The Wikipedia article's own infobox, standing in the lede rail when no
   friend's record of the subject earned the slot (design:
   docs/design-plans/2026-08-08-infobox-retention.md). Hand-written imitation
   of Vector's infobox, like every other wiki-looking element in this sheet —
   TemplateStyles are never passed through. Colored header bands arrive as
   inline style attributes on the rows and survive on their own. */
.infobox{width:100%;border:1px solid var(--rule-strong);background:var(--bg);
  border-collapse:collapse;font-size:.8rem;line-height:1.45}
.infobox td,.infobox th{vertical-align:top;padding:2px 8px;text-align:left;border:0}
.infobox th[scope="row"].infobox-label{font-weight:700;padding-right:6px}
.infobox .infobox-above{font-size:1.05rem;font-weight:700;text-align:center;padding:5px 8px}
.infobox .infobox-header,.infobox .infobox-subheader,.infobox .infobox-full-data,
.infobox .infobox-below{text-align:center}
.infobox .infobox-header,.infobox .infobox-subheader{font-weight:700}
.infobox .infobox-image{text-align:center;padding:4px 8px}
.infobox .infobox-image img{margin:0 auto;height:auto}
.infobox .infobox-caption{font-size:.75rem;line-height:1.4;padding-top:3px}
.infobox .infobox-below{font-size:.75rem}
/* Nested sub-boxes (an infobox inside an infobox) flatten to full width. */
.infobox .infobox-subbox{width:100%;border:0;background:transparent;font-size:100%}
/* The magnifier-fold rides INSIDE the box, as its last row — the seat the
   v·t·e navbar held before extraction stripped it, which is where a wiki
   reader already expects a box's own apparatus. Quiet grey like the card
   folds; the panel opens leftward-aligned inside the same cell. */
.ib-why-row td{text-align:right;padding:2px 6px 3px}
.ib-why{margin:0}
.ib-why summary{list-style:none;cursor:pointer;display:inline-block}
.ib-why summary::-webkit-details-marker{display:none}
.ib-why[open] .rinfo{opacity:.55}
.ib-why p{text-align:left;font-size:.7rem;line-height:1.5;color:var(--muted);
  background:var(--warm);border:1px solid var(--warm-rule);border-radius:4px;padding:6px 8px;margin:4px 0 2px}

/* Holder panel with merged infobox and record rows, each attributed to its source. */
.infobox.holder-panel{margin:0 0 12px}
.rail-panel{clear:right}
/* Chips on rows: institution and Wikipedia source attribution, small muted labels. */
.infobox-chip{display:inline-block;font-size:.65rem;font-weight:600;color:var(--manila-ink);
  background:var(--manila);border:1px solid var(--manila-rule);border-radius:4px;
  padding:1px 6px;margin-left:4px;white-space:nowrap}
/* A conflict is two stacked rows; the second row's label cell is empty. */
.infobox td.infobox-conflict{background:var(--faint);padding:3px 8px}

/* The hero: the one thing the section wants a passing reader to see. It is a
   card, so everything true of a card stays true of it — it is just given the
   room to be looked at rather than scanned past. */
/* The thumb frame: hairline border, grey ground, 3px of padding around the
   picture, caption inside the box. No radius and no shadow — MediaWiki content
   has neither, and they were what made these read as cards from another site
   pasted onto a wiki page. */
.hero-card{flex:none;width:100%;margin:0;border:1px solid var(--rule);
  background:var(--bg);padding:3px}
.hero-card .shot{border-radius:0;box-shadow:none}
.hero-card figcaption{padding:6px 4px 3px}
/* Flex, not because the tag needs it, but because the hero can carry the same
   manila sample badge a shelf head does — pushed to the right edge of the
   frame, where every other head on the page puts it. */
.hero-src{display:flex;align-items:center;gap:7px;margin:0 0 6px;min-width:0}
/* No line clamp here: the hero has the room, and a hero whose title is cut off
   mid-word is a worse advertisement for the find than a title on three lines. */
.hero-card h4{font-size:1rem;line-height:1.3;margin:0 0 5px;display:block;-webkit-line-clamp:none}
.hero-card .desc{font-size:.78rem;-webkit-line-clamp:2}
.hero-card .credit{font-size:.72rem;-webkit-line-clamp:2}
/* The lede's hero is the infobox and keeps the roomier caption; a section's is
   a 220px thumb, where a three-line description and a three-line credit are
   most of the card's height and all of the dead column beside it. */
.band:first-child .hero-card h4{font-size:1.08rem}
.band:first-child .hero-card .desc{font-size:.8rem;-webkit-line-clamp:3}
.band:first-child .hero-card .credit{-webkit-line-clamp:3}
.zoom-link{margin:6px 0 0}
a.zoom{color:var(--link);display:inline;font-size:.78rem}
a.zoom:visited{color:var(--link-visited)}
a.zoom:hover{text-decoration:underline}
.req-statement{font-size:.72rem;color:#5d6469;margin:2px 0 0}

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
.carousel-head .count{margin-left:auto;font-family:var(--sans);font-size:.66rem;font-weight:600;
  color:var(--manila-ink);background:var(--manila);border:1px solid var(--manila-rule);
  border-radius:8px;padding:1px 8px;white-space:nowrap;flex:none}
.carousel-head .count[title]{cursor:help}
/* A single thumb's caption head: the same source tag and manila claim the
   gallery head carries, at caption scale, inside the frame. */
.single-head{display:flex;align-items:center;gap:7px;margin:1px 1px 6px;min-width:0}
.single-head .topic{font-size:.72rem;font-weight:600;color:var(--head);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.single-head .count,.hero-src .count{margin-left:auto;font-family:var(--sans);font-size:.62rem;font-weight:600;
  color:var(--manila-ink);background:var(--manila);border:1px solid var(--manila-rule);
  border-radius:8px;padding:0 7px;white-space:nowrap;flex:none}
.single-head .count[title],.hero-src .count[title]{cursor:help}
/* The badge as the door (2026-08-10). It keeps the manila slug exactly — the
   number is still the claim, and a blue underlined "4 of 54" would read as one
   more link in a page already dense with them — and earns its affordance from
   the ↗ it now carries plus a hover that fills the chip. The pointer cursor
   overrides the help cursor the [title] rule above sets, which is right for a
   hover-only sentence and wrong for something you can click. */
a.count{text-decoration:none;cursor:pointer;transition:background-color .12s,border-color .12s}
a.count:hover,a.count:focus-visible{text-decoration:none;background:var(--manila-rule);
  border-color:var(--manila-ink)}
/* Both heads sit above the visual now, outside the figcaption's padding, so
   they carry their own: the friend's name opens every box (2026-08-09). */
.card > .single-head,.card > .hero-src{margin:3px 4px 7px}
.carousel.single .card{width:100%;flex:none}
.carousel-head .topic{font-size:.8rem;font-weight:600;color:var(--head);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.carousel-why{font-family:var(--sans);font-size:.67rem;color:var(--muted);margin:-6px 0 8px}
/* A wrapping grid of framed boxes, which IS MediaWiki's gallery — ul.gallery
   with li.gallerybox, each box a thumb frame. It replaced a horizontally
   scrolling strip on 2026-08-07: MediaWiki has no scrolling-strip idiom and no
   arrow-carousel idiom either, so scrolling was not a departure that arrows
   would have fixed — both are inventions, and only one of them is also a
   hidden-content problem. Wrapping costs nothing here because a shelf holds at
   most six cards (WORKS_BY_SUBJECT) and usually three or four, so nothing was
   ever off-screen enough to need a control; the shelf's flex-basis still sizes
   it to three across, and a longer shelf now grows a second row instead of
   hiding its tail behind a scrollbar. */
/* flex-start since 2026-08-08 (was stretch, 2026-08-07). Stretch made cards
   in a row share the tallest card's height, which did not remove the hole
   under a short card — it moved the hole INSIDE the card's border, where it
   reads as a broken caption. Ragged bottoms are what a real gallery has. */
.carousel-track{display:flex;flex-wrap:wrap;align-items:flex-start;gap:14px}
/* Every card is a MediaWiki thumbnail, and that IS the argument: these are
   shaped exactly like the pictures an article already carries, so what a reader
   notices is not a foreign widget but that the article does not have them. The
   one thing kept deliberately un-wiki is .src — the uppercase partner line
   with its favicon, which has no MediaWiki analogue and is what says this came
   from outside. */
/* margin:0 is load-bearing, not tidying (2026-08-07). A card is a <figure>, and
   the UA default for figure is margin:1em 40px — so every card carried 80px of
   horizontal margin nobody wrote. .hero-card had always reset it; deck cards
   never did. It was invisible while the tracks scrolled horizontally, because
   the extra width just made a scrolling strip scroll a little more. The moment
   the tracks wrapped it became the dominant whitespace bug on the page: three
   186px cards need 586px and were claiming 826px, so a shelf sized for three
   fitted two, wrapped the third onto a row of its own, and left the ragged
   holes that made a wide page look mostly empty. */
.card{flex:0 0 178px;margin:0;border:1px solid var(--rule);background:var(--bg);padding:3px}
.src{display:inline-flex;align-items:center;gap:7px;font-size:.68rem;letter-spacing:.08em;
  text-transform:uppercase;font-weight:700;color:var(--muted)}
.frame{position:relative;aspect-ratio:16/9;background:#111;overflow:hidden}
.frame.audio{aspect-ratio:auto;height:52px;background:#1d1d20}
.frame iframe{position:absolute;inset:0;width:100%;height:100%;border:0}
.frame.audio iframe{position:static;height:52px}
.shot{width:100%;background:var(--faint)}
/* Gallery images share one height, letterboxed, never cropped or squashed —
   MediaWiki's own gallery normalizes exactly this way (2026-08-08). Mixed
   portrait covers were growing rows to the tallest scan on the shelf. The
   hero and the gutter thumbs keep natural aspect: they are thumbs, and a
   thumb's shape IS its content's shape. */
.carousel:not(.single) .card .shot{height:150px;object-fit:contain}
a:has(> .shot){display:block}
/* Where a card has no picture. Deliberately NOT image-shaped: a 4/3 grey box is
   exactly what a failed thumbnail looks like. This is shorter, ruled at the
   foot like a card in a catalog drawer, and set in the serif — it should read
   as a label, which is what it is. See plate(). */
.plate{aspect-ratio:5/2;background:linear-gradient(180deg,#fbfbfa,var(--faint));
  border:1px solid var(--rule);border-bottom-width:3px;display:flex;align-items:center;
  justify-content:center;padding:6px 10px;box-sizing:border-box;overflow:hidden}
/* Serif is kept here on purpose. It was chosen so a plate reads as a catalog
   label rather than a failed image, and under the wiki skin it now shares the
   headings' family, so it reads as of a piece with the page instead of as a
   stray face. */
.plate-mark{font-family:var(--serif);font-size:1.02rem;line-height:1.15;font-weight:600;
  color:#4a5058;text-align:center;letter-spacing:.01em;
  display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden}
/* Nothing to say: no glyph, no stock icon, just a quiet panel that is plainly
   on purpose. The carousel already names the source above it. */
.plate.bare{background:var(--faint);border-bottom-width:1px;aspect-ratio:5/1.4}
a:has(> .plate){display:block;text-decoration:none}
a:hover > .plate{border-color:var(--link)}
a:hover > .plate .plate-mark{color:var(--link)}
/* The hero has room, so its plate can carry the label at reading size rather
   than shrinking it into the same 178px slot the carousel cards use. */
.hero-card .plate{aspect-ratio:auto;min-height:96px}
.hero-card .plate-mark{font-size:1.55rem;-webkit-line-clamp:3}
.hero-card .plate.bare{min-height:60px}
/* The caption sits inside the frame, as a thumbcaption does. */
.card figcaption{padding:6px 4px 3px;font-family:var(--sans)}
/* Three lines before the ellipsis: archival titles spend their first line on
   throat-clearing ("Tentative statement of philosophy for the…"), and the
   deck has the vertical room the old narrow rail did not. The full title
   rides on the tooltip. */
.card h4{font-size:.92rem;line-height:1.3;margin:0 0 4px;color:var(--head);font-weight:400;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
/* A card with no picture gets six title lines, not three (2026-08-09). The
   three-line clamp is fitted to cards where an image takes most of the
   height; on a text-only card the title is the only thing that says what the
   item is, nothing else wants the room, and archival titles clipped at three
   lines were unreadable on a real shelf. Keyed on the ABSENCE of a visual,
   not the presence of a plate, because "no picture" is a runtime state: a
   partner thumbnail that hotlink-blocks removes itself via onerror, and that
   card — markup says image, reader sees text — is exactly the one that needs
   the room. :has() is live, so the clamp loosens the moment the broken image
   leaves. The hero is excluded — it has its own no-clamp rule, and this
   selector would out-rank it. */
.card:not(.hero-card):not(:has(.shot,.frame)) h4{-webkit-line-clamp:6}
/* A thumbcaption's link is an ordinary blue wikilink — the underlined-on-hover
   kind — not a bordered title treatment. */
.card h4 a{color:var(--link)}
.card h4 a:visited{color:var(--link-visited)}
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
.rwhy>summary:hover,.rwhy[open]>summary{color:var(--accent)}
.rwhy>summary .ccrow{margin:0}
.rwhy .ccmark{width:1em;height:1em}
/* The magnifier (LENS), matching the connection fold below rather than
   avoiding it. A question mark was tried first, on the reasoning that two
   identical glyphs would read as one control — but "?" beside a licence mark
   reads as doubt ABOUT the licence, and casting doubt on the claim is a far
   worse cost than repeating an icon. Both controls offer a closer look; that
   they look alike is honest. (Was a circled i until 2026-08-08.) */
.rinfo{color:var(--accent);vertical-align:-1px}
.rwhy[open] .rinfo{opacity:.55}
.rwhy[open]{flex:1 1 100%}
.rwhy p{font-size:.7rem;line-height:1.5;color:var(--muted);background:var(--warm);
  border:1px solid var(--warm-rule);border-radius:4px;padding:6px 8px;margin:6px 0 0}
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
.subject-rights{clear:both;margin:0 0 14px;padding:9px 12px;border-radius:4px;
  background:#f6f8f8;border:1px solid var(--rule-strong);border-left:8px solid #b9c4c6}
.subject-rights .sr-line{margin:0;font-size:.86rem;line-height:1.45;color:#3c4448}
.subject-rights .sr-conflict{margin:6px 0 0;font-size:.86rem;line-height:1.45;color:#3c4448;border-top:1px solid #dde3e6;padding-top:6px}
.subject-rights .ccrow{--ccmark-hole:#f6f8f8}
.subject-rights .ccmark{width:1.25em;height:1.25em}
.sr-why{margin:5px 0 0}
.sr-why>summary{font-size:.74rem;color:#6a7176;cursor:pointer}
.sr-why p{font-size:.74rem;color:#5d6469;line-height:1.45}

/* The rights working, inside the lens fold. */
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
.gap summary:hover{color:var(--accent)}
.gap[open] summary{margin:0 0 12px;color:var(--head)}
.gap-body{padding:14px 16px;background:var(--warm);border:1px solid var(--warm-rule);border-radius:4px}
.gap-lead{font-size:.8rem;line-height:1.55;color:var(--ink);margin:0 0 11px}
/* Two questions, two columns: what this partner gave the page in front of you,
   and how much of it Wikipedia can show. Running them together in prose is
   what made "the article can show you one of them" read as a contradiction. */
/* A wikitable: hairline grid, grey header band. */
.gap-list{width:100%;border-collapse:collapse;margin:0 0 10px;background:var(--paper);
  border:1px solid var(--rule-strong)}
.gap-list thead th{font-size:.62rem;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);
  font-weight:700;text-align:left;padding:5px 8px 5px 10px;background:var(--faint);
  border-bottom:1px solid var(--rule-strong)}
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
.card .prov summary.why:hover,.card .prov[open] summary.why{color:var(--accent)}
/* The affordance, in the link color and heavier than the line it ends: a grey
   ⓘ reads as decoration, a blue one reads as a control. */
.card .prov .info{color:var(--accent);margin-left:5px;vertical-align:-1px}
.card .prov summary.bare .info{margin:0 4px 0 0}
.card .prov[open] .info{opacity:.55}
.card .prov p{font-size:.7rem;line-height:1.5;color:var(--muted);background:var(--faint);
  border:1px solid var(--rule);padding:6px 8px;margin:5px 0 0}
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

/* A claim about a sample, in the shape of a MediaWiki message box: hairline
   border, near-white ground, a thick colored bar on the left. It must stay
   visually unlike .broad below — one describes cards the reader can see and
   (no backticks in this stylesheet: it is a JS template literal)
   the other describes cards that are not there — and the ambox/hairline split
   keeps that distinction while both gain the wiki's own vocabulary. */
.disclosure{font-size:.75rem;line-height:1.5;color:var(--ink);
  margin:0 0 14px;padding:7px 10px;background:#fbfbfb;
  border:1px solid var(--rule-strong);border-left:8px solid #36c}
/* The references: Wikipedia's own footnotes, at the foot of the section they
   belong to. Small, hanging-numbered, with the marker's number so the prose
   and the notes agree. They floated at the TOP RIGHT of every section until
   2026-08-05, which put a closed fold in the most prominent slot on the page
   and made the prose indent around one line of small caps. */
/* MediaWiki's reflist: 90% of body size, hanging numbers in the link color
   (the "^" backlink is blue on Wikipedia, and the number is doing that job
   here), notes tight together. No top rule — the fold's summary already
   separates it from the prose, and the h2 below starts the next section. */
.refs{clear:both;margin-top:22px}
.fnlist{list-style:none;margin:0;padding:0}
.fn{display:flex;gap:7px;font-size:.9em;line-height:1.5;color:var(--ink);margin:0 0 4px}
.fn:target{background:#eaf3ff;outline:4px solid #eaf3ff}
.fn-num{flex:none;min-width:1.7em;text-align:right;color:var(--link)}
.fn-text{min-width:0;overflow-wrap:break-word}
.fn-text a{color:var(--link)}
.fn-text a:visited{color:var(--link-visited)}
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

/* The site footer, in Vector's own key: inside the content block, above a
   hairline, small and grey. */
.foot{max-width:1000px;margin:0 auto;padding:14px 32px 26px;background:var(--paper);
  border:1px solid var(--rule-strong);border-width:0 1px 1px;
  font-size:.78rem;line-height:1.6;color:var(--muted)}
.foot p{margin:0;padding-top:14px;border-top:1px solid var(--warm-rule)}
.foot code{background:var(--faint);padding:1px 5px}

@media(max-width:900px){main{padding:4px 20px 0}.hero{padding:0 20px 12px}
  .kicker{margin:0 -20px 18px;padding:9px 20px}.foot{padding:14px 20px 26px}}
@media(max-width:640px){
  main{padding:4px 14px 0}
  .hero{padding:0 14px 12px}
  .kicker{margin:0 -14px 16px;padding:8px 14px}
  .foot{padding:14px 14px 22px}
  /* Stacked order: the section's best find, the article, the rest of the
     media, then the references. The DOM order already says this, but the
     float has to be undone and the flex order stated so a future DOM change
     cannot silently reshuffle a one-column page. */
  .band-body{display:flex;flex-direction:column}
  /* The first-child override must be restated: a media query adds no
     specificity, so without this the lede rail (infobox or hero) stays a
     fixed 330px inside the one-column stack — masked at 390px, a growing
     dead right margin anywhere between ~420 and 640px. */
  .rail,.band:first-child .rail{float:none;width:auto;margin:0 0 22px;order:1}
  .prose{order:2}
  /* Gutter thumbs stack AFTER the prose on a phone — a column of images
     before any text is not an article. */
  .rail-more,.band:first-child .rail-more{float:none;width:auto;margin:0 0 22px;order:3}
  .deck{order:4}
  .refs{order:5}
  /* One column means shelves and cards take the column. The shelf's flex
     basis arrives as an inline style (sized for the desktop deck), so the
     stylesheet needs !important to beat it here — the one place this sheet
     does that, and why. Cards go two-up: 178px singles left half the column
     as dead margin, and full-width cards blow a 16:9 thumbnail to 360px for
     three lines of caption. */
  .carousel{flex:1 1 100%!important}
  .carousel-head .topic{white-space:normal}
  .card{flex:1 1 calc(50% - 7px)}
  .broad{display:block}
  .broad .fav{display:inline-block;margin-right:6px}
}
`
