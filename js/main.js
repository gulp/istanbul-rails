// No need to register fcose if only using preset, but doesn't hurt
// You WILL need it if you want to use it for the unpositioned nodes.
// So, if you uncomment fcose usage below, uncomment this too:
// cytoscape.use(cytoscapeFcose);

// STEP 1: Load ALL Data
let metroData = {};
let tramData = {};
let figmaCoordinates = {};
let globalLineColors = {};

const RECT_WIDTH = 8;
const RECT_HEIGHT = 8;

let allElements = [];
let cy; // Declare cy here to be accessible in createElementsFromDataset if needed for merging

// Function to create Cytoscape elements from a dataset (now assumes dataset has line_colors at its root)
function createElementsFromDataset(dataset, datasetType, nodesWithFigmaCoords, existingStationIds, lineColors) {
  const elements = [];
  
  // Add station nodes
  dataset.stations.forEach(station => {
    const stationId = station.id; // Use a local const for clarity
    const isNewStation = !existingStationIds.has(stationId);
    
    if (isNewStation) {
      const hasFigma = figmaCoordinates[stationId] !== undefined;
      if (hasFigma) {
        nodesWithFigmaCoords.add(stationId);
      }
      elements.push({
        group: 'nodes',
        data: {
          id: stationId,
          name: station.name,
          isInterchange: (station.transfers && station.transfers.length > 0) || (station.lines && station.lines.length > 1),
          figmaColor: hasFigma ? figmaCoordinates[stationId].figmaFill : undefined,
          hasFigmaCoord: hasFigma,
          datasetType: datasetType, // Added datasetType to node data
          lines: station.lines || [],
          notes: station.notes // Added notes to node data
        },
        classes: datasetType,
        position: hasFigma ? { x: figmaCoordinates[stationId].x + RECT_WIDTH / 2, y: figmaCoordinates[stationId].y + RECT_HEIGHT / 2 } : undefined,
      });
      existingStationIds.add(stationId);
    } else {
      // Handle existing station (merge lines, etc.)
      const existingNode = cy ? cy.getElementById(stationId) : null; // Check if cy is initialized
      if (existingNode && existingNode.length > 0) {
          let currentLines = new Set(existingNode.data('lines') || []);
          (station.lines || []).forEach(lineId => currentLines.add(lineId));
          existingNode.data('lines', Array.from(currentLines));
          if (!existingNode.hasClass(datasetType)) {
            existingNode.addClass(datasetType);
          }
          // Re-evaluating isInterchange on merged nodes
          existingNode.data('isInterchange', (existingNode.data('lines') && existingNode.data('lines').length > 1) || (existingNode.data('transfers') && station.transfers.length > 0) );
      }
    }
  });

  // Add line edges
  dataset.lines.forEach(line => {
    function addEdgesForStationList(stations, branchName = null) {
      for (let i = 0; i < stations.length - 1; i++) {
        const source = stations[i];
        const target = stations[i+1];
        // Ensure stations exist before creating an edge
        if (existingStationIds.has(source) && existingStationIds.has(target)) {
          const colorForThisLine = (lineColors && lineColors[line.id]) ||
                                   (lineColors && lineColors.DEFAULT) ||
                                   '#CCCCCC'; // Fallback chain
          elements.push({
            group: 'edges',
            data: {
              id: `${datasetType}-${line.id}-${branchName ? branchName + '-' : ''}${source}-${target}`,
              source: source, target: target,
              lineColor: colorForThisLine, // USE THE LOOKED-UP COLOR
              lineId: line.id,
              datasetType: datasetType
            },
            classes: datasetType
          });
        } else {
            console.warn(`Edge creation skipped for line ${line.id} (${datasetType}): ${source} or ${target} not in existingStationIds`);
        }
      }
    }
    if (line.stations && line.stations.length > 0) addEdgesForStationList(line.stations);
    if (line.branches) {
      for (const branch in line.branches) {
        if (line.branches[branch] && line.branches[branch].length > 0) addEdgesForStationList(line.branches[branch], branch);
      }
    }
  });
  return elements;
}


// STEP 1 (cont.): Load ALL Data
Promise.all([
  fetch('../data/metro_data.json').then(response => response.json()),
  fetch('../data/tram_data.json').then(response => response.json()),
  fetch('../data/funicular_data.json').then(response => response.json()),
  fetch('../data/figma_coordinates.json').then(response => response.json()),
  fetch('../data/colors.json').then(response => response.json())
])
.then(([metroJson, tramJson, funicularJson, figmaCoordsData, colorsJson]) => {
  metroData = metroJson;
  tramData = tramJson;
  funicularData = funicularJson;
  figmaCoordinates = figmaCoordsData;
  globalLineColors = colorsJson.line_colors || {};

  const nodesWithFigmaCoords = new Set();
  const combinedStationIds = new Set(); // To track all unique station IDs across datasets

  // Clear previous elements if re-loading
  allElements = [];

  // Process Metro Data
  if (metroData && metroData.stations && metroData.lines) {
    const effectiveMetroLineColors = { ...(globalLineColors || {}), ...(metroData.line_colors || {}) };
    const metroElements = createElementsFromDataset(
      metroData,
      "metro",
      nodesWithFigmaCoords,
      combinedStationIds,
      effectiveMetroLineColors
    );
    allElements = allElements.concat(metroElements);
  } else {
    console.warn("Metro data is missing or malformed. Skipping metro elements.");
  }

  // Process Tram Data
  // Note: createElementsFromDataset will handle merging if station IDs already exist from metroData
  if (tramData && tramData.stations && tramData.lines) {
    const effectiveTramLineColors = { ...(globalLineColors || {}), ...(tramData.line_colors || {}) };
    const tramElements = createElementsFromDataset(
      tramData,
      "tram",
      nodesWithFigmaCoords,
      combinedStationIds,
      effectiveTramLineColors
    );
    allElements = allElements.concat(tramElements);
  } else {
    console.warn("Tram data is missing or malformed. Skipping tram elements.");
  }

  // Process Funicular Data
  // Note: createElementsFromDataset will handle merging if station IDs already exist
  if (funicularData && funicularData.stations && funicularData.lines) {
    const effectiveFunicularLineColors = { ...(globalLineColors || {}), ...(funicularData.line_colors || {}) };
    const funicularElements = createElementsFromDataset(
      funicularData,
      "funicular",
      nodesWithFigmaCoords,
      combinedStationIds,
      effectiveFunicularLineColors
    );
    allElements = allElements.concat(funicularElements);
  } else {
    console.warn("Funicular data is missing or malformed. Skipping funicular elements.");
  }

  // STEP 4: Initialize Cytoscape
  cy = cytoscape({ // Assign to the globally declared cy
    container: document.getElementById('cy'),
    elements: allElements, // Use the populated allElements
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
    let types = [];
    if (node.hasClass('metro')) types.push('Metro');
    if (node.hasClass('tram')) types.push('Tram');
    if (node.hasClass('funicular')) types.push('Funicular');
    const typeInfo = types.length > 0 ? types.join('/') : 'N/A';
    const stationInfo = `ID: ${node.id()}<br>Name: ${node.data('name') || node.id()}<br>Type: ${typeInfo}<br>Notes: ${node.data('notes') || ''}`;
    document.getElementById('station-info').innerHTML = stationInfo; // Use innerHTML for <br>
  });

  // STEP 6: Setup UI Toggles
  const toggleMetro = document.getElementById('toggle-metro');
  const toggleTram = document.getElementById('toggle-tram');
  const toggleFunicular = document.getElementById('toggle-funicular');

  function updateNetworkVisibility() {
    if (!cy) return; // Ensure cy is initialized

    const showMetro = toggleMetro.checked;
    const showTram = toggleTram.checked;
    const showFunicular = toggleFunicular.checked;

    cy.batch(function() {
      cy.elements().forEach(el => {
        const isMetro = el.hasClass('metro');
        const isTram = el.hasClass('tram');
        const isFunicular = el.hasClass('funicular');

        // If the element is not part of any specific network type we manage with toggles,
        // leave its visibility as is (don't hide it by default based on these toggles).
        if (!isMetro && !isTram && !isFunicular) {
          // el.show(); // Or do nothing to preserve its current state
          return; // Skip to the next element
        }

        let shouldBeVisible = false;
        if (isMetro && showMetro) {
          shouldBeVisible = true;
        }
        if (isTram && showTram) {
          shouldBeVisible = true;
        }
        if (isFunicular && showFunicular) {
          shouldBeVisible = true;
        }

        if (shouldBeVisible) {
          el.show();
        } else {
          el.hide();
        }
      });
    }); // End batch
  }

  toggleMetro.addEventListener('change', updateNetworkVisibility);
  toggleTram.addEventListener('change', updateNetworkVisibility);
  toggleFunicular.addEventListener('change', updateNetworkVisibility);

  // Initial call to set visibility based on default checkbox states
  updateNetworkVisibility();

  // Function to apply localized force-directed layout
  function expandRegion(hubId) {
    console.log("Expand region button clicked!"); // Debugging log
    if (!cy) {
      console.error("Cytoscape instance is not initialized."); // Debugging log
      return;
    }

    let hub = cy.getElementById(hubId);
    if (!hub || hub.length === 0) {
      console.warn(`Hub node with ID "${hubId}" not found.`); // Debugging log
      return;
    }

    let regionNodes = hub.union(hub.neighborhood('node'));
    console.log(`Number of nodes in region: ${regionNodes.length}`); // Debugging log

    const nodeRepulsionSlider = document.getElementById('nodeRepulsion');
    const nodeRepulsionValue = nodeRepulsionSlider.value;
    const idealEdgeLengthSlider = document.getElementById('idealEdgeLength');
    const idealEdgeLengthValue = idealEdgeLengthSlider.value;
    const paddingSlider = document.getElementById('padding');
    const paddingValue = paddingSlider.value;

    regionNodes.layout({
      name: 'fcose', // or cose
      fit: false, // Don't fit this small layout to the whole screen
      padding: paddingValue,
      idealEdgeLength: idealEdgeLengthValue,
      nodeRepulsion: nodeRepulsionValue,
      animate: true,
      boundingBox: hub.boundingBox() // Constrain layout to hub's bounding box
    }).run();
  }

  // Update nodeRepulsionValue span on slider input
  const nodeRepulsionSlider = document.getElementById('nodeRepulsion');
  const nodeRepulsionValueSpan = document.getElementById('nodeRepulsionValue');
  const idealEdgeLengthSlider = document.getElementById('idealEdgeLength');
  const idealEdgeLengthValueSpan = document.getElementById('idealEdgeLengthValue');
  const paddingSlider = document.getElementById('padding');
  const paddingValueSpan = document.getElementById('paddingValue');

  nodeRepulsionSlider.addEventListener('input', function() {
    nodeRepulsionValueSpan.textContent = this.value;
  });
  idealEdgeLengthSlider.addEventListener('input', function() {
    idealEdgeLengthValueSpan.textContent = this.value;
  });
  paddingSlider.addEventListener('input', function() {
    paddingValueSpan.textContent = this.value;
  });

  // Function to reset the layout
  function resetLayout() {
    console.log("Reset layout button clicked!"); // Debugging log
    if (!cy) {
      console.error("Cytoscape instance is not initialized."); // Debugging log
      return;
    }

    // Stop any running layouts
    cy.stop();
    cy.layout({
      name: 'preset',
      fit: false,
      padding: 50
    }).run();
  }

  // Get references to the buttons
  const expandRegionButton = document.getElementById('expand-region');
  const resetLayoutButton = document.getElementById('reset-layout');

  // Add event listeners to the buttons
  expandRegionButton.addEventListener('click', function() {
    console.log("Expand region button event fired."); // Debugging log
    // For now, hardcode the hub ID.  Ideally, this would come from user selection.
    expandRegion('yenikapi'); // Example hub ID - CHANGED FROM M1
  });

  resetLayoutButton.addEventListener('click', function() {
    console.log("Reset layout button event fired."); // Debugging log
    resetLayout();
  });
})
.catch(error => console.error("Error loading data:", error));