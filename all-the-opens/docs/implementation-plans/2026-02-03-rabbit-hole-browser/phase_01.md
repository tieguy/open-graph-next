# Rabbit Hole Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a visual "rabbit hole browser" that connects resources across open knowledge organizations, starting with Apollo 11 as seed.

**Architecture:** Force-directed graph visualization with D3.js. All data pre-cached in JSON files. Static site with no backend.

**Tech Stack:** D3.js v7 (ESM from CDN), vanilla JavaScript, CSS

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-02-03 - Greenfield project, no existing code

---

## Phase 1: Project Setup and Data Structure

**Goal:** Initialize project structure and define data schema

**Done when:** Project structure exists, data loads, single seed node renders

---

### Task 1: Create HTML Shell

**Files:**
- Create: `index.html`

**Step 1: Create the file**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Rabbit Hole Browser - Internet Library Consortium Demo</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <div id="app">
    <svg id="graph"></svg>
    <footer>
      <p>Imagining a unified library. Data from Internet Archive, Wikipedia, DPLA, OpenLibrary, arXiv, Smithsonian, Met Museum.</p>
    </footer>
  </div>
  <script type="module" src="main.js"></script>
</body>
</html>
```

**Step 2: Verify operationally**

Run: `ls -la index.html`
Expected: File exists

**Step 3: Commit**

```bash
git add index.html
git commit -m "feat: add HTML shell for rabbit hole browser"
```

---

### Task 2: Create Base Styles

**Files:**
- Create: `style.css`

**Step 1: Create the file**

```css
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  background-color: #0d1117;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

#app {
  flex: 1;
  display: flex;
  flex-direction: column;
}

#graph {
  flex: 1;
  width: 100%;
}

footer {
  padding: 1rem;
  text-align: center;
  font-size: 0.875rem;
  color: #8b949e;
  border-top: 1px solid #21262d;
}
```

**Step 2: Verify operationally**

Run: `ls -la style.css`
Expected: File exists

**Step 3: Commit**

```bash
git add style.css
git commit -m "feat: add dark theme base styles"
```

---

### Task 3: Create Data Schema and Seed File

**Files:**
- Create: `data/apollo-11/seed.json`

**Step 1: Create directory and file**

```bash
mkdir -p data/apollo-11
```

Create `data/apollo-11/seed.json`:

```json
{
  "id": "ia-apollo11-mission",
  "source": "internet_archive",
  "title": "Apollo 11",
  "description": "The Apollo 11 mission was the first crewed mission to land on the Moon. Commander Neil Armstrong and lunar module pilot Buzz Aldrin landed the Apollo Lunar Module Eagle on July 20, 1969.",
  "thumbnail": "https://archive.org/services/img/apollo11",
  "url": "https://archive.org/details/apollo11",
  "connections": []
}
```

**Data Schema Reference (TypeScript-style for documentation):**

```typescript
interface Node {
  id: string;                    // source-prefixed: "ia-apollo11-footage"
  source: string;                // "internet_archive" | "wikipedia" | "wikimedia_commons" | "dpla" | "openlibrary" | "arxiv" | "met_museum" | "smithsonian"
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
  wikimedia_commons?: number;
  dpla?: number;
  openlibrary?: number;
  arxiv?: number;
  met_museum?: number;
  smithsonian?: number;
  total: number;
}
```

**Step 2: Verify operationally**

Run: `cat data/apollo-11/seed.json | python3 -m json.tool`
Expected: Valid JSON output

**Step 3: Commit**

```bash
git add data/
git commit -m "feat: add Apollo 11 seed data with schema"
```

---

### Task 4: Create Connections File

**Files:**
- Create: `data/apollo-11/connections.json`

**Step 1: Create the file**

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
    }
  ]
}
```

**Step 2: Verify operationally**

Run: `cat data/apollo-11/connections.json | python3 -m json.tool`
Expected: Valid JSON output

**Step 3: Commit**

```bash
git add data/apollo-11/connections.json
git commit -m "feat: add connections data structure"
```

---

### Task 5: Create Main JavaScript Entry Point

**Files:**
- Create: `main.js`

**Step 1: Create the file**

```javascript
import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// Graph state
let nodes = [];
let links = [];
let simulation = null;
let svg = null;
let g = null;

// Initialize the graph
async function init() {
  try {
    // Load seed data
    const seedResponse = await fetch('data/apollo-11/seed.json');
    if (!seedResponse.ok) {
      throw new Error(`Failed to load seed: ${seedResponse.status}`);
    }
    const seed = await seedResponse.json();

    nodes = [seed];
    links = [];

    setupSvg();
    setupSimulation();
    render();

    console.log('Rabbit Hole Browser initialized with seed:', seed.title);
  } catch (error) {
    console.error('Failed to initialize:', error);
  }
}

function setupSvg() {
  const container = document.getElementById('graph');
  const width = container.clientWidth || window.innerWidth;
  const height = container.clientHeight || window.innerHeight - 100;

  svg = d3.select('#graph')
    .attr('width', width)
    .attr('height', height);

  // Create zoomable container
  g = svg.append('g');

  // Setup zoom behavior
  const zoom = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoom);
}

function setupSimulation() {
  const width = +svg.attr('width');
  const height = +svg.attr('height');

  simulation = d3.forceSimulation(nodes)
    .force('link', d3.forceLink(links).id(d => d.id).distance(100))
    .force('charge', d3.forceManyBody().strength(-300))
    .force('center', d3.forceCenter(width / 2, height / 2))
    .on('tick', ticked);
}

function ticked() {
  g.selectAll('.link')
    .attr('x1', d => d.source.x)
    .attr('y1', d => d.source.y)
    .attr('x2', d => d.target.x)
    .attr('y2', d => d.target.y);

  g.selectAll('.node')
    .attr('transform', d => `translate(${d.x},${d.y})`);
}

function render() {
  // Render links
  g.selectAll('.link')
    .data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
    .join('line')
    .attr('class', 'link')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 2);

  // Render nodes
  const nodeGroups = g.selectAll('.node')
    .data(nodes, d => d.id)
    .join('g')
    .attr('class', 'node')
    .style('cursor', 'pointer')
    .call(drag(simulation));

  // Add circles to new nodes
  nodeGroups.selectAll('circle')
    .data(d => [d])
    .join('circle')
    .attr('r', 20)
    .attr('fill', '#238636')
    .attr('stroke', '#3fb950')
    .attr('stroke-width', 2);

  // Add title text to new nodes
  nodeGroups.selectAll('text')
    .data(d => [d])
    .join('text')
    .attr('dy', 35)
    .attr('text-anchor', 'middle')
    .attr('fill', '#c9d1d9')
    .attr('font-size', '12px')
    .text(d => d.title);

  // Restart simulation
  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.alpha(1).restart();
}

function drag(simulation) {
  function dragstarted(event, d) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }

  function dragged(event, d) {
    d.fx = event.x;
    d.fy = event.y;
  }

  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);
    d.fx = null;
    d.fy = null;
  }

  return d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);
}

// Start the application
init();
```

**Step 2: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Page loads with dark background
- Single green node labeled "Apollo 11" in center
- Node is draggable
- Footer text visible
- Console shows: "Rabbit Hole Browser initialized with seed: Apollo 11"

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add D3.js force-directed graph initialization"
```

---

### Task 6: Create Source Icons Directory

**Files:**
- Create: `assets/source-icons/.gitkeep`

**Step 1: Create directory structure**

```bash
mkdir -p assets/source-icons
touch assets/source-icons/.gitkeep
```

**Step 2: Verify operationally**

Run: `ls -la assets/source-icons/`
Expected: Directory exists with .gitkeep file

**Step 3: Commit**

```bash
git add assets/
git commit -m "chore: add source-icons directory placeholder"
```
