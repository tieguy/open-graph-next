# Rabbit Hole Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a visual "rabbit hole browser" that connects resources across open knowledge organizations, starting with Apollo 11 as seed.

**Architecture:** Force-directed graph visualization with D3.js. All data pre-cached in JSON files. Static site with no backend.

**Tech Stack:** D3.js v7 (ESM from CDN), vanilla JavaScript, CSS

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-02-03 - Greenfield project, no existing code

---

## Phase 5: Leaf Node "Potential" Display

**Goal:** Evocative dead ends showing unexplored possibilities

**Dependencies:** Phase 4

**Done when:** Leaf nodes display potential counts, hover shows breakdown, dead ends feel like invitations

---

### Task 1: Add Potential Counts to Data Schema

**Files:**
- Modify: `data/apollo-11/items/wiki-neil-armstrong.json`
- Modify: `data/apollo-11/items/wiki-buzz-aldrin.json`
- Modify: `data/apollo-11/items/wiki-michael-collins.json`

**Step 1: Update wiki-neil-armstrong.json**

Replace the file contents:

```json
{
  "id": "wiki-neil-armstrong",
  "source": "wikipedia",
  "title": "Neil Armstrong",
  "description": "Neil Alden Armstrong was an American astronaut and aeronautical engineer who became the first person to walk on the Moon.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/Neil_Armstrong_pose.jpg/220px-Neil_Armstrong_pose.jpg",
  "url": "https://en.wikipedia.org/wiki/Neil_Armstrong",
  "connections": [],
  "potential": {
    "internet_archive": 847,
    "wikipedia": 156,
    "wikimedia_commons": 312,
    "dpla": 89,
    "openlibrary": 34,
    "arxiv": 12,
    "met_museum": 3,
    "smithsonian": 67,
    "total": 1520
  }
}
```

**Step 2: Update wiki-buzz-aldrin.json**

Replace the file contents:

```json
{
  "id": "wiki-buzz-aldrin",
  "source": "wikipedia",
  "title": "Buzz Aldrin",
  "description": "Buzz Aldrin is an American former astronaut, fighter pilot and engineer. He was the lunar module pilot on Apollo 11.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/d/dc/Buzz_Aldrin.jpg/220px-Buzz_Aldrin.jpg",
  "url": "https://en.wikipedia.org/wiki/Buzz_Aldrin",
  "connections": [],
  "potential": {
    "internet_archive": 623,
    "wikipedia": 134,
    "wikimedia_commons": 245,
    "dpla": 56,
    "openlibrary": 28,
    "arxiv": 8,
    "met_museum": 1,
    "smithsonian": 45,
    "total": 1140
  }
}
```

**Step 3: Update wiki-michael-collins.json**

Replace the file contents:

```json
{
  "id": "wiki-michael-collins",
  "source": "wikipedia",
  "title": "Michael Collins",
  "description": "Michael Collins was an American astronaut who flew the Apollo 11 command module Columbia while his crewmates walked on the Moon.",
  "thumbnail": "https://upload.wikimedia.org/wikipedia/commons/thumb/f/fa/Michael_Collins_%28S69-31742%2C_restoration%29.jpg/220px-Michael_Collins_%28S69-31742%2C_restoration%29.jpg",
  "url": "https://en.wikipedia.org/wiki/Michael_Collins_(astronaut)",
  "connections": [],
  "potential": {
    "internet_archive": 412,
    "wikipedia": 98,
    "wikimedia_commons": 178,
    "dpla": 34,
    "openlibrary": 19,
    "arxiv": 5,
    "met_museum": 0,
    "smithsonian": 52,
    "total": 798
  }
}
```

**Step 4: Verify operationally**

Run: `cat data/apollo-11/items/*.json | python3 -m json.tool | grep -A 15 '"potential"'`
Expected: Shows potential counts for all three files

**Step 5: Commit**

```bash
git add data/apollo-11/items/
git commit -m "feat: add potential counts to leaf node data"
```

---

### Task 2: Add Visual Indicator on Leaf Nodes

**Files:**
- Modify: `main.js` (add potential badge rendering)
- Modify: `style.css` (add potential badge styles)

**Step 1: Add isLeafNode helper function**

Add after getConnectionColor function in main.js:

```javascript
function isLeafNode(node) {
  // A leaf node has potential counts and no connections in our cache
  return node.potential && node.potential.total > 0;
}

function formatPotentialCount(count) {
  if (count >= 1000) {
    return `${(count / 1000).toFixed(1)}k`;
  }
  return count.toString();
}
```

**Step 2: Add potential badge rendering in render()**

Add after the expand-plus rendering section in the render() function:

```javascript
  // Add potential indicator for leaf nodes (sparkle badge)
  nodeGroups.selectAll('g.potential-badge')
    .data(d => isLeafNode(d) ? [d] : [])
    .join(
      enter => {
        const badge = enter.append('g')
          .attr('class', 'potential-badge')
          .attr('transform', 'translate(-18, -18)');

        // Badge background
        badge.append('rect')
          .attr('rx', 10)
          .attr('ry', 10)
          .attr('width', 50)
          .attr('height', 20)
          .attr('fill', '#238636')
          .attr('opacity', 0.9);

        // Sparkle icon
        badge.append('text')
          .attr('class', 'potential-sparkle')
          .attr('x', 8)
          .attr('y', 14)
          .attr('font-size', '10px')
          .text('✨');

        // Count text
        badge.append('text')
          .attr('class', 'potential-count')
          .attr('x', 20)
          .attr('y', 14)
          .attr('fill', '#fff')
          .attr('font-size', '11px')
          .attr('font-weight', '600')
          .text(d => `+${formatPotentialCount(d.potential.total)}`);

        return badge;
      },
      update => update.select('.potential-count')
        .text(d => `+${formatPotentialCount(d.potential.total)}`),
      exit => exit.remove()
    );
```

**Step 3: Add potential badge styles**

Add to style.css:

```css
/* Potential badge for leaf nodes */
.potential-badge {
  pointer-events: none;
  opacity: 0.95;
  transition: opacity 0.2s;
}

.node:hover .potential-badge {
  opacity: 1;
}

.potential-sparkle {
  filter: drop-shadow(0 0 2px rgba(255, 255, 255, 0.5));
}
```

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Click Apollo 11 to expand
- Each crew member node shows green badge with "✨ +1.5k" (or similar)
- Badge positioned in top-left corner of node

**Step 5: Commit**

```bash
git add main.js style.css
git commit -m "feat: add potential count badge on leaf nodes"
```

---

### Task 3: Add Potential Breakdown Tooltip

**Files:**
- Modify: `main.js` (enhance tooltip for potential display)
- Modify: `style.css` (add potential breakdown styles)

**Step 1: Update tooltip HTML in index.html**

Update the tooltip div to include potential breakdown section:

```html
    <div id="tooltip" class="tooltip hidden">
      <div class="tooltip-title"></div>
      <div class="tooltip-description"></div>
      <div class="tooltip-source"></div>
      <div id="tooltip-potential" class="tooltip-potential hidden">
        <div class="tooltip-potential-header">
          <span class="sparkle">✨</span>
          <span id="tooltip-potential-total">0</span> more items available
        </div>
        <div id="tooltip-potential-breakdown" class="tooltip-potential-breakdown"></div>
        <div class="tooltip-potential-message">
          We only showed you a tiny slice. The ocean is right there.
        </div>
      </div>
      <a id="tooltip-link" class="tooltip-link" href="#" target="_blank" rel="noopener">
        View original ↗
      </a>
      <div class="tooltip-action">Click node to explore connections</div>
    </div>
```

**Step 2: Add potential breakdown styles**

Add to style.css:

```css
/* Potential breakdown in tooltip */
.tooltip-potential {
  background: #21262d;
  border-radius: 6px;
  padding: 10px 12px;
  margin: 8px 0;
}

.tooltip-potential.hidden {
  display: none;
}

.tooltip-potential-header {
  font-size: 13px;
  font-weight: 600;
  color: #3fb950;
  margin-bottom: 8px;
}

.tooltip-potential-header .sparkle {
  margin-right: 4px;
}

.tooltip-potential-breakdown {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 12px;
  font-size: 11px;
  margin-bottom: 8px;
}

.tooltip-potential-item {
  display: flex;
  justify-content: space-between;
  color: #8b949e;
}

.tooltip-potential-item .source-name {
  color: #c9d1d9;
}

.tooltip-potential-item .count {
  color: #8b949e;
}

.tooltip-potential-message {
  font-size: 10px;
  color: #6e7681;
  font-style: italic;
  padding-top: 8px;
  border-top: 1px solid #30363d;
}
```

**Step 3: Update showTooltip to display potential breakdown**

Update the showTooltip function in main.js:

```javascript
function showTooltip(event, d) {
  const tooltip = document.getElementById('tooltip');
  const expanded = expandedNodes.has(d.id);

  tooltip.querySelector('.tooltip-title').textContent = d.title;
  tooltip.querySelector('.tooltip-description').textContent = d.description || '';
  tooltip.querySelector('.tooltip-source').textContent = `Source: ${getSourceName(d.source)}`;

  const linkElement = document.getElementById('tooltip-link');
  linkElement.href = d.url;
  linkElement.style.display = d.url ? 'inline-block' : 'none';

  // Handle potential counts for leaf nodes
  const potentialSection = document.getElementById('tooltip-potential');
  if (d.potential && d.potential.total > 0) {
    potentialSection.classList.remove('hidden');
    document.getElementById('tooltip-potential-total').textContent =
      d.potential.total.toLocaleString();

    // Build breakdown
    const breakdownContainer = document.getElementById('tooltip-potential-breakdown');
    breakdownContainer.innerHTML = '';

    // Sort sources by count descending
    const sources = Object.entries(d.potential)
      .filter(([key]) => key !== 'total' && d.potential[key] > 0)
      .sort((a, b) => b[1] - a[1]);

    for (const [source, count] of sources) {
      const item = document.createElement('div');
      item.className = 'tooltip-potential-item';
      item.innerHTML = `
        <span class="source-name">${getSourceName(source)}</span>
        <span class="count">${count.toLocaleString()}</span>
      `;
      breakdownContainer.appendChild(item);
    }
  } else {
    potentialSection.classList.add('hidden');
  }

  tooltip.querySelector('.tooltip-action').textContent = expanded
    ? 'Already explored'
    : d.potential && d.potential.total > 0
      ? 'This is a leaf node - no cached connections'
      : 'Click to explore connections';

  // Position tooltip near cursor but not overlapping
  const x = event.pageX + 15;
  const y = event.pageY + 15;

  // Keep tooltip on screen - account for larger tooltip with potential
  const maxX = window.innerWidth - 340;
  const maxY = window.innerHeight - 280;

  tooltip.style.left = `${Math.min(x, maxX)}px`;
  tooltip.style.top = `${Math.min(y, maxY)}px`;

  tooltip.classList.remove('hidden');
}
```

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Click Apollo 11 to expand
- Hover over Neil Armstrong node
- Tooltip shows potential section with green header "✨ 1,520 more items available"
- Breakdown shows counts per source (Internet Archive: 847, etc.)
- Message at bottom: "We only showed you a tiny slice..."

**Step 5: Commit**

```bash
git add index.html style.css main.js
git commit -m "feat: add potential breakdown to leaf node tooltip"
```

---

### Task 4: Style Leaf Nodes Distinctively

**Files:**
- Modify: `main.js` (add leaf node visual distinction)
- Modify: `style.css` (add leaf node styles)

**Step 1: Add leaf node class in render()**

Update the node circle rendering to add a class for leaf nodes:

```javascript
  // Add circles to new nodes with source-specific colors
  nodeGroups.selectAll('circle.node-circle')
    .data(d => [d])
    .join(
      enter => enter.append('circle')
        .attr('class', d => {
          const classes = ['node-circle'];
          if (expandedNodes.has(d.id)) classes.push('expanded');
          else classes.push('expandable');
          if (isLeafNode(d)) classes.push('leaf');
          return classes.join(' ');
        })
        .attr('r', 0)
        .attr('fill', d => getSourceColor(d.source))
        .attr('stroke', d => isLeafNode(d) ? '#3fb950' : '#fff')
        .attr('stroke-width', d => isLeafNode(d) ? 3 : 2)
        .attr('opacity', 0.9)
        .call(enter => enter.transition()
          .duration(400)
          .ease(d3.easeCubicOut)
          .attr('r', 24)),
      update => update
        .attr('class', d => {
          const classes = ['node-circle'];
          if (expandedNodes.has(d.id)) classes.push('expanded');
          else classes.push('expandable');
          if (isLeafNode(d)) classes.push('leaf');
          return classes.join(' ');
        })
        .attr('r', 24)
        .attr('fill', d => getSourceColor(d.source))
        .attr('stroke', d => isLeafNode(d) ? '#3fb950' : '#fff')
        .attr('stroke-width', d => isLeafNode(d) ? 3 : 2),
      exit => exit.remove()
    );
```

**Step 2: Add leaf node styles**

Add to style.css:

```css
/* Leaf node distinctive styling */
.node-circle.leaf {
  stroke-dasharray: 4 2;
  animation: leaf-pulse 2s ease-in-out infinite;
}

@keyframes leaf-pulse {
  0%, 100% {
    stroke-opacity: 1;
  }
  50% {
    stroke-opacity: 0.5;
  }
}

.node:hover .node-circle.leaf {
  stroke-dasharray: none;
  animation: none;
  stroke-opacity: 1;
}
```

**Step 3: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Click Apollo 11 to expand
- Crew member nodes (leaf nodes) have green dashed border
- Border gently pulses (animation)
- Hovering stops pulse and shows solid border

**Step 4: Commit**

```bash
git add main.js style.css
git commit -m "feat: add distinctive styling for leaf nodes"
```

---

### Task 5: Hide Expand Indicator on Leaf Nodes

**Files:**
- Modify: `main.js` (update expand indicator logic)

**Step 1: Update expand indicator to exclude leaf nodes**

In the render() function, update the expand indicator data binding:

```javascript
  // Add expand indicator for non-expanded, non-leaf nodes
  nodeGroups.selectAll('circle.expand-indicator')
    .data(d => (expandedNodes.has(d.id) || isLeafNode(d)) ? [] : [d])
    .join(
      enter => enter.append('circle')
        .attr('class', 'expand-indicator')
        .attr('cx', 18)
        .attr('cy', -18)
        .attr('r', 8)
        .attr('fill', '#238636')
        .attr('stroke', '#fff')
        .attr('stroke-width', 1),
      update => update,
      exit => exit.remove()
    );

  nodeGroups.selectAll('text.expand-plus')
    .data(d => (expandedNodes.has(d.id) || isLeafNode(d)) ? [] : [d])
    .join(
      enter => enter.append('text')
        .attr('class', 'expand-plus')
        .attr('x', 18)
        .attr('y', -18)
        .attr('text-anchor', 'middle')
        .attr('dy', '0.35em')
        .attr('fill', '#fff')
        .attr('font-size', '12px')
        .attr('font-weight', 'bold')
        .attr('pointer-events', 'none')
        .text('+'),
      update => update,
      exit => exit.remove()
    );
```

**Step 2: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Apollo 11 node shows "+" expand indicator
- After clicking, crew member nodes show potential badge but NOT "+" indicator
- Leaf nodes have potential badge, non-leaf expandable nodes have "+" indicator

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: hide expand indicator on leaf nodes"
```
