// js/modules/element-creators.js
import * as config from './config.js';

/**
 * Creates Cytoscape elements (nodes and edges) from a single dataset.
 * @param {object} dataset - The dataset object (e.g., metroData, tramData).
 * @param {string} datasetType - E.g., "metro", "tram", "funicular".
 * @param {object} figmaCoordinates - Object mapping station IDs to Figma coordinates.
 * @param {Set<string>} nodesWithFigmaCoords - Set to track nodes that have Figma coordinates.
 * @param {Set<string>} existingStationIds - Set to track all unique station IDs processed so far.
 * @param {object} lineColors - Line color definitions for this dataset.
 * @param {object} cyInstance - The Cytoscape instance (passed if already initialized, for merging).
 * @returns {Array<object>} Array of Cytoscape elements.
 */
export function createElementsFromDataset(dataset, datasetType, figmaCoordinates, nodesWithFigmaCoords, existingStationIds, lineColors, cyInstance) {
  const elements = [];
  if (!dataset || !dataset.stations || !dataset.lines) {
    console.warn(`Dataset for ${datasetType} is missing or malformed. Skipping.`);
    return elements;
  }

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
          figmaX: hasFigma ? figmaCoordinates[stationId].x + config.RECT_WIDTH / 2 : undefined,
          figmaY: hasFigma ? figmaCoordinates[stationId].y + config.RECT_HEIGHT / 2 : undefined,
          datasetType: datasetType, lines: station.lines || [], notes: station.notes,
          labelPosition: 'B' 
        },
        classes: datasetType,
        position: hasFigma ? { x: figmaCoordinates[stationId].x + config.RECT_WIDTH / 2, y: figmaCoordinates[stationId].y + config.RECT_HEIGHT / 2 } : undefined,
      });
      existingStationIds.add(stationId);
    } else {
      // Handle existing station (merge lines, etc.) if cyInstance is available
      if (cyInstance) {
        const existingNode = cyInstance.getElementById(stationId);
        if (existingNode && existingNode.length > 0) {
            let currentLines = new Set(existingNode.data('lines') || []);
            (station.lines || []).forEach(lineId => currentLines.add(lineId));
            existingNode.data('lines', Array.from(currentLines));
            if (!existingNode.hasClass(datasetType)) existingNode.addClass(datasetType);
            existingNode.data('isInterchange', (existingNode.data('lines').length > 1) || (existingNode.data('transfers') && existingNode.data('transfers').length > 0) );
        }
      } else {
        // This case should ideally be handled by processing all datasets before cy init,
        // or by ensuring cyInstance is passed if elements are added dynamically post-init.
        console.warn(`Station ${stationId} from ${datasetType} already processed but cyInstance not available for merging.`);
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

/**
 * Creates the underlay node element definition.
 * @returns {object} Cytoscape node definition for the underlay.
 */
export function createUnderlayNodeElement() {
  return {
      group: 'nodes',
      data: {
          id: '__underlayNode__',
          imageUrl: config.UNDERLAY_IMAGE_URL,
          imgWidth: config.IMAGE_ACTUAL_WIDTH,
          imgHeight: config.IMAGE_ACTUAL_HEIGHT,
          labelPosition: '' 
      },
      position: { 
          x: (config.IMAGE_ACTUAL_WIDTH / 2) - config.MANUAL_OFFSET_X, 
          y: (config.IMAGE_ACTUAL_HEIGHT / 2) - config.MANUAL_OFFSET_Y 
      },
      selectable: false,
      grabbable: false,
      pannable: true, 
      locked: true,   
      classes: 'underlay-node'
  };
}