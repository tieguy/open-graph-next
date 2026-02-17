# Rabbit Hole Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a visual "rabbit hole browser" that connects resources across open knowledge organizations, starting with Apollo 11 as seed.

**Architecture:** Force-directed graph visualization with D3.js. All data pre-cached in JSON files. Static site with no backend.

**Tech Stack:** D3.js v7 (ESM from CDN), vanilla JavaScript, CSS

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-02-03 - Greenfield project, no existing code

---

## Phase 4: Visual Polish

**Goal:** Refined visual design and cooperative messaging

**Dependencies:** Phase 3

**Done when:** Demo looks polished, source diversity is visually apparent, cooperative message is present but subtle

---

### Task 1: Add Node Tooltip on Hover

**Files:**
- Modify: `index.html` (add tooltip container)
- Modify: `style.css` (add tooltip styles)
- Modify: `main.js` (add tooltip behavior)

**Step 1: Add tooltip div to index.html**

Add after the opening `<div id="app">` tag:

```html
    <div id="tooltip" class="tooltip hidden">
      <div class="tooltip-title"></div>
      <div class="tooltip-description"></div>
      <div class="tooltip-source"></div>
      <div class="tooltip-action">Click to explore connections</div>
    </div>
```

**Step 2: Add tooltip styles to style.css**

Add to style.css:

```css
/* Tooltip */
.tooltip {
  position: fixed;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 12px 16px;
  max-width: 300px;
  pointer-events: none;
  z-index: 1000;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  transition: opacity 0.15s ease;
}

.tooltip.hidden {
  opacity: 0;
  visibility: hidden;
}

.tooltip-title {
  font-weight: 600;
  font-size: 14px;
  color: #f0f6fc;
  margin-bottom: 6px;
}

.tooltip-description {
  font-size: 12px;
  color: #8b949e;
  margin-bottom: 8px;
  line-height: 1.4;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.tooltip-source {
  font-size: 11px;
  color: #58a6ff;
  margin-bottom: 8px;
}

.tooltip-action {
  font-size: 10px;
  color: #3fb950;
  font-style: italic;
}
```

**Step 3: Add tooltip show/hide functions to main.js**

Add after the getSourceName function:

```javascript
function showTooltip(event, d) {
  const tooltip = document.getElementById('tooltip');
  const expanded = expandedNodes.has(d.id);

  tooltip.querySelector('.tooltip-title').textContent = d.title;
  tooltip.querySelector('.tooltip-description').textContent = d.description || '';
  tooltip.querySelector('.tooltip-source').textContent = `Source: ${getSourceName(d.source)}`;
  tooltip.querySelector('.tooltip-action').textContent = expanded
    ? 'Already explored'
    : 'Click to explore connections';

  // Position tooltip near cursor but not overlapping
  const x = event.pageX + 15;
  const y = event.pageY + 15;

  // Keep tooltip on screen
  const rect = tooltip.getBoundingClientRect();
  const maxX = window.innerWidth - 320;
  const maxY = window.innerHeight - 150;

  tooltip.style.left = `${Math.min(x, maxX)}px`;
  tooltip.style.top = `${Math.min(y, maxY)}px`;

  tooltip.classList.remove('hidden');
}

function hideTooltip() {
  const tooltip = document.getElementById('tooltip');
  tooltip.classList.add('hidden');
}
```

**Step 4: Add tooltip event handlers to node rendering**

In the render() function, update the node join to add mouseenter/mouseleave:

```javascript
  // Render nodes
  const nodeGroups = g.selectAll('.node')
    .data(nodes, d => d.id)
    .join(
      enter => enter.append('g')
        .attr('class', 'node')
        .style('cursor', 'pointer')
        .style('opacity', 0)
        .call(drag(simulation))
        .on('click', expandNode)
        .on('dblclick', (event, d) => {
          event.stopPropagation();
          d.fx = null;
          d.fy = null;
          simulation.alpha(0.3).restart();
        })
        .on('mouseenter', showTooltip)
        .on('mousemove', showTooltip)
        .on('mouseleave', hideTooltip)
        .call(enter => enter.transition()
          .duration(300)
          .style('opacity', 1)),
      update => update,
      exit => exit.transition()
        .duration(300)
        .style('opacity', 0)
        .remove()
    );
```

**Step 5: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Hover over Apollo 11 node shows tooltip
- Tooltip displays title, description, source name
- Tooltip follows mouse movement
- Tooltip shows "Click to explore connections"
- After expanding, tooltip shows "Already explored"

**Step 6: Commit**

```bash
git add index.html style.css main.js
git commit -m "feat: add node tooltip on hover"
```

---

### Task 2: Add Edge Color-Coding by Connection Type

**Files:**
- Modify: `main.js` (add connection type colors)
- Modify: `style.css` (refine edge styles)

**Step 1: Add connection type color mapping**

Add after the SOURCES configuration in main.js:

```javascript
// Connection type colors (muted palette)
const CONNECTION_TYPES = {
  person: {
    color: '#8957e5',
    name: 'Person'
  },
  subject: {
    color: '#3fb950',
    name: 'Subject'
  },
  location: {
    color: '#f0883e',
    name: 'Location'
  },
  time: {
    color: '#58a6ff',
    name: 'Time Period'
  },
  creator: {
    color: '#f778ba',
    name: 'Creator'
  }
};

function getConnectionColor(type) {
  return CONNECTION_TYPES[type]?.color || '#30363d';
}
```

**Step 2: Update link rendering to use connection colors**

In the render() function, update the link line rendering:

```javascript
  // Link lines with type-based colors
  linkGroups.selectAll('line')
    .data(d => [d])
    .join('line')
    .attr('class', 'link')
    .attr('stroke', d => getConnectionColor(d.type))
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.6);
```

**Step 3: Update link hover behavior**

Update the link group hover handlers:

```javascript
  // Add hover behavior for link labels
  linkGroups
    .on('mouseenter', function(event, d) {
      d3.select(this).select('.link-label').attr('opacity', 1);
      d3.select(this).select('.link')
        .attr('stroke-opacity', 1)
        .attr('stroke-width', 3);
    })
    .on('mouseleave', function(event, d) {
      d3.select(this).select('.link-label').attr('opacity', 0);
      d3.select(this).select('.link')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 2);
    });
```

**Step 4: Update link label color to match**

Update link label rendering:

```javascript
  // Link labels (hidden by default, shown on hover)
  linkGroups.selectAll('text')
    .data(d => [d])
    .join('text')
    .attr('class', 'link-label')
    .attr('text-anchor', 'middle')
    .attr('fill', d => getConnectionColor(d.type))
    .attr('font-size', '11px')
    .attr('font-weight', '500')
    .attr('dy', -8)
    .attr('opacity', 0)
    .text(d => d.label || '');
```

**Step 5: Update style.css for improved link appearance**

Update/add edge styles:

```css
/* Edge styles */
.link {
  stroke-linecap: round;
  transition: stroke-opacity 0.2s, stroke-width 0.2s;
}

.link-label {
  pointer-events: none;
  user-select: none;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
}

.link-group {
  cursor: default;
}
```

**Step 6: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Click Apollo 11 to expand
- Edges to crew members show purple color (person type)
- Hover over edge shows label "crew member" in matching purple
- Edge brightens and thickens on hover

**Step 7: Commit**

```bash
git add main.js style.css
git commit -m "feat: add edge color-coding by connection type"
```

---

### Task 3: Add Source Legend Panel

**Files:**
- Modify: `index.html` (add legend container)
- Modify: `style.css` (add legend styles)
- Modify: `main.js` (populate legend dynamically)

**Step 1: Add legend to index.html**

Add before the closing `</div>` of `#app`:

```html
    <div id="legend" class="legend collapsed">
      <button id="legend-toggle" class="legend-toggle">
        <span class="legend-toggle-icon">◀</span>
        <span class="legend-toggle-text">Sources</span>
      </button>
      <div class="legend-content">
        <h3>Sources in Graph</h3>
        <div id="legend-sources" class="legend-sources"></div>
        <div class="legend-total">
          <span id="legend-node-count">0</span> items from
          <span id="legend-source-count">0</span> sources
        </div>
      </div>
    </div>
```

**Step 2: Add legend styles to style.css**

```css
/* Legend panel */
.legend {
  position: fixed;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  background: #161b22;
  border: 1px solid #30363d;
  border-left: none;
  border-radius: 0 8px 8px 0;
  z-index: 100;
  transition: transform 0.3s ease;
}

.legend.collapsed {
  transform: translateY(-50%) translateX(-100%);
}

.legend.collapsed .legend-toggle {
  transform: translateX(100%);
  border-radius: 0 8px 8px 0;
  border-left: 1px solid #30363d;
}

.legend.collapsed .legend-toggle-icon {
  transform: rotate(180deg);
}

.legend-toggle {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  background: #161b22;
  border: 1px solid #30363d;
  border-left: none;
  border-radius: 0 8px 8px 0;
  padding: 8px 12px;
  color: #c9d1d9;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  transition: background 0.2s;
}

.legend-toggle:hover {
  background: #21262d;
}

.legend-toggle-icon {
  font-size: 10px;
  transition: transform 0.3s ease;
}

.legend-toggle-text {
  writing-mode: vertical-rl;
  text-orientation: mixed;
}

.legend:not(.collapsed) .legend-toggle-text {
  display: none;
}

.legend:not(.collapsed) .legend-toggle {
  position: relative;
  transform: none;
  border-radius: 0;
  border: none;
  border-bottom: 1px solid #30363d;
  width: 100%;
  justify-content: flex-start;
}

.legend-content {
  padding: 12px 16px;
  min-width: 180px;
}

.legend-content h3 {
  font-size: 12px;
  font-weight: 600;
  color: #f0f6fc;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.legend-sources {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-bottom: 12px;
}

.legend-source {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.legend-source-dot {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
}

.legend-source-name {
  color: #c9d1d9;
}

.legend-source-count {
  color: #8b949e;
  margin-left: auto;
}

.legend-total {
  font-size: 11px;
  color: #8b949e;
  padding-top: 8px;
  border-top: 1px solid #30363d;
}
```

**Step 3: Add legend update function to main.js**

Add after the hideTooltip function:

```javascript
function updateLegend() {
  // Count nodes by source
  const sourceCounts = new Map();
  for (const node of nodes) {
    const count = sourceCounts.get(node.source) || 0;
    sourceCounts.set(node.source, count + 1);
  }

  // Build legend HTML
  const legendSources = document.getElementById('legend-sources');
  legendSources.innerHTML = '';

  for (const [source, count] of sourceCounts) {
    const div = document.createElement('div');
    div.className = 'legend-source';
    div.innerHTML = `
      <span class="legend-source-dot" style="background: ${getSourceColor(source)}"></span>
      <span class="legend-source-name">${getSourceName(source)}</span>
      <span class="legend-source-count">${count}</span>
    `;
    legendSources.appendChild(div);
  }

  // Update totals
  document.getElementById('legend-node-count').textContent = nodes.length;
  document.getElementById('legend-source-count').textContent = sourceCounts.size;
}
```

**Step 4: Add legend toggle behavior**

Add after updateLegend:

```javascript
function setupLegend() {
  const legend = document.getElementById('legend');
  const toggle = document.getElementById('legend-toggle');

  toggle.addEventListener('click', () => {
    legend.classList.toggle('collapsed');
  });
}
```

**Step 5: Call updateLegend in render() and setupLegend in init()**

Add at the end of the render() function:

```javascript
  // Update legend
  updateLegend();
```

Add in init() after `render()`:

```javascript
  setupLegend();
```

**Step 6: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- "Sources" tab visible on left edge
- Click tab to expand legend panel
- Shows "Internet Archive: 1" initially
- After expanding Apollo 11, shows "Internet Archive: 1, Wikipedia: 3"
- Total shows "4 items from 2 sources"
- Click toggle again to collapse

**Step 7: Commit**

```bash
git add index.html style.css main.js
git commit -m "feat: add collapsible source legend panel"
```

---

### Task 4: Enhance Footer and Add Credits

**Files:**
- Modify: `index.html` (enhance footer)
- Modify: `style.css` (improve footer styling)

**Step 1: Update footer in index.html**

Replace the footer element:

```html
    <footer>
      <div class="footer-content">
        <p class="footer-tagline">Imagining a unified library</p>
        <p class="footer-sources">
          Data from
          <a href="https://archive.org" target="_blank" rel="noopener">Internet Archive</a>,
          <a href="https://wikipedia.org" target="_blank" rel="noopener">Wikipedia</a>,
          <a href="https://dp.la" target="_blank" rel="noopener">DPLA</a>,
          <a href="https://openlibrary.org" target="_blank" rel="noopener">OpenLibrary</a>,
          <a href="https://arxiv.org" target="_blank" rel="noopener">arXiv</a>,
          <a href="https://www.si.edu" target="_blank" rel="noopener">Smithsonian</a>,
          <a href="https://www.metmuseum.org" target="_blank" rel="noopener">Met Museum</a>
        </p>
        <p class="footer-credit">
          A speculative design prototype exploring cooperative knowledge infrastructure
        </p>
      </div>
    </footer>
```

**Step 2: Update footer styles in style.css**

Replace the footer styles:

```css
footer {
  padding: 1rem 2rem;
  text-align: center;
  border-top: 1px solid #21262d;
  background: linear-gradient(to top, #0d1117 0%, transparent 100%);
}

.footer-content {
  max-width: 800px;
  margin: 0 auto;
}

.footer-tagline {
  font-size: 1rem;
  color: #c9d1d9;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.footer-sources {
  font-size: 0.75rem;
  color: #8b949e;
  margin-bottom: 0.5rem;
  line-height: 1.6;
}

.footer-sources a {
  color: #58a6ff;
  text-decoration: none;
  transition: color 0.2s;
}

.footer-sources a:hover {
  color: #79c0ff;
  text-decoration: underline;
}

.footer-credit {
  font-size: 0.6875rem;
  color: #6e7681;
  font-style: italic;
}
```

**Step 3: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Footer has gradient fade from background
- "Imagining a unified library" prominently displayed
- Source links are clickable and open in new tabs
- Credit text is subtle italic

**Step 4: Commit**

```bash
git add index.html style.css
git commit -m "feat: enhance footer with source links and credits"
```

---

### Task 5: Add Title Header

**Files:**
- Modify: `index.html` (add header)
- Modify: `style.css` (add header styles)

**Step 1: Add header to index.html**

Add after opening `<div id="app">` and before the tooltip:

```html
    <header>
      <h1>Rabbit Hole Browser</h1>
      <p class="subtitle">Exploring the Internet Library Consortium</p>
    </header>
```

**Step 2: Add header styles to style.css**

Add after the #controls styles:

```css
/* Header */
header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  padding: 1rem 2rem;
  background: linear-gradient(to bottom, #0d1117 0%, transparent 100%);
  z-index: 50;
  pointer-events: none;
}

header h1 {
  font-size: 1.25rem;
  font-weight: 600;
  color: #f0f6fc;
  margin: 0;
  letter-spacing: -0.5px;
}

header .subtitle {
  font-size: 0.75rem;
  color: #8b949e;
  margin: 0.25rem 0 0 0;
}
```

**Step 3: Adjust controls position**

Update #controls in style.css:

```css
#controls {
  position: fixed;
  top: 5rem;  /* Moved down to account for header */
  right: 1rem;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  z-index: 100;
}
```

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Title "Rabbit Hole Browser" visible in top-left
- Subtitle below it
- Header has gradient fade into graph area
- Zoom controls not overlapping header

**Step 5: Commit**

```bash
git add index.html style.css
git commit -m "feat: add title header with gradient fade"
```

---

### Task 6: Add Link to Original Item on Node Click (External Link)

**Files:**
- Modify: `main.js` (add external link button to tooltip)
- Modify: `style.css` (tooltip button styles)

**Step 1: Update tooltip HTML in index.html**

Update the tooltip div:

```html
    <div id="tooltip" class="tooltip hidden">
      <div class="tooltip-title"></div>
      <div class="tooltip-description"></div>
      <div class="tooltip-source"></div>
      <a id="tooltip-link" class="tooltip-link" href="#" target="_blank" rel="noopener">
        View original ↗
      </a>
      <div class="tooltip-action">Click node to explore connections</div>
    </div>
```

**Step 2: Add tooltip link styles**

Add to style.css:

```css
.tooltip-link {
  display: inline-block;
  font-size: 11px;
  color: #58a6ff;
  text-decoration: none;
  margin-bottom: 8px;
  pointer-events: auto;
  transition: color 0.2s;
}

.tooltip-link:hover {
  color: #79c0ff;
  text-decoration: underline;
}
```

**Step 3: Update showTooltip to set link URL**

Update the showTooltip function:

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

  tooltip.querySelector('.tooltip-action').textContent = expanded
    ? 'Already explored'
    : 'Click to explore connections';

  // Position tooltip near cursor but not overlapping
  const x = event.pageX + 15;
  const y = event.pageY + 15;

  // Keep tooltip on screen
  const maxX = window.innerWidth - 320;
  const maxY = window.innerHeight - 180;

  tooltip.style.left = `${Math.min(x, maxX)}px`;
  tooltip.style.top = `${Math.min(y, maxY)}px`;

  tooltip.classList.remove('hidden');
}
```

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Hover over node shows tooltip with "View original ↗" link
- Clicking link opens original source (e.g., archive.org) in new tab
- Link is clickable even though tooltip follows mouse

**Step 5: Commit**

```bash
git add index.html style.css main.js
git commit -m "feat: add external link to original item in tooltip"
```
