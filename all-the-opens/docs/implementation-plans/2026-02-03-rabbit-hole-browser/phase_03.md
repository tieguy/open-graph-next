# Rabbit Hole Browser Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use ed3d-plan-and-execute:executing-an-implementation-plan to implement this plan task-by-task.

**Goal:** Build a visual "rabbit hole browser" that connects resources across open knowledge organizations, starting with Apollo 11 as seed.

**Architecture:** Force-directed graph visualization with D3.js. All data pre-cached in JSON files. Static site with no backend.

**Tech Stack:** D3.js v7 (ESM from CDN), vanilla JavaScript, CSS

**Scope:** 6 phases from original design (phases 1-6)

**Codebase verified:** 2026-02-03 - Greenfield project, no existing code

---

## Phase 3: Interaction and Expansion

**Goal:** Click-to-expand behavior and graph growth

**Dependencies:** Phase 2

**Done when:** Clicking a node loads its connections, new nodes animate in, graph reorganizes smoothly

---

### Task 1: Implement Node Click Handler

**Files:**
- Modify: `main.js` (add click handler and expansion logic)

**Step 1: Add expanded nodes tracking**

Add to the state variables section (after `let zoomBehavior = null;`):

```javascript
// Track which nodes have been expanded
const expandedNodes = new Set();
```

**Step 2: Add the expandNode function**

Add after the `loadConnections()` function:

```javascript
async function expandNode(event, d) {
  // Prevent event bubbling to zoom
  event.stopPropagation();

  // Don't expand if already expanded
  if (expandedNodes.has(d.id)) {
    console.log(`Node ${d.id} already expanded`);
    return;
  }

  // Load connections data
  const connections = await loadConnections();
  const nodeConnections = connections[d.id];

  if (!nodeConnections || nodeConnections.length === 0) {
    console.log(`No connections for ${d.id}`);
    // Mark as expanded even if no connections (it's a leaf)
    expandedNodes.add(d.id);
    return;
  }

  console.log(`Expanding ${d.id} with ${nodeConnections.length} connections`);

  // Load all connected items
  const newNodes = [];
  const newLinks = [];

  for (const conn of nodeConnections) {
    // Check if node already exists in graph
    const existingNode = nodes.find(n => n.id === conn.targetId);

    if (existingNode) {
      // Just add link to existing node
      newLinks.push({
        source: d.id,
        target: conn.targetId,
        type: conn.type,
        label: conn.label
      });
    } else {
      // Load the item data
      const item = await loadItem(conn.targetId);

      if (item) {
        // Position new node near parent
        item.x = d.x + (Math.random() - 0.5) * 100;
        item.y = d.y + (Math.random() - 0.5) * 100;

        newNodes.push(item);
        newLinks.push({
          source: d.id,
          target: conn.targetId,
          type: conn.type,
          label: conn.label
        });
      }
    }
  }

  // Mark as expanded
  expandedNodes.add(d.id);

  // Add to graph
  if (newNodes.length > 0 || newLinks.length > 0) {
    nodes = [...nodes, ...newNodes];
    links = [...links, ...newLinks];
    render();
  }
}
```

**Step 3: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected: Page loads without errors. Expansion function exists but click handler not yet connected.

**Step 4: Commit**

```bash
git add main.js
git commit -m "feat: add expandNode function for loading connections"
```

---

### Task 2: Connect Click Handler to Nodes

**Files:**
- Modify: `main.js` (update render function to add click handler)

**Step 1: Update node rendering in render() function**

Find this section in render():

```javascript
  // Render nodes
  const nodeGroups = g.selectAll('.node')
    .data(nodes, d => d.id)
    .join('g')
    .attr('class', 'node')
    .style('cursor', 'pointer')
    .call(drag(simulation));
```

Replace with:

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

**Step 2: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Click Apollo 11 node
- Console shows: "Expanding ia-apollo11-mission with 3 connections"
- Three new nodes appear (Neil Armstrong, Buzz Aldrin, Michael Collins)
- New nodes have Wikipedia color (gray #636466) with "W" badge
- Edges connect Apollo 11 to each crew member
- Clicking Apollo 11 again shows "Node ia-apollo11-mission already expanded"

**Step 3: Commit**

```bash
git add main.js
git commit -m "feat: add click-to-expand behavior on nodes"
```

---

### Task 3: Add Animation for New Nodes

**Files:**
- Modify: `main.js` (enhance enter animation)
- Modify: `style.css` (add animation styles)

**Step 1: Update node circle enter animation**

In the render() function, find the circle rendering section and update it:

```javascript
  // Add circles to new nodes with source-specific colors
  nodeGroups.selectAll('circle.node-circle')
    .data(d => [d])
    .join(
      enter => enter.append('circle')
        .attr('class', 'node-circle')
        .attr('r', 0)
        .attr('fill', d => getSourceColor(d.source))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('opacity', 0.9)
        .call(enter => enter.transition()
          .duration(400)
          .ease(d3.easeCubicOut)
          .attr('r', 24)),
      update => update
        .attr('r', 24)
        .attr('fill', d => getSourceColor(d.source)),
      exit => exit.remove()
    );
```

**Step 2: Update link enter animation**

In the render() function, update the link group join:

```javascript
  // Render link groups (line + label)
  const linkGroups = g.selectAll('.link-group')
    .data(links, d => `${d.source.id || d.source}-${d.target.id || d.target}`)
    .join(
      enter => enter.append('g')
        .attr('class', 'link-group')
        .style('opacity', 0)
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

**Step 3: Adjust simulation restart for smoother animation**

In the render() function, update the simulation restart at the end:

```javascript
  // Restart simulation with gentler reheat
  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.alpha(0.5).restart();  // Reduced from 1 to 0.5 for gentler animation
```

**Step 4: Add CSS for smoother transitions**

Add to style.css:

```css
/* Node animations */
.node {
  transition: opacity 0.3s ease;
}

.node-circle {
  transition: r 0.4s ease-out, fill 0.2s ease;
}
```

**Step 5: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Click Apollo 11 node
- New nodes scale up from size 0 (grow animation)
- New edges fade in smoothly
- Graph reorganizes with smooth physics (not jarring snap)

**Step 6: Commit**

```bash
git add main.js style.css
git commit -m "feat: add smooth animations for node expansion"
```

---

### Task 4: Add Visual Feedback for Expandable vs Expanded Nodes

**Files:**
- Modify: `main.js` (add visual state indicators)
- Modify: `style.css` (add state styles)

**Step 1: Update circle rendering to show expansion state**

Update the circle styling in render() to add a class based on expansion state:

```javascript
  // Add circles to new nodes with source-specific colors
  nodeGroups.selectAll('circle.node-circle')
    .data(d => [d])
    .join(
      enter => enter.append('circle')
        .attr('class', d => `node-circle ${expandedNodes.has(d.id) ? 'expanded' : 'expandable'}`)
        .attr('r', 0)
        .attr('fill', d => getSourceColor(d.source))
        .attr('stroke', '#fff')
        .attr('stroke-width', 2)
        .attr('opacity', 0.9)
        .call(enter => enter.transition()
          .duration(400)
          .ease(d3.easeCubicOut)
          .attr('r', 24)),
      update => update
        .attr('class', d => `node-circle ${expandedNodes.has(d.id) ? 'expanded' : 'expandable'}`)
        .attr('r', 24)
        .attr('fill', d => getSourceColor(d.source)),
      exit => exit.remove()
    );
```

**Step 2: Add node hover effects to style.css**

Add to style.css:

```css
/* Expandable node hover effect */
.node .expandable {
  cursor: pointer;
}

.node:hover .expandable {
  filter: brightness(1.2);
  stroke-width: 3;
}

.node .expanded {
  opacity: 0.8;
}

.node:hover .expanded {
  filter: brightness(1.1);
}
```

**Step 3: Add expand indicator to nodes**

Add after the source-badge rendering in render():

```javascript
  // Add expand indicator for non-expanded nodes with connections
  nodeGroups.selectAll('circle.expand-indicator')
    .data(d => expandedNodes.has(d.id) ? [] : [d])
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
    .data(d => expandedNodes.has(d.id) ? [] : [d])
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

**Step 4: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Apollo 11 node shows green "+" indicator in corner
- After clicking, "+" indicator disappears
- New crew member nodes have "+" indicators
- Hovering unexpanded nodes shows brightness increase
- Expanded nodes appear slightly dimmer

**Step 5: Commit**

```bash
git add main.js style.css
git commit -m "feat: add visual feedback for expandable nodes"
```

---

### Task 5: Implement Node Dragging Improvements

**Files:**
- Modify: `main.js` (improve drag behavior)

**Step 1: Update drag function to work better with click**

Replace the entire `drag()` function:

```javascript
function drag(simulation) {
  let dragStartTime = 0;

  function dragstarted(event, d) {
    dragStartTime = Date.now();
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

    // If drag was very short, treat as click (allow expansion)
    const dragDuration = Date.now() - dragStartTime;
    if (dragDuration < 150) {
      // Release fixed position for short drags (clicks)
      d.fx = null;
      d.fy = null;
    }
    // Long drags keep the node pinned at its new position
    // (fx/fy remain set)
  }

  return d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);
}
```

**Step 2: Add double-click to unpin nodes**

In the render() function, update the node join to add dblclick handler:

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
          // Unpin the node
          d.fx = null;
          d.fy = null;
          simulation.alpha(0.3).restart();
        })
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

**Step 3: Add pinned indicator styling**

Add to style.css:

```css
/* Pinned node indicator */
.node.pinned .node-circle {
  stroke: #f0883e;
  stroke-width: 3;
}
```

**Step 4: Update drag handlers to toggle pinned class**

Update the dragended function in drag():

```javascript
  function dragended(event, d) {
    if (!event.active) simulation.alphaTarget(0);

    const dragDuration = Date.now() - dragStartTime;
    const nodeElement = d3.select(event.sourceEvent.target.closest('.node'));

    if (dragDuration < 150) {
      // Short drag = click, unpin
      d.fx = null;
      d.fy = null;
      nodeElement.classed('pinned', false);
    } else {
      // Long drag = pin node
      nodeElement.classed('pinned', true);
    }
  }
```

**Step 5: Verify operationally**

Run: `python3 -m http.server 8000`
Open: `http://localhost:8000`
Expected:
- Single click expands nodes
- Dragging a node for >150ms pins it (orange border)
- Double-clicking a pinned node unpins it
- Pinned nodes stay fixed while simulation runs
- Unpinned nodes float freely

**Step 6: Commit**

```bash
git add main.js style.css
git commit -m "feat: improve drag behavior with pin/unpin support"
```
