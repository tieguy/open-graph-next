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
