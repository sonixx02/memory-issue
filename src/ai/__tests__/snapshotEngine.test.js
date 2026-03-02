/**
 * snapshotEngine.test.js — Tests for memory extraction, parsing, dedup, and commit.
 *
 * Covers: parseMemoryItemsResponse (edge cases), dedupeArray,
 * previewSnapshot + commitPreviewedItems (mocked LLM), commitSnapshot (legacy).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../../db/database.js';
import { clearAllTables, seedWorkspaceWithConversation, seedMemoryItems } from '../../test/helpers.js';

// Mock LLM service
vi.mock('../../ai/llmService.js', () => ({
  chatCompletion: vi.fn(async () => '[]'),
  streamChat: vi.fn(async () => ''),
}));

const {
  previewSnapshot,
  commitPreviewedItems,
  commitSnapshot,
  dedupeArray,
} = await import('../../ai/snapshotEngine.js');

const { chatCompletion } = await import('../../ai/llmService.js');

beforeEach(async () => {
  await clearAllTables();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// DEDUP ARRAY
// ══════════════════════════════════════════════════════════════════════════════

describe('dedupeArray', () => {
  it('removes case-insensitive duplicates', () => {
    expect(dedupeArray(['React', 'react', 'REACT', 'Vue'])).toEqual(['React', 'Vue']);
  });

  it('trims whitespace in comparison', () => {
    expect(dedupeArray([' hello ', 'hello'])).toEqual([' hello ']);
  });

  it('handles empty array', () => {
    expect(dedupeArray([])).toEqual([]);
  });

  it('handles non-string items', () => {
    expect(dedupeArray([1, 2, 1, 3])).toEqual([1, 2, 3]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PARSE MEMORY ITEMS RESPONSE
// ══════════════════════════════════════════════════════════════════════════════

describe('parseMemoryItemsResponse (via previewSnapshot)', () => {
  it('parses valid JSON array from LLM', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue(JSON.stringify([
      { content: 'Use PostgreSQL', category: 'decision', tags: ['database'] },
      { content: 'Rate limit is 100/min', category: 'fact', tags: ['api'] },
    ]));

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems).toHaveLength(2);
    expect(result.extractedItems[0].content).toBe('Use PostgreSQL');
    expect(result.extractedItems[0].category).toBe('decision');
  });

  it('strips code fences from LLM response', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue('```json\n[{"content":"fenced","category":"fact","tags":[]}]\n```');

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems).toHaveLength(1);
    expect(result.extractedItems[0].content).toBe('fenced');
  });

  it('defaults invalid category to "fact"', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue(JSON.stringify([
      { content: 'Some item', category: 'invalid_cat', tags: [] },
    ]));

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems[0].category).toBe('fact');
  });

  it('filters out items with empty content', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue(JSON.stringify([
      { content: '', category: 'fact', tags: [] },
      { content: '  ', category: 'fact', tags: [] },
      { content: 'valid', category: 'fact', tags: [] },
    ]));

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems).toHaveLength(1);
    expect(result.extractedItems[0].content).toBe('valid');
  });

  it('handles LLM returning empty array', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue('[]');

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems).toHaveLength(0);
  });

  it('handles LLM returning non-array (malformed)', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue('{"not":"an array"}');

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems).toHaveLength(0);
  });

  it('handles completely invalid JSON from LLM', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue('This is not JSON at all, just text');

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.extractedItems).toHaveLength(0);
  });

  it('marks duplicates against existing memory', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    // Pre-existing memory
    await seedMemoryItems(workspace.id, [
      { content: 'Use PostgreSQL', category: 'decision' },
    ]);

    chatCompletion.mockResolvedValue(JSON.stringify([
      { content: 'Use PostgreSQL', category: 'decision', tags: [] }, // dupe
      { content: 'Brand new insight', category: 'fact', tags: [] },  // new
    ]));

    const result = await previewSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);

    const dupe = result.extractedItems.find(i => i.content === 'Use PostgreSQL');
    expect(dupe.isDuplicate).toBe(true);
    expect(dupe.accepted).toBe(false);

    const fresh = result.extractedItems.find(i => i.content === 'Brand new insight');
    expect(fresh.isDuplicate).toBe(false);
    expect(fresh.accepted).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT PREVIEWED ITEMS
// ══════════════════════════════════════════════════════════════════════════════

describe('commitPreviewedItems', () => {
  it('saves accepted items + creates snapshot record', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    const result = await commitPreviewedItems(
      workspace.id,
      chat.id,
      [
        { content: 'Decision item', category: 'decision', tags: ['test'] },
        { content: 'Fact item', category: 'fact', tags: [] },
      ],
      5,    // messageCount
      null  // stateFile
    );

    expect(result.success).toBe(true);
    expect(result.newItems).toHaveLength(2);

    // Verify snapshot record
    const snapshots = await db.snapshots.where('workspaceId').equals(workspace.id).toArray();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].itemCount).toBe(2);
    expect(snapshots[0].messageCount).toBe(5);
  });

  it('uses suggestTags when item has no tags', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(3);

    const result = await commitPreviewedItems(
      workspace.id,
      chat.id,
      [{ content: 'Use React hooks for state', category: 'decision', tags: [] }],
      3,
      null
    );

    expect(result.success).toBe(true);
    // suggestTags should have added 'react' tag
    expect(result.newItems[0].tags).toContain('react');
  });

  it('skips items that fail validation and counts them', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(3);

    const result = await commitPreviewedItems(
      workspace.id,
      chat.id,
      [
        { content: 'Valid item', category: 'fact', tags: [] },
        { content: '', category: 'fact', tags: [] },  // invalid: empty content
      ],
      3,
      null
    );

    expect(result.success).toBe(true);
    expect(result.newItems).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COMMIT SNAPSHOT (legacy one-step flow)
// ══════════════════════════════════════════════════════════════════════════════

describe('commitSnapshot (legacy)', () => {
  it('extracts, dedupes, and saves in one step', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);

    chatCompletion.mockResolvedValue(JSON.stringify([
      { content: 'New decision', category: 'decision', tags: ['test'] },
    ]));

    const result = await commitSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.newItems).toHaveLength(1);
    expect(result.skipped).toBe(0);

    // Verify item in DB
    const items = await db.memoryItems.where('workspaceId').equals(workspace.id).toArray();
    expect(items).toHaveLength(1);
    expect(items[0].content).toBe('New decision');
  });

  it('deduplicates against existing memory', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);
    await seedMemoryItems(workspace.id, [
      { content: 'Existing fact', category: 'fact' },
    ]);

    chatCompletion.mockResolvedValue(JSON.stringify([
      { content: 'Existing fact', category: 'fact', tags: [] },    // dupe
      { content: 'New insight', category: 'fact', tags: [] },       // new
    ]));

    const result = await commitSnapshot(workspace.id, chat.id);
    expect(result.success).toBe(true);
    expect(result.newItems).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.newItems[0].content).toBe('New insight');
  });

  it('fails gracefully for missing workspace', async () => {
    const result = await commitSnapshot('nonexistent-ws', 'some-chat');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('fails gracefully when no messages', async () => {
    const ws = { id: 'no-msgs-ws', name: 'Empty', createdAt: Date.now(), updatedAt: Date.now(), stateFile: {} };
    await db.workspaces.add(ws);
    const chat = { id: 'empty-chat', workspaceId: ws.id, title: 'Empty', createdAt: Date.now(), updatedAt: Date.now() };
    await db.chats.add(chat);

    const result = await commitSnapshot(ws.id, chat.id);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No messages');
  });
});
