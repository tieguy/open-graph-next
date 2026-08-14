// The partner manifest: every fact about a partner that is DATA rather than
// logic, in one descriptor per partner. `gap.js` (visibility hosts),
// `emit-html.js` (display name + icon), `front-page.js` (the friends list),
// `http.js` (hotlink safety) and `mw.js` (host limits) all derive their
// tables from here, so adding a source states these facts once instead of
// editing five slug-keyed tables that drift apart — the DigitalNZ integration
// shipped with the fetch working and the credit missing, which is exactly the
// failure this file exists to make impossible (test/partners.test.js asserts
// completeness). What CANNOT live here is logic: the fetcher, the rights
// mapping, and the lookup registration stay per-partner code — see
// docs/adding-a-source.md.
//
// This module imports nothing and must stay that way: anything may import it
// (shared infrastructure included) precisely because it can never drag a
// partner's code along. Key order is the legend's display order
// (`emit-html.js` prints sources in declaration order).
//
// Fields:
//   name           display name (the legend, credit bars, share cards)
//   icon           favicon/logo URL — bytes are committed via
//                  `tools/build-icons.mjs`; regenerate when one changes
//   hosts          registrable hosts that ARE this partner, for the
//                  visibility panel (subdomains match automatically)
//   friend         the front-page friends-list entry: `gives` (what it
//                  contributes to a page), `terms` (its openness, in our
//                  words), optional `cite` (the partner's own statement of
//                  those terms — only where the page has actually been
//                  read), optional `name` where the list's prose style
//                  differs from the display name
//   hotlinkUnsafe  true for aggregators whose thumbnails point at many
//                  provider hosts (see `hotlinkUnsafe` in src/http.js)
//   hostLimits     host → concurrent-request limit, ONLY with the partner's
//                  published policy quoted beside it (see `hostLimit` in
//                  src/mw.js — the default everywhere else is 1)

export const PARTNERS = {
  internet_archive: {
    name: 'Internet Archive',
    icon: 'https://archive.org/favicon.ico',
    hosts: ['archive.org'],
    friend: {
      gives: 'Books you can borrow, discovered through a footnote’s ISBN.',
      terms: 'Public-domain scans free to read; in-copyright books lent, not copied.',
    },
  },
  openlibrary: {
    name: 'Open Library',
    icon: 'https://openlibrary.org/favicon.ico',
    hosts: ['openlibrary.org'],
    friend: {
      gives: 'A book’s editions, and which are free to read, discovered through its ISBN.',
      terms: 'Open bibliographic data, downloadable in bulk.',
    },
  },
  smithsonian: {
    name: 'Smithsonian',
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Smithsonian_sun_logo_no_text.svg/120px-Smithsonian_sun_logo_no_text.svg.png',
    hosts: ['si.edu'],
    friend: {
      // The list's prose style, not the legend's: "the Smithsonian".
      name: 'the Smithsonian',
      gives:
        '3D scans and museum records, discovered through a pair of Wikidata statements naming the museum and its own accession number.',
      terms: 'Open Access items are CC0: no rights reserved at all.',
      // NOT si.edu's own announcement of the release, which would be the better
      // citation: www.si.edu is challenge-gated, and a real page and an invented
      // one come back indistinguishable (46,677 vs 46,728 bytes of "Smithsonian
      // request verification", 2026-08-06), so it cannot be verified from here.
      // This is the Smithsonian's own Open Access data repository, which states
      // CC0-1.0 as its licence and which does resolve — 200 for the repo, 404 for
      // one that does not exist. A claim we can check beats a better-worded one
      // we cannot. See LUI-128.
      cite: 'https://github.com/Smithsonian/OpenAccess',
    },
  },
  openstreetmap: {
    name: 'OpenStreetMap',
    icon: 'https://www.openstreetmap.org/favicon.ico',
    hosts: ['openstreetmap.org', 'osm.org'],
    friend: {
      gives: 'A map of a place, discovered through the coordinates Wikidata states for it.',
      terms: 'Map data ODbL: share-alike, credit the contributors.',
      // Says share-alike and credit in almost the same words we do.
      cite: 'https://www.openstreetmap.org/copyright',
    },
  },
  free_law: {
    // free.law, not courtlistener.com: CourtListener's favicon answers 403 to
    // every non-browser fetch, so the partner this page names most confidently
    // was the one arriving with no picture. Free Law Project is the organization
    // the credit line already says, and its own site serves the icon.
    name: 'Free Law Project',
    icon: 'https://free.law/favicon.ico',
    hosts: ['courtlistener.com'],
    friend: {
      gives: 'The court’s opinion in full, discovered through the case citation already in the article.',
      terms: 'Court opinions are public domain: nobody owns the law.',
    },
  },
  inaturalist: {
    name: 'iNaturalist',
    icon: 'https://www.inaturalist.org/favicon.ico',
    hosts: ['inaturalist.org'],
    friend: {
      gives: 'Photographs of species, discovered through a Wikidata statement naming the species’ iNaturalist taxon.',
      terms: 'Each photo carries its observer’s chosen license; only openly licensed ones are shown here.',
    },
  },
  gbif: {
    name: 'GBIF',
    icon: 'https://www.gbif.org/favicon.ico',
    hosts: ['gbif.org'],
    friend: {
      gives: 'Maps of where a species has been recorded, discovered through a Wikidata statement naming its GBIF dataset.',
      terms: 'Records CC BY-NC, CC BY or CC0, stated per dataset.',
      // Names all three licenses, including the CC BY-NC that our line used to
      // omit and that most occurrence records actually carry.
      cite: 'https://www.gbif.org/terms',
    },
  },
  openalex: {
    name: 'OpenAlex',
    // favicon.ico here answers 200 with an HTML error page, which passed the old
    // size-only check and shipped a 4 KB text/html blob as OpenAlex's icon — a
    // broken image on every page that cited an open paper. This is the file the
    // site's own <link rel="icon"> names.
    icon: 'https://openalex.org/favicon.png',
    // An article never links OpenAlex; what it links is the paper's DOI. That IS
    // the reach question for this partner — the citation is present, and what a
    // reader cannot tell from it is that a free copy exists.
    hosts: ['openalex.org', 'doi.org'],
    friend: {
      gives: 'A free, legal copy of a cited paper, discovered through its DOI or PMID.',
      terms:
        'Catalog CC0. Only papers with an open copy are shown — each card names its license; closed ones are counted, not carded.',
    },
  },
  arxiv: {
    name: 'arXiv',
    icon: 'https://arxiv.org/favicon.ico',
    hosts: ['arxiv.org'],
    friend: {
      gives: 'Preprints in physics, maths and computing, discovered through the arXiv id in a citation.',
      terms: 'Metadata CC0; each paper names its own license.',
      // Their license help page: the submitter picks a license per paper and the
      // choice is irrevocable, which is the half of our claim that matters here.
      cite: 'https://arxiv.org/help/license',
    },
  },
  met: {
    name: 'The Met',
    // The museum's own favicon answers 429 to non-browser fetches; the logo
    // hosted on Commons serves at an allowlisted thumb width instead.
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/7/73/The_Metropolitan_Museum_of_Art_Logo.svg/120px-The_Metropolitan_Museum_of_Art_Logo.svg.png',
    hosts: ['metmuseum.org'],
    friend: {
      gives:
        'The museum’s own record of an object — title, artist, date, and often an image — discovered through a Wikidata statement naming it.',
      terms: 'Public-domain works released CC0, images included.',
    },
  },
  artic: {
    name: 'Art Institute of Chicago',
    icon: 'https://www.artic.edu/favicon.ico',
    hosts: ['artic.edu'],
    friend: {
      gives:
        'The museum’s own record of a painting — title, artist, date, and often an image — discovered through a Wikidata statement naming it.',
      terms: 'Public-domain images CC0, served over open IIIF.',
      // States the CC0 designation outright, and that the object data is CC0 too.
      cite: 'https://www.artic.edu/open-access/open-access-images',
    },
  },
  rijks: {
    name: 'Rijksmuseum',
    // Unlike the Met's, the Rijksmuseum's own favicon serves 200 to non-browser
    // clients, so this one needs no Commons stand-in.
    icon: 'https://www.rijksmuseum.nl/favicon.ico',
    hosts: ['rijksmuseum.nl'],
    friend: {
      gives:
        'The museum’s own record of a work — title, date, and a photograph at full resolution — discovered through a Wikidata statement naming it.',
      terms:
        'Works out of copyright carry the public-domain mark; images served over open IIIF, catalog data CC0.',
      // Their own announcement of Collection Online, which is the infrastructure
      // this demo actually reads: it states that the data is released as Linked
      // Open Data "in the public domain", links their Information and Data
      // Policy, and recaps the 2012 Rijksstudio release that started it.
      cite: 'https://www.rijksmuseum.nl/en/press/press-releases/rijksmuseum-launches-collection-online',
    },
  },
  iiif: {
    // Not one institution but a door many institutions share: P6108 manifests
    // arrive from whichever library or museum holds the object.
    name: 'IIIF collections',
    icon: 'https://iiif.io/favicon.ico',
    // No fixed host on purpose: a IIIF manifest is served by whichever
    // institution holds the object, so its hosts can only come from the cards
    // themselves (see `partnerHosts` in src/gap.js).
    hosts: [],
    friend: {
      gives:
        'A manuscript or artwork’s own manifest — title, often an image, and the holding institution’s own credit — discovered through a Wikidata statement naming it.',
      terms: 'Terms set per object by its holding institution, stated in each manifest.',
    },
  },
  dpla: {
    name: 'DPLA',
    icon: 'https://dp.la/favicon.ico',
    hosts: ['dp.la'],
    friend: {
      gives:
        'Items from US libraries, archives and museums, discovered through the subject heading a cataloger filed them under.',
      terms: 'Metadata CC0; each item’s rights stated by its holder.',
    },
    hotlinkUnsafe: true,
    hostLimits: {
      // DPLA's developer policy (pro.dp.la/developers/policies): "Consistent
      // with its philosophical presumption of openness, in general, the DPLA
      // will not restrict or rate-limit the use of its API." The only
      // reservation is against activity "denying or unduly degrading service
      // to other API users", which a demo answering a few pageviews is not.
      // This was the second-longest chain on a cold page: 21 requests, 3.9s
      // serial.
      'api.dp.la': 4,
    },
  },
  europeana: {
    name: 'Europeana',
    // europeana.eu's own favicon now 404s and the live one sits behind a
    // content-hashed Nuxt path that changes on every redeploy of their site.
    // The logo on Commons is stable and serves at an allowlisted thumb width —
    // the same reason the Met and Smithsonian icons come from there.
    icon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/0/02/Europeana_logo_2015_basic.svg/120px-Europeana_logo_2015_basic.svg.png',
    hosts: ['europeana.eu'],
    friend: {
      gives:
        'Items from European museums, libraries and archives, discovered through a Wikidata statement naming Europeana’s own entity for the subject.',
      terms: 'Only openly licensed items are shown; each card names its license.',
    },
  },
  digitalnz: {
    name: 'DigitalNZ',
    // NOT `/favicon.ico`, which 302s to a 404 error page (checked 2026-08-08);
    // this is the path the site's own <link rel="icon"> declares. It serves
    // image/png to curl but a 202 challenge page to Node's fetch — see the
    // cache-priming note in tools/build-icons.mjs, which is how its bytes got
    // into src/icons.js.
    icon: 'https://digitalnz.org/favicons/favicon-32x32.png',
    hosts: ['digitalnz.org'],
    friend: {
      gives:
        'Items from New Zealand libraries, archives and museums, discovered through that same heading, in the way NZ catalogers spell it.',
      terms:
        'Each item states in plain words what a reader may do with it — but the API’s metadata is non-commercial by default.',
      // Their Developer API terms, read 2026-08-08 (via the Wayback Machine —
      // the live page challenge-gates non-browser clients): metadata is NC by
      // default, a keyed commercial track covers "a selection", and the
      // open-license carve-out names only Europeana, DPLA and data.govt.nz —
      // not the NZ collections themselves.
      cite: 'https://digitalnz.org/about/terms-of-use/developer-api-terms-of-use',
    },
    hotlinkUnsafe: true,
  },
}
