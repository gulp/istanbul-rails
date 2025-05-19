// No need to register fcose if only using preset, but doesn't hurt
// cytoscape.use(cytoscapeFcose);

// STEP 1: Load Rich Station Data and Figma Coordinates
let richData = {};
let figmaCoordinates = {};

const RECT_WIDTH = 8; // Assuming these are constants used in figma coordinate processing
const RECT_HEIGHT = 8;

Promise.all([
  fetch('../data/stations_lines.json').then(response => response.json()),
  fetch('../data/figma_coordinates.json').then(response => response.json())
])
.then(([stationsLinesData, figmaCoordsData]) => {
  richData = stationsLinesData;
  figmaCoordinates = figmaCoordsData;

  // STEP 2: Merge Figma Coordinates into Rich Data (Adjusted for loaded data)
  richData.stations.forEach(station => {
    if (figmaCoordinates[station.id]) {
      // Adjust for center calculation if your stored figmaCoordinates are top-left
      station.x = figmaCoordinates[station.id].x + RECT_WIDTH/2;
      station.y = figmaCoordinates[station.id].y + RECT_HEIGHT/2;
      station.figmaColor = figmaCoordinates[station.id].figmaFill; // Store Figma color
    } else {
      console.warn(`Coordinates not found in figmaCoordinates for station ID: ${station.id}. It will be auto-placed if not locked.`);
    }
  });

  // STEP 3: Create Cytoscape Elements
  const elements = [];
  const stationNodeIds = new Set();

  // Add station nodes using the merged richData
  richData.stations.forEach(station => {
    if (!stationNodeIds.has(station.id)) {
      elements.push({
        group: 'nodes',
        data: {
          id: station.id,
          name: station.name,
          isInterchange: (station.transfers && station.transfers.length > 0) || (station.lines && station.lines.length > 1),
          figmaColor: station.figmaColor // Pass Figma color to data
        },
        position: (typeof station.x !== 'undefined' && typeof station.y !== 'undefined') ?
                  { x: station.x, y: station.y } :
                  undefined // Only set position if x and y exist
        // locked: (typeof station.x !== 'undefined') // Optionally lock nodes with preset positions
      });
      stationNodeIds.add(station.id);
    }
  });

  // Add real line edges
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

  // STEP 4: Initialize Cytoscape with 'preset' layout
  var cy = cytoscape({
    container: document.getElementById('cy'),
    elements: elements,
    style: [
      { selector: 'node', style: {
          // 'background-color': 'data(figmaColor)', // Use Figma color if available
          'background-color': '#888', // Default if no figmaColor
          'label': 'data(name)',
          'font-size': '10px', 'text-valign': 'bottom', 'text-halign': 'center',
          'text-margin-y': '3px', 'width': '8px', 'height': '8px',
          'border-width': 1, 'border-color': '#555'
      }},
      { selector: 'node[isInterchange="true"]', style: {
          'background-color': '#fff', 'border-color': '#000', 'border-width': 1.5,
          'width': '12px', 'height': '12px', 'shape': 'ellipse'
      }},
      { selector: 'node[?figmaColor]', style: { // If figmaColor data exists, use it
            'background-color': 'data(figmaColor)'
      }},
      { selector: 'edge', style: {
          'width': 3, 'line-color': 'data(lineColor)',
          'curve-style': 'bezier', // For preset, straight lines will form. Bezier is fine.
                                    // If you need orthogonal edges AFTER preset, that's another step.
          'target-arrow-shape': 'none', 'opacity': 0.7
      }}
    ],
    layout: {
      name: 'preset', // USE THE PRESET POSITIONS
      fit: true,      // Zoom to fit all positioned elements
      padding: 30     // Padding around the graph
    }
  });

  cy.on('tap', 'node', function(evt){
    var node = evt.target;
    document.getElementById('station-info').textContent = `ID: ${node.id()}\nName: ${node.data('name') || node.id()}`;
  });

})
.catch(error => console.error("Error loading data:", error));