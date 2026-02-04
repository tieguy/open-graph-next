import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

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

// Graph state
let nodes = [];
let links = [];
let simulation = null;
let svg = null;
let g = null;
let zoomBehavior = null;

// Track which nodes have been expanded
const expandedNodes = new Set();

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

function render() {
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

  // Add title text to new nodes
  nodeGroups.selectAll('text.node-title')
    .data(d => [d])
    .join('text')
    .attr('class', 'node-title')
    .attr('dy', 40)
    .attr('text-anchor', 'middle')
    .attr('fill', '#c9d1d9')
    .attr('font-size', '12px')
    .text(d => d.title);

  // Restart simulation with gentler reheat
  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.alpha(0.5).restart();  // Reduced from 1 to 0.5 for gentler animation
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
