import { create, insertMultiple, search, removeMultiple } from '@orama/orama';
import db from '../db/database.js';
import { embedText, embedBatch } from './embeddingService.js';
import { debugLog } from './debugLogger.js';

/**
 * RAG service — local semantic search over past conversation history.
 *
 * Architecture:
 * - Messages are chunked and embedded using local MiniLM model (free)
 * - Stored in Orama in-memory vector index (rebuilt on load from IndexedDB)
 * - **Hybrid search**: combined vector similarity + BM25 full-text matching
 * - **Message-pair chunking**: user+assistant pairs kept as semantic units
 * - **Recency weighting**: newer results get a time-decay boost
 * - Top-K results injected into Context Compiler system prompt
 *
 * Chunking strategy (v2 — message pairs):
 * - Adjacent user→assistant pairs are merged into a single chunk
 * - Very long chunks (>800 chars) are split with overlap
 * - Orphan messages (e.g. system, standalone) fall back to single-message chunks
 * - Metadata: chatId, workspaceId, role, timestamp
 */

const CHUNK_MAX_CHARS = 800;          // increased for paired messages
const CHUNK_OVERLAP_CHARS = 150;
const VECTOR_SIZE = 384;              // MiniLM output dimension
const MAX_CACHED_INDEXES = 3;         // LRU cap

// Recency weighting: half-life in milliseconds (7 days)
const RECENCY_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000;

// Per-workspace Orama indexes stored in memory (LRU-evicted)
const workspaceIndexes = new Map();

/**
 * LRU eviction: ensure we don't hold more than MAX_CACHED_INDEXES in memory.
 * Map iteration order is insertion-order; re-set to bump to "most recent".
 */
function touchIndex(workspaceId, index) {
    workspaceIndexes.delete(workspaceId);
    workspaceIndexes.set(workspaceId, index);

    if (workspaceIndexes.size > MAX_CACHED_INDEXES) {
        const oldest = workspaceIndexes.keys().next().value;
        workspaceIndexes.delete(oldest);
        console.log(`♻️ Evicted RAG index for workspace ${oldest} (LRU)`);
    }
}

/**
 * Create or get an Orama vector index for a workspace.
 * Schema includes `text` as a searchable string so Orama can run BM25 in hybrid mode.
 */
async function getOrCreateIndex(workspaceId) {
    if (workspaceIndexes.has(workspaceId)) {
        const idx = workspaceIndexes.get(workspaceId);
        touchIndex(workspaceId, idx);
        return idx;
    }

    const index = await create({
        schema: {
            text: 'string',            // searchable for BM25
            chatId: 'string',
            workspaceId: 'string',
            role: 'string',            // 'user', 'assistant', or 'pair'
            timestamp: 'number',
            embedding: `vector[${VECTOR_SIZE}]`,
        },
    });

    touchIndex(workspaceId, index);
    return index;
}

// ── Message-pair chunking ──

/**
 * Returns true if a message should be skipped from indexing.
 */
function shouldSkip(msg) {
    const text = msg.content?.trim();
    if (!text || text === '...') return true;
    if (text.length < 20) return true;
    if (text.startsWith('📸') || text.startsWith('⚠️') || text.startsWith('❌')) return true;
    if (text.startsWith('Snapshot committed')) return true;
    return false;
}

/**
 * Split a long text into overlapping chunks.
 */
function splitOverlapping(text, meta) {
    const chunks = [];
    for (let start = 0; start < text.length; start += CHUNK_MAX_CHARS - CHUNK_OVERLAP_CHARS) {
        const end = Math.min(start + CHUNK_MAX_CHARS, text.length);
        chunks.push({ ...meta, text: text.slice(start, end) });
        if (end === text.length) break;
    }
    return chunks;
}

/**
 * Chunk messages into semantic units.
 * Pairs adjacent user→assistant messages as single chunks when possible.
 * Falls back to single-message chunks for orphans / very long content.
 */
function chunkMessages(messages) {
    const sorted = [...messages].sort((a, b) => a.timestamp - b.timestamp);
    const chunks = [];
    let i = 0;

    while (i < sorted.length) {
        const msg = sorted[i];

        // Try to pair user→assistant
        if (msg.role === 'user' && i + 1 < sorted.length && sorted[i + 1].role === 'assistant'
            && sorted[i + 1].chatId === msg.chatId) {
            const assistant = sorted[i + 1];
            if (shouldSkip(msg) && shouldSkip(assistant)) { i += 2; continue; }

            const userText = shouldSkip(msg) ? '' : `User: ${msg.content.trim()}`;
            const assistantText = shouldSkip(assistant) ? '' : `Assistant: ${assistant.content.trim()}`;
            const combined = [userText, assistantText].filter(Boolean).join('\n');

            const meta = {
                chatId: msg.chatId,
                role: 'pair',
                timestamp: assistant.timestamp, // use the later timestamp
            };

            if (combined.length <= CHUNK_MAX_CHARS) {
                chunks.push({ ...meta, text: combined });
            } else {
                chunks.push(...splitOverlapping(combined, meta));
            }
            i += 2;
            continue;
        }

        // Single message (orphan user, standalone assistant, etc.)
        if (shouldSkip(msg)) { i++; continue; }

        const prefix = msg.role === 'user' ? 'User' : 'Assistant';
        const text = `${prefix}: ${msg.content.trim()}`;
        const meta = { chatId: msg.chatId, role: msg.role, timestamp: msg.timestamp };

        if (text.length <= CHUNK_MAX_CHARS) {
            chunks.push({ ...meta, text });
        } else {
            chunks.push(...splitOverlapping(text, meta));
        }
        i++;
    }
    return chunks;
}

/**
 * Index a set of messages into the workspace's Orama index.
 *
 * @param {string} workspaceId
 * @param {Array} messages - messages from DB (with chatId, role, content, timestamp)
 */
export async function indexMessages(workspaceId, messages) {
    if (!messages?.length) return;

    const index = await getOrCreateIndex(workspaceId);

    // Chunk using message-pair strategy
    const allChunks = chunkMessages(messages).map(c => ({ ...c, workspaceId }));
    if (!allChunks.length) return;

    // Batch embed
    const texts = allChunks.map(c => c.text);
    const embeddings = await embedBatch(texts);

    // Attach embeddings and insert
    const docs = allChunks.map((chunk, i) => ({
        ...chunk,
        embedding: Array.from(embeddings[i]),
    }));

    await insertMultiple(index, docs);

    // Track indexing progress by timestamp
    const maxTimestamp = Math.max(...messages.map(m => m.timestamp));
    const existingTs = (await db.settings.get(`rag_last_indexed_ts_${workspaceId}`))?.value || 0;
    if (maxTimestamp > existingTs) {
        await db.settings.put({ key: `rag_last_indexed_ts_${workspaceId}`, value: maxTimestamp });
    }

    debugLog('rag:indexed', {
        workspaceId,
        messageCount: messages.length,
        chunkCount: allChunks.length,
        sampleChunks: allChunks.slice(0, 3).map(c => ({ text: c.text?.slice(0, 100), role: c.role })),
    });
    console.log(`✅ Indexed ${allChunks.length} chunks from ${messages.length} messages (workspace: ${workspaceId})`);
}

/**
 * Get messages from a workspace that haven't been indexed yet.
 */
export async function getUnindexedMessages(workspaceId) {
    const chats = await db.chats.where('workspaceId').equals(workspaceId).toArray();
    if (!chats.length) return [];

    const chatIds = chats.map(c => c.id);
    const allMessages = await db.messages.where('chatId').anyOf(chatIds).sortBy('timestamp');
    const lastIndexedTs = (await db.settings.get(`rag_last_indexed_ts_${workspaceId}`))?.value || 0;

    return allMessages.filter(m => m.timestamp > lastIndexedTs);
}

/**
 * Index any new (un-indexed) messages for a workspace.
 */
export async function indexNewMessages(workspaceId) {
    const unindexed = await getUnindexedMessages(workspaceId);
    if (!unindexed.length) return 0;
    await indexMessages(workspaceId, unindexed);
    return unindexed.length;
}

// ── Recency weighting ──

/**
 * Exponential decay boost based on age.
 * Returns a multiplier in [0.5, 1.0] — newer = higher.
 */
function recencyBoost(timestamp) {
    const age = Date.now() - timestamp;
    // decay = 0.5^(age / half_life), clamped to [0.5, 1.0]
    const decay = Math.pow(0.5, age / RECENCY_HALF_LIFE_MS);
    return 0.5 + 0.5 * decay; // maps [0→1] to [0.5→1.0]
}

/**
 * Search the workspace's conversation history using **hybrid search**
 * (vector similarity + BM25 full-text) with recency weighting.
 *
 * @param {string} workspaceId
 * @param {string} query - the user's new message
 * @param {number} topK - number of results to return (default 5)
 * @returns {Promise<Array<{text, score, chatId, role, timestamp}>>}
 */
export async function searchMemory(workspaceId, query, topK = 5) {
    if (!workspaceIndexes.has(workspaceId)) {
        await indexNewMessages(workspaceId);
    }

    const index = workspaceIndexes.get(workspaceId);
    if (!index) return [];

    try {
        const queryEmbedding = await embedText(query);

        // Hybrid search: Orama runs BM25 on `text` + vector on `embedding`,
        // and combines. We fetch 2× topK to give recency re-ranking headroom.
        let results;
        try {
            results = await search(index, {
                mode: 'hybrid',
                term: query,
                vector: {
                    value: Array.from(queryEmbedding),
                    property: 'embedding',
                },
                limit: topK * 2,
                similarity: 0.25, // slightly lower threshold for hybrid
            });
        } catch (_hybridErr) {
            // Fallback: if hybrid mode not supported in this Orama version, use vector-only
            results = await search(index, {
                mode: 'vector',
                vector: {
                    value: Array.from(queryEmbedding),
                    property: 'embedding',
                },
                limit: topK * 2,
                similarity: 0.3,
            });
        }

        // Apply recency weighting and re-rank
        const scored = results.hits.map(hit => {
            const baseScore = hit.score;
            const boost = recencyBoost(hit.document.timestamp);
            return {
                text: hit.document.text,
                score: baseScore * boost,
                baseScore,
                recencyBoost: boost,
                chatId: hit.document.chatId,
                role: hit.document.role,
                timestamp: hit.document.timestamp,
            };
        });

        // Re-sort by boosted score and take topK
        scored.sort((a, b) => b.score - a.score);
        const mapped = scored.slice(0, topK);

        debugLog('rag:search', {
            workspaceId,
            query: query.slice(0, 200),
            topK,
            mode: 'hybrid+recency',
            resultCount: mapped.length,
            results: mapped.map(r => ({
                text: r.text?.slice(0, 120),
                score: Math.round(r.score * 1000) / 1000,
                baseScore: Math.round(r.baseScore * 1000) / 1000,
                recencyBoost: Math.round(r.recencyBoost * 100) / 100,
                role: r.role,
                date: new Date(r.timestamp).toLocaleString(),
            })),
        });

        return mapped;
    } catch (err) {
        console.warn('RAG search failed:', err);
        return [];
    }
}

/**
 * Clear the RAG index for a workspace (e.g., when workspace is deleted).
 */
export async function clearWorkspaceIndex(workspaceId) {
    workspaceIndexes.delete(workspaceId);
    await db.settings.delete(`rag_last_indexed_ts_${workspaceId}`);
    await db.settings.delete(`rag_indexed_${workspaceId}`);
}
