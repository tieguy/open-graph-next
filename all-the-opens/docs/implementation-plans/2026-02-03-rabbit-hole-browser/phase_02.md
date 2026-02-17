# Rabbit Hole Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a visual "rabbit hole browser" that connects resources across open knowledge organizations, starting with Apollo 11 as seed.

**Architecture:** Force-directed graph visualization with D3.js. All data pre-cached in JSON files. Static site with no backend.

**Tech Stack:** D3.js v7 (ESM from CDN), vanilla JavaScript, CSS

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-02-03 - Greenfield project, no existing code

---

## Phase 2: Graph Visualization Core

**Goal:** Render nodes and edges with D3.js force layout, including source badges and edge labels

**Dependencies:** Phase 1

**Done when:** Can render a static graph from seed.json, nodes display with source icons, edges show connection types on hover

---

### Task 1: Add Source Icon Mapping

**Files:**
- Modify: `main.js` (add source configuration at top of file)

**Step 1: Add source configuration after imports**

Add this code after the `import * as d3` line and before `// Graph state`:

```javascript
// Source configuration with colors and icons
const SOURCES = {
  internet_archive: {
    color: '#428bca',
    name: 'Internet Archive',
    icon: '🏛️'
  },
  wikipedia: {
    color: '#636466',
    name: 'Wikipedia',
    icon: 'W'
  },
  wikimedia_commons: {
    color: '#006699',
    name: 'Wikimedia Commons',
    icon: '🖼️'
  },
  dpla: {
    color: '#0066cc',
    name: 'DPLA',
    icon: '📚'
  },
  openlibrary: {
    color: '#e47911',
    name: 'OpenLibrary',
    icon: '📖'
  },
  arxiv: {
    color: '#b31b1b',
    name: 'arXiv',
    icon: '📄'
  },
  met_museum: {
    color: '#e4002b',
    name: 'Met Museum',
    icon: '🏺'
  },
  smithsonian: {
    color: '#5b9bd5',
    name: 'Smithsonian',
    icon: '🦋'
  }
};

function getSourceColor(source) {
  return SOURCES[source]?.color || '#238636';
}

function getSourceIcon(source) {
  return SOURCES[source]?.icon || '?';
}

function getSourceName(source) {
  return SOURCES[source]?.name || source;
}
```

**Step 2: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected: Page still loads, no JavaScript errors in console

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add source configuration with colors and icons"
```

---

### Task 2: Update Node Rendering with Source Colors

**Files:**
- Modify: `main.js` (update render function)

**Step 1: Replace the node circle rendering in the render() function**

Find this section in the `render()` function:

```javascript
  // Add circles to new nodes
  nodeGroups.selectAll('circle')
    .data(d => [d])
    .join('circle')
    .attr('r', 20)
    .attr('fill', '#238636')
    .attr('stroke', '#3fb950')
    .attr('stroke-width', 2);
```

Replace with:

```javascript
  // Add circles to new nodes with source-specific colors
  nodeGroups.selectAll('circle.node-circle')
    .data(d => [d])
    .join('circle')
    .attr('class', 'node-circle')
    .attr('r', 24)
    .attr('fill', d => getSourceColor(d.source))
    .attr('stroke', '#fff')
    .attr('stroke-width', 2)
    .attr('opacity', 0.9);

  // Add source badge
  nodeGroups.selectAll('text.source-badge')
    .data(d => [d])
    .join('text')
    .attr('class', 'source-badge')
    .attr('text-anchor', 'middle')
    .attr('dy', '0.35em')
    .attr('fill', '#fff')
    .attr('font-size', '14px')
    .attr('font-weight', 'bold')
    .attr('pointer-events', 'none')
    .text(d => getSourceIcon(d.source));
```

**Step 2: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Apollo 11 node now has blue color (Internet Archive color #428bca)
- Node displays 🏛️ emoji in center
- White border around node

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add source-specific node colors and badges"
```

---

### Task 3: Add More Test Nodes to Verify Multi-Node Rendering

**Files:**
- Create: `data/apollo-11/items/wiki-neil-armstrong.json`
- Create: `data/apollo-11/items/wiki-buzz-aldrin.json`
- Create: `data/apollo-11/items/wiki-michael-collins.json`

**Step 1: Create items directory**

```bash
mkdir -p data/apollo-11/items
```

**Step 2: Create wiki-neil-armstrong.json**

```json
{
  "id": "wiki-neil-armstrong",
  "source": "wikipedia",
  "title": "Neil Armstrong",
  "description": "Neil Alden Armstrong was an American astronaut and aeronautical engineer who became the first person to walk on the Moon.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Neil_Armstrong_pose.jpg/220px-Neil_Armstrong_pose.jpg",
  "url": "https://en.wikipedia.org/wiki/Neil_Armstrong",
  "connections": []
}
```

**Step 3: Create wiki-buzz-aldrin.json**

```json
{
  "id": "wiki-buzz-aldrin",
  "source": "wikipedia",
  "title": "Buzz Aldrin",
  "description": "Buzz Aldrin is an American former astronaut, fighter pilot and engineer. He was the lunar module pilot on Apollo 11.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Buzz_Aldrin.jpg/220px-Buzz_Aldrin.jpg",
  "url": "https://en.wikipedia.org/wiki/Buzz_Aldrin",
  "connections": []
}
```

**Step 4: Create wiki-michael-collins.json**

```json
{
  "id": "wiki-michael-collins",
  "source": "wikipedia",
  "title": "Michael Collins",
  "description": "Michael Collins was an American astronaut who flew the Apollo 11 command module Columbia while his crewmates walked on the Moon.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Michael_Collins_%28S69-31742%2C_restoration%29.jpg/220px-Michael_Collins_%28S69-31742%2C_restoration%29.jpg",
  "url": "https://en.wikipedia.org/wiki/Michael_Collins_(astronaut)",
  "connections": []
}
```

**Step 5: Verify operationally**

Run: `cat data/apollo-11/items/*.json | python3 -m json.tool`
Expected: Valid JSON for all three files

**Step 6: Commit**

```bash
git add data/apollo-11/items/
git commit -m "feat: add crew member item data files"
```

---

### Task 4: Implement Data Loading for Items

**Files:**
- Modify: `main.js` (add item loading functions)

**Step 1: Add item cache and loading function**

Add after the SOURCES configuration and before `// Graph state`:

```javascript
// Item cache - stores loaded items by ID
const itemCache = new Map();

async function loadItem(itemId) {
  // Return from cache if already loaded
  if (itemCache.has(itemId)) {
    return itemCache.get(itemId);
  }

  // Determine file path based on ID
  const filePath = `data/apollo-11/items/${itemId}.json`;

  try {
    const response = await fetch(filePath);
    if (!response.ok) {
      console.warn(`Item not found: ${itemId}`);
      return null;
    }
    const item = await response.json();
    itemCache.set(itemId, item);
    return item;
  } catch (error) {
    console.error(`Failed to load item ${itemId}:`, error);
    return null;
  }
}

// Connections cache
let connectionsData = null;

async function loadConnections() {
  if (connectionsData) {
    return connectionsData;
  }

  try {
    const response = await fetch('data/apollo-11/connections.json');
    if (!response.ok) {
      throw new Error(`Failed to load connections: ${response.status}`);
    }
    connectionsData = await response.json();
    return connectionsData;
  } catch (error) {
    console.error('Failed to load connections:', error);
    return {};
  }
}
```

**Step 2: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected: Page loads without errors, console shows initialization message

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add item and connections data loading"
```

---

### Task 5: Add Edge Rendering with Labels

**Files:**
- Modify: `main.js` (update render function for edges)
- Modify: `style.css` (add edge label styles)

**Step 1: Update the render() function - replace link rendering**

Find this section in the `render()` function:

```javascript
  // Render links
  g.selectAll('.link')
    .data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
    .join('line')
    .attr('class', 'link')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 2);
```

Replace with:

```javascript
  // Render link groups (line + label)
  const linkGroups = g.selectAll('.link-group')
    .data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
    .join('g')
    .attr('class', 'link-group');

  // Link lines
  linkGroups.selectAll('line')
    .data(d => [d])
    .join('line')
    .attr('class', 'link')
    .attr('stroke', '#30363d')
    .attr('stroke-width', 2);

  // Link labels (hidden by default, shown on hover)
  linkGroups.selectAll('text')
    .data(d => [d])
    .join('text')
    .attr('class', 'link-label')
    .attr('text-anchor', 'middle')
    .attr('fill', '#8b949e')
    .attr('font-size', '10px')
    .attr('dy', -5)
    .attr('opacity', 0)
    .text(d => d.label || '');

  // Add hover behavior for link labels
  linkGroups
    .on('mouseenter', function() {
      d3.select(this).select('.link-label').attr('opacity', 1);
      d3.select(this).select('.link').attr('stroke', '#58a6ff').attr('stroke-width', 3);
    })
    .on('mouseleave', function() {
      d3.select(this).select('.link-label').attr('opacity', 0);
      d3.select(this).select('.link').attr('stroke', '#30363d').attr('stroke-width', 2);
    });
```

**Step 2: Update the ticked() function for link groups**

Replace the entire `ticked()` function:

```javascript
function ticked() {
  // Update link positions
  g.selectAll('.link-group').each(function(d) {
    const group = d3.select(this);

    group.select('line')
      .attr('x1', d.source.x)
      .attr('y1', d.source.y)
      .attr('x2', d.target.x)
      .attr('y2', d.target.y);

    group.select('text')
      .attr('x', (d.source.x + d.target.x) / 2)
      .attr('y', (d.source.y + d.target.y) / 2);
  });

  // Update node positions
  g.selectAll('.node')
    .attr('transform', d => `translate(${d.x},${d.y})`);
}
```

**Step 3: Add edge styles to style.css**

Add at the end of style.css:

```css
/* Edge styles */
.link {
  stroke: #30363d;
  stroke-width: 2;
  transition: stroke 0.2s, stroke-width 0.2s;
}

.link-label {
  pointer-events: none;
  user-select: none;
}

.link-group {
  cursor: pointer;
}
```

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected: Page loads (still only seed node until expansion is implemented in Phase 3)

**Step 5: Commit**

```bash
git add main.js style.css
git commit -m "feat: add edge rendering with hover labels"
```

---

### Task 6: Add Zoom Controls Display

**Files:**
- Modify: `index.html` (add zoom controls)
- Modify: `style.css` (add control styles)
- Modify: `main.js` (add zoom control handlers)

**Step 1: Update index.html body**

Replace the `<div id="app">` section:

```html
  <div id="app">
    <div id="controls">
      <button id="zoom-in" title="Zoom In">+</button>
      <button id="zoom-out" title="Zoom Out">−</button>
      <button id="zoom-reset" title="Reset View">⟲</button>
    </div>
    <svg id="graph"></svg>
    <footer>
      <p>Imagining a unified library. Data from Internet Archive, Wikipedia, DPLA, OpenLibrary, arXiv, Smithsonian, Met Museum.</p>
    </footer>
  </div>
```

**Step 2: Add control styles to style.css**

Add after the edge styles:

```css
/* Zoom controls */
#controls {
  position: fixed;
  top: 1rem;
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 100;
}

#controls button {
  width: 36px;
  height: 36px;
  border: 1px solid #30363d;
  border-radius: 6px;
  background: #21262d;
  color: #c9d1d9;
  font-size: 18px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s;
}

#controls button:hover {
  background: #30363d;
  border-color: #8b949e;
}
```

**Step 3: Add zoom control handlers in main.js**

Update the `setupSvg()` function. Replace the entire function:

```javascript
// Store zoom behavior reference
let zoomBehavior = null;

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
  zoomBehavior = d3.zoom()
    .scaleExtent([0.1, 4])
    .on('zoom', (event) => {
      g.attr('transform', event.transform);
    });

  svg.call(zoomBehavior);

  // Setup zoom controls
  d3.select('#zoom-in').on('click', () => {
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 1.3);
  });

  d3.select('#zoom-out').on('click', () => {
    svg.transition().duration(300).call(zoomBehavior.scaleBy, 0.7);
  });

  d3.select('#zoom-reset').on('click', () => {
    svg.transition().duration(300).call(
      zoomBehavior.transform,
      d3.zoomIdentity.translate(width / 2, height / 2).scale(1)
    );
  });
}
```

Also add `let zoomBehavior = null;` at the top with the other state variables:

```javascript
// Graph state
let nodes = [];
let links = [];
let simulation = null;
let svg = null;
let g = null;
let zoomBehavior = null;
```

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Zoom controls visible in top-right corner
- "+" button zooms in
- "−" button zooms out
- "⟲" button resets view to center
- Mouse wheel/trackpad zoom still works

**Step 5: Commit**

```bash
git add index.html style.css main.js
git commit -m "feat: add zoom controls UI"
```
