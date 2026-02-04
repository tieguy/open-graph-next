import * as d3 from 'https://cdn.jsdelivr.net/npm/d3@7/+esm';

// Source configuration with colors and favicons
const SOURCES = {
  internet_archive: {
    color: '#428bca',
    name: 'Internet Archive',
    favicon: 'https://archive.org/favicon.ico'
  },
  wikipedia: {
    color: '#636466',
    name: 'Wikipedia',
    favicon: 'https://en.wikipedia.org/favicon.ico'
  },
  wikimedia_commons: {
    color: '#006699',
    name: 'Wikimedia Commons',
    favicon: 'https://commons.wikimedia.org/favicon.ico'
  },
  dpla: {
    color: '#0066cc',
    name: 'DPLA',
    favicon: 'https://dp.la/favicon.ico'
  },
  openlibrary: {
    color: '#e47911',
    name: 'OpenLibrary',
    favicon: 'https://openlibrary.org/favicon.ico'
  },
  arxiv: {
    color: '#b31b1b',
    name: 'arXiv',
    favicon: 'https://arxiv.org/favicon.ico'
  },
  met_museum: {
    color: '#e4002b',
    name: 'Met Museum',
    favicon: 'https://www.metmuseum.org/favicon.ico'
  },
  smithsonian: {
    color: '#5b9bd5',
    name: 'Smithsonian',
    favicon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c4/Smithsonian_sun_logo_no_text.svg/32px-Smithsonian_sun_logo_no_text.svg.png'
  },
  openstreetmap: {
    color: '#7ebc6f',
    name: 'OpenStreetMap',
    favicon: 'https://www.openstreetmap.org/favicon.ico'
  },
  inaturalist: {
    color: '#74ac00',
    name: 'iNaturalist',
    favicon: 'https://www.inaturalist.org/favicon.ico'
  },
  gbif: {
    color: '#4e9a47',
    name: 'GBIF',
    favicon: 'https://upload.wikimedia.org/wikipedia/commons/thumb/3/3a/Gbif-full-green-logo.svg/32px-Gbif-full-green-logo.svg.png'
  }
};

function getSourceColor(source) {
  return SOURCES[source]?.color || '#238636';
}

function getSourceFavicon(source) {
  return SOURCES[source]?.favicon || null;
}

function getSourceName(source) {
  return SOURCES[source]?.name || source;
}

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

function truncateTitle(title, maxLength = 22) {
  if (title.length <= maxLength) return title;
  return title.slice(0, maxLength - 1).trim() + '…';
}

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

function updateSidebar(d) {
  const sidebar = document.getElementById('sidebar');
  const empty = document.getElementById('sidebar-empty');
  const content = document.getElementById('sidebar-content');
  const expanded = expandedNodes.has(d.id);

  // Show content, hide empty state
  empty.classList.add('hidden');
  content.classList.remove('hidden');

  sidebar.querySelector('.sidebar-title').textContent = d.title;
  sidebar.querySelector('.sidebar-description').textContent = d.description || '';
  sidebar.querySelector('.sidebar-source').textContent = `Source: ${getSourceName(d.source)}`;

  const linkElement = document.getElementById('sidebar-link');
  linkElement.href = d.url;
  linkElement.style.display = d.url ? 'inline-block' : 'none';

  // Handle potential counts for leaf nodes
  const potentialSection = document.getElementById('sidebar-potential');
  if (d.potential && d.potential.total > 0) {
    potentialSection.classList.remove('hidden');
    document.getElementById('sidebar-potential-total').textContent =
      d.potential.total.toLocaleString();

    // Build breakdown
    const breakdownContainer = document.getElementById('sidebar-potential-breakdown');
    breakdownContainer.innerHTML = '';

    // Sort sources by count descending
    const sources = Object.entries(d.potential)
      .filter(([key]) => key !== 'total' && d.potential[key] > 0)
      .sort((a, b) => b[1] - a[1]);

    for (const [source, count] of sources) {
      const item = document.createElement('div');
      item.className = 'sidebar-potential-item';
      item.innerHTML = `
        <span class="source-name">${getSourceName(source)}</span>
        <span class="count">${count.toLocaleString()}</span>
      `;
      breakdownContainer.appendChild(item);
    }
  } else {
    potentialSection.classList.add('hidden');
  }

  sidebar.querySelector('.sidebar-status').textContent = expanded
    ? 'Connections explored'
    : d.potential && d.potential.total > 0
      ? 'Leaf node - no cached connections'
      : 'Click again to explore connections';
}

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

    const dot = document.createElement('span');
    dot.className = 'legend-source-dot';
    dot.style.background = getSourceColor(source);

    const name = document.createElement('span');
    name.className = 'legend-source-name';
    name.textContent = getSourceName(source);

    const countSpan = document.createElement('span');
    countSpan.className = 'legend-source-count';
    countSpan.textContent = count;

    div.appendChild(dot);
    div.appendChild(name);
    div.appendChild(countSpan);

    legendSources.appendChild(div);
  }

  // Update totals
  document.getElementById('legend-node-count').textContent = nodes.length;
  document.getElementById('legend-source-count').textContent = sourceCounts.size;
}

function setupLegend() {
  const legend = document.getElementById('legend');
  const toggle = document.getElementById('legend-toggle');

  toggle.addEventListener('click', () => {
    legend.classList.toggle('collapsed');
  });
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
    const response = await fetch(`data/apollo-11/connections.json?v=${Date.now()}`);
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
    setupLegend();

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

  // Create defs for clip paths
  const defs = svg.append('defs');

  // Circular clip path for thumbnails
  defs.append('clipPath')
    .attr('id', 'thumbnail-clip')
    .append('circle')
    .attr('r', 24)
    .attr('cx', 0)
    .attr('cy', 0);

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
    .force('link', d3.forceLink(links).id(d => d.id).distance(d => {
      // Vary distance based on target label length
      const target = typeof d.target === 'object' ? d.target : nodes.find(n => n.id === d.target);
      const labelLen = target?.title?.length || 15;
      return 80 + Math.min(labelLen * 2, 60);
    }))
    .force('charge', d3.forceManyBody().strength(-400))
    .force('collision', d3.forceCollide().radius(50))
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

  // Link lines with type-based colors
  linkGroups.selectAll('line')
    .data(d => [d])
    .join('line')
    .attr('class', 'link')
    .attr('stroke', d => getConnectionColor(d.type))
    .attr('stroke-width', 2)
    .attr('stroke-opacity', 0.6);

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

  // Add hover behavior for link labels
  linkGroups
    .on('mouseenter', function(_event, _d) {
      d3.select(this).select('.link-label').attr('opacity', 1);
      d3.select(this).select('.link')
        .attr('stroke-opacity', 1)
        .attr('stroke-width', 3);
    })
    .on('mouseleave', function(_event, _d) {
      d3.select(this).select('.link-label').attr('opacity', 0);
      d3.select(this).select('.link')
        .attr('stroke-opacity', 0.6)
        .attr('stroke-width', 2);
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
        .on('click', (event, d) => {
          updateSidebar(d);
          expandNode(event, d);
        })
        .on('dblclick', (event, d) => {
          event.stopPropagation();
          // Unpin the node
          d.fx = null;
          d.fy = null;
          d3.select(event.currentTarget).classed('pinned', false);
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

  // Add thumbnail image (only for nodes with thumbnails)
  nodeGroups.selectAll('image.node-thumbnail')
    .data(d => d.thumbnail ? [d] : [])
    .join(
      enter => enter.append('image')
        .attr('class', 'node-thumbnail')
        .attr('href', d => d.thumbnail)
        .attr('x', -24)
        .attr('y', -24)
        .attr('width', 48)
        .attr('height', 48)
        .attr('clip-path', 'url(#thumbnail-clip)')
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('pointer-events', 'none'),
      update => update
        .attr('href', d => d.thumbnail),
      exit => exit.remove()
    );

  // Add source favicon (smaller, positioned in corner when thumbnail exists)
  nodeGroups.selectAll('image.source-favicon')
    .data(d => [d])
    .join('image')
    .attr('class', 'source-favicon')
    .attr('href', d => getSourceFavicon(d.source))
    .attr('x', d => d.thumbnail ? 8 : -12)
    .attr('y', d => d.thumbnail ? 8 : -12)
    .attr('width', d => d.thumbnail ? 16 : 24)
    .attr('height', d => d.thumbnail ? 16 : 24)
    .attr('pointer-events', 'none');

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

  // Add potential indicator for leaf nodes (sparkle badge)
  nodeGroups.selectAll('g.potential-badge')
    .data(d => isLeafNode(d) ? [d] : [])
    .join(
      enter => {
        const badge = enter.append('g')
          .attr('class', 'potential-badge')
          .attr('transform', 'translate(-50, -30)');

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

  // Add title background for readability
  nodeGroups.selectAll('rect.node-title-bg')
    .data(d => [d])
    .join('rect')
    .attr('class', 'node-title-bg')
    .attr('fill', 'rgba(13, 17, 23, 0.85)')
    .attr('rx', 3)
    .attr('ry', 3)
    .attr('y', 30)
    .attr('height', 18)
    .attr('x', d => -Math.min(truncateTitle(d.title).length * 3.5 + 6, 80))
    .attr('width', d => Math.min(truncateTitle(d.title).length * 7 + 12, 160));

  // Add title text to new nodes
  nodeGroups.selectAll('text.node-title')
    .data(d => [d])
    .join('text')
    .attr('class', 'node-title')
    .attr('dy', 44)
    .attr('text-anchor', 'middle')
    .attr('fill', '#c9d1d9')
    .attr('font-size', '11px')
    .text(d => truncateTitle(d.title));

  // Restart simulation with gentler reheat
  simulation.nodes(nodes);
  simulation.force('link').links(links);
  simulation.alpha(0.5).restart();  // Reduced from 1 to 0.5 for gentler animation

  // Update legend
  updateLegend();
}

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

  return d3.drag()
    .on('start', dragstarted)
    .on('drag', dragged)
    .on('end', dragended);
}

// Start the application
init();
