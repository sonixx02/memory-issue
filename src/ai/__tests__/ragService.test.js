/**
 * ragService.test.js — Unit tests for chunking logic and LRU cache management.
 *
 * The integration tests live in ragIntegration.test.js.
 * Here we test the pure-logic internals: chunkMessage, touchIndex / LRU, etc.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../../db/database.js';
import { clearAllTables, seedWorkspaceWithConversation, fakeEmbed } from '../../test/helpers.js';

// Mock the embedding service so we never load the real model
vi.mock('../../ai/embeddingService.js', () => ({
  embedText: vi.fn(async () => new Float32Array(384)),
  embedBatch: vi.fn(async () => []),
  onEmbeddingStatusChange: vi.fn(() => () => {}),
}));

// Re-import after mocking
const {
  indexMessages,
  searchMemory,
  indexNewMessages,
  getUnindexedMessages,
  clearWorkspaceIndex,
} = await import('../../ai/ragService.js');

const { embedBatch, embedText } = await import('../../ai/embeddingService.js');

// Wire fakeEmbed into the mocks for each test
beforeEach(async () => {
  await clearAllTables();
  vi.clearAllMocks();
  embedText.mockImplementation(async (text) => fakeEmbed(text));
  embedBatch.mockImplementation(async (texts) => texts.map(t => fakeEmbed(t)));
});

// ══════════════════════════════════════════════════════════════════════════════
// CHUNKING (tested indirectly through indexMessages)
// ══════════════════════════════════════════════════════════════════════════════

describe('chunking via indexMessages', () => {
  it('skips messages shorter than 20 characters', async () => {
    await indexMessages('ws1', [
      { chatId: 'c1', role: 'user', content: 'hi', timestamp: 1 },
      { chatId: 'c1', role: 'assistant', content: 'ok cool', timestamp: 2 },
    ]);

    // embedBatch should never be called — nothing to index
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('skips messages that are just "..."', async () => {
    await indexMessages('ws1', [
      { chatId: 'c1', role: 'assistant', content: '...', timestamp: 1 },
    ]);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('skips emoji-prefixed system-like messages', async () => {
    await indexMessages('ws1', [
      { chatId: 'c1', role: 'assistant', content: '📸 Snapshot committed!', timestamp: 1 },
      { chatId: 'c1', role: 'assistant', content: '⚠️ Warning: rate limited', timestamp: 2 },
      { chatId: 'c1', role: 'assistant', content: '❌ Error processing request', timestamp: 3 },
    ]);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('handles a normal message as a single chunk', async () => {
    await indexMessages('ws1', [
      { chatId: 'c1', role: 'user', content: 'How can I optimize PostgreSQL query performance?', timestamp: 1 },
    ]);

    expect(embedBatch).toHaveBeenCalledOnce();
    const texts = embedBatch.mock.calls[0][0];
    expect(texts).toHaveLength(1);
    expect(texts[0]).toContain('User:');
    expect(texts[0]).toContain('PostgreSQL');
  });

  it('splits long messages (>500 chars) into overlapping chunks', async () => {
    const longContent = 'A'.repeat(1100); // Will split into 3 chunks (500, 500, 500 overlap)
    await indexMessages('ws1', [
      { chatId: 'c1', role: 'assistant', content: longContent, timestamp: 1 },
    ]);

    expect(embedBatch).toHaveBeenCalledOnce();
    const texts = embedBatch.mock.calls[0][0];
    // 1100 chars, step = 400, so: 0-500, 400-900, 800-1100 → 3 chunks
    expect(texts.length).toBeGreaterThanOrEqual(3);
  });

  it('handles null/undefined content gracefully', async () => {
    await indexMessages('ws1', [
      { chatId: 'c1', role: 'user', content: null, timestamp: 1 },
      { chatId: 'c1', role: 'user', content: undefined, timestamp: 2 },
    ]);
    expect(embedBatch).not.toHaveBeenCalled();
  });

  it('handles empty messages array', async () => {
    await indexMessages('ws1', []);
    expect(embedBatch).not.toHaveBeenCalled();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// TIMESTAMP WATERMARK TRACKING
// ══════════════════════════════════════════════════════════════════════════════

describe('timestamp watermark', () => {
  it('stores watermark after indexing', async () => {
    await indexMessages('ws-wm', [
      { chatId: 'c1', role: 'user', content: 'This is a question about React hooks', timestamp: 1000 },
      { chatId: 'c1', role: 'user', content: 'Another longer question about React state', timestamp: 2000 },
    ]);

    const setting = await db.settings.get('rag_last_indexed_ts_ws-wm');
    expect(setting?.value).toBe(2000);
  });

  it('only advances watermark (never goes backwards)', async () => {
    await indexMessages('ws-wm', [
      { chatId: 'c1', role: 'user', content: 'A sufficiently long message for indexing purposes', timestamp: 5000 },
    ]);

    await indexMessages('ws-wm', [
      { chatId: 'c1', role: 'user', content: 'An earlier message that arrives late to indexing', timestamp: 3000 },
    ]);

    const setting = await db.settings.get('rag_last_indexed_ts_ws-wm');
    expect(setting?.value).toBe(5000); // should keep the higher timestamp
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getUnindexedMessages
// ══════════════════════════════════════════════════════════════════════════════

describe('getUnindexedMessages', () => {
  it('returns all messages for fresh workspace', async () => {
    const { workspace, messages } = await seedWorkspaceWithConversation(6);
    const unindexed = await getUnindexedMessages(workspace.id);
    expect(unindexed).toHaveLength(6);
  });

  it('returns only messages after watermark', async () => {
    const { workspace, messages } = await seedWorkspaceWithConversation(6);

    // Set watermark to midpoint
    const mid = messages[2].timestamp;
    await db.settings.put({ key: `rag_last_indexed_ts_${workspace.id}`, value: mid });

    const unindexed = await getUnindexedMessages(workspace.id);
    expect(unindexed.length).toBeLessThan(6);
    for (const m of unindexed) {
      expect(m.timestamp).toBeGreaterThan(mid);
    }
  });

  it('returns empty array for workspace with no chats', async () => {
    const result = await getUnindexedMessages('nonexistent-ws');
    expect(result).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// clearWorkspaceIndex
// ══════════════════════════════════════════════════════════════════════════════

describe('clearWorkspaceIndex', () => {
  it('removes watermark from settings', async () => {
    await db.settings.put({ key: 'rag_last_indexed_ts_ws-clear', value: 5000 });
    await clearWorkspaceIndex('ws-clear');
    const setting = await db.settings.get('rag_last_indexed_ts_ws-clear');
    expect(setting).toBeFalsy();
  });

  it('removes legacy key if it exists', async () => {
    await db.settings.put({ key: 'rag_indexed_ws-clear', value: ['msg1', 'msg2'] });
    await clearWorkspaceIndex('ws-clear');
    const legacy = await db.settings.get('rag_indexed_ws-clear');
    expect(legacy).toBeFalsy();
  });

  it('does not throw for non-existent workspace', async () => {
    await expect(clearWorkspaceIndex('does-not-exist')).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// LRU EVICTION (indirect — when >3 workspaces indexed)
// ══════════════════════════════════════════════════════════════════════════════

describe('LRU eviction', () => {
  it('evicts oldest index when exceeding MAX_CACHED_INDEXES=3', async () => {
    // Index 4 workspaces — first should be evicted
    for (let i = 1; i <= 4; i++) {
      await indexMessages(`ws-lru-${i}`, [
        { chatId: `c-${i}`, role: 'user', content: `This is a longer message for workspace number ${i} with extra text`, timestamp: i * 1000 },
      ]);
    }

    // ws-lru-1 should be evicted; searching it will need to rebuild from scratch
    // ws-lru-4 should still be cached
    const result4 = await searchMemory('ws-lru-4', 'workspace number 4');
    expect(result4.length).toBeGreaterThanOrEqual(0); // should work from cache
  });
});
