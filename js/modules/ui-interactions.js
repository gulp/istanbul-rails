// js/modules/ui-interactions.js
import * as config from './config.js';
import * as versioning from './versioning.js';
import { generateTimestampId } from './utils.js';

let selectedNodeForLabeling = null;

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
      const node = evt.target;
      if (node.id() === '__underlayNode__') {
        selectedNodeForLabeling = null;
        cyInstance.nodes().removeClass('label-editing');
        document.getElementById('station-info').textContent = 'Map Underlay selected (non-editable).';
        return;
      }
      // Also ignore taps on the coordinate space debug rectangle
      if (node.id() === '__coordinateSpaceDebugRect__') {
        selectedNodeForLabeling = null;
        cyInstance.nodes().removeClass('label-editing');
        document.getElementById('station-info').textContent = 'Coordinate Space Debug Rectangle selected (non-editable).';
        return;
      }
      selectedNodeForLabeling = node;
      cyInstance.nodes().removeClass('label-editing'); selectedNodeForLabeling.addClass('label-editing');
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

    cyInstance.on('tap', function(evt){
      if(evt.target === cyInstance){ 
        if (selectedNodeForLabeling) selectedNodeForLabeling.removeClass('label-editing');
        selectedNodeForLabeling = null;
        document.getElementById('station-info').textContent = 'No station selected.';
      }
    });
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