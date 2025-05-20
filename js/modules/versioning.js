// js/modules/versioning.js
import * as config from './config.js';
import { generateTimestampId } from './utils.js';
// We'll need to pass 'cy' and 'applyLabelPosition' and UI elements to some of these functions,
// or initialize the module with them.

// State variables that might be managed by this module or passed in.
// For now, assuming they are managed externally or passed.
// let cy; (will be passed)
// let originalLayoutData = {}; (managed in main.js for now)
// let activeVersionId = config.ORIGINAL_LAYOUT_ID; (managed in main.js for now)
// let hasUnsavedChanges = false; (managed in main.js for now)
// let versionSelect, versionSelectContainer, changesMadeIndicator, saveBtn, newVersionBtn, resetLayoutBtn, exportLayoutBtn, importLayoutFile, importLayoutBtn, destroyAllBtn; (passed or queried)


export function getCurrentNodeLayoutData(cyInstance) {
  if (!cyInstance) return {};
  const layoutData = {};
  cyInstance.nodes().forEach(node => {
    if (node.id() === '__underlayNode__') return; 
    layoutData[node.id()] = {
      x: node.position().x,
      y: node.position().y,
      label_pos: node.data('labelPosition') || 'B' 
    };
  });
  return layoutData;
}

export function getSavedVersions() {
  const versions = localStorage.getItem(config.SAVED_VERSIONS_KEY);
  return versions ? JSON.parse(versions) : {};
}

export function saveVersion(id, dataToSave) {
  const versions = getSavedVersions();
  versions[id] = dataToSave;
  localStorage.setItem(config.SAVED_VERSIONS_KEY, JSON.stringify(versions));
  console.log(`Unified version '${id}' saved.`);
}

export function applyLayoutDataToGraph(cyInstance, layoutDataMap, applyLabelPositionFunc) {
  if (!cyInstance || !layoutDataMap) return;
  cyInstance.batch(function() {
    for (const nodeId in layoutDataMap) {
      if (nodeId === '__underlayNode__') continue; 
      const node = cyInstance.getElementById(nodeId);
      if (node.length > 0 && layoutDataMap[nodeId]) {
        const data = layoutDataMap[nodeId];
        if (typeof data.x === 'number' && typeof data.y === 'number') {
          node.position({ x: data.x, y: data.y });
        }
        applyLabelPositionFunc(node, data.label_pos); 
      }
    }
  });
}

export function updateVersionUI(uiElements, currentActiveVersionId, currentHasUnsavedChanges) {
  const { versionSelect, versionSelectContainer, changesMadeIndicator, saveBtn, newVersionBtn, resetLayoutBtn } = uiElements;
  if (!versionSelect || !versionSelectContainer || !changesMadeIndicator || !saveBtn || !newVersionBtn || !resetLayoutBtn) {
    console.warn("Versioning UI elements not fully provided to updateVersionUI.");
    return;
  }
  const savedVersions = getSavedVersions();
  if (versionSelectContainer) versionSelectContainer.style.display = 'block';
    
  versionSelect.innerHTML = ''; 
  const originalOpt = document.createElement('option');
  originalOpt.value = config.ORIGINAL_LAYOUT_ID;
  originalOpt.textContent = 'Original (Unified)';
  versionSelect.appendChild(originalOpt);

  Object.keys(savedVersions).sort().reverse().forEach(id => {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = id.replace('layout_', '').replace('T', ' ').substring(0, 19);
    versionSelect.appendChild(option);
  });

  versionSelect.value = savedVersions[currentActiveVersionId] ? currentActiveVersionId : config.ORIGINAL_LAYOUT_ID;
  changesMadeIndicator.style.display = (currentActiveVersionId === config.ORIGINAL_LAYOUT_ID && currentHasUnsavedChanges) ? 'inline' : 'none';
  saveBtn.style.display = (currentActiveVersionId === config.ORIGINAL_LAYOUT_ID && currentHasUnsavedChanges) ? 'inline-block' : 'none';
  newVersionBtn.style.display = (currentActiveVersionId !== config.ORIGINAL_LAYOUT_ID || Object.keys(savedVersions).length > 0 || currentHasUnsavedChanges) ? 'inline-block' : 'none';
  resetLayoutBtn.style.display = (currentActiveVersionId !== config.ORIGINAL_LAYOUT_ID || currentHasUnsavedChanges) ? 'inline-block' : 'none';
}

// loadOriginalLayout and loadVersionById will need more parameters from main.js state
// (cy, originalLayoutData, activeVersionId, hasUnsavedChanges, applyLabelPosition, uiElements)
// For now, defining them with placeholders for these dependencies.

export function loadOriginalLayout(cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements) {
  console.log("In versioning.loadOriginalLayout, cyInstance:", cyInstance); // DEBUG LOG
  console.log("Loading original unified layout (from versioning module).");
  if (!cyInstance) {
    console.error("Cytoscape instance not available for loading original layout.");
    return;
  }

  if (Object.keys(originalLayoutDataRef.current).length === 0 && cyInstance.nodes().filter(n => n.id() !== '__underlayNode__').length > 0) {
    console.log("Original unified layout data is empty. Capturing from current graph state (Figma/defaults).");
    cyInstance.nodes().forEach(node => {
      if (node.id() === '__underlayNode__') return;
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
      originalLayoutDataRef.current[nodeId] = { x: x, y: y, label_pos: node.data('labelPosition') || 'B' };
    });
    console.log("Captured initial originalLayoutData (excluding underlay):", originalLayoutDataRef.current);
  }
  
  applyLayoutDataToGraph(cyInstance, originalLayoutDataRef.current, applyLabelPositionFunc); 
  
  const underlay = cyInstance.getElementById('__underlayNode__');
  if (underlay.length > 0) {
      underlay.position({
          x: (underlay.data('imgWidth') / 2) - config.MANUAL_OFFSET_X, 
          y: (underlay.data('imgHeight') / 2) - config.MANUAL_OFFSET_Y  
      });
      applyLabelPositionFunc(underlay, underlay.data('labelPosition')); 
  }

  activeVersionIdRef.current = config.ORIGINAL_LAYOUT_ID;
  hasUnsavedChangesRef.current = false;
  updateVersionUI(uiElements, activeVersionIdRef.current, hasUnsavedChangesRef.current);
}

export function loadVersionById(cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements, versionId) {
  if (versionId === config.ORIGINAL_LAYOUT_ID) {
    loadOriginalLayout(cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements); return;
  }
  const savedVersions = getSavedVersions();
  if (savedVersions[versionId]) {
    console.log(`Loading unified version: ${versionId} (from versioning module)`);
    applyLayoutDataToGraph(cyInstance, savedVersions[versionId], applyLabelPositionFunc);
    
    const underlay = cyInstance.getElementById('__underlayNode__');
    if (underlay.length > 0) {
        underlay.position({
            x: (underlay.data('imgWidth') / 2) - config.MANUAL_OFFSET_X,
            y: (underlay.data('imgHeight') / 2) - config.MANUAL_OFFSET_Y
        });
        applyLabelPositionFunc(underlay, underlay.data('labelPosition'));
    }
    activeVersionIdRef.current = versionId;
    hasUnsavedChangesRef.current = false;
    updateVersionUI(uiElements, activeVersionIdRef.current, hasUnsavedChangesRef.current);
  } else {
    console.warn(`Unified version ${versionId} not found. Loading original.`);
    loadOriginalLayout(cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements);
  }
}

export function exportCurrentVersionToFile(currentActiveVersionId, currentOriginalLayoutData) {
  const dataToExport = currentActiveVersionId === config.ORIGINAL_LAYOUT_ID ? currentOriginalLayoutData : getSavedVersions()[currentActiveVersionId];
  if (!dataToExport) { console.error("No data to export for current version:", currentActiveVersionId); alert("Error: No data to export."); return; }
  const filename = currentActiveVersionId === config.ORIGINAL_LAYOUT_ID ? 'original_layout_unified.json' : `${currentActiveVersionId}_unified.json`;
  const jsonString = JSON.stringify(dataToExport, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
  console.log(`Version '${currentActiveVersionId}' exported to ${filename}.`);
}

export function importLayoutAsNewVersion(event, cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements) {
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
      saveVersion(newId, importedLayoutData);
      loadVersionById(cyInstance, originalLayoutDataRef, activeVersionIdRef, hasUnsavedChangesRef, applyLabelPositionFunc, uiElements, newId);
      alert(`Layout imported successfully as new version: ${newId}`);
    } catch (error) {
      console.error("Error importing layout:", error); alert(`Error importing layout: ${error.message}`);
    } finally {
      event.target.value = null; 
    }
  };
  reader.readAsText(file);
}