import * as config from './modules/config.js';
import { generateTimestampId } from './modules/utils.js';
import { cytoscapeStylesheet } from './modules/cytoscape-styles.js';
import { createElementsFromDataset, createUnderlayNodeElement, createCoordinateSpaceDebugRectangle } from './modules/element-creators.js';
import * as versioning from './modules/versioning.js';
import * as ui from './modules/ui-interactions.js';

// STEP 1: Load ALL Data (Global variables for data)
let metroData = {};
let tramData = {};
let funicularData = {};
let metrobusData = {};
let figmaCoordinates = {};
let globalLineColors = {};

// --- Main Application State ---
const mainState = {
    cy: null, 
    originalLayoutData: {}, 
    activeVersionIdRef: { current: config.ORIGINAL_LAYOUT_ID },
    hasUnsavedChangesRef: { current: false },
    originalLayoutDataRef: { current: {} }, 
    uiElements: {
        versionSelect: null, versionSelectContainer: null, changesMadeIndicator: null,
        saveBtn: null, newVersionBtn: null, resetLayoutBtn: null,
        exportLayoutBtn: null, importLayoutFile: null, importLayoutBtn: null, destroyAllBtn: null
    },
    applyLabelPositionFunc: ui.applyLabelPosition 
};
mainState.originalLayoutDataRef.current = mainState.originalLayoutData; 

let allElements = []; 

// --- DATA FETCHING AND CYTOSCAPE INITIALIZATION ---
Promise.all([
  fetch('./data/metro_data.json').then(response => response.json()),
  fetch('./data/tram_data.json').then(response => response.json()),
  fetch('./data/funicular_data.json').then(response => response.json()),
  fetch('./data/metrobus_data.json').then(response => response.json()),
  fetch('./data/figma_coordinates.json').then(response => response.json()),
  fetch('./data/colors.json').then(response => response.json())
])
.then(([metroJson, tramJson, funicularJsonData, metrobusJsonData, figmaCoordsData, colorsJson]) => {
  metroData = metroJson; 
  tramData = tramJson; 
  funicularData = funicularJsonData; 
  metrobusData = metrobusJsonData; 
  figmaCoordinates = figmaCoordsData; 
  globalLineColors = colorsJson.line_colors || {};
  
  allElements = []; 

  try {
    console.log("Attempting to create underlay node...");
    const underlayNodeElement = createUnderlayNodeElement();
    if (underlayNodeElement) allElements.push(underlayNodeElement);
    console.log("Underlay node created and added.");

    console.log("Attempting to create coordinate space debug rectangle...");
    // Corrected variable name from previous diff attempt
    const coordDebugRectElement = createCoordinateSpaceDebugRectangle(); 
    if (coordDebugRectElement) {
      allElements.push(coordDebugRectElement);
      console.log("Coordinate space debug rectangle created and added.");
    } else {
      console.log("Coordinate space debug rectangle not created (flag likely false).");
    }

    console.log("Attempting to process datasets for elements...");
    if (metroData && metroData.stations && metroData.lines) {
      allElements = allElements.concat(createElementsFromDataset(metroData, "metro", figmaCoordinates, new Set(), new Set(), { ...globalLineColors, ...(metroData.line_colors || {}) }, null));
    }
    if (tramData && tramData.stations && tramData.lines) {
      allElements = allElements.concat(createElementsFromDataset(tramData, "tram", figmaCoordinates, new Set(), new Set(), { ...globalLineColors, ...(tramData.line_colors || {}) }, null));
    }
    if (funicularData && funicularData.stations && funicularData.lines) {
      allElements = allElements.concat(createElementsFromDataset(funicularData, "funicular", figmaCoordinates, new Set(), new Set(), { ...globalLineColors, ...(funicularData.line_colors || {}) }, null));
    }
    if (metrobusData && metrobusData.stations && metrobusData.lines) { 
      allElements = allElements.concat(createElementsFromDataset(metrobusData, "metrobus", figmaCoordinates, new Set(), new Set(), { ...globalLineColors, ...(metrobusData.line_colors || {}) }, null));
    }
    console.log("Datasets processed. Total elements:", allElements.length);

    console.log("Attempting to initialize Cytoscape...");
    mainState.cy = cytoscape({ 
      container: document.getElementById('cy'),
      elements: allElements,
      style: cytoscapeStylesheet, 
      layout: { name: 'preset', fit: false, padding: 50 },
      boxSelectionEnabled: false, userZoomingEnabled: true, userPanningEnabled: true,
    });
    console.log("Cytoscape initialized successfully.");
 
    console.log("Attempting to apply initial label positions...");
    mainState.cy.nodes().forEach(node => { 
      ui.applyLabelPosition(node, node.data('labelPosition')); 
    });
    console.log("Initial label positions applied.");

    console.log("Attempting to initialize versioning controls DOM...");
    ui.initializeVersioningControlsDOM(mainState);
    console.log("Versioning controls DOM initialized.");

    console.log("Attempting to setup initial layout and listeners...");
    setupInitialLayoutAndListeners();
    console.log("Initial layout and listeners setup complete.");

  } catch (initError) {
    console.error("Error during Cytoscape initialization sequence:", initError);
  }
})
.catch(error => console.error("Main .catch() - Error loading initial data or during setup:", error));


// --- MAIN SETUP FUNCTION ---
function setupInitialLayoutAndListeners() {
    console.log("TRACE: setupInitialLayoutAndListeners called from main.js");
    versioning.loadOriginalLayout(
        mainState.cy,
        mainState.originalLayoutDataRef,
        mainState.activeVersionIdRef,
        mainState.hasUnsavedChangesRef,
        mainState.applyLabelPositionFunc,
        mainState.uiElements
    );

    ui.setupCytoscapeEventListeners(mainState);
    ui.setupGlobalEventListeners(mainState); 
    ui.setupLayerToggles(mainState.cy); 

    const unpositionedNodes = mainState.cy.nodes('[!hasFigmaCoord]');
    const positionedNodes = mainState.cy.nodes('[hasFigmaCoord]');
    
    if (unpositionedNodes.filter(n => n.id() !== '__underlayNode__').length > 0) { 
        console.log(`Found ${unpositionedNodes.filter(n => n.id() !== '__underlayNode__').length} unpositioned nodes to explode.`);
        let bb;
        if (positionedNodes.filter(n => n.id() !== '__underlayNode__').length > 0) bb = positionedNodes.filter(n => n.id() !== '__underlayNode__').boundingBox();
        else bb = { x1: 0, y1: 0, w: mainState.cy.width() ? mainState.cy.width() / 2 : 400, h: mainState.cy.height() ? mainState.cy.height() / 2 : 300 };
        const radius = Math.max(150, unpositionedNodes.filter(n => n.id() !== '__underlayNode__').length * 10);
        const circleCenterX = bb.x1 + bb.w + 200 + radius; 
        const circleCenterY = bb.y1 + bb.h / 2;
        const layoutOptions = {
            name: 'circle', fit: false, padding: 50, radius: radius,
            startAngle: -Math.PI / 2, sweep: Math.PI * 1.5,
            boundingBox: { x1: circleCenterX - radius, y1: circleCenterY - radius, w: radius * 2, h: radius * 2 },
            animate: true, animationDuration: 500,
            stop: function() {
                console.log("Explode layout stopped. Fitting graph and then calling final setup.");
                mainState.cy.animate({ fit: { padding: 50 } }, { duration: 300 }); 
                console.log("Calling applyLayerVisibility and updateVersionUI after explode layout stop.");
                ui.applyLayerVisibility(mainState.cy); 
                versioning.updateVersionUI(mainState.uiElements, mainState.activeVersionIdRef.current, mainState.hasUnsavedChangesRef.current);
            }
        };
        unpositionedNodes.filter(n => n.id() !== '__underlayNode__').layout(layoutOptions).run(); 
    } else {
        console.log("No unpositioned nodes to explode (or only underlay node). Fitting graph.");
        mainState.cy.animate(
            { fit: { padding: 50 } },
            { 
                duration: 300,
                complete: function() { 
                    console.log("Initial fit animation complete. Calling applyLayerVisibility and updateVersionUI.");
                    ui.applyLayerVisibility(mainState.cy);
                    versioning.updateVersionUI(mainState.uiElements, mainState.activeVersionIdRef.current, mainState.hasUnsavedChangesRef.current);
                }
            }
        );
    }
}