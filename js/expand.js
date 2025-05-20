document.addEventListener('DOMContentLoaded', function () {
    const cy = cytoscape({
        container: document.getElementById('cy'),
        style: [
            {
                selector: 'node',
                style: {
                    'label': 'data(name)',
                    'width': 'mapData(population, 0, 200, 20, 60)',
                    'height': 'mapData(population, 0, 200, 20, 60)',
                    'background-color': 'data(color)',
                    'border-width': 2,
                    'border-color': '#000',
                    'font-size': '10px',
                    'text-valign': 'bottom',
                    'text-halign': 'center',
                    'text-margin-y': 5
                }
            },
            {
                selector: 'edge',
                style: {
                    'width': 3,
                    'line-color': 'data(color)',
                    'curve-style': 'bezier',
                    'target-arrow-shape': 'none'
                }
            },
            {
                selector: '.highlighted',
                style: {
                    'background-color': '#FFD700', // Gold
                    'line-color': '#FFD700',
                    'target-arrow-color': '#FFD700',
                    'transition-property': 'background-color, line-color, target-arrow-color',
                    'transition-duration': '0.5s'
                }
            },
            {
                selector: '.faded',
                style: {
                    'opacity': 0.25,
                    'text-opacity': 0.25
                }
            }
        ],
        layout: {
            name: 'preset', // Use preset layout as positions are in data
            padding: 50
        },
        minZoom: 0.1,
        maxZoom: 5
    });

    let originalPositions = {}; // To store original positions for reset

    Promise.all([
        fetch('../data/consolidated_system_data.json').then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for consolidated_system_data.json`);
            return res.json();
        }),
        fetch('../data/figma_coordinates.json').then(res => {
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status} for figma_coordinates.json`);
            return res.json();
        })
    ])
    .then(([systemData, figmaCoordsData]) => {
        const elements = [];
        const hubSelect = document.getElementById('hub-select');
        
        const coordinatesMap = new Map();
        // figmaCoordsData is an object, not an array. Iterate over its keys.
        if (figmaCoordsData && typeof figmaCoordsData === 'object' && !Array.isArray(figmaCoordsData)) {
            Object.keys(figmaCoordsData).forEach(stationId => {
                const coord = figmaCoordsData[stationId];
                if (coord && typeof coord.x !== 'undefined' && typeof coord.y !== 'undefined') {
                    const x = parseFloat(coord.x); // Figma data uses 'x', 'y'
                    const y = parseFloat(coord.y);
                    if (!isNaN(x) && !isNaN(y)) {
                        coordinatesMap.set(stationId, { x: x, y: y, color: coord.figmaFill }); // Figma data uses 'figmaFill' for color
                    } else {
                        console.warn(`Invalid or missing coordinates for Figma ID ${stationId}.`);
                    }
                } else {
                     console.warn(`Coordinate object for station ID ${stationId} is malformed or missing x/y properties.`);
                }
            });
        } else {
            console.warn("Figma coordinates data is missing, not a valid object, or failed to load. Nodes may not be positioned correctly.");
        }

        const stationData = systemData.stations;
        const lineData = systemData.lines;

        // Process stations (nodes)
        if (stationData && Array.isArray(stationData)) {
            stationData.forEach(station => {
                const coords = coordinatesMap.get(station.id);
                const posX = coords ? coords.x : undefined;
                const posY = coords ? coords.y : undefined;
                // Use color from Figma if available, otherwise from station data (if exists), then default
                const nodeColor = coords ? coords.color : (station.color || '#808080');


                if (posX === undefined || posY === undefined) {
                    console.warn(`Coordinates not found or invalid for station ${station.id} (${station.name}). It will not be added to the graph for preset layout.`);
                } else {
                    elements.push({
                        group: 'nodes',
                        data: {
                            id: station.id,
                            name: station.name,
                            population: station.population || 100, // Assuming population might be missing
                            color: nodeColor,
                            lines: station.lines || []
                        },
                        position: { x: posX, y: posY }
                    });
                    originalPositions[station.id] = { x: posX, y: posY }; // Store original positions

                    // Populate hub select
                    const option = document.createElement('option');
                    option.value = station.id;
                    option.textContent = station.name;
                    hubSelect.appendChild(option);
                }
            });
        } else {
            console.error("Station data (systemData.stations) is missing or not an array:", stationData);
            document.getElementById('station-info').textContent = 'Error: Station data is malformed.';
            return;
        }

        // Process lines (to create edges)
        if (lineData && Array.isArray(lineData)) {
            lineData.forEach(line => {
                if (line.stations && Array.isArray(line.stations) && line.stations.length > 1) {
                    for (let i = 0; i < line.stations.length - 1; i++) {
                        const sourceStationId = line.stations[i];
                        const targetStationId = line.stations[i+1];
                        // Ensure both source and target stations were processed (i.e., have coordinates and are in originalPositions)
                        if (originalPositions.hasOwnProperty(sourceStationId) && originalPositions.hasOwnProperty(targetStationId)) {
                            elements.push({
                                group: 'edges',
                                data: {
                                    id: `e-${line.line_name || 'unknown_line'}-${sourceStationId}-${targetStationId}`,
                                    source: sourceStationId,
                                    target: targetStationId,
                                    color: line.color || '#A9A9A9',
                                    line_name: line.line_name
                                }
                            });
                        } else {
                            // console.warn(`Skipping edge for line ${line.line_name || 'unknown_line'} between ${sourceStationId} and ${targetStationId} due to missing station data/coordinates.`);
                        }
                    }
                }
            });
        } else {
            console.warn("Line data (systemData.lines) is missing or not an array. Edges might not be created.");
        }

        if (elements.some(el => el.group === 'nodes')) {
            cy.add(elements);
            cy.fit(undefined, 50); // Fit to view with padding
            
            // It's good practice to ensure originalPositions reflects the actual positions Cytoscape uses after adding.
            // This is especially true if Cytoscape might adjust positions slightly even with 'preset'.
            cy.nodes().forEach(node => {
               if(originalPositions[node.id()]) {
                   originalPositions[node.id()] = { ...node.position() };
               }
            });

        } else {
            console.error("No valid nodes with coordinates to add to the graph.");
            document.getElementById('station-info').textContent = 'Error: No graph elements could be processed (nodes might be missing coordinates).';
            return;
        }

    const stationInfoDiv = document.getElementById('station-info');
    cy.on('tap', 'node', function (evt) {
        const node = evt.target;
        const lines = node.data('lines') ? node.data('lines').join(', ') : 'N/A';
        stationInfoDiv.innerHTML = `<b>Station:</b> ${node.data('name')} (ID: ${node.id()})<br><b>Lines:</b> ${lines}`;
    });

    cy.on('tap', function (event) {
        if (event.target === cy) {
            stationInfoDiv.textContent = 'Click a station...';
        }
    });

    const expandButton = document.getElementById('expand-btn');
    const resetButton = document.getElementById('reset-btn');
    const expansionScaleInput = document.getElementById('expansion-scale');

    expandButton.addEventListener('click', () => {
        const selectedHubId = hubSelect.value;
        const expansionScale = parseFloat(expansionScaleInput.value) || 1.5;

        if (!selectedHubId) {
            alert("Please select a hub to expand.");
            return;
        }

        const hubNode = cy.getElementById(selectedHubId);
        if (!hubNode.length) {
            console.error("Selected hub node not found:", selectedHubId);
            return;
        }

        // Reset positions before expanding a new hub or re-expanding
        resetPositions();

        const connectedNodes = hubNode.neighborhood().nodes().filter(node => node.id() !== selectedHubId);
        const allNodesToArrange = cy.collection().add(hubNode).add(connectedNodes);

        if (allNodesToArrange.length <= 1) {
            console.log("Hub has no distinct neighbors to arrange.");
            return;
        }

        const baseDistance = 100; // Base distance for grid layout
        const scaledDistance = baseDistance * expansionScale;

        // Simple grid arrangement around the hub
        // For more complex scenarios, a dedicated layout algorithm might be better
        const positions = [];
        const numNeighbors = connectedNodes.length;
        const angleStep = (2 * Math.PI) / numNeighbors;
        const hubPos = originalPositions[hubNode.id()];

        if (!hubPos) {
            console.error("Original position for hub not found:", hubNode.id());
            return;
        }

        connectedNodes.forEach((node, index) => {
            const angle = index * angleStep;
            positions.push({
                node: node,
                x: hubPos.x + scaledDistance * Math.cos(angle),
                y: hubPos.y + scaledDistance * Math.sin(angle)
            });
        });

        cy.animate({
            positions: positions,
            duration: 500,
            easing: 'ease-out-quad'
        });
    });

    function resetPositions() {
        const currentPositions = [];
        cy.nodes().forEach(node => {
            if (originalPositions[node.id()]) {
                currentPositions.push({
                    node: node,
                    x: originalPositions[node.id()].x,
                    y: originalPositions[node.id()].y
                });
            }
        });

        if (currentPositions.length > 0) {
            cy.animate({
                positions: currentPositions,
                duration: 500,
                easing: 'ease-out-quad'
            });
        }
        stationInfoDiv.textContent = 'Positions Reset. Click a station...';
    }

    resetButton.addEventListener('click', resetPositions);
}) // This closes the .then(data => { ... }) block from the fetch
    .catch(err => {
        console.error("Error loading graph data:", err);
        document.getElementById('station-info').textContent = 'Error loading data. Check console.';
    });
});