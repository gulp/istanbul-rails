// js/modules/config.js

// --- LABEL POSITIONING ---
export const LABEL_POSITIONS = {
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

// --- GENERAL DRAWING CONSTANTS ---
export const RECT_WIDTH = 8;
export const RECT_HEIGHT = 8;

// --- UNIFIED VERSIONING SYSTEM ---
export const SAVED_VERSIONS_KEY = 'cytoscapeUnifiedLayoutVersions'; 
export const ORIGINAL_LAYOUT_ID = 'original_unified'; 

// --- UNDERLAY IMAGE CONFIGURATION ---
export const UNDERLAY_IMAGE_URL = 'assets/map-underlay.png';
export const IMAGE_ACTUAL_WIDTH = 3279; 
export const IMAGE_ACTUAL_HEIGHT = 2064; 

// Manual pixel offsets to nudge the underlay image for perfect alignment.
// Positive MANUAL_OFFSET_X shifts image to the LEFT relative to the Cytoscape drawing
// Positive MANUAL_OFFSET_Y shifts image UP relative to the Cytoscape drawing
export const MANUAL_OFFSET_X = 0;
export const MANUAL_OFFSET_Y = 0;

// --- DEBUGGING FLAGS ---
// export const DEBUG_DRAW_IMAGE_BOUNDS = true; // This was for the previous approach, effectively replaced by styling the underlay node itself.
export const DEBUG_SHOW_UNDERLAY_NODE_BORDER = false; // Set to true to make the __underlayNode__ border visible (e.g., green)
export const DEBUG_DRAW_COORDINATE_RECT = false; // Set to true to draw a red rectangle at 0,0 with IMAGE_ACTUAL_WIDTH/HEIGHT