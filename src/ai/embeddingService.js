/**
 * Local embedding service using Transformers.js with MiniLM.
 * Runs in a Web Worker to keep the main thread responsive.
 *
 * Model: all-MiniLM-L6-v2 (~80MB, 384-dim vectors)
 * First load: ~3-5s (downloads + initializes)
 * Subsequent: <1s (cached by browser)
 * Inference: ~15-30ms per sentence
 */

let worker = null;
let msgIdCounter = 0;
const pendingCallbacks = new Map();

let status = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'
let statusListeners = new Set();

function notifyStatusChange() {
    statusListeners.forEach(fn => fn(status));
}

export function onEmbeddingStatusChange(listener) {
    statusListeners.add(listener);
    return () => statusListeners.delete(listener);
}

export function getEmbeddingStatus() {
    return status;
}

function getWorker() {
    if (worker) return worker;
    worker = new Worker(new URL('./embeddingWorker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
        const { id, type, payload } = e.data;
        if (type === 'status') {
            status = payload;
            notifyStatusChange();
            // Resolve the 'load' call if pending
            const cb = pendingCallbacks.get(id);
            if (cb) { cb.resolve(true); pendingCallbacks.delete(id); }
            return;
        }
        const cb = pendingCallbacks.get(id);
        if (!cb) return;
        pendingCallbacks.delete(id);
        if (type === 'error') {
            cb.reject(new Error(payload));
        } else {
            cb.resolve(payload);
        }
    };
    worker.onerror = (err) => {
        status = 'error';
        notifyStatusChange();
        console.error('❌ Embedding worker error:', err);
    };
    return worker;
}

function postToWorker(type, payload) {
    const id = ++msgIdCounter;
    const w = getWorker();
    return new Promise((resolve, reject) => {
        pendingCallbacks.set(id, { resolve, reject });
        w.postMessage({ id, type, payload });
    });
}

/**
 * Load the embedding model (lazy, idempotent).
 * Call this early (e.g., on app mount) to preload.
 */
export async function loadEmbeddingModel() {
    if (status === 'ready') return true;
    status = 'loading';
    notifyStatusChange();
    try {
        await postToWorker('load', {});
        console.log('✅ Embedding model loaded in Web Worker (all-MiniLM-L6-v2)');
        return true;
    } catch (err) {
        status = 'error';
        notifyStatusChange();
        console.error('❌ Failed to load embedding model:', err);
        throw err;
    }
}

/**
 * Embed a single text string into a 384-dim float array.
 * @param {string} text
 * @returns {Promise<Float32Array>}
 */
export async function embedText(text) {
    const result = await postToWorker('embed', { text });
    return new Float32Array(result);
}

/**
 * Embed multiple texts in a batch.
 * @param {string[]} texts
 * @returns {Promise<Float32Array[]>}
 */
export async function embedBatch(texts) {
    if (!texts.length) return [];
    const results = await postToWorker('embedBatch', { texts });
    return results.map(arr => new Float32Array(arr));
}
