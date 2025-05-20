// js/modules/utils.js

/**
 * Generates a timestamp-based ID string.
 * @returns {string} A string like "layout_2023-10-27T12:34:56.789Z"
 */
export function generateTimestampId() {
  return `layout_${new Date().toISOString()}`;
}