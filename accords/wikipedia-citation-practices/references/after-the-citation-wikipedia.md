---
title: "After the citation: Wikipedia"
license: CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/)
metadata:
  author: Mike Tiegerman
---

Adding a citation to a Wikipedia article is not the final step. Every edit enters an ecosystem of human review processes and automated systems that may modify, validate, challenge, or build upon the citation. This document describes what happens after a citation is saved.

## Human review processes

### Recent changes patrol

Wikipedia's Recent Changes feed shows all edits in real time. Patrollers — experienced editors who monitor this feed — review edits for vandalism, policy violations, and sourcing problems.

On English Wikipedia, the formal patrol flag only applies to newly created articles (via *new page patrol*). For edits to existing articles, review happens through less formal channels:

- **Watchlists.** Editors who have watchlisted an article receive notifications of changes. Articles on controversial topics tend to have many watchers.
- **Topic-specific WikiProjects.** WikiProjects (e.g., WikiProject Medicine, WikiProject Biography) monitor articles within their scope and may review citation quality.
- **Article talk pages.** Editors discuss sourcing concerns on the article's talk page. Disputes about whether a source is reliable or whether it supports a particular claim are resolved through talk page consensus.

There is no systematic review of every citation edit. Low-traffic articles with few watchers may receive little scrutiny.

See: https://en.wikipedia.org/wiki/Wikipedia:Recent_changes_patrol

### Pending changes review

Some articles are placed under *pending changes protection*, meaning that edits by unregistered or newly registered users are not immediately visible to readers. Instead, they sit in a queue until a *reviewer* (an editor with the reviewer permission) accepts or rejects them.

Reviewers check for:
- Obvious vandalism
- BLP violations
- Copyright violations
- Good faith but problematic edits

Reviewers are **not expected to verify factual accuracy** or evaluate source quality in depth. Pending changes is a filter for bad-faith edits, not a fact-checking system.

English Wikipedia has approximately 8,200 reviewers and 813 administrators who can perform reviews. The queue is accessible at Special:PendingChanges.

See: https://en.wikipedia.org/wiki/Wikipedia:Reviewing_pending_changes

### New page patrol

Newly created articles enter the *new pages patrol* queue, where patrollers evaluate them for:
- Basic sourcing (does the article cite any reliable sources?)
- Notability (do the cited sources establish that the subject meets Wikipedia's notability guidelines?)
- Policy compliance (BLP, copyright, neutrality)

New page patrol is the most structured human review process on Wikipedia. Patrollers can mark articles as reviewed, tag them for issues, or nominate them for deletion.

See: https://en.wikipedia.org/wiki/Wikipedia:New_pages_patrol

### BLP enforcement

Biographies of living persons receive heightened scrutiny through both human and automated mechanisms:

- **Edit filters.** Automated rules (edit filters 39, 117, 189, and others) detect patterns associated with BLP violations — unsourced negative content, certain categories of personal information, edits by new accounts to BLP articles. Triggered edits may be flagged, warned, or blocked.
- **BLPWatch.** An extended monitoring system that provides additional oversight of tagged BLP articles.
- **Immediate removal standard.** Unlike other sourcing issues where material may be tagged and given time for improvement, unsourced contentious BLP material must be removed on sight.

See: https://en.wikipedia.org/wiki/Wikipedia:Biographies_of_living_persons

### Dispute resolution

When editors disagree about citations — whether a source is reliable, whether it supports a claim, whether a claim needs a citation — Wikipedia has a graduated dispute resolution process:

1. **Talk page discussion.** The default venue. Editors present arguments grounded in policy.
2. **Bold, revert, discuss (BRD).** A common cycle: one editor makes a change, another reverts it, and both discuss on the talk page.
3. **Reliable sources noticeboard (WP:RSN).** A centralized forum where editors can ask for community input on whether a specific source is reliable for a specific claim.
4. **Third opinion (WP:3O).** For disputes between two editors, a third editor provides an outside perspective.
5. **Request for comment (RfC).** A formal process for soliciting broader community input on a specific question.
6. **Arbitration.** Wikipedia's highest dispute resolution body, reserved for conduct disputes rather than content questions.

See: https://en.wikipedia.org/wiki/Wikipedia:Dispute_resolution

## Automated systems (bots)

### Citation bot

An automated tool that improves existing citations by expanding incomplete metadata. It does not add new citations or verify factual claims.

What it does:
- Looks up DOIs, PMIDs, ISBNs, and other identifiers via CrossRef, PubMed, JSTOR, and similar APIs
- Converts bare URLs (e.g., arxiv.org links) into properly formatted citation templates
- Fills in missing parameters (title, author, date, journal) from identifier databases
- Fixes formatting errors in existing citations

What it does not do:
- Verify that a source supports the claim it is cited for
- Add citations to unsourced claims
- Evaluate source reliability

Citation bot can be triggered manually by editors or runs as a scheduled bot.

See: https://github.com/ms609/citation-bot

### InternetArchiveBot (IABot)

Operated by the Internet Archive, IABot is one of Wikipedia's most impactful bots for citation maintenance:

- **Proactive archiving.** Monitors all Wikimedia wikis for new outgoing links and saves them to the Wayback Machine within approximately 24 hours.
- **Dead link detection.** Periodically checks existing citation URLs for availability.
- **Automatic repair.** When a URL is dead but an archived version exists, IABot replaces the link with the archived version using `|archive-url=` and `|archive-date=` parameters.
- **Tagging.** Links that cannot be repaired (no archive available) are tagged with `{{Dead link}}`.

IABot has rescued over 9 million broken links across Wikipedia.

See: https://meta.wikimedia.org/wiki/InternetArchiveBot

### OAbot (Open Access Bot)

Finds open-access versions of paywalled academic sources and adds links to them. When a citation references a journal article behind a paywall, OAbot searches for freely available versions on:
- Institutional repositories
- Preprint servers (arXiv, bioRxiv, etc.)
- PubMed Central
- CORE, Unpaywall, and other open-access aggregators

OAbot adds `|doi-access=free` or links to the open-access version, improving both citation quality and reader access.

See: https://en.wikipedia.org/wiki/Wikipedia:OABOT

### Edit filters

Edit filters are automated rules that evaluate edits *before* they are saved. They can:
- **Warn** the editor about potential problems
- **Tag** the edit for human review
- **Disallow** the edit entirely (for high-confidence vandalism patterns)
- **Log** the edit for monitoring

Edit filters relevant to citations include rules that detect:
- Removal of all references from an article
- Addition of known unreliable or spam URLs
- BLP-related sourcing violations
- Suspicious patterns in reference formatting

Edit filters are maintained by edit filter managers (a subset of administrators) and their specific rules are generally not public (to prevent circumvention).

## The lifecycle of a citation

Putting it together, a citation on Wikipedia may go through these stages after being added:

1. **Immediate.** The edit appears in Recent Changes. If the article is under pending changes protection, the edit enters the review queue.
2. **Minutes to hours.** Watchers of the article are notified. IABot may archive the URL.
3. **Hours to days.** Citation bot may expand incomplete metadata. OAbot may add open-access links.
4. **Ongoing.** Other editors may challenge the citation on the talk page, add `{{better source needed}}` or `{{failed verification}}` tags, or replace it with a stronger source.
5. **Long-term.** IABot periodically checks for link rot and repairs dead links. The citation may be refined, replaced, or removed as the article evolves.

No single system provides comprehensive quality assurance. The combination of watchlists, bots, editorial norms, and occasional formal review creates a distributed, asynchronous review process.
