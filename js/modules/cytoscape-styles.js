// js/modules/cytoscape-styles.js
import * as config from './config.js'; // In case any config constants are needed for styles in the future

export const cytoscapeStylesheet = [
  { 
    selector: 'node', 
    style: { 
      'background-color': '#888', 
      'label': 'data(name)', 
      'font-size': '10px', 
      'width': '8px', 
      'height': '8px', 
      'border-width': 1, 
      'border-color': '#555' 
      // Text alignment properties are set by applyLabelPosition
    }
  },
  { 
    selector: 'node.label-editing', 
    style: { 
      'border-color': '#f90', 
      'border-width': '3px' 
    }
  },
  { 
    selector: 'node[isInterchange="true"]', 
    style: { 
      'background-color': '#fff', 
      'border-color': '#000', 
      'border-width': 1.5, 
      'width': '12px', 
      'height': '12px', 
      'shape': 'ellipse' 
    }
  },
  { 
    selector: 'node[?figmaColor]', 
    style: { 
      'background-color': 'data(figmaColor)' 
    }
  },
  {
    selector: 'node.underlay-node',
    style: {
        'background-image': 'data(imageUrl)',
        'background-fit': 'none',
        'background-clip': 'node',
        'background-width': 'data(imgWidth)',
        'background-height': 'data(imgHeight)',
        'width': 'data(imgWidth)',
        'height': 'data(imgHeight)',
        'opacity': 0.4, 
        'border-width': 5, // Temporarily make border visible for debugging bounds
        'border-color': 'red', // Use a distinct color for the debug border
        'border-style': 'solid',
        'label': '', 
        'shape': 'rectangle',
        'z-compound-depth': 'bottom', 
        'z-index': -999
    }
  },
  { 
    selector: 'edge', 
    style: { 
      'width': 3, 
      'line-color': 'data(lineColor)', 
      'curve-style': 'bezier', 
      'target-arrow-shape': 'none', 
      'opacity': 0.7 
    }
  }
];