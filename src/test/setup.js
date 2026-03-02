/**
 * Vitest global setup — runs before every test file.
 *
 * 1. Polyfills IndexedDB with fake-indexeddb
 * 2. Polyfills crypto.subtle (for responseCache SHA-256)
 * 3. Stubs navigator.storage.persist
 * 4. Stubs window.matchMedia
 * 5. Imports jest-dom matchers
 */

import 'fake-indexeddb/auto';
import { webcrypto } from 'node:crypto';
import '@testing-library/jest-dom/vitest';

// ── crypto.subtle polyfill ──
if (!globalThis.crypto?.subtle) {
  globalThis.crypto = webcrypto;
}

// ── navigator.storage.persist stub (database.js calls this on load) ──
if (!globalThis.navigator) globalThis.navigator = {};
if (!globalThis.navigator.storage) {
  globalThis.navigator.storage = {
    persist: () => Promise.resolve(true),
    persisted: () => Promise.resolve(true),
  };
}

// ── matchMedia stub (needed by any component using media queries) ──
if (!globalThis.window) globalThis.window = globalThis;
globalThis.matchMedia =
  globalThis.matchMedia ||
  function () {
    return {
      matches: false,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    };
  };

// ── URL.createObjectURL stub (used by exportImport.js) ──
if (typeof URL.createObjectURL === 'undefined') {
  URL.createObjectURL = () => 'blob:fake';
  URL.revokeObjectURL = () => {};
}
