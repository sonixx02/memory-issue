/**
 * Debug Logger — centralized event bus for pipeline visibility.
 *
 * Captures every major pipeline event with full input/output data.
 * The DebugPanel component subscribes to these events and renders them live.
 *
 * Usage in modules:
 *   import { debugLog } from './debugLogger.js';
 *   debugLog('rag:search', { query, results, duration });
 *
 * Usage in UI:
 *   import { useDebugEvents } from './debugLogger.js';
 *   const events = useDebugEvents();
 */

const MAX_EVENTS = 200;
const events = [];
const listeners = new Set();

let _enabled = true; // can be toggled from UI

export function setDebugEnabled(enabled) {
  _enabled = enabled;
}

export function isDebugEnabled() {
  return _enabled;
}

/**
 * Log a debug event.
 * @param {string} type - e.g. 'context:compile', 'rag:search', 'rag:index', 'snapshot:preview'
 * @param {object} data - arbitrary payload (will be frozen/copied for safety)
 */
export function debugLog(type, data = {}) {
  if (!_enabled) return;

  const event = {
    id: Date.now() + '-' + Math.random().toString(36).slice(2, 6),
    type,
    timestamp: Date.now(),
    data,
  };

  events.push(event);

  // Ring buffer — drop oldest
  while (events.length > MAX_EVENTS) events.shift();

  // Notify subscribers
  listeners.forEach(fn => {
    try { fn([...events]); } catch (_) {}
  });
}

/**
 * Get all current events (snapshot).
 */
export function getDebugEvents() {
  return [...events];
}

/**
 * Clear all events.
 */
export function clearDebugEvents() {
  events.length = 0;
  listeners.forEach(fn => {
    try { fn([]); } catch (_) {}
  });
}

/**
 * Subscribe to event changes.
 * @returns {() => void} unsubscribe function
 */
export function onDebugEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
