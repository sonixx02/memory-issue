import { pipeline } from '@huggingface/transformers';

/**
 * Web Worker for embedding inference.
 * Keeps the heavy Transformers.js model off the main thread.
 */

let embeddingPipeline = null;

async function loadModel() {
  if (embeddingPipeline) return embeddingPipeline;
  embeddingPipeline = await pipeline(
    'feature-extraction',
    'Xenova/all-MiniLM-L6-v2',
    { dtype: 'fp32' }
  );
  return embeddingPipeline;
}

async function embedSingle(text) {
  const pipe = await loadModel();
  const output = await pipe(text, { pooling: 'mean', normalize: true });
  return Array.from(output.data); // Transfer as plain array
}

async function embedBatch(texts) {
  const pipe = await loadModel();
  const results = [];
  const BATCH_SIZE = 8;
  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const embeddings = await Promise.all(
      batch.map(async (t) => {
        const output = await pipe(t, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
      })
    );
    results.push(...embeddings);
  }
  return results;
}

// Message handler
self.onmessage = async (e) => {
  const { id, type, payload } = e.data;

  try {
    switch (type) {
      case 'load': {
        await loadModel();
        self.postMessage({ id, type: 'status', payload: 'ready' });
        break;
      }
      case 'embed': {
        const embedding = await embedSingle(payload.text);
        self.postMessage({ id, type: 'result', payload: embedding });
        break;
      }
      case 'embedBatch': {
        const embeddings = await embedBatch(payload.texts);
        self.postMessage({ id, type: 'result', payload: embeddings });
        break;
      }
      default:
        self.postMessage({ id, type: 'error', payload: `Unknown message type: ${type}` });
    }
  } catch (err) {
    self.postMessage({ id, type: 'error', payload: err.message || String(err) });
  }
};
