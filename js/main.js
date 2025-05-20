// No need to register fcose if only using preset, but doesn't hurt
// You WILL need it if you want to use it for the unpositioned nodes.
// So, if you uncomment fcose usage below, uncomment this too:
// cytoscape.use(cytoscapeFcose);

// STEP 1: Load ALL Data
let metroData = {};
let tramData = {};
let figmaCoordinates = {};
let globalLineColors = {};

// --- START LABEL POSITIONING ---
const LABEL_POSITIONS = {
  'T':  { valign: 'top',    halign: 'center', marginX: 0,  marginY: -12 },
  'TR': { valign: 'top',    halign: 'right',  marginX: 8,  marginY: -8  },
  'R':  { valign: 'center', halign: 'right',  marginX: 12, marginY: 0   },
  'BR': { valign: 'bottom', halign: 'right',  marginX: 8,  marginY: 8   },
  'B':  { valign: 'bottom', halign: 'center', marginX: 0,  marginY: 12  },
  'BL': { valign: 'bottom', halign: 'left',   marginX: -8, marginY: 8   },
  'L':  { valign: 'center', halign: 'left',   marginX: -12,marginY: 0   },
  'TL': { valign: 'top',    halign: 'left',   marginX: -8, marginY: -8  },
  'C':  { valign: 'center', halign: 'center', marginX: 0,  marginY: 0   }
};
const LABEL_POSITION_KEYS = Object.keys(LABEL_POSITIONS); // ['T', 'TR', ...]
let stationLabelPositions = {}; // { stationId: 'TR' }
let selectedNodeForLabeling = null;

function applyLabelPosition(node, positionKey) {
  const pos = LABEL_POSITIONS[positionKey] || LABEL_POSITIONS['C']; // Default to Center if key is invalid
  node.style({
    'text-valign': pos.valign,
    'text-halign': pos.halign,
    'text-margin-x': pos.marginX,
    'text-margin-y': pos.marginY
  });
  node.data('labelPosition', positionKey); // Store the key on the node
  stationLabelPositions[node.id()] = positionKey; // Update our external tracking
}
// --- END LABEL POSITIONING ---
 
const RECT_WIDTH = 8;
const RECT_HEIGHT = 8;
 
let allElements = [];
let cy; // Declare cy here to be accessible in createElementsFromDataset if needed for merging
 
// --- START VERSIONING SYSTEM ---
const SAVED_VERSIONS_KEY = 'cytoscapeSavedLayoutVersions';
const ORIGINAL_LAYOUT_ID = 'original'; // Identifier for the initial/default layout
let originalNodePositions = {}; // To store the very first layout
let activeVersionId = ORIGINAL_LAYOUT_ID; // Can be ORIGINAL_LAYOUT_ID or a timestamp
let hasUnsavedChanges = false; // True if original layout is modified but not saved as a new version

// DOM Elements for versioning
let versionSelect, versionSelectContainer, changesMadeIndicator, saveBtn, newVersionBtn, resetLayoutBtn, exportLayoutBtn, importLayoutFile, importLayoutBtn, destroyAllBtn; // Added versionSelectContainer

// Helper to get current positions from Cytoscape
function getCurrentNodePositions() {
  if (!cy) return {};
  const positions = {};
  cy.nodes().forEach(node => {
    positions[node.id()] = node.position();
  });
  return positions;
}

// Get all saved versions from LocalStorage
function getSavedVersions() {
  const versions = localStorage.getItem(SAVED_VERSIONS_KEY);
  return versions ? JSON.parse(versions) : {};
}

// Save a version to LocalStorage
function saveVersion(id, positions) {
  const versions = getSavedVersions();
  versions[id] = positions;
  localStorage.setItem(SAVED_VERSIONS_KEY, JSON.stringify(versions));
  console.log(`Version '${id}' saved.`);
}

// Generate a new timestamp-based ID
function generateTimestampId() {
  return `layout_${new Date().toISOString()}`;
}

// Apply positions to the graph
function applyPositionsToGraph(positions) {
  if (!cy || !positions) return;
  cy.batch(function() {
    for (const nodeId in positions) {
      const node = cy.getElementById(nodeId);
      if (node.length > 0) {
        node.position(positions[nodeId]);
      }
    }
  });
  cy.animate({ fit: { padding: 50 } }, { duration: 300 });
}

// Update UI elements (dropdown, buttons, indicator)
function updateVersionUI() {
  // Ensure all necessary DOM elements are available
  if (!versionSelect || !versionSelectContainer || !changesMadeIndicator || !saveBtn || !newVersionBtn || !resetLayoutBtn) {
    console.warn("Versioning UI elements not yet initialized. Required elements: versionSelect, versionSelectContainer, changesMadeIndicator, saveBtn, newVersionBtn, resetLayoutBtn.");
    return;
  }

  const savedVersions = getSavedVersions();

  // Ensure the version selection dropdown container is always visible
  if (versionSelectContainer) { // Check if the container element exists
    versionSelectContainer.style.display = 'block'; // Or 'initial', 'flex' etc. depending on its default CSS
  }
    
  // Populate dropdown
  versionSelect.innerHTML = ''; // Clear previous options

  // Add the "Original" option first
  const selectOption = document.createElement('option');
  selectOption.value = ORIGINAL_LAYOUT_ID; // Use ORIGINAL_LAYOUT_ID as its value
  selectOption.textContent = 'Original';
  versionSelect.appendChild(selectOption);

  // Add saved versions
  Object.keys(savedVersions).sort().reverse().forEach(id => { // Show newest first
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id.replace('layout_', '').replace('T', ' ').substring(0, 19); // Make it more readable
    versionSelect.appendChild(option);
  });

  // Set selected value in dropdown
  if (activeVersionId === ORIGINAL_LAYOUT_ID) {
    versionSelect.value = ORIGINAL_LAYOUT_ID; // Select "Original"
  } else if (savedVersions[activeVersionId]) {
    versionSelect.value = activeVersionId; // Select the active saved version
  } else {
    // Active version ID is not original and not in saved versions (e.g., was deleted)
    // Default to selecting "Original"
    versionSelect.value = ORIGINAL_LAYOUT_ID;
  }

  // "Changes made" indicator and "Save" button (for original layout modifications)
  if (activeVersionId === ORIGINAL_LAYOUT_ID && hasUnsavedChanges) {
    changesMadeIndicator.style.display = 'inline';
    saveBtn.style.display = 'inline-block';
  } else {
    changesMadeIndicator.style.display = 'none';
    saveBtn.style.display = 'none';
  }

  // "New Version from Current" button visibility
  if (newVersionBtn) {
    if (activeVersionId === ORIGINAL_LAYOUT_ID) {
      newVersionBtn.style.display = 'none'; // Hide if original layout is active (initial state or after reset)
    } else {
      // Active version is a saved one
      newVersionBtn.style.display = 'inline-block'; // Show if a saved version is loaded
    }
  }

  // "Reset" button visibility
  if (resetLayoutBtn) { // Ensure the button exists
    if (activeVersionId === ORIGINAL_LAYOUT_ID && !hasUnsavedChanges) {
      resetLayoutBtn.style.display = 'none'; // Hide if original is active and no changes
    } else {
      resetLayoutBtn.style.display = 'inline-block'; // Show if a saved version is loaded, or if original has changes
    }
  }
}


// Load the original (initial) layout
function loadOriginalLayout() {
  console.log("Loading original layout (applying Figma coordinates and initial positions).");
  if (!cy) {
    console.error("Cytoscape instance not available for loading original layout.");
    return;
  }

  cy.batch(() => {
    cy.nodes().forEach(node => {
      const nodeId = node.id();
      const figmaX = node.data('figmaX');
      const figmaY = node.data('figmaY');
      const hasFigmaCoord = node.data('hasFigmaCoord');

      console.log(`RESET TRACE: Node ${nodeId}, hasFigmaCoord: ${hasFigmaCoord}, figmaX: ${figmaX}, figmaY: ${figmaY}`);

      if (hasFigmaCoord && typeof figmaX === 'number' && typeof figmaY === 'number') {
        const newPos = { x: figmaX, y: figmaY };
        console.log(`RESET TRACE: Node ${nodeId} applying Figma position:`, newPos);
        node.position(newPos);
      } else if (originalNodePositions && originalNodePositions[nodeId]) {
        const originalPos = originalNodePositions[nodeId];
        console.log(`RESET TRACE: Node ${nodeId} applying original captured position:`, originalPos);
        node.position(originalPos);
      } else {
        console.log(`RESET TRACE: Node ${nodeId} has no Figma coords and no original position stored. Skipping.`);
      }
    });
  });

  // activeVersionId and hasUnsavedChanges are critical for versioning UI
  activeVersionId = ORIGINAL_LAYOUT_ID;
  hasUnsavedChanges = false;
  updateVersionUI();
}

// Load a specific saved version by its ID (timestamp)
function loadVersionById(versionId) {
  if (versionId === ORIGINAL_LAYOUT_ID) {
    loadOriginalLayout();
    return;
  }
  const savedVersions = getSavedVersions();
  if (savedVersions[versionId]) {
    console.log(`Loading version: ${versionId}`);
    applyPositionsToGraph(savedVersions[versionId]);
    activeVersionId = versionId;
    hasUnsavedChanges = false; // A loaded version is considered "saved"
    updateVersionUI();
  } else {
    console.warn(`Version ${versionId} not found. Loading original.`);
    loadOriginalLayout();
  }
}

// --- END VERSIONING SYSTEM ---

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
          figmaX: hasFigma ? figmaCoordinates[stationId].x + RECT_WIDTH / 2 : undefined, // Store adjusted X
          figmaY: hasFigma ? figmaCoordinates[stationId].y + RECT_HEIGHT / 2 : undefined, // Store adjusted Y
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
          existingNode.data('isInterchange', (existingNode.data('lines') && existingNode.data('lines').length > 1) || (existingNode.data('transfers') && existingNode.data('transfers').length > 0) );
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
  fetch('../data/colors.json').then(response => response.json()),
  fetch('../data/label_pos.json') // Load label positions
    .then(response => response.ok ? response.json() : {})
    .catch(() => ({}))
])
.then(([metroJson, tramJson, funicularJson, figmaCoordsData, colorsJson, labelPosData]) => { // Added labelPosData
  stationLabelPositions = labelPosData || {}; // Initialize with loaded data
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
          'font-size': '10px',
          // 'text-valign': 'bottom', // Default valign, will be overridden by applyLabelPosition
          // 'text-halign': 'center', // Default halign, will be overridden by applyLabelPosition
          // 'text-margin-y': '3px', // Default margin, will be overridden by applyLabelPosition
          'width': '8px', 'height': '8px',
          'border-width': 1, 'border-color': '#555'
      }},
      { selector: 'node.label-editing', style: { // Added from feedback for visual cue
          'border-color': '#f90',
          'border-width': '3px'
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
 
  // Apply initial label positions from label_pos.json or default
  cy.nodes().forEach(node => {
    const posKey = stationLabelPositions[node.id()];
    applyLabelPosition(node, posKey || 'B'); // Default to Bottom
  });

  // Initialize Versioning UI elements (called after DOM is ready)
  function initializeVersioningControls() {
    console.log("TRACE: initializeVersioningControls called"); // New log
    versionSelect = document.getElementById('version-select');
    versionSelectContainer = document.getElementById('version-select-container'); // Initialize the container
    changesMadeIndicator = document.getElementById('changes-made-indicator');
    saveBtn = document.getElementById('save-btn');
    newVersionBtn = document.getElementById('new-version-btn');
    resetLayoutBtn = document.getElementById('reset-layout-btn');
    exportLayoutBtn = document.getElementById('export-layout-btn');
    importLayoutFile = document.getElementById('import-layout-file');
    importLayoutBtn = document.getElementById('import-layout-btn');
    destroyAllBtn = document.getElementById('destroy-all-btn');

    // Event Listeners for Versioning
    versionSelect.addEventListener('change', (event) => {
      loadVersionById(event.target.value);
    });

    saveBtn.addEventListener('click', () => {
      if (activeVersionId === ORIGINAL_LAYOUT_ID && hasUnsavedChanges) {
        const newId = generateTimestampId();
        saveVersion(newId, getCurrentNodePositions());
        activeVersionId = newId;
        hasUnsavedChanges = false;
        updateVersionUI(); // This will also select the new version in dropdown
        console.log('Changes saved as new version:', newId);
      }
    });

    newVersionBtn.addEventListener('click', () => {
      const newId = generateTimestampId();
      saveVersion(newId, getCurrentNodePositions());
      activeVersionId = newId;
      hasUnsavedChanges = false; // New version is inherently "saved"
      updateVersionUI();
      console.log('New version created from current state:', newId);
    });

    resetLayoutBtn.addEventListener('click', () => {
      loadOriginalLayout(); // This handles UI update and flags
    });
    
    destroyAllBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to delete ALL saved layout versions? This cannot be undone.')) {
        localStorage.removeItem(SAVED_VERSIONS_KEY);
        loadOriginalLayout(); // Revert to original and update UI
        console.log('All saved versions destroyed.');
      }
    });

    // Wire up Export and Import buttons
    if (exportLayoutBtn) {
      exportLayoutBtn.addEventListener('click', exportCurrentVersionToFile);
    }
    if (importLayoutBtn && importLayoutFile) {
      importLayoutBtn.addEventListener('click', () => {
          if (importLayoutFile) importLayoutFile.click();
      });
      // Ensure this event listener is also inside the function
      importLayoutFile.addEventListener('change', importLayoutAsNewVersion);
  }
} // This curly brace correctly closes initializeVersioningControls


  // Function to finalize initialization and set up versioning
  function captureAndFinalizeInitialLayout() {
    console.log("TRACE: captureAndFinalizeInitialLayout called"); // New log
    originalNodePositions = getCurrentNodePositions();
    console.log("Definitive original node positions captured. Node count:", Object.keys(originalNodePositions).length);

    // Initialize DOM elements for versioning controls AND THEIR LISTENERS
    initializeVersioningControls();

    // Set up initial UI state for versioning
    // This will set activeVersionId to ORIGINAL_LAYOUT_ID, apply original positions, and call updateVersionUI
    loadOriginalLayout();

    // Now that versioning is initialized (activeVersionId is set), setup drag listener
    cy.on('dragfreeon', 'node', function(evt) {
      if (activeVersionId === ORIGINAL_LAYOUT_ID) {
        hasUnsavedChanges = true;
        updateVersionUI(); // Show "Changes made" and "Save" button
        console.log(`Node ${evt.target.id()} moved. Original layout modified.`);
      } else {
        // Auto-save for any loaded/active saved version
        saveVersion(activeVersionId, getCurrentNodePositions());
        console.log(`Node ${evt.target.id()} moved. Version '${activeVersionId}' auto-saved.`);
      }
    });
    // --- END VERSIONING DRAG LISTENER ---

    // --- START LABEL POSITIONING EVENT LISTENERS ---
    cy.on('tap', 'node', function(evt){
      selectedNodeForLabeling = evt.target;
      cy.nodes().removeClass('label-editing'); // Clear from others
      selectedNodeForLabeling.addClass('label-editing');
      const currentPosKey = selectedNodeForLabeling.data('labelPosition');
      document.getElementById('current-label-pos-info').textContent =
        `Selected: ${selectedNodeForLabeling.data('name')} (${selectedNodeForLabeling.id()}) | Pos: ${currentPosKey || 'Default (B)'}`;
    });

    cy.on('tap', function(evt){
      if(evt.target === cy){ // Click on background
        if (selectedNodeForLabeling) {
          selectedNodeForLabeling.removeClass('label-editing');
        }
        selectedNodeForLabeling = null;
        document.getElementById('current-label-pos-info').textContent = 'None';
      }
    });

    document.addEventListener('keydown', function(event) {
      if (!selectedNodeForLabeling) return;

      const keyMap = {
        'W': 'T', 'A': 'L', 'S': 'B', 'D': 'R',
        'Q': 'TL', 'E': 'TR', 'Z': 'BL', 'C': 'BR', // Changed from your 'C' to 'X' for center
        'X': 'C' // Using X for Center as it's less likely to conflict
      };
      const key = event.key.toUpperCase();
      const newPosKey = keyMap[key];

      if (newPosKey && LABEL_POSITIONS[newPosKey]) {
        applyLabelPosition(selectedNodeForLabeling, newPosKey);
         document.getElementById('current-label-pos-info').textContent =
          `Selected: ${selectedNodeForLabeling.data('name')} (${selectedNodeForLabeling.id()}) | Pos: ${newPosKey}`;
        event.preventDefault(); // Prevent default browser actions for these keys
      }
    });

    // Save Button for Label Positions
    const saveLabelsBtn = document.getElementById('save-labels-btn');
    if (saveLabelsBtn) {
        saveLabelsBtn.addEventListener('click', function() {
            const jsonString = JSON.stringify(stationLabelPositions, null, 2);
            const blob = new Blob([jsonString], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'label_pos.json';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            alert("Label positions saved as label_pos.json!");
        });
    } else {
        console.error("Save Labels Button not found in the DOM.");
    }
    // --- END LABEL POSITIONING EVENT LISTENERS ---
  }
 
  // STEP 5: "Explode" Unpositioned Nodes
  const unpositionedNodes = cy.nodes('[!hasFigmaCoord]');
  const positionedNodes = cy.nodes('[hasFigmaCoord]');

  if (unpositionedNodes.length > 0) {
    console.log(`Found ${unpositionedNodes.length} unpositioned nodes to explode.`);
    let layoutOptions;
    let bb;
    if (positionedNodes.length > 0) {
        bb = positionedNodes.boundingBox();
    } else {
        bb = { x1: 0, y1: 0, w: cy.width() / 2, h: cy.height() / 2 };
    }
    const circleCenterX = bb.x1 + bb.w + 200;
    const circleCenterY = bb.y1 + bb.h / 2;
    layoutOptions = {
        name: 'circle',
        fit: false,
        padding: 50,
        radius: Math.max(150, unpositionedNodes.length * 10),
        startAngle: 3 / 2 * Math.PI,
        counterclockwise: false,
    };
    // Optional: fcose layout commented out as in original
    /*
    layoutOptions = {
        name: 'fcose', // or 'cose'
        idealEdgeLength: 70,
        nodeRepulsion: 10000,
        fit: false,
        padding: 50,
        animate: true,
        randomize: true,
    };
    */
    let unpositionedLayout = unpositionedNodes.layout(layoutOptions);
    unpositionedLayout.pon('layoutstop', function() {
      console.log("TRACE: 'layoutstop' event fired for unpositioned nodes."); // New log
      console.log("Unpositioned layout finished. Fitting graph.");
      console.log("TRACE: About to call cy.animate() for unpositioned nodes fit."); // New log
      cy.fit(50); // Use synchronous fit
      console.log("TRACE: Synchronous fit complete for unpositioned nodes. Calling captureAndFinalizeInitialLayout."); // Updated log
      console.log("Fit operation after unpositioned layout complete. Finalizing initialization."); // Updated log
      captureAndFinalizeInitialLayout();
    });
    unpositionedLayout.run();
  } else {
    console.log("TRACE: Entering 'else' block (no unpositioned nodes)."); // New log
    console.log("No unpositioned nodes. Fitting graph after preset.");
    console.log("TRACE: About to call cy.animate() for preset layout fit."); // New log
    cy.fit(50); // Use synchronous fit
    console.log("TRACE: Synchronous fit complete for preset layout. Calling captureAndFinalizeInitialLayout."); // Updated log
    console.log("Fit operation after preset layout complete. Finalizing initialization."); // Updated log
    captureAndFinalizeInitialLayout();
  }

  // Tap event (same as your existing code)
  cy.on('tap', 'node', function(evt){
    var node = evt.target;
    let types = [];
    if (node.hasClass('metro')) types.push('Metro');
    if (node.hasClass('tram')) types.push('Tram');
    if (node.hasClass('funicular')) types.push('Funicular');
    const typeInfo = types.length > 0 ? types.join('/') : 'N/A';
    const stationInfo = `ID: ${node.id()}<br>Name: ${node.data('name') || node.id()}<br>Type: ${typeInfo}<br>Notes: ${node.data('notes') || ''}<br>Pos: x: ${node.position().x.toFixed(2)}, y: ${node.position().y.toFixed(2)}`;
    document.getElementById('station-info').innerHTML = stationInfo; // Use innerHTML for <br>
  });
 
  // STEP 6: UI Toggles & Final Versioning Setup (Export/Import functions are still needed globally)
 
  // Export function (updated for versioning)
  function exportCurrentVersionToFile() {
    if (!cy) return;
    const positions = getCurrentNodePositions(); // Get current state
    const filename = activeVersionId === ORIGINAL_LAYOUT_ID ? 'original_layout.json' : `${activeVersionId}.json`;
    
    const jsonString = JSON.stringify(positions, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    console.log(`Version '${activeVersionId}' exported to ${filename}.`);
  }
 
  // Import function (updated for versioning - always creates a new version)
  function importLayoutAsNewVersion(event) {
    if (!cy) return;
    const file = event.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = function(e) {
        try {
          const importedPositions = JSON.parse(e.target.result);
          const newId = generateTimestampId();
          
          applyPositionsToGraph(importedPositions);
          saveVersion(newId, importedPositions);
          
          activeVersionId = newId;
          hasUnsavedChanges = false;
          updateVersionUI();
          
          console.log(`Layout imported from file and saved as new version: ${newId}`);
        } catch (err) {
          console.error('Error parsing layout file:', err);
          alert('Error parsing layout file. Please ensure it is a valid JSON file.');
        } finally {
            if(importLayoutFile) importLayoutFile.value = ''; // Reset file input
        }
      };
      reader.readAsText(file);
    }
  }
 
  // Setup UI Toggles
  const toggleMetro = document.getElementById('toggle-metro');
  const toggleTram = document.getElementById('toggle-tram');
  const toggleFunicular = document.getElementById('toggle-funicular');

  // updateNetworkVisibility function definition (unchanged)
  function updateNetworkVisibility() {
    if (!cy) return;
    const showMetro = toggleMetro.checked;
    const showTram = toggleTram.checked;
    const showFunicular = toggleFunicular.checked;
    cy.batch(function() {
      cy.elements().forEach(el => {
        const isMetro = el.hasClass('metro');
        const isTram = el.hasClass('tram');
        const isFunicular = el.hasClass('funicular');
        if (!isMetro && !isTram && !isFunicular) {
          return;
        }
        let shouldBeVisible = false;
        if (isMetro && showMetro) shouldBeVisible = true;
        if (isTram && showTram) shouldBeVisible = true;
        if (isFunicular && showFunicular) shouldBeVisible = true;
        if (shouldBeVisible) el.show();
        else el.hide();
      });
    });
  }

  toggleMetro.addEventListener('change', updateNetworkVisibility);
  toggleTram.addEventListener('change', updateNetworkVisibility);
  toggleFunicular.addEventListener('change', updateNetworkVisibility);

  updateNetworkVisibility(); // Initial call
  // The old block for --- Initialize Versioning System and UI --- (lines 605-624) is now removed
  // and its functionality integrated into captureAndFinalizeInitialLayout and the modified flow.
  // --- End Versioning System Initialization --- is now part of the flow above
  // The main .then() block closes here
})
.catch(error => console.error("Error loading data:", error));