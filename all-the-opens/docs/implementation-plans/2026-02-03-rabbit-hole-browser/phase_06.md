# Rabbit Hole Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a visual "rabbit hole browser" that connects resources across open knowledge organizations, starting with Apollo 11 as seed.

**Architecture:** Force-directed graph visualization with D3.js. All data pre-cached in JSON files. Static site with no backend.

**Tech Stack:** D3.js v7 (ESM from CDN), vanilla JavaScript, CSS

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-02-03 - Greenfield project, no existing code

---

## Phase 6: Data Curation

**Goal:** Populate cache with curated Apollo 11 exploration graph (~50-100 items across all sources)

**Dependencies:** Phase 1 (schema), Phase 5 (potential counts format)

**Done when:** Interesting exploration paths exist from Apollo 11 through diverse sources, leaf nodes have potential counts

**Note:** This phase involves research and data fetching from external APIs. The implementation agent should use WebFetch and WebSearch tools to gather real data from the knowledge sources.

---

### Task 1: Expand Apollo 11 Seed with First-Level Connections

**Files:**
- Modify: `data/apollo-11/connections.json`

**Step 1: Update connections.json with comprehensive first-level connections**

Research and add connections from Apollo 11 to items across multiple sources:

```json
{
  "ia-apollo11-mission": [
    {
      "targetId": "wiki-neil-armstrong",
      "type": "person",
      "label": "crew member"
    },
    {
      "targetId": "wiki-buzz-aldrin",
      "type": "person",
      "label": "crew member"
    },
    {
      "targetId": "wiki-michael-collins",
      "type": "person",
      "label": "crew member"
    },
    {
      "targetId": "ia-apollo11-footage",
      "type": "subject",
      "label": "mission footage"
    },
    {
      "targetId": "commons-apollo11-launch",
      "type": "subject",
      "label": "launch photo"
    },
    {
      "targetId": "wiki-saturn-v",
      "type": "subject",
      "label": "launch vehicle"
    },
    {
      "targetId": "smithsonian-command-module",
      "type": "subject",
      "label": "spacecraft"
    },
    {
      "targetId": "ol-carrying-fire",
      "type": "creator",
      "label": "memoir by crew"
    }
  ]
}
```

**Step 2: Verify operationally**

Run: `cat data/apollo-11/connections.json | python3 -m json.tool`
Expected: Valid JSON with 8+ connections from Apollo 11

**Step 3: Commit**

```bash
git add data/apollo-11/connections.json
git commit -m "feat: expand Apollo 11 first-level connections"
```

---

### Task 2: Create Internet Archive Items

**Files:**
- Create: `data/apollo-11/items/ia-apollo11-footage.json`
- Create: `data/apollo-11/items/ia-apollo11-audio.json`
- Create: `data/apollo-11/items/ia-nasa-apollo11-press-kit.json`

**Research:** Use WebFetch to get metadata from archive.org API:
- `https://archive.org/metadata/apollo11`
- `https://archive.org/metadata/Apollo11Audio`
- Search for related Apollo 11 items

**Step 1: Create ia-apollo11-footage.json**

```json
{
  "id": "ia-apollo11-footage",
  "source": "internet_archive",
  "title": "Apollo 11 Mission Footage",
  "description": "Complete television transmission of the Apollo 11 mission, including the historic first moonwalk by Neil Armstrong and Buzz Aldrin on July 20, 1969.",
  "thumbnail": "https://archive.org/services/img/Apollo11MoonwalkonNASATVJuly201969",
  "url": "https://archive.org/details/Apollo11MoonwalkonNASATVJuly201969",
  "connections": [],
  "potential": {
    "internet_archive": 2341,
    "wikipedia": 45,
    "wikimedia_commons": 156,
    "dpla": 23,
    "total": 2565
  }
}
```

**Step 2: Create ia-apollo11-audio.json**

```json
{
  "id": "ia-apollo11-audio",
  "source": "internet_archive",
  "title": "Apollo 11 Mission Audio",
  "description": "Air-to-ground voice transmissions and onboard recordings from the Apollo 11 mission, including 'The Eagle has landed' and 'One small step' moments.",
  "thumbnail": "https://archive.org/services/img/Apollo11Audio",
  "url": "https://archive.org/details/Apollo11Audio",
  "connections": [],
  "potential": {
    "internet_archive": 892,
    "wikipedia": 12,
    "arxiv": 3,
    "total": 907
  }
}
```

**Step 3: Create ia-nasa-apollo11-press-kit.json**

```json
{
  "id": "ia-nasa-apollo11-press-kit",
  "source": "internet_archive",
  "title": "NASA Apollo 11 Press Kit",
  "description": "Official NASA press kit for the Apollo 11 mission, containing mission timeline, spacecraft specifications, crew biographies, and technical details.",
  "thumbnail": "https://archive.org/services/img/nasa_apollo11_press_kit",
  "url": "https://archive.org/details/nasa_apollo11_press_kit",
  "connections": [],
  "potential": {
    "internet_archive": 567,
    "dpla": 89,
    "smithsonian": 12,
    "total": 668
  }
}
```

**Step 4: Verify operationally**

Run: `ls data/apollo-11/items/ia-*.json | wc -l`
Expected: 4 (including original seed reference files)

**Step 5: Commit**

```bash
git add data/apollo-11/items/ia-*.json
git commit -m "feat: add Internet Archive Apollo 11 items"
```

---

### Task 3: Create Wikipedia Items

**Files:**
- Create: `data/apollo-11/items/wiki-saturn-v.json`
- Create: `data/apollo-11/items/wiki-lunar-module.json`
- Create: `data/apollo-11/items/wiki-apollo-program.json`
- Create: `data/apollo-11/items/wiki-moon-landing.json`

**Research:** Use WebSearch/WebFetch to get article summaries from Wikipedia API

**Step 1: Create wiki-saturn-v.json**

```json
{
  "id": "wiki-saturn-v",
  "source": "wikipedia",
  "title": "Saturn V",
  "description": "The Saturn V was an American human-rated super heavy-lift launch vehicle used by NASA for the Apollo program. It remains the most powerful rocket ever flown successfully.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/1/16/Apollo_11_Launch2.jpg/200px-Apollo_11_Launch2.jpg",
  "url": "https://en.wikipedia.org/wiki/Saturn_V",
  "connections": [
    {
      "targetId": "wiki-wernher-von-braun",
      "type": "creator",
      "label": "chief architect"
    }
  ],
  "potential": {
    "internet_archive": 234,
    "wikipedia": 89,
    "wikimedia_commons": 456,
    "smithsonian": 23,
    "total": 802
  }
}
```

**Step 2: Create wiki-lunar-module.json**

```json
{
  "id": "wiki-lunar-module",
  "source": "wikipedia",
  "title": "Apollo Lunar Module",
  "description": "The Apollo Lunar Module (LM) was the lunar lander spacecraft that was flown between lunar orbit and the Moon's surface during the Apollo program.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/2/2a/Apollo_11_Lunar_Module_Eagle_in_landing_configuration_in_lunar_orbit_from_the_Command_and_Service_Module_Columbia.jpg/220px-Apollo_11_Lunar_Module_Eagle_in_landing_configuration_in_lunar_orbit_from_the_Command_and_Service_Module_Columbia.jpg",
  "url": "https://en.wikipedia.org/wiki/Apollo_Lunar_Module",
  "connections": [],
  "potential": {
    "internet_archive": 178,
    "wikipedia": 67,
    "wikimedia_commons": 234,
    "smithsonian": 45,
    "total": 524
  }
}
```

**Step 3: Create wiki-apollo-program.json**

```json
{
  "id": "wiki-apollo-program",
  "source": "wikipedia",
  "title": "Apollo Program",
  "description": "The Apollo program was a NASA human spaceflight program that landed the first humans on the Moon between 1969 and 1972. It accomplished President Kennedy's goal of landing a man on the Moon.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e0/Apollo_program_insignia.png/200px-Apollo_program_insignia.png",
  "url": "https://en.wikipedia.org/wiki/Apollo_program",
  "connections": [
    {
      "targetId": "wiki-jfk",
      "type": "person",
      "label": "initiated by"
    }
  ],
  "potential": {
    "internet_archive": 4521,
    "wikipedia": 345,
    "wikimedia_commons": 1234,
    "dpla": 234,
    "openlibrary": 456,
    "arxiv": 89,
    "smithsonian": 123,
    "total": 7002
  }
}
```

**Step 4: Create wiki-moon-landing.json**

```json
{
  "id": "wiki-moon-landing",
  "source": "wikipedia",
  "title": "Moon Landing",
  "description": "A Moon landing is the arrival of a spacecraft on the surface of the Moon. The first human Moon landing was Apollo 11 on July 20, 1969.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/9c/Aldrin_Apollo_11.jpg/200px-Aldrin_Apollo_11.jpg",
  "url": "https://en.wikipedia.org/wiki/Moon_landing",
  "connections": [],
  "potential": {
    "internet_archive": 3456,
    "wikipedia": 567,
    "wikimedia_commons": 2345,
    "dpla": 123,
    "total": 6491
  }
}
```

**Step 5: Verify operationally**

Run: `ls data/apollo-11/items/wiki-*.json | wc -l`
Expected: 7+ Wikipedia items

**Step 6: Commit**

```bash
git add data/apollo-11/items/wiki-*.json
git commit -m "feat: add Wikipedia Apollo 11 related items"
```

---

### Task 4: Create Wikimedia Commons Items

**Files:**
- Create: `data/apollo-11/items/commons-apollo11-launch.json`
- Create: `data/apollo-11/items/commons-earthrise.json`
- Create: `data/apollo-11/items/commons-footprint.json`

**Research:** Use WebSearch to find notable Apollo 11 images on Wikimedia Commons

**Step 1: Create commons-apollo11-launch.json**

```json
{
  "id": "commons-apollo11-launch",
  "source": "wikimedia_commons",
  "title": "Apollo 11 Launch",
  "description": "Photograph of the Saturn V rocket carrying Apollo 11 lifting off from Kennedy Space Center Launch Complex 39A on July 16, 1969.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/9/98/Aldrin_Apollo_11_original.jpg/200px-Aldrin_Apollo_11_original.jpg",
  "url": "https://commons.wikimedia.org/wiki/File:Apollo_11_Launch_-_GPN-2000-000630.jpg",
  "connections": [],
  "potential": {
    "wikimedia_commons": 4567,
    "internet_archive": 234,
    "total": 4801
  }
}
```

**Step 2: Create commons-earthrise.json**

```json
{
  "id": "commons-earthrise",
  "source": "wikimedia_commons",
  "title": "Earthrise (Apollo 11)",
  "description": "Earth rising over the lunar horizon as seen from Apollo 11. One of the most iconic images of the space age.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a8/NASA-Apollo8-Dec24-Earthrise.jpg/200px-NASA-Apollo8-Dec24-Earthrise.jpg",
  "url": "https://commons.wikimedia.org/wiki/File:NASA-Apollo8-Dec24-Earthrise.jpg",
  "connections": [
    {
      "targetId": "wiki-environmental-movement",
      "type": "subject",
      "label": "inspired"
    }
  ],
  "potential": {
    "wikimedia_commons": 1234,
    "internet_archive": 89,
    "met_museum": 5,
    "total": 1328
  }
}
```

**Step 3: Create commons-footprint.json**

```json
{
  "id": "commons-footprint",
  "source": "wikimedia_commons",
  "title": "Bootprint on the Moon",
  "description": "Buzz Aldrin's bootprint on the lunar surface, one of the first steps taken on the Moon. This photograph has become an iconic image of human space exploration.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/a/a5/Aldrin_Apollo_11.jpg/200px-Aldrin_Apollo_11.jpg",
  "url": "https://commons.wikimedia.org/wiki/File:Bootprint.jpg",
  "connections": [],
  "potential": {
    "wikimedia_commons": 567,
    "internet_archive": 123,
    "smithsonian": 8,
    "total": 698
  }
}
```

**Step 4: Verify operationally**

Run: `ls data/apollo-11/items/commons-*.json | wc -l`
Expected: 3 Wikimedia Commons items

**Step 5: Commit**

```bash
git add data/apollo-11/items/commons-*.json
git commit -m "feat: add Wikimedia Commons Apollo 11 images"
```

---

### Task 5: Create Smithsonian Items

**Files:**
- Create: `data/apollo-11/items/smithsonian-command-module.json`
- Create: `data/apollo-11/items/smithsonian-space-suit.json`

**Research:** Use WebSearch to find Smithsonian Apollo 11 collection items

**Step 1: Create smithsonian-command-module.json**

```json
{
  "id": "smithsonian-command-module",
  "source": "smithsonian",
  "title": "Apollo 11 Command Module Columbia",
  "description": "The actual spacecraft that carried astronauts Armstrong, Aldrin, and Collins to the Moon and back. On display at the National Air and Space Museum in Washington, D.C.",
  "thumbnail": "https://ids.si.edu/ids/deliveryService?id=NASM-A19700102000-NASM2018-02925",
  "url": "https://airandspace.si.edu/collection-objects/command-module-apollo-11/nasm_A19700102000",
  "connections": [
    {
      "targetId": "wiki-michael-collins",
      "type": "person",
      "label": "piloted by"
    }
  ],
  "potential": {
    "smithsonian": 234,
    "internet_archive": 456,
    "wikimedia_commons": 89,
    "total": 779
  }
}
```

**Step 2: Create smithsonian-space-suit.json**

```json
{
  "id": "smithsonian-space-suit",
  "source": "smithsonian",
  "title": "Neil Armstrong's Apollo 11 Spacesuit",
  "description": "The A7-L spacesuit worn by Neil Armstrong during the Apollo 11 mission, including the historic first moonwalk. Recently restored and on display.",
  "thumbnail": "https://ids.si.edu/ids/deliveryService?id=NASM-NASM2019-01866",
  "url": "https://airandspace.si.edu/collection-objects/pressure-suit-a7-l-armstrong-apollo-11-flown/nasm_A19710155000",
  "connections": [
    {
      "targetId": "wiki-neil-armstrong",
      "type": "person",
      "label": "worn by"
    }
  ],
  "potential": {
    "smithsonian": 156,
    "internet_archive": 234,
    "wikimedia_commons": 78,
    "total": 468
  }
}
```

**Step 3: Verify operationally**

Run: `ls data/apollo-11/items/smithsonian-*.json | wc -l`
Expected: 2 Smithsonian items

**Step 4: Commit**

```bash
git add data/apollo-11/items/smithsonian-*.json
git commit -m "feat: add Smithsonian Apollo 11 collection items"
```

---

### Task 6: Create OpenLibrary Items

**Files:**
- Create: `data/apollo-11/items/ol-carrying-fire.json`
- Create: `data/apollo-11/items/ol-first-man.json`

**Research:** Use WebSearch to find Apollo 11 books on OpenLibrary

**Step 1: Create ol-carrying-fire.json**

```json
{
  "id": "ol-carrying-fire",
  "source": "openlibrary",
  "title": "Carrying the Fire",
  "description": "An Astronaut's Journeys by Michael Collins. A memoir of the Apollo 11 command module pilot's experiences, widely considered one of the best astronaut autobiographies ever written.",
  "thumbnail": "https://covers.openlibrary.org/b/id/240726-M.jpg",
  "url": "https://openlibrary.org/works/OL1126865W/Carrying_the_Fire",
  "connections": [
    {
      "targetId": "wiki-michael-collins",
      "type": "creator",
      "label": "written by"
    }
  ],
  "potential": {
    "openlibrary": 345,
    "internet_archive": 567,
    "dpla": 23,
    "total": 935
  }
}
```

**Step 2: Create ol-first-man.json**

```json
{
  "id": "ol-first-man",
  "source": "openlibrary",
  "title": "First Man: The Life of Neil A. Armstrong",
  "description": "Biography by James R. Hansen, the only authorized biography of Neil Armstrong. Basis for the 2018 film starring Ryan Gosling.",
  "thumbnail": "https://covers.openlibrary.org/b/id/8234571-M.jpg",
  "url": "https://openlibrary.org/works/OL17354773W/First_Man",
  "connections": [
    {
      "targetId": "wiki-neil-armstrong",
      "type": "subject",
      "label": "biography of"
    }
  ],
  "potential": {
    "openlibrary": 234,
    "internet_archive": 89,
    "dpla": 12,
    "total": 335
  }
}
```

**Step 3: Verify operationally**

Run: `ls data/apollo-11/items/ol-*.json | wc -l`
Expected: 2 OpenLibrary items

**Step 4: Commit**

```bash
git add data/apollo-11/items/ol-*.json
git commit -m "feat: add OpenLibrary Apollo 11 books"
```

---

### Task 7: Create Additional Wikipedia People Items

**Files:**
- Create: `data/apollo-11/items/wiki-wernher-von-braun.json`
- Create: `data/apollo-11/items/wiki-jfk.json`

**Step 1: Create wiki-wernher-von-braun.json**

```json
{
  "id": "wiki-wernher-von-braun",
  "source": "wikipedia",
  "title": "Wernher von Braun",
  "description": "German-American aerospace engineer who led development of the Saturn V rocket. Known as the 'father of space travel' and central figure in NASA's Apollo program.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/5/56/Wernher_von_Braun_1960.jpg/200px-Wernher_von_Braun_1960.jpg",
  "url": "https://en.wikipedia.org/wiki/Wernher_von_Braun",
  "connections": [],
  "potential": {
    "wikipedia": 234,
    "internet_archive": 1234,
    "wikimedia_commons": 567,
    "openlibrary": 89,
    "total": 2124
  }
}
```

**Step 2: Create wiki-jfk.json**

```json
{
  "id": "wiki-jfk",
  "source": "wikipedia",
  "title": "John F. Kennedy",
  "description": "35th President of the United States who announced the goal of landing a man on the Moon before the end of the 1960s in his famous 1961 speech to Congress.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/c/c3/John_F._Kennedy%2C_White_House_color_photo_portrait.jpg/200px-John_F._Kennedy%2C_White_House_color_photo_portrait.jpg",
  "url": "https://en.wikipedia.org/wiki/John_F._Kennedy",
  "connections": [],
  "potential": {
    "wikipedia": 2345,
    "internet_archive": 8901,
    "wikimedia_commons": 3456,
    "dpla": 1234,
    "openlibrary": 567,
    "met_museum": 23,
    "smithsonian": 456,
    "total": 16982
  }
}
```

**Step 3: Verify operationally**

Run: `ls data/apollo-11/items/*.json | wc -l`
Expected: 20+ total items

**Step 4: Commit**

```bash
git add data/apollo-11/items/wiki-wernher-von-braun.json data/apollo-11/items/wiki-jfk.json
git commit -m "feat: add key people Wikipedia items"
```

---

### Task 8: Update Connections for Second-Level Exploration

**Files:**
- Modify: `data/apollo-11/connections.json`

**Step 1: Add connections for crew members and other first-level items**

Update connections.json to include connections from first-level items:

```json
{
  "ia-apollo11-mission": [
    {
      "targetId": "wiki-neil-armstrong",
      "type": "person",
      "label": "crew member"
    },
    {
      "targetId": "wiki-buzz-aldrin",
      "type": "person",
      "label": "crew member"
    },
    {
      "targetId": "wiki-michael-collins",
      "type": "person",
      "label": "crew member"
    },
    {
      "targetId": "ia-apollo11-footage",
      "type": "subject",
      "label": "mission footage"
    },
    {
      "targetId": "commons-apollo11-launch",
      "type": "subject",
      "label": "launch photo"
    },
    {
      "targetId": "wiki-saturn-v",
      "type": "subject",
      "label": "launch vehicle"
    },
    {
      "targetId": "smithsonian-command-module",
      "type": "subject",
      "label": "spacecraft"
    },
    {
      "targetId": "ol-carrying-fire",
      "type": "creator",
      "label": "memoir by crew"
    },
    {
      "targetId": "wiki-apollo-program",
      "type": "subject",
      "label": "part of program"
    }
  ],
  "wiki-neil-armstrong": [
    {
      "targetId": "ol-first-man",
      "type": "subject",
      "label": "biography"
    },
    {
      "targetId": "smithsonian-space-suit",
      "type": "subject",
      "label": "wore this suit"
    },
    {
      "targetId": "commons-footprint",
      "type": "subject",
      "label": "first footprint"
    }
  ],
  "wiki-michael-collins": [
    {
      "targetId": "ol-carrying-fire",
      "type": "creator",
      "label": "wrote memoir"
    },
    {
      "targetId": "smithsonian-command-module",
      "type": "subject",
      "label": "piloted spacecraft"
    }
  ],
  "wiki-saturn-v": [
    {
      "targetId": "wiki-wernher-von-braun",
      "type": "creator",
      "label": "chief architect"
    },
    {
      "targetId": "commons-apollo11-launch",
      "type": "subject",
      "label": "launch photo"
    }
  ],
  "wiki-apollo-program": [
    {
      "targetId": "wiki-jfk",
      "type": "person",
      "label": "initiated by"
    },
    {
      "targetId": "wiki-moon-landing",
      "type": "subject",
      "label": "achieved goal"
    }
  ],
  "commons-earthrise": [
    {
      "targetId": "wiki-apollo-program",
      "type": "subject",
      "label": "taken during"
    }
  ]
}
```

**Step 2: Verify operationally**

Run: `cat data/apollo-11/connections.json | python3 -m json.tool | grep -c '"targetId"'`
Expected: 20+ connections

**Step 3: Commit**

```bash
git add data/apollo-11/connections.json
git commit -m "feat: add second-level exploration connections"
```

---

### Task 9: Final Verification and Item Count

**Files:** None (verification only)

**Step 1: Count total items**

Run: `ls data/apollo-11/items/*.json | wc -l`
Expected: ~20 items minimum

**Step 2: Verify all connections reference valid items**

Run: `python3 -c "
import json
import os

# Load connections
with open('data/apollo-11/connections.json') as f:
    connections = json.load(f)

# Get all item IDs
items = set()
items.add('ia-apollo11-mission')  # Seed
for f in os.listdir('data/apollo-11/items'):
    if f.endswith('.json'):
        items.add(f.replace('.json', ''))

# Check all targets exist
missing = set()
for source, conns in connections.items():
    for conn in conns:
        if conn['targetId'] not in items:
            missing.add(conn['targetId'])

if missing:
    print('Missing items:', missing)
else:
    print('All connection targets exist!')
    print(f'Total items: {len(items)}')
    print(f'Total connections: {sum(len(c) for c in connections.values())}')
"
`

Expected: "All connection targets exist!" with item and connection counts

**Step 3: Test exploration paths**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`

Test exploration paths:
1. Apollo 11 → Neil Armstrong → Biography → (leaf)
2. Apollo 11 → Saturn V → Wernher von Braun → (leaf)
3. Apollo 11 → Apollo Program → JFK → (leaf)
4. Apollo 11 → Command Module → Michael Collins → Carrying the Fire → (leaf)

Expected: Multiple interesting paths with 3-4 levels of exploration, ending at leaf nodes with potential counts

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Apollo 11 data curation

- 20+ curated items across 7 sources
- Multiple exploration paths from Apollo 11
- Leaf nodes show potential counts
- Ready for demo"
```
