// js/modules/ui-interactions.js
import * as config from './config.js';
import * as versioning from './versioning.js';
import { generateTimestampId } from './utils.js';

let selectedNodeForLabeling = null;
let shiftSelectedAnchorNodes = []; // Stores IDs of the two anchor nodes for pathfinding
let systemData = null; // To be populated with parsed JSON data from consolidated_system_data.json

// Function to load and store system data (should be called from main.js during init)
export async function loadSystemData() {
    try {
        const response = await fetch('data/consolidated_system_data.json');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        systemData = await response.json();
        console.log("System data loaded successfully for pathfinding.");
    } catch (error) {
        console.error("Error loading consolidated_system_data.json:", error);
        systemData = null; // Ensure it's null if loading fails
    }
}

export function applyLabelPosition(node, positionKey) {
  if (!node || !node.id) return;
  const posKeyOrDefault = positionKey || 'B'; 
  const pos = config.LABEL_POSITIONS[posKeyOrDefault] || config.LABEL_POSITIONS['B']; 

  node.style({
    'text-valign': pos.valign,
    'text-halign': pos.halign,
    'text-margin-x': pos.marginX,
    'text-margin-y': pos.marginY
  });
  node.data('labelPosition', posKeyOrDefault); 
}

let layerVisibilityState = {
    metro: true,
    tram: true,
    funicular: true,
    underlay: false // Default to off
};

export function applyLayerVisibility(cyInstance) {
    if (!cyInstance) { console.warn("applyLayerVisibility called before cy was initialized."); return; }
    cyInstance.batch(function(){
        cyInstance.elements('.metro').style('display', layerVisibilityState.metro ? 'element' : 'none');
        cyInstance.elements('.tram').style('display', layerVisibilityState.tram ? 'element' : 'none');
        cyInstance.elements('.funicular').style('display', layerVisibilityState.funicular ? 'element' : 'none');
        const underlayNodeCy = cyInstance.getElementById('__underlayNode__');
        if (underlayNodeCy.length > 0) {
            underlayNodeCy.style('display', layerVisibilityState.underlay ? 'element' : 'none');
        }
    });
    console.log("Applied layer visibility (from ui-interactions.js):", layerVisibilityState);
}

export function setupLayerToggles(cyInstance) {
    const toggleMetro = document.getElementById('toggle-metro');
    const toggleTram = document.getElementById('toggle-tram');
    const toggleFunicular = document.getElementById('toggle-funicular');
    const toggleUnderlay = document.getElementById('toggle-underlay'); 

    layerVisibilityState.metro = toggleMetro ? toggleMetro.checked : true;
    layerVisibilityState.tram = toggleTram ? toggleTram.checked : true;
    layerVisibilityState.funicular = toggleFunicular ? toggleFunicular.checked : true;
    layerVisibilityState.underlay = toggleUnderlay ? toggleUnderlay.checked : true;

    if (toggleMetro) toggleMetro.addEventListener('change', function() { layerVisibilityState.metro = this.checked; applyLayerVisibility(cyInstance); });
    if (toggleTram) toggleTram.addEventListener('change', function() { layerVisibilityState.tram = this.checked; applyLayerVisibility(cyInstance); });
    if (toggleFunicular) toggleFunicular.addEventListener('change', function() { layerVisibilityState.funicular = this.checked; applyLayerVisibility(cyInstance); });
    if (toggleUnderlay) toggleUnderlay.addEventListener('change', function() { layerVisibilityState.underlay = this.checked; applyLayerVisibility(cyInstance); });
    
    applyLayerVisibility(cyInstance); // Initial call
}

export function setupCytoscapeEventListeners(mainState) {
    const { cy: cyInstance, uiElements, activeVersionIdRef, hasUnsavedChangesRef } = mainState;
    if (!cyInstance) return;

    cyInstance.on('dragfreeon', 'node', function(evt) {
      const movedNodeId = evt.target.id();
      if (movedNodeId === '__underlayNode__') return; 
      if (activeVersionIdRef.current === config.ORIGINAL_LAYOUT_ID) { 
        hasUnsavedChangesRef.current = true; 
        versioning.updateVersionUI(uiElements, activeVersionIdRef.current, hasUnsavedChangesRef.current);
      } else {
        versioning.saveVersion(activeVersionIdRef.current, versioning.getCurrentNodeLayoutData(cyInstance));
      }
      console.log(`Node ${movedNodeId} moved. Active: ${activeVersionIdRef.current}, Unsaved: ${hasUnsavedChangesRef.current}`);
    });

    cyInstance.on('tap', 'node', function(evt){
      const tappedNode = evt.target;
      const tappedNodeId = tappedNode.id();

      if (tappedNodeId === '__underlayNode__' || tappedNodeId === '__coordinateSpaceDebugRect__') {
        selectedNodeForLabeling = null;
        cyInstance.nodes().removeClass('label-editing');
        document.getElementById('station-info').textContent = tappedNodeId === '__underlayNode__' ? 'Map Underlay selected (non-editable).' : 'Coordinate Space Debug Rectangle selected (non-editable).';
        clearAllPathSelections(cyInstance);
        shiftSelectedAnchorNodes = [];
        return;
      }

      const wasTappedNodeAlreadyAnAnchor = shiftSelectedAnchorNodes.includes(tappedNodeId);

      if (evt.originalEvent.shiftKey) {
        // --- SHIFT CLICK ---
        let pathSuccessfullyFormed = false;

        if (wasTappedNodeAlreadyAnAnchor) { // Shift-clicked an existing anchor node
            const anchorIndex = shiftSelectedAnchorNodes.indexOf(tappedNodeId);
            shiftSelectedAnchorNodes.splice(anchorIndex, 1);
            tappedNode.unselect();
            clearIntermediatePathSelections(cyInstance);

            if (shiftSelectedAnchorNodes.length === 1) {
                const remainingAnchorNode = cyInstance.getElementById(shiftSelectedAnchorNodes[0]);
                if (remainingAnchorNode.length > 0) {
                    cyInstance.nodes(':selected').not(remainingAnchorNode).unselect();
                    remainingAnchorNode.select();
                    displayNodeInfo(remainingAnchorNode, "\nShift-select another station to complete path.");
                }
            } else {
                document.getElementById('station-info').textContent = 'Click a station to start, then Shift-click another.';
            }
        } else { // Shift-clicked a NEW node to potentially complete a pair or start a new selection
            if (shiftSelectedAnchorNodes.length < 2) {
                shiftSelectedAnchorNodes.push(tappedNodeId);
                // tappedNode.select(); // Select it as a new anchor
            } else { // Had 2 anchors, this new shift-click means a new primary anchor
                clearAllPathSelections(cyInstance);
                shiftSelectedAnchorNodes = [tappedNodeId];
                // tappedNode.select();
            }
            
            // If we now have two anchors, attempt path selection
            if (shiftSelectedAnchorNodes.length === 2) {
                pathSuccessfullyFormed = attemptPathSelection(cyInstance);
            } else if (shiftSelectedAnchorNodes.length === 1) {
                 // This is the first anchor, or became the only anchor.
                 // If it's the tappedNode and it's new, select it and update info.
                 if (shiftSelectedAnchorNodes[0] === tappedNodeId) {
                    cyInstance.nodes(':selected').not(tappedNode).unselect(); // Ensure only this one is selected
                    tappedNode.select();
                    displayNodeInfo(tappedNode, "\nShift-select another station to complete path.");
                 }
            }
        }
        
        // Re-enable the "unselect trick"
        if (pathSuccessfullyFormed && shiftSelectedAnchorNodes.length === 2 && shiftSelectedAnchorNodes.includes(tappedNodeId) && !wasTappedNodeAlreadyAnAnchor) {
            // This means tappedNode was the second anchor that successfully completed a path.
            // Our logic selected it as part of the path. Now unselect it so Cytoscape's default action re-selects it.
            // console.log(`DEBUG: Applying unselect trick to ${tappedNodeId}. Current selected: ${tappedNode.selected()}`);
            tappedNode.unselect();
            // console.log(`DEBUG: After unselect trick for ${tappedNodeId}. Current selected: ${tappedNode.selected()}`);
        }
        // The evt.preventDefault() and final re-select are removed as the unselect trick is the primary strategy here.

      } else {
        // --- NORMAL CLICK (NO SHIFT) ---
        clearAllPathSelections(cyInstance);
        shiftSelectedAnchorNodes = [tappedNodeId];
        
        selectedNodeForLabeling = tappedNode;
        cyInstance.nodes().forEach(n => n.removeClass('label-editing'));
        tappedNode.addClass('label-editing');
        
        tappedNode.select(); // Selects only this node (clearAllPathSelections handled others)
        displayNodeInfo(tappedNode, "\nShift-select another station to complete path.");
      }
    });

    cyInstance.on('tap', function(evt){
      if(evt.target === cyInstance){ // Click on canvas background
        if (selectedNodeForLabeling) {
            selectedNodeForLabeling.removeClass('label-editing');
            selectedNodeForLabeling = null;
        }
        document.getElementById('station-info').textContent = 'No station selected. Click a station to start.';
        
        clearAllPathSelections(cyInstance);
        shiftSelectedAnchorNodes = [];
      }
    });
}


function attemptPathSelection(cyInstance) {
    if (shiftSelectedAnchorNodes.length === 2) {
        const nodeA_id = shiftSelectedAnchorNodes[0]; // This is the first clicked anchor
        const nodeB_id = shiftSelectedAnchorNodes[1]; // This is the second clicked (shift-tapped) anchor
        let pathSuccessfullyFormedInBatch = false;

        cyInstance.batch(function(){
            const nodeA_cy = cyInstance.getElementById(nodeA_id);
            const nodeB_cy = cyInstance.getElementById(nodeB_id);
            
            if (!nodeA_cy.length) { console.error("Anchor A (first clicked) not found:", nodeA_id); return; }
            if (!nodeB_cy.length) { console.error("Anchor B (second clicked) not found:", nodeB_id); return; }

            // Ensure only these two anchors are selected before pathfinding
            nodeA_cy.select();
            nodeB_cy.select();
            let currentAnchorsCollection = cyInstance.collection().union(nodeA_cy).union(nodeB_cy);
            cyInstance.nodes(':selected').not(currentAnchorsCollection).unselect();

            // Pass the click order to findAndSelectPath
            pathSuccessfullyFormedInBatch = findAndSelectPath(
                nodeA_id, // First anchor for path segment
                nodeB_id, // Second anchor for path segment
                systemData.lines,
                cyInstance,
                nodeA_id, // Explicitly first clicked
                nodeB_id  // Explicitly second clicked
            );

            if (pathSuccessfullyFormedInBatch) {
                // findAndSelectPath selected the whole path including anchors.
                // Re-assert selection of anchors here to be absolutely sure.
                nodeA_cy.select();
                nodeB_cy.select();
            } else {
                // Pathfinding failed, revert to 1 anchor (the first clicked one: nodeA_id)
                if (nodeB_cy.length > 0) nodeB_cy.unselect(); // Unselect the second, failed anchor
                
                shiftSelectedAnchorNodes = [nodeA_id]; // Keep only the first anchor's ID
                
                if (nodeA_cy.length > 0) { // nodeA_cy is firstAnchorNodeCy
                    nodeA_cy.select();
                    displayNodeInfo(nodeA_cy, "\nNo direct path to the last station. Shift-select another.");
                } else {
                     document.getElementById('station-info').textContent = 'Error: First anchor not found after path failure.';
                     shiftSelectedAnchorNodes = [];
                }
            }
        });
        return pathSuccessfullyFormedInBatch; // Return status from batch
    }
    return false; // Default if not 2 anchors
}

function displayNodeInfo(node, messageSuffix = '') {
  if (!node || node.id() === '__underlayNode__' || node.id() === '__coordinateSpaceDebugRect__') {
    let baseMessage = 'No station selected.';
    if (node) {
        baseMessage = node.id() === '__underlayNode__' ? 'Map Underlay selected (non-editable).' : 'Coordinate Space Debug Rectangle selected (non-editable).';
    }
    document.getElementById('station-info').textContent = baseMessage + messageSuffix;
    return;
  }
  let types = [];
  if (node.hasClass('metro')) types.push('Metro');
  if (node.hasClass('tram')) types.push('Tram');
  if (node.hasClass('funicular')) types.push('Funicular');
  const typeInfo = types.length > 0 ? types.join('/') : 'N/A';
  let stationInfoContent =
    `ID: ${node.id()}\nName: ${node.data('name') || node.id()}\nType: ${typeInfo}\n` +
    `Lines: ${(node.data('lines') || []).join(', ')}\nNotes: ${node.data('notes') || ''}\n` +
    `Pos: x: ${node.position().x.toFixed(2)}, y: ${node.position().y.toFixed(2)}\n` +
    `Label: ${node.data('labelPosition') || 'B (Default)'}`;
  document.getElementById('station-info').textContent = stationInfoContent + messageSuffix;
}

function clearIntermediatePathSelections(cyInstance) {
    let nodesToKeepSelected = cyInstance.collection(); // Create an empty collection
    shiftSelectedAnchorNodes.forEach(id => {
        const node = cyInstance.getElementById(id);
        if (node.length > 0) {
            nodesToKeepSelected = nodesToKeepSelected.union(node); // Add each anchor node's collection to the main one
        }
    });
    cyInstance.nodes(':selected').not(nodesToKeepSelected).unselect();
}

function clearAllPathSelections(cyInstance) {
    cyInstance.nodes(':selected').unselect();
}


// Removed handleShiftClick as its logic is integrated into the main tap listener and attemptPathSelection


function findAndSelectPath(anchor1_id, anchor2_id, allLinesData, cy, userClickedFirst_id, userClickedSecond_id) {
    // anchor1_id, anchor2_id are the two nodes for path segment calculation.
    // userClickedFirst_id, userClickedSecond_id maintain the actual click order for display.
    console.log(`Pathfinding between: ${anchor1_id} and ${anchor2_id}. User click order: ${userClickedFirst_id} then ${userClickedSecond_id}`);
    
    const userClickedFirstName = cy.getElementById(userClickedFirst_id).data('name') || userClickedFirst_id;
    const userClickedSecondName = cy.getElementById(userClickedSecond_id).data('name') || userClickedSecond_id;

    let commonLineSegments = [];

    for (const line of allLinesData) {
        const lineId = line.id;
        const mainStations = line.stations || [];
        const indexA_main = mainStations.indexOf(anchor1_id); // Use anchor1_id for segment calculation
        const indexB_main = mainStations.indexOf(anchor2_id); // Use anchor2_id for segment calculation

        if (indexA_main > -1 && indexB_main > -1) {
            commonLineSegments.push({
                lineId: lineId, segmentName: 'main', stations: mainStations,
                indexA: indexA_main, indexB: indexB_main,
                distance: Math.abs(indexA_main - indexB_main)
            });
        }

        if (line.branches) {
            for (const branchKey in line.branches) {
                const branchStations = line.branches[branchKey] || [];
                const indexA_branch = branchStations.indexOf(anchor1_id); // Use anchor1_id
                const indexB_branch = branchStations.indexOf(anchor2_id); // Use anchor2_id

                if (indexA_branch > -1 && indexB_branch > -1) {
                    commonLineSegments.push({
                        lineId: lineId, segmentName: `branch-${branchKey}`, stations: branchStations,
                        indexA: indexA_branch, indexB: indexB_branch,
                        distance: Math.abs(indexA_branch - indexB_branch)
                    });
                }
            }
        }
    }
    
    if (commonLineSegments.length === 0) {
        console.log(`No common line segment found between ${userClickedFirst_id} and ${userClickedSecond_id}.`);
        document.getElementById('station-info').textContent = `Anchors: ${userClickedFirstName}, ${userClickedSecondName}.\nNo direct path found between them.`;
        return false;
    }

    // Sort by shortest distance first
    commonLineSegments.sort((a, b) => a.distance - b.distance);
    const bestSegment = commonLineSegments[0];

    console.log(`Shortest path found on line ${bestSegment.lineId} (segment: ${bestSegment.segmentName}), distance: ${bestSegment.distance}`);

    const stationsToSelectOnPath = bestSegment.stations.slice(
        Math.min(bestSegment.indexA, bestSegment.indexB),
        Math.max(bestSegment.indexA, bestSegment.indexB) + 1
    );

    console.log("Selecting intermediate stations:", stationsToSelectOnPath);

    let nodesInPathCollection = cy.collection();
    stationsToSelectOnPath.forEach(stationId => {
        const node = cy.getElementById(stationId);
        if (node && node.length > 0) {
            nodesInPathCollection = nodesInPathCollection.union(node);
        } else {
            console.warn(`Node with ID ${stationId} not found in Cytoscape graph for path selection.`);
        }
    });

    if (nodesInPathCollection.length > 0) {
        nodesInPathCollection.select();
        // console.log("Applied .select() to collection of nodes:", nodesInPathCollection.map(n => n.id()));
    }

    // Diagnostic logging: Check selected state immediately after collection select
    if (nodesInPathCollection.length > 0) {
        console.log("Diagnostic: After collection.select(), checking individual selected states:");
        nodesInPathCollection.forEach(n => {
            console.log(`Node ${n.id()}: selected = ${n.selected()}`);
        });
    }

    // Update station-info with the path details
    let displayPathNodeNames = stationsToSelectOnPath.map(id => {
        const node = cy.getElementById(id);
        return (node && node.length > 0 && node.data('name')) ? node.data('name') : id;
    });

    // Check if the user's click order is reverse to the natural line order
    // Use userClickedFirstName and userClickedSecondName for this check
    const firstClickedIndexInDisplayPath = displayPathNodeNames.indexOf(userClickedFirstName);
    const secondClickedIndexInDisplayPath = displayPathNodeNames.indexOf(userClickedSecondName);

    if (firstClickedIndexInDisplayPath > -1 && secondClickedIndexInDisplayPath > -1 && firstClickedIndexInDisplayPath > secondClickedIndexInDisplayPath) {
        displayPathNodeNames.reverse();
    }
    
    let pathInfoText = "";
    if (displayPathNodeNames.length > 0) {
        const startNodeNameDisplay = displayPathNodeNames[0];
        const endNodeNameDisplay = displayPathNodeNames[displayPathNodeNames.length - 1];
        
        pathInfoText = `Path selected on Line ${bestSegment.lineId}:\n${startNodeNameDisplay}`;
        
        if (displayPathNodeNames.length > 2) {
            const intermediateNames = displayPathNodeNames.slice(1, -1).join(' → ');
            pathInfoText += ` → ${intermediateNames} → ${endNodeNameDisplay}`;
        } else if (displayPathNodeNames.length === 2 && startNodeNameDisplay !== endNodeNameDisplay) {
            pathInfoText += ` → ${endNodeNameDisplay}`;
        }
    } else {
        pathInfoText = "Error: Path found but no nodes to display.";
    }
    document.getElementById('station-info').textContent = pathInfoText;
    return true; // Indicate path found and selected
}

export function setupGlobalEventListeners(mainState) {
    const { cy: cyInstance, uiElements, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc } = mainState;

    document.addEventListener('keydown', function(event) {
      if (!selectedNodeForLabeling || selectedNodeForLabeling.id() === '__underlayNode__') return;
      const keyMap = { 'W': 'T', 'A': 'L', 'S': 'B', 'D': 'R', 'Q': 'TL', 'E': 'TR', 'Z': 'BL', 'C': 'BR', 'X': 'C' };
      const key = event.key.toUpperCase(); const newPosKey = keyMap[key];
      if (newPosKey && config.LABEL_POSITIONS[newPosKey]) { 
        applyLabelPositionFunc(selectedNodeForLabeling, newPosKey);
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
        if (activeVersionIdRef.current !== config.ORIGINAL_LAYOUT_ID) { 
          versioning.saveVersion(activeVersionIdRef.current, versioning.getCurrentNodeLayoutData(cyInstance));
        } else {
          hasUnsavedChangesRef.current = true; 
          versioning.updateVersionUI(uiElements, activeVersionIdRef.current, hasUnsavedChangesRef.current);
        }
        console.log(`Label for ${selectedNodeForLabeling.id()} to ${newPosKey}. Active: ${activeVersionIdRef.current}, Unsaved: ${hasUnsavedChangesRef.current}`);
      }
    });
}

export function initializeVersioningControlsDOM(mainState) {
    console.log("TRACE: initializeVersioningControlsDOM (from ui-interactions.js) called");
    const { uiElements, cy: cyInstance, activeVersionIdRef, hasUnsavedChangesRef, originalLayoutDataRef, applyLabelPositionFunc } = mainState;

    uiElements.versionSelect = document.getElementById('version-select');
    uiElements.versionSelectContainer = document.getElementById('version-select-container');
    uiElements.changesMadeIndicator = document.getElementById('changes-made-indicator');
    uiElements.saveBtn = document.getElementById('save-btn');
    uiElements.newVersionBtn = document.getElementById('new-version-btn');
    uiElements.resetLayoutBtn = document.getElementById('reset-layout-btn');
    uiElements.exportLayoutBtn = document.getElementById('export-layout-btn');
    uiElements.importLayoutFile = document.getElementById('import-layout-file');
    uiElements.importLayoutBtn = document.getElementById('import-layout-btn');
    uiElements.destroyAllBtn = document.getElementById('destroy-all-btn');

    const { versionSelect, saveBtn, newVersionBtn, resetLayoutBtn, exportLayoutBtn, importLayoutBtn, importLayoutFile, destroyAllBtn } = uiElements;

    if (!versionSelect || !saveBtn || !newVersionBtn || !resetLayoutBtn || !exportLayoutBtn || !importLayoutBtn || !destroyAllBtn) {
        console.error("One or more versioning DOM elements are missing!"); return;
    }

    versionSelect.addEventListener('change', (event) => versioning.loadVersionById(
        cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements, event.target.value
    ));
    
    saveBtn.addEventListener('click', () => {
      if (activeVersionIdRef.current === config.ORIGINAL_LAYOUT_ID && hasUnsavedChangesRef.current) {
        const newId = generateTimestampId(); 
        versioning.saveVersion(newId, versioning.getCurrentNodeLayoutData(cyInstance));
        activeVersionIdRef.current = newId; 
        hasUnsavedChangesRef.current = false; 
        versioning.updateVersionUI(uiElements, activeVersionIdRef.current, hasUnsavedChangesRef.current);
        console.log('Changes saved as new unified version:', newId);
      }
    });

    newVersionBtn.addEventListener('click', () => {
      const newId = generateTimestampId(); 
      versioning.saveVersion(newId, versioning.getCurrentNodeLayoutData(cyInstance));
      activeVersionIdRef.current = newId; 
      hasUnsavedChangesRef.current = false; 
      versioning.updateVersionUI(uiElements, activeVersionIdRef.current, hasUnsavedChangesRef.current);
      console.log('New unified version created from current state:', newId);
    });

    resetLayoutBtn.addEventListener('click', () => versioning.loadOriginalLayout(
        cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements
    ));
    
    destroyAllBtn.addEventListener('click', () => {
      if (confirm('Are you sure you want to delete ALL saved unified layout versions? This cannot be undone.')) {
        localStorage.removeItem(config.SAVED_VERSIONS_KEY); 
        originalLayoutDataRef.current = {}; 
        versioning.loadOriginalLayout(
            cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements
        ); 
        console.log('All saved unified versions destroyed.');
      }
    });

    exportLayoutBtn.addEventListener('click', () => versioning.exportCurrentVersionToFile(activeVersionIdRef.current, originalLayoutDataRef.current));
    
    if(importLayoutBtn && importLayoutFile) {
        importLayoutBtn.addEventListener('click', () => importLayoutFile.click());
    }
    importLayoutFile.addEventListener('change', (event) => versioning.importLayoutAsNewVersion(
        event, cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements
    ));
}