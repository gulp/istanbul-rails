// No need to register fcose if only using preset, but doesn't hurt
// You WILL need it if you want to use it for the unpositioned nodes.
// So, if you uncomment fcose usage below, uncomment this too:
// cytoscape.use(cytoscapeFcose);

// STEP 1: Load Rich Station Data and Figma Coordinates
let richData = {};
let figmaCoordinates = {};

const RECT_WIDTH = 8;
const RECT_HEIGHT = 8;

Promise.all([
  fetch('../data/stations_lines.json').then(response => response.json()),
  fetch('../data/figma_coordinates.json').then(response => response.json())
])
.then(([stationsLinesData, figmaCoordsData]) => {
  richData = stationsLinesData;
  figmaCoordinates = figmaCoordsData;

  const nodesWithFigmaCoords = new Set(); // Keep track of nodes that have Figma coords

  // STEP 2: Merge Figma Coordinates into Rich Data
  richData.stations.forEach(station => {
    if (figmaCoordinates[station.id]) {
      station.x = figmaCoordinates[station.id].x + RECT_WIDTH / 2;
      station.y = figmaCoordinates[station.id].y + RECT_HEIGHT / 2;
      station.figmaColor = figmaCoordinates[station.id].figmaFill;
      nodesWithFigmaCoords.add(station.id); // Mark this node as having Figma coordinates
    } else {
      console.warn(`Coordinates not found in figmaCoordinates for station ID: ${station.id}.`);
      // station.x and station.y will remain undefined for these
    }
  });

  // STEP 3: Create Cytoscape Elements
  const elements = [];
  const stationNodeIds = new Set();

  richData.stations.forEach(station => {
    if (!stationNodeIds.has(station.id)) {
      elements.push({
        group: 'nodes',
        data: {
          id: station.id,
          name: station.name,
          isInterchange: (station.transfers && station.transfers.length > 0) || (station.lines && station.lines.length > 1),
          figmaColor: station.figmaColor,
          hasFigmaCoord: nodesWithFigmaCoords.has(station.id) // Add a flag
        },
        position: (typeof station.x !== 'undefined' && typeof station.y !== 'undefined') ?
                  { x: station.x, y: station.y } :
                  undefined,
        // Lock nodes that have Figma coordinates if you want them absolutely fixed
        // during the secondary layout.
        // locked: nodesWithFigmaCoords.has(station.id) 
      });
      stationNodeIds.add(station.id);
    }
  });

  // Add real line edges (same as your existing code)
  richData.lines.forEach(line => {
    function addEdgesForStationList(stations, branchName = null) {
      for (let i = 0; i < stations.length - 1; i++) {
        const source = stations[i];
        const target = stations[i+1];
        if (stationNodeIds.has(source) && stationNodeIds.has(target)) {
          elements.push({
            group: 'edges',
            data: {
              id: `${line.id}-${branchName ? branchName + '-' : ''}${source}-${target}`,
              source: source, target: target, lineColor: line.color || '#ccc', lineId: line.id
            }
          });
        } else {
            console.warn(`Edge creation skipped for line ${line.id}: ${source} or ${target} not in stationNodeIds`);
        }
      }
    }
    if (line.stations && line.stations.length > 0) {
        addEdgesForStationList(line.stations);
    }
    if (line.branches) {
      for (const branch in line.branches) {
        if (line.branches[branch] && line.branches[branch].length > 0) {
            addEdgesForStationList(line.branches[branch], branch);
        }
      }
    }
  });

  // STEP 4: Initialize Cytoscape
  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: elements,
    style: [ // Your existing styles
      { selector: 'node', style: {
          'background-color': '#888', 
          'label': 'data(name)',
          'font-size': '10px', 'text-valign': 'bottom', 'text-halign': 'center',
          'text-margin-y': '3px', 'width': '8px', 'height': '8px',
          'border-width': 1, 'border-color': '#555'
      }},
      { selector: 'node[isInterchange="true"]', style: {
          'background-color': '#fff', 'border-color': '#000', 'border-width': 1.5,
          'width': '12px', 'height': '12px', 'shape': 'ellipse'
      }},
      { selector: 'node[?figmaColor]', style: { 
            'background-color': 'data(figmaColor)'
      }},
      { selector: 'edge', style: {
          'width': 3, 'line-color': 'data(lineColor)',
          'curve-style': 'bezier', 
          'target-arrow-shape': 'none', 'opacity': 0.7
      }}
    ],
    // Initial layout is preset to place the known coordinates
    layout: {
      name: 'preset',
      fit: false, // Don't fit initially, we'll fit after exploding
      padding: 50
    }
  });

  // STEP 5: "Explode" Unpositioned Nodes
  // Select nodes that do NOT have figma coordinates
  const unpositionedNodes = cy.nodes('[!hasFigmaCoord]'); 
  const positionedNodes = cy.nodes('[hasFigmaCoord]');

  if (unpositionedNodes.length > 0) {
    console.log(`Found ${unpositionedNodes.length} unpositioned nodes to explode.`);

    // Option 1: Use a force-directed layout like fcose for unpositioned nodes
    // Make sure to include fcose library if you use this:
    // <script src="https://unpkg.com/cytoscape-fcose@2.2.0/cytoscape-fcose.js"></script>
    // And uncomment: cytoscape.use(cytoscapeFcose); at the top.
    
    // To prevent positioned nodes from moving during this layout, you can lock them
    // OR ensure the layout only runs on the `unpositionedNodes` collection and
    // respects the positions of other nodes (some layouts do this better than others).
    // `cose` and `fcose` have options to constrain nodes.

    // A simple approach: run layout on unpositioned nodes, then fit everything.
    // The `boundingBox` option can help constrain where these nodes are placed.
    // You might need to experiment with the bounding box.
    // For example, place them in a circle around the existing map.

    // First, let's try a simple 'circle' layout for the unpositioned ones,
    // and try to place this circle somewhat away from the main cluster if possible,
    // or just let it arrange them and then we zoom out.

    let layoutOptions;

    // Attempt to find a bounding box for the positioned nodes
    let bb;
    if (positionedNodes.length > 0) {
        bb = positionedNodes.boundingBox();
    } else { // If NO nodes have figma coords, just use a default bounding box
        bb = { x1: 0, y1: 0, w: cy.width() / 2, h: cy.height() / 2 }; // Default placement area
    }

    // Place the circle of unpositioned nodes to the side or below
    // For example, to the right of the existing bounding box:
    const circleCenterX = bb.x1 + bb.w + 200; // 200px to the right
    const circleCenterY = bb.y1 + bb.h / 2;   // Vertically centered with existing map

    layoutOptions = {
        name: 'circle',
        fit: false, // We don't want this small circle to fit the whole viewport
        padding: 50,
        radius: Math.max(150, unpositionedNodes.length * 10), // Adjust radius based on node count
        startAngle: 3 / 2 * Math.PI,
        counterclockwise: false,
        // Position the center of the circle:
        // boundingBox: { x1: circleCenterX - 100, y1: circleCenterY - 100, w: 200, h: 200 } // A guess for bbox
        // Simpler for circle is often to manually position after layout if needed, or use a more complex concentric
    };
    
    // Or use cose/fcose for better spreading (recommended if many unpositioned)
    /*
    layoutOptions = {
        name: 'fcose', // or 'cose'
        idealEdgeLength: 70,
        nodeRepulsion: 10000,
        fit: false, // Don't fit this sub-layout to the whole screen
        padding: 50,
        animate: true,
        randomize: true,
        // boundingBox: { x1: someX, y1: someY, w: someWidth, h: someHeight } // Define a region
    };
    */

    // Run the layout on the collection of unpositioned nodes
    let unpositionedLayout = unpositionedNodes.layout(layoutOptions);
    
    unpositionedLayout.pon('layoutstop', function() {
        // After the unpositioned nodes are laid out, fit the whole graph
        cy.animate({
            fit: { padding: 50 }
        }, { duration: 500 });
    });
    unpositionedLayout.run();


  } else {
    // If all nodes were positioned, just fit the graph
    cy.animate({
        fit: { padding: 50 }
    }, { duration: 500 });
  }

  // Tap event (same as your existing code)
  cy.on('tap', 'node', function(evt){
    var node = evt.target;
    const stationInfo = `ID: ${node.id()}<br>Name: ${node.data('name') || node.id()}<br>Has Figma Coord: ${node.data('hasFigmaCoord')}`;
    document.getElementById('station-info').innerHTML = stationInfo; // Use innerHTML for <br>
  });

})
.catch(error => console.error("Error loading data:", error));