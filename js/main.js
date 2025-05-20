// No need to register fcose if only using preset, but doesn't hurt
// You WILL need it if you want to use it for the unpositioned nodes.
// So, if you uncomment fcose usage below, uncomment this too:
// cytoscape.use(cytoscapeFcose);

// STEP 1: Load ALL Data
let metroData = {};
let tramData = {};
let funicularData = {}; // Added for completeness
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
let selectedNodeForLabeling = null;

function applyLabelPosition(node, positionKey) {
  const posKeyOrDefault = positionKey || 'B'; 
  const pos = LABEL_POSITIONS[posKeyOrDefault] || LABEL_POSITIONS['B']; 

  node.style({
    'text-valign': pos.valign,
    'text-halign': pos.halign,
    'text-margin-x': pos.marginX,
    'text-margin-y': pos.marginY
  });
  node.data('labelPosition', posKeyOrDefault); 
}
// --- END LABEL POSITIONING ---
 
const RECT_WIDTH = 8;
const RECT_HEIGHT = 8;
 
let allElements = [];
let cy; 
 
// --- START UNIFIED VERSIONING SYSTEM ---
const SAVED_VERSIONS_KEY = 'cytoscapeUnifiedLayoutVersions'; 
const ORIGINAL_LAYOUT_ID = 'original_unified'; 
let originalLayoutData = {}; 
let activeVersionId = ORIGINAL_LAYOUT_ID;
let hasUnsavedChanges = false; 

let versionSelect, versionSelectContainer, changesMadeIndicator, saveBtn, newVersionBtn, resetLayoutBtn, exportLayoutBtn, importLayoutFile, importLayoutBtn, destroyAllBtn;

function getCurrentNodeLayoutData() {
  if (!cy) return {};
  const layoutData = {};
  cy.nodes().forEach(node => {
    layoutData[node.id()] = {
      x: node.position().x,
      y: node.position().y,
      label_pos: node.data('labelPosition') || 'B' 
    };
  });
  return layoutData;
}

function getSavedVersions() {
  const versions = localStorage.getItem(SAVED_VERSIONS_KEY);
  return versions ? JSON.parse(versions) : {};
}

function saveVersion(id, dataToSave) {
  const versions = getSavedVersions();
  versions[id] = dataToSave;
  localStorage.setItem(SAVED_VERSIONS_KEY, JSON.stringify(versions));
  console.log(`Unified version '${id}' saved.`);
}

function generateTimestampId() {
  return `layout_${new Date().toISOString()}`;
}

function applyLayoutDataToGraph(layoutDataMap) {
  if (!cy || !layoutDataMap) return;
  cy.batch(function() {
    for (const nodeId in layoutDataMap) {
      const node = cy.getElementById(nodeId);
      if (node.length > 0 && layoutDataMap[nodeId]) {
        const data = layoutDataMap[nodeId];
        if (typeof data.x === 'number' && typeof data.y === 'number') {
          node.position({ x: data.x, y: data.y });
        }
        applyLabelPosition(node, data.label_pos); 
      }
    }
  });
}

function updateVersionUI() {
  if (!versionSelect || !versionSelectContainer || !changesMadeIndicator || !saveBtn || !newVersionBtn || !resetLayoutBtn) {
    console.warn("Versioning UI elements not yet initialized.");
    return;
  }
  const savedVersions = getSavedVersions();
  if (versionSelectContainer) versionSelectContainer.style.display = 'block';
    
  versionSelect.innerHTML = ''; 
  const originalOpt = document.createElement('option');
  originalOpt.value = ORIGINAL_LAYOUT_ID;
  originalOpt.textContent = 'Original (Unified)';
  versionSelect.appendChild(originalOpt);

  Object.keys(savedVersions).sort().reverse().forEach(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id.replace('layout_', '').replace('T', ' ').substring(0, 19);
    versionSelect.appendChild(option);
  });

  versionSelect.value = savedVersions[activeVersionId] ? activeVersionId : ORIGINAL_LAYOUT_ID;
  changesMadeIndicator.style.display = (activeVersionId === ORIGINAL_LAYOUT_ID && hasUnsavedChanges) ? 'inline' : 'none';
  saveBtn.style.display = (activeVersionId === ORIGINAL_LAYOUT_ID && hasUnsavedChanges) ? 'inline-block' : 'none';
  newVersionBtn.style.display = (activeVersionId !== ORIGINAL_LAYOUT_ID || Object.keys(savedVersions).length > 0 || hasUnsavedChanges) ? 'inline-block' : 'none';
  resetLayoutBtn.style.display = (activeVersionId !== ORIGINAL_LAYOUT_ID || hasUnsavedChanges) ? 'inline-block' : 'none';
}

function loadOriginalLayout() {
  console.log("Loading original unified layout.");
  if (!cy) {
    console.error("Cytoscape instance not available for loading original layout.");
    return;
  }
  if (Object.keys(originalLayoutData).length === 0 && cy.nodes().length > 0) {
    console.log("Original unified layout data is empty. Capturing from current graph state (Figma/defaults).");
    cy.nodes().forEach(node => {
      const nodeId = node.id();
      const figmaX = node.data('figmaX');
      const figmaY = node.data('figmaY');
      const hasFigmaCoord = node.data('hasFigmaCoord');
      let x = node.position().x; 
      let y = node.position().y;
      if (hasFigmaCoord && typeof figmaX === 'number' && typeof figmaY === 'number') {
        x = figmaX; y = figmaY;
      } else if (node.scratch('_initialPosition')) { 
        x = node.scratch('_initialPosition').x; y = node.scratch('_initialPosition').y;
      }
      originalLayoutData[nodeId] = { x: x, y: y, label_pos: node.data('labelPosition') || 'B' };
    });
    console.log("Captured initial originalLayoutData:", originalLayoutData);
  } else if (Object.keys(originalLayoutData).length === 0 && cy.nodes().length === 0) {
    console.log("Original unified layout data is empty, and graph is also empty. Nothing to capture yet.");
  }
  applyLayoutDataToGraph(originalLayoutData);
  activeVersionId = ORIGINAL_LAYOUT_ID;
  hasUnsavedChanges = false;
  updateVersionUI();
}

function loadVersionById(versionId) {
  if (versionId === ORIGINAL_LAYOUT_ID) {
    loadOriginalLayout(); return;
  }
  const savedVersions = getSavedVersions();
  if (savedVersions[versionId]) {
    console.log(`Loading unified version: ${versionId}`);
    applyLayoutDataToGraph(savedVersions[versionId]);
    activeVersionId = versionId; hasUnsavedChanges = false; updateVersionUI();
  } else {
    console.warn(`Unified version ${versionId} not found. Loading original.`);
    loadOriginalLayout();
  }
}
// --- END UNIFIED VERSIONING SYSTEM ---

function createElementsFromDataset(dataset, datasetType, nodesWithFigmaCoords, existingStationIds, lineColors) {
  const elements = [];
  dataset.stations.forEach(station => {
    const stationId = station.id;
    const isNewStation = !existingStationIds.has(stationId);
    if (isNewStation) {
      const hasFigma = figmaCoordinates[stationId] !== undefined;
      if (hasFigma) nodesWithFigmaCoords.add(stationId);
      elements.push({
        group: 'nodes',
        data: {
          id: stationId, name: station.name,
          isInterchange: (station.transfers && station.transfers.length > 0) || (station.lines && station.lines.length > 1),
          figmaColor: hasFigma ? figmaCoordinates[stationId].figmaFill : undefined,
          hasFigmaCoord: hasFigma,
          figmaX: hasFigma ? figmaCoordinates[stationId].x + RECT_WIDTH / 2 : undefined,
          figmaY: hasFigma ? figmaCoordinates[stationId].y + RECT_HEIGHT / 2 : undefined,
          datasetType: datasetType, lines: station.lines || [], notes: station.notes,
          labelPosition: 'B' 
        },
        classes: datasetType,
        position: hasFigma ? { x: figmaCoordinates[stationId].x + RECT_WIDTH / 2, y: figmaCoordinates[stationId].y + RECT_HEIGHT / 2 } : undefined,
      });
      existingStationIds.add(stationId);
    } else {
      const existingNode = cy ? cy.getElementById(stationId) : null;
      if (existingNode && existingNode.length > 0) {
          let currentLines = new Set(existingNode.data('lines') || []);
          (station.lines || []).forEach(lineId => currentLines.add(lineId));
          existingNode.data('lines', Array.from(currentLines));
          if (!existingNode.hasClass(datasetType)) existingNode.addClass(datasetType);
          existingNode.data('isInterchange', (existingNode.data('lines').length > 1) || (existingNode.data('transfers') && existingNode.data('transfers').length > 0) );
      }
    }
  });
  dataset.lines.forEach(line => {
    function addEdgesForStationList(stations, branchName = null) {
      for (let i = 0; i < stations.length - 1; i++) {
        const source = stations[i]; const target = stations[i+1];
        if (existingStationIds.has(source) && existingStationIds.has(target)) {
          const colorForThisLine = (lineColors && lineColors[line.id]) || (lineColors && lineColors.DEFAULT) || '#CCCCCC';
          elements.push({
            group: 'edges',
            data: { id: `${datasetType}-${line.id}-${branchName ? branchName + '-' : ''}${source}-${target}`, source: source, target: target, lineColor: colorForThisLine, lineId: line.id, datasetType: datasetType },
            classes: datasetType
          });
        } else { console.warn(`Edge creation skipped for line ${line.id} (${datasetType}): ${source} or ${target} not in existingStationIds`); }
      }
    }
    if (line.stations && line.stations.length > 0) addEdgesForStationList(line.stations);
    if (line.branches) { for (const branch in line.branches) { if (line.branches[branch] && line.branches[branch].length > 0) addEdgesForStationList(line.branches[branch], branch); } }
  });
  return elements;
}

Promise.all([
  fetch('../data/metro_data.json').then(response => response.json()),
  fetch('../data/tram_data.json').then(response => response.json()),
  fetch('../data/funicular_data.json').then(response => response.json()),
  fetch('../data/figma_coordinates.json').then(response => response.json()),
  fetch('../data/colors.json').then(response => response.json())
])
.then(([metroJson, tramJson, funicularJsonData, figmaCoordsData, colorsJson]) => {
  metroData = metroJson; tramData = tramJson; funicularData = funicularJsonData; 
  figmaCoordinates = figmaCoordsData; globalLineColors = colorsJson.line_colors || {};
  const nodesWithFigmaCoords = new Set(); const combinedStationIds = new Set(); 
  allElements = [];
  if (metroData && metroData.stations && metroData.lines) {
    allElements = allElements.concat(createElementsFromDataset(metroData, "metro", nodesWithFigmaCoords, combinedStationIds, { ...globalLineColors, ...(metroData.line_colors || {}) }));
  }
  if (tramData && tramData.stations && tramData.lines) {
    allElements = allElements.concat(createElementsFromDataset(tramData, "tram", nodesWithFigmaCoords, combinedStationIds, { ...globalLineColors, ...(tramData.line_colors || {}) }));
  }
  if (funicularData && funicularData.stations && funicularData.lines) {
    allElements = allElements.concat(createElementsFromDataset(funicularData, "funicular", nodesWithFigmaCoords, combinedStationIds, { ...globalLineColors, ...(funicularData.line_colors || {}) }));
  }

  cy = cytoscape({
    container: document.getElementById('cy'),
    elements: allElements,
    style: [ 
      { selector: 'node', style: { 'background-color': '#888', 'label': 'data(name)', 'font-size': '10px', 'width': '8px', 'height': '8px', 'border-width': 1, 'border-color': '#555' }},
      { selector: 'node.label-editing', style: { 'border-color': '#f90', 'border-width': '3px' }},
      { selector: 'node[isInterchange="true"]', style: { 'background-color': '#fff', 'border-color': '#000', 'border-width': 1.5, 'width': '12px', 'height': '12px', 'shape': 'ellipse' }},
      { selector: 'node[?figmaColor]', style: { 'background-color': 'data(figmaColor)' }},
      { selector: 'edge', style: { 'width': 3, 'line-color': 'data(lineColor)', 'curve-style': 'bezier', 'target-arrow-shape': 'none', 'opacity': 0.7 }}
    ],
    layout: { name: 'preset', fit: false, padding: 50 },
    boxSelectionEnabled: false, userZoomingEnabled: true, userPanningEnabled: true,
  });
 
  cy.nodes().forEach(node => { applyLabelPosition(node, node.data('labelPosition') || 'B'); });
  initializeVersioningControlsDOM(); 
  setupInitialLayoutAndListeners(); 
})
.catch(error => console.error("Error loading initial data:", error));

function initializeVersioningControlsDOM() {
    console.log("TRACE: initializeVersioningControlsDOM called");
    versionSelect = document.getElementById('version-select');
    versionSelectContainer = document.getElementById('version-select-container');
    changesMadeIndicator = document.getElementById('changes-made-indicator');
    saveBtn = document.getElementById('save-btn');
    newVersionBtn = document.getElementById('new-version-btn');
    resetLayoutBtn = document.getElementById('reset-layout-btn');
    exportLayoutBtn = document.getElementById('export-layout-btn');
    importLayoutFile = document.getElementById('import-layout-file');
    importLayoutBtn = document.getElementById('import-layout-btn');
    destroyAllBtn = document.getElementById('destroy-all-btn');

    if (!versionSelect || !saveBtn || !newVersionBtn || !resetLayoutBtn || !exportLayoutBtn || !importLayoutBtn || !destroyAllBtn) {
        console.error("One or more versioning DOM elements are missing!"); return;
    }
    versionSelect.addEventListener('change', (event) => loadVersionById(event.target.value));
    saveBtn.addEventListener('click', () => {
      if (activeVersionId === ORIGINAL_LAYOUT_ID && hasUnsavedChanges) {
        const newId = generateTimestampId(); saveVersion(newId, getCurrentNodeLayoutData());
        activeVersionId = newId; hasUnsavedChanges = false; updateVersionUI();
        console.log('Changes saved as new unified version:', newId);
      }
    });
    newVersionBtn.addEventListener('click', () => {
      const newId = generateTimestampId(); saveVersion(newId, getCurrentNodeLayoutData());
      activeVersionId = newId; hasUnsavedChanges = false; updateVersionUI();
      console.log('New unified version created from current state:', newId);
    });
    resetLayoutBtn.addEventListener('click', () => loadOriginalLayout());
    destroyAllBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to delete ALL saved unified layout versions? This cannot be undone.')) {
        localStorage.removeItem(SAVED_VERSIONS_KEY); originalLayoutData = {}; 
        loadOriginalLayout(); console.log('All saved unified versions destroyed.');
      }
    });
    exportLayoutBtn.addEventListener('click', exportCurrentVersionToFile);
    importLayoutBtn.addEventListener('click', () => importLayoutFile.click());
    importLayoutFile.addEventListener('change', importLayoutAsNewVersion);
}

function setupInitialLayoutAndListeners() {
    console.log("TRACE: setupInitialLayoutAndListeners called");
    loadOriginalLayout(); 

    cy.on('dragfreeon', 'node', function(evt) {
      const movedNodeId = evt.target.id();
      if (activeVersionId === ORIGINAL_LAYOUT_ID) {
        hasUnsavedChanges = true; updateVersionUI();
      } else {
        saveVersion(activeVersionId, getCurrentNodeLayoutData());
      }
      console.log(`Node ${movedNodeId} moved. Active: ${activeVersionId}, Unsaved: ${hasUnsavedChanges}`);
    });

    cy.on('tap', 'node', function(evt){
      const node = evt.target; selectedNodeForLabeling = node; 
      cy.nodes().removeClass('label-editing'); selectedNodeForLabeling.addClass('label-editing');
      let types = [];
      if (node.hasClass('metro')) types.push('Metro');
      if (node.hasClass('tram')) types.push('Tram');
      if (node.hasClass('funicular')) types.push('Funicular');
      const typeInfo = types.length > 0 ? types.join('/') : 'N/A';
      const stationInfoContent =
        `ID: ${node.id()}\nName: ${node.data('name') || node.id()}\nType: ${typeInfo}\n` +
        `Lines: ${(node.data('lines') || []).join(', ')}\nNotes: ${node.data('notes') || ''}\n` +
        `Pos: x: ${node.position().x.toFixed(2)}, y: ${node.position().y.toFixed(2)}\n` +
        `Label: ${node.data('labelPosition') || 'B (Default)'}`;
      document.getElementById('station-info').textContent = stationInfoContent;
    });

    cy.on('tap', function(evt){
      if(evt.target === cy){ 
        if (selectedNodeForLabeling) selectedNodeForLabeling.removeClass('label-editing');
        selectedNodeForLabeling = null;
        document.getElementById('station-info').textContent = 'No station selected.';
      }
    });

    document.addEventListener('keydown', function(event) {
      if (!selectedNodeForLabeling) return;
      const keyMap = { 'W': 'T', 'A': 'L', 'S': 'B', 'D': 'R', 'Q': 'TL', 'E': 'TR', 'Z': 'BL', 'C': 'BR', 'X': 'C' };
      const key = event.key.toUpperCase(); const newPosKey = keyMap[key];
      if (newPosKey && LABEL_POSITIONS[newPosKey]) {
        applyLabelPosition(selectedNodeForLabeling, newPosKey);
        const node = selectedNodeForLabeling; 
        let types = [];
        if (node.hasClass('metro')) types.push('Metro');
        if (node.hasClass('tram')) types.push('Tram');
        if (node.hasClass('funicular')) types.push('Funicular');
        const typeInfo = types.length > 0 ? types.join('/') : 'N/A';
        const stationInfoContent =
          `ID: ${node.id()}\nName: ${node.data('name') || node.id()}\nType: ${typeInfo}\n` +
          `Lines: ${(node.data('lines') || []).join(', ')}\nNotes: ${node.data('notes') || ''}\n` +
          `Pos: x: ${node.position().x.toFixed(2)}, y: ${node.position().y.toFixed(2)}\nLabel: ${newPosKey}`;
        document.getElementById('station-info').textContent = stationInfoContent;
        event.preventDefault();
        if (activeVersionId !== ORIGINAL_LAYOUT_ID) {
          saveVersion(activeVersionId, getCurrentNodeLayoutData());
        } else {
          hasUnsavedChanges = true; updateVersionUI();
        }
        console.log(`Label for ${selectedNodeForLabeling.id()} to ${newPosKey}. Active: ${activeVersionId}, Unsaved: ${hasUnsavedChanges}`);
      }
    });
    
    // --- START REFACTORED LAYER TOGGLE WITH STATE MANAGEMENT ---
    const toggleMetro = document.getElementById('toggle-metro');
    const toggleTram = document.getElementById('toggle-tram');
    const toggleFunicular = document.getElementById('toggle-funicular');

    // Centralized state for layer visibility
    let layerVisibilityState = {
        metro: toggleMetro ? toggleMetro.checked : true, // Default to true if element not found, though it should be
        tram: toggleTram ? toggleTram.checked : true,
        funicular: toggleFunicular ? toggleFunicular.checked : true
    };

    // Function to apply visibility based on the state object
    function applyLayerVisibility() {
        if (!cy) { console.warn("applyLayerVisibility called before cy was initialized."); return; }
        cy.batch(function(){
            cy.elements('.metro').style('display', layerVisibilityState.metro ? 'element' : 'none');
            cy.elements('.tram').style('display', layerVisibilityState.tram ? 'element' : 'none');
            cy.elements('.funicular').style('display', layerVisibilityState.funicular ? 'element' : 'none');
        });
        console.log("Applied layer visibility using direct styles:", layerVisibilityState);
    }

    // Event listeners update the state and then apply it
    if (toggleMetro) {
        toggleMetro.addEventListener('change', function() {
            layerVisibilityState.metro = this.checked;
            applyLayerVisibility();
        });
    }
    if (toggleTram) {
        toggleTram.addEventListener('change', function() {
            layerVisibilityState.tram = this.checked;
            applyLayerVisibility();
        });
    }
    if (toggleFunicular) {
        toggleFunicular.addEventListener('change', function() {
            layerVisibilityState.funicular = this.checked;
            applyLayerVisibility();
        });
    }
    // Initial call to applyLayerVisibility will be done after layout promise resolves.
    // --- END REFACTORED LAYER TOGGLE ---

    const unpositionedNodes = cy.nodes('[!hasFigmaCoord]');
    const positionedNodes = cy.nodes('[hasFigmaCoord]');
    let layoutCompletePromise;

    if (unpositionedNodes.length > 0) {
        console.log(`Found ${unpositionedNodes.length} unpositioned nodes to explode.`);
        let bb;
        if (positionedNodes.length > 0) bb = positionedNodes.boundingBox();
        else bb = { x1: 0, y1: 0, w: cy.width() ? cy.width() / 2 : 400, h: cy.height() ? cy.height() / 2 : 300 };
        const radius = Math.max(150, unpositionedNodes.length * 10);
        const circleCenterX = bb.x1 + bb.w + 200 + radius; 
        const circleCenterY = bb.y1 + bb.h / 2;
        const layoutOptions = {
            name: 'circle', fit: false, padding: 50, radius: radius,
            startAngle: -Math.PI / 2, sweep: Math.PI * 1.5,
            boundingBox: { x1: circleCenterX - radius, y1: circleCenterY - radius, w: radius * 2, h: radius * 2 },
            animate: true, animationDuration: 500,
        };
        layoutCompletePromise = unpositionedNodes.layout(layoutOptions).run().promise();
    } else {
        console.log("No unpositioned nodes to explode. Fitting graph.");
        layoutCompletePromise = cy.animate({ fit: { padding: 50 } }, { duration: 300 }).promise();
    }

    layoutCompletePromise.then(() => {
        console.log("Initial layout/fit animation complete. Calling applyLayerVisibility and updateVersionUI.");
        applyLayerVisibility(); // INITIAL CALL for toggles after layout
        updateVersionUI();
    });
}

function exportCurrentVersionToFile() {
  if (!cy) return;
  const dataToExport = activeVersionId === ORIGINAL_LAYOUT_ID ? originalLayoutData : getSavedVersions()[activeVersionId];
  if (!dataToExport) { console.error("No data to export for current version:", activeVersionId); alert("Error: No data to export."); return; }
  const filename = activeVersionId === ORIGINAL_LAYOUT_ID ? 'original_layout_unified.json' : `${activeVersionId}_unified.json`;
  const jsonString = JSON.stringify(dataToExport, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  console.log(`Version '${activeVersionId}' exported to ${filename}.`);
}

function importLayoutAsNewVersion(event) {
  const file = event.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const importedLayoutData = JSON.parse(e.target.result);
      if (typeof importedLayoutData !== 'object' || importedLayoutData === null) { throw new Error("Imported file is not a valid JSON object."); }
      const firstKey = Object.keys(importedLayoutData)[0];
      if (firstKey && (typeof importedLayoutData[firstKey] !== 'object' || importedLayoutData[firstKey] === null ||
          typeof importedLayoutData[firstKey].x !== 'number' || typeof importedLayoutData[firstKey].y !== 'number' )) {
        throw new Error("Imported JSON does not follow unified station layout format (e.g., missing x/y).");
      }
      const newId = generateTimestampId() + "_imported_unified";
      saveVersion(newId, importedLayoutData); loadVersionById(newId); 
      alert(`Layout imported successfully as new version: ${newId}`);
    } catch (error) {
      console.error("Error importing layout:", error); alert(`Error importing layout: ${error.message}`);
    } finally {
      event.target.value = null; 
    }
  };
  reader.readAsText(file);
}