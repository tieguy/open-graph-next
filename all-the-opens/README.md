# All The Opens

Exploring what it would look like if open knowledge institutions worked together at internet speed.

Three prototypes:

- **tapestry-gen/** - *"The article, enriched."* Takes an English Wikipedia article and renders it with the open ecosystem's media and cited sources placed beside the prose. Nothing is placed by hand: every item is found by an identifier the article itself states — a citation's ISBN, OCLC or LCCN, or a wikilink's Wikidata QID. `spike.js` does this for any article, with no curated dataset and no per-article code.
- **web-demo/** - A D3.js force-directed graph connecting Apollo 11 resources across Internet Archive, Wikipedia, Wikimedia Commons, OpenLibrary, Smithsonian, and more
- **extension/** - A Chrome extension that surfaces related open knowledge resources while browsing Wikipedia

## Seeing it

```
node site/build.js                      # assemble _site/ from the committed renders
python3 -m http.server 8000 -d _site    # open http://localhost:8000
```

`site/index.html` is the index: three live-generated articles (Apollo 11, Brown v. Board of Education, Ludwig Prandtl), the earlier curated Apollo 11 render, and the graph demo.

## Inspiration

This project is inspired by conversations with [Jennie Rose Halperin](https://jennierosehalperin.me) about cooperative knowledge infrastructure and the future of libraries.

## License

All code in this repository is dedicated to the public domain under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

**Not covered by this license:**

- **Extension icons** (`extension/icons/`) and source favicons referenced in the web demo are the property of their respective owners.
- **Cached data** (`web-demo/data/`) contains metadata derived from the following sources, each with their own licenses and terms:
  - [Wikipedia](https://en.wikipedia.org) / [Wikidata](https://www.wikidata.org) — [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/)
  - [Wikimedia Commons](https://commons.wikimedia.org) — various licenses per file
  - [Internet Archive](https://archive.org) — various licenses per item
  - [OpenLibrary](https://openlibrary.org) — [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (catalog data)
  - [Smithsonian](https://www.si.edu) — [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (Open Access metadata)
  - [OpenStreetMap](https://www.openstreetmap.org) — [ODbL](https://opendatacommons.org/licenses/odbl/)
  - [iNaturalist](https://www.inaturalist.org) — various licenses per observation
  - [GBIF](https://www.gbif.org) — [CC0](https://creativecommons.org/publicdomain/zero/1.0/) (metadata)
