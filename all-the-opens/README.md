# All The Opens

Exploring what it would look like if open knowledge institutions worked together at internet speed.

One active prototype:

- **tapestry-gen/** - *"The article, enriched."* Takes an English Wikipedia article and renders it with the open ecosystem's media and cited sources placed beside the prose. Nothing is placed by hand: every item is found by an identifier the article itself states — a citation's ISBN, OCLC or LCCN, or a wikilink's Wikidata QID. `spike.js` does this for any article, with no curated dataset and no per-article code.

Two earlier prototypes — a D3.js force-directed graph of the Apollo 11 dataset (`web-demo/`) and a browser extension — were retired to the repo-root `attic/` in August 2026, along with the Netlify site build.

## Seeing it

Open `tapestry-gen/demo/apollo-11.html` (self-contained) in a browser, or generate a fresh page:

```
cd tapestry-gen
cp .env.example .env      # your own WIKIMEDIA_UA_CONTACT, plus any partner API keys
npm run spike -- "Any Article Title"
```

Or watch it happen live — the article streams in first, the ecosystem follows as each source answers:

```
npm run serve   # then /wiki/Any_Article_Title
```

`.env` is gitignored and the npm scripts load it. A clone without one still runs: the keyed lookups skip, and those cards are missing. `WIKIMEDIA_UA_CONTACT` has no default — it identifies whoever runs the code to the Wikimedia Foundation, so it must be your own address.

## Inspiration

This project is inspired by conversations with [Jennie Rose Halperin](https://jennierosehalperin.me) about cooperative knowledge infrastructure and the future of libraries.

## License

All code in this repository is dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

**Not covered by this license:**

- **Source favicons** referenced in the renders are the property of their respective owners.
- **Cached data** (`tapestry-gen/data/`) contains metadata derived from the following sources, each with their own licenses and terms:
  - [Wikipedia](https://en.wikipedia.org) / [Wikidata](https://www.wikidata.org) — [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
  - [Wikimedia Commons](https://commons.wikimedia.org) — various licenses per file
  - [Internet Archive](https://archive.org) — various licenses per item
  - [OpenLibrary](https://openlibrary.org) — [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (catalog data)
  - [Smithsonian](https://www.si.edu) — [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (Open Access metadata)
  - [OpenStreetMap](https://www.openstreetmap.org) — [ODbL](https://opendatacommons.org/licenses/odbl/)
  - [iNaturalist](https://www.inaturalist.org) — various licenses per observation
  - [GBIF](https://www.gbif.org) — [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (metadata)
