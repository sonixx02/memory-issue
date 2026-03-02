import db from '../db/database.js';
import { embedText } from './embeddingService.js';
import { debugLog } from './debugLogger.js';

/**
 * Semantic response cache — saves API calls for similar (not just identical) questions.
 *
 * v2 architecture:
 * - Each cached entry stores the question embedding + response text
 * - Lookup: embed the new question, scan cached entries for the workspace,
 *   return the best match above a similarity threshold (0.92)
 * - Falls back to exact SHA-256 match for speed when embedding isn't ready
 * - Cache entries include a `memoryVersion` counter that auto-invalidates
 *   when workspace memories change
 */

const SIMILARITY_THRESHOLD = 0.92;  // high threshold to avoid wrong cache hits
const MAX_CACHE_ENTRIES = 50;       // per workspace

// ── Cosine similarity ──
function cosineSim(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, magA = 0, magB = 0;
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        magA += a[i] * a[i];
        magB += b[i] * b[i];
    }
    const denom = Math.sqrt(magA) * Math.sqrt(magB);
    return denom === 0 ? 0 : dot / denom;
}

// ── SHA-256 hash for exact-match fallback ──
async function getHash(text) {
    const msgUint8 = new TextEncoder().encode(text.trim().toLowerCase());
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgUint8);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Get the current memory version for a workspace (incremented on snapshot commit).
 */
async function getMemoryVersion(workspaceId) {
    const entry = await db.settings.get(`memory_version_${workspaceId}`);
    return entry?.value || 0;
}

/**
 * Bump the memory version — call this after any snapshot commit or memory change.
 * Effectively invalidates all semantic cache entries for this workspace.
 */
export async function invalidateCache(workspaceId) {
    if (!workspaceId) return;
    const current = await getMemoryVersion(workspaceId);
    await db.settings.put({ key: `memory_version_${workspaceId}`, value: current + 1 });
    debugLog('cache:invalidated', { workspaceId, newVersion: current + 1 });
}

/**
 * Look up a cached response for a question.
 * 1. Try semantic similarity (embedding-based) — catches paraphrased questions
 * 2. Fall back to exact hash match — works even when embedding model isn't loaded
 * Returns null on cache miss.
 */
export async function getCachedResponse(workspaceId, question) {
    if (!workspaceId || !question) return null;

    const memVersion = await getMemoryVersion(workspaceId);

    // Load all cache entries for this workspace
    const cacheKey = `semantic_cache_${workspaceId}`;
    const cacheData = (await db.settings.get(cacheKey))?.value || [];

    // ── 1. Semantic search ──
    try {
        const qEmbed = await embedText(question);
        let bestMatch = null;
        let bestSim = 0;

        for (const entry of cacheData) {
            // Skip entries from old memory versions (stale)
            if (entry.memoryVersion !== memVersion) continue;
            if (!entry.embedding) continue;

            const sim = cosineSim(qEmbed, new Float32Array(entry.embedding));
            if (sim > bestSim) {
                bestSim = sim;
                bestMatch = entry;
            }
        }

        if (bestMatch && bestSim >= SIMILARITY_THRESHOLD) {
            debugLog('cache:lookup', {
                workspaceId,
                question: question.slice(0, 100),
                hit: true,
                mode: 'semantic',
                similarity: Math.round(bestSim * 1000) / 1000,
                responsePreview: bestMatch.response?.slice(0, 100),
            });
            return bestMatch.response;
        }
    } catch (_) {
        // Embedding not ready — fall through to exact match
    }

    // ── 2. Exact hash fallback ──
    const hash = await getHash(workspaceId + '_' + question);
    for (const entry of cacheData) {
        if (entry.memoryVersion !== memVersion) continue;
        if (entry.hash === hash) {
            debugLog('cache:lookup', {
                workspaceId,
                question: question.slice(0, 100),
                hit: true,
                mode: 'exact',
                responsePreview: entry.response?.slice(0, 100),
            });
            return entry.response;
        }
    }

    debugLog('cache:lookup', {
        workspaceId,
        question: question.slice(0, 100),
        hit: false,
    });
    return null;
}

/**
 * Store a response in the semantic cache.
 */
export async function setCachedResponse(workspaceId, question, response) {
    if (!workspaceId || !question || !response) return;

    const memVersion = await getMemoryVersion(workspaceId);
    const hash = await getHash(workspaceId + '_' + question);

    // Try to get embedding (may fail if model not loaded)
    let embedding = null;
    try {
        const emb = await embedText(question);
        embedding = Array.from(emb);
    } catch (_) {}

    const cacheKey = `semantic_cache_${workspaceId}`;
    const cacheData = (await db.settings.get(cacheKey))?.value || [];

    // Remove existing entry with same hash (update)
    const filtered = cacheData.filter(e => e.hash !== hash);

    // Add new entry
    filtered.push({
        hash,
        embedding,
        response,
        memoryVersion: memVersion,
        createdAt: Date.now(),
    });

    // Evict oldest if over limit
    const trimmed = filtered.length > MAX_CACHE_ENTRIES
        ? filtered.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_CACHE_ENTRIES)
        : filtered;

    await db.settings.put({ key: cacheKey, value: trimmed });
}
