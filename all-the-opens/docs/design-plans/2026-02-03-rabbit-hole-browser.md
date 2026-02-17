# Rabbit Hole Browser: Internet Library Consortium Demo

## Summary

This prototype demonstrates what cooperative knowledge infrastructure could feel like by building a visual "rabbit hole browser" that connects resources across major open knowledge organizations. Starting with Apollo 11 as a seed, users explore a growing network graph where each click reveals connections to related items from Internet Archive, Wikipedia, Wikimedia Commons, DPLA, OpenLibrary, arXiv, and museum collections. The graph visualizes not just individual items but the relationships between them—crew members, shared subjects, time periods, locations—making the interconnected nature of knowledge visible and navigable.

The implementation uses a force-directed graph visualization powered by D3.js, with all data pre-cached to ensure reliability during demonstrations. Rather than building production-quality integrations with external APIs, the prototype curates approximately 50-100 items from these sources into local JSON files that define nodes (items) and edges (connections). When users reach items without further cached connections, the interface displays "potential counts" showing how many more related items exist in each source, emphasizing that the demo represents a tiny fraction of what unified library infrastructure could surface. The goal is speculative design fiction—a provocation piece for artists and dreamers that asks "what if these organizations worked together?"

## Definition of Done

**Deliverable:** A web-based "rabbit hole browser" demo seeded with Apollo 11, exploring metadata-driven connections across open knowledge sources: Internet Archive, Wikipedia, Wikimedia Commons, DPLA, OpenLibrary, arXiv, and museum collections (Met, Smithsonian).

**Success criteria:**
- Start at Apollo 11, discover connections to items from other sources
- Each item displays its source via icon/logo
- Connection types are visible ("same subject", "related person", "same era", etc.)
- Uses pre-cached data for reliability
- Evokes the reaction: "if these organizations worked together, this is what knowledge could feel like"

**Out of scope:**
- Production-quality code
- Full API integration (curated cached examples are sufficient)
- User accounts, saving, sharing features
- Comprehensive coverage of any topic

**Purpose:** Speculative design fiction prototype to provoke questions and spark imagination about cooperative knowledge infrastructure. For artists and dreamers, not bankers.

## Glossary

- **D3.js**: JavaScript library for creating interactive data visualizations using web standards. Widely used for network graphs and custom visual representations.
- **DPLA (Digital Public Library of America)**: Aggregator that provides unified access to collections from libraries, archives, and museums across the United States.
- **Force-directed graph**: Visualization technique where nodes repel each other while edges act like springs, creating organic layouts that reveal network structure through physics simulation.
- **Internet Archive**: Non-profit digital library offering free access to archived websites, books, audio, video, and other cultural artifacts.
- **Leaf node**: Node in a graph with no outgoing connections. In this context, items without further curated connections in the cached data.
- **Met Museum**: The Metropolitan Museum of Art in New York, which provides open access to data about its collection.
- **OpenLibrary**: Internet Archive project providing a catalog page for every book, with borrowing capabilities for public domain and licensed works.
- **Smithsonian**: Network of museums and research centers that shares collection metadata and images through open APIs.
- **Static site**: Website with no server-side processing, consisting only of HTML, CSS, and JavaScript files served directly to browsers.
- **Wikidata**: Free knowledge base that provides structured data for Wikipedia and other projects, including entities, relationships, and properties.
- **Wikimedia Commons**: Free media repository containing images, sounds, and videos that can be used across Wikipedia projects and beyond.

## Architecture

Force-directed graph visualization showing Apollo 11 as a seed node. Users click nodes to expand connections from cached data across multiple open knowledge sources. The graph grows organically as exploration continues.

**Core interaction:**
1. Demo opens with single prominent node: Apollo 11
2. Click to expand — connections animate in as new nodes linked by labeled edges
3. Each node shows source icon (IA spiral, Wikipedia W, DPLA mark, etc.)
4. Edge labels indicate connection type ("crew member", "same subject: spaceflight", "same era: 1969")
5. Click any node to make it the new focus and expand its connections
6. Graph accumulates — your exploration path becomes visible

**Data flow:**
```
User clicks node
  → Fetch connections from cached JSON
  → Add new nodes to graph
  → Force simulation repositions
  → User sees expanded network
```

**Leaf node handling ("evocative dead ends"):**
When a node has no further connections in the curated cache, display potential counts:
- Visual indicator: "✨ +2,847 more"
- Hover reveals breakdown: "2,847 items in Internet Archive, 156 Wikipedia articles, 89 museum objects..."
- Message: "We only showed you a tiny slice. The ocean is right there."

**Cooperative message (subtle):**
- Source icons on every node make diversity visible
- Footer text: "Imagining a unified library. Data from Internet Archive, Wikipedia, DPLA, OpenLibrary, arXiv, Smithsonian, Met Museum."
- Optional collapsible legend showing source counts in current graph

## Existing Patterns

No existing codebase — this is a new prototype. Design draws on established patterns:

- **D3.js force-directed layouts** — mature, well-documented approach for network visualization
- **Static site architecture** — no backend, pure client-side, easy to host and share
- **Pre-cached API data** — avoids rate limits and network failures during demo

## Implementation Phases

### Phase 1: Project Setup and Data Structure
**Goal:** Initialize project structure and define data schema

**Components:**
- `index.html` — single page shell
- `style.css` — base styles, dark background
- `main.js` — entry point
- `data/apollo-11/seed.json` — Apollo 11 node definition
- `data/apollo-11/connections.json` — connection definitions
- `assets/source-icons/` — SVG icons for each source

**Data schema:**
```typescript
interface Node {
  id: string;                    // source-prefixed: "ia-apollo11-footage"
  source: string;                // "internet_archive" | "wikipedia" | etc.
  title: string;
  description?: string;
  thumbnail?: string;
  url: string;                   // link to original
  connections: Connection[];
  potential?: PotentialCounts;   // for leaf nodes
}

interface Connection {
  targetId: string;
  type: string;                  // "person" | "subject" | "location" | "time" | "creator"
  label: string;                 // "crew member" | "same subject: spaceflight"
}

interface PotentialCounts {
  internet_archive?: number;
  wikipedia?: number;
  dpla?: number;
  // ... per source
  total: number;
}
```

**Dependencies:** None

**Done when:** Project structure exists, data schema documented, sample seed.json created

### Phase 2: Graph Visualization Core
**Goal:** Render nodes and edges with D3.js force layout

**Components:**
- D3.js integration in `main.js`
- Force simulation configuration
- Node rendering (circles with thumbnails, source badges)
- Edge rendering (lines with hover labels)
- Zoom and pan controls

**Dependencies:** Phase 1

**Done when:** Can render a static graph from seed.json, nodes display with source icons, edges show connection types on hover

### Phase 3: Interaction and Expansion
**Goal:** Click-to-expand behavior and graph growth

**Components:**
- Click handler on nodes
- Fetch and merge connection data
- Animation for new nodes entering
- Force simulation update on expansion
- Node dragging for manual arrangement

**Dependencies:** Phase 2

**Done when:** Clicking a node loads its connections, new nodes animate in, graph reorganizes smoothly

### Phase 4: Visual Polish
**Goal:** Refined visual design and cooperative messaging

**Components:**
- Dark background styling
- Source-specific color accents (muted palette)
- Node hover states with title/description tooltip
- Edge color-coding by connection type
- Footer attribution text
- Optional source legend panel

**Dependencies:** Phase 3

**Done when:** Demo looks polished, source diversity is visually apparent, cooperative message is present but subtle

### Phase 5: Leaf Node "Potential" Display
**Goal:** Evocative dead ends showing unexplored possibilities

**Components:**
- Visual indicator on leaf nodes ("✨ +N more")
- Hover tooltip with per-source breakdown
- Styling that suggests "more out there"

**Dependencies:** Phase 4

**Done when:** Leaf nodes display potential counts, hover shows breakdown, dead ends feel like invitations

### Phase 6: Data Curation
**Goal:** Populate cache with curated Apollo 11 exploration graph

**Components:**
- Curated ~50-100 items across all sources
- Pre-fetched from APIs: Internet Archive, Wikipedia/Wikidata, Wikimedia Commons, DPLA, OpenLibrary, arXiv, Met, Smithsonian
- Connection mapping between items
- Potential counts for leaf nodes (one API query per leaf)
- JSON files in `data/apollo-11/items/`

**Dependencies:** Phase 1 (schema), Phase 5 (potential counts format)

**Done when:** Interesting exploration paths exist from Apollo 11 through diverse sources, leaf nodes have potential counts

## Additional Considerations

**Desktop-first:** Mobile not prioritized for this prototype. Force-directed graphs work poorly on small screens anyway.

**Performance:** With ~50-100 nodes, D3 force simulation should handle fine. No optimization needed for this scale.

**Accessibility:** Nice to have, not blocking. This is a provocation piece, not production software.

**Future seeds:** Architecture supports other seed topics (add new `data/<topic>/` directories). Not in scope for initial prototype but design doesn't preclude it.
