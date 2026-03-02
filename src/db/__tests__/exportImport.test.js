/**
 * exportImport.test.js — Tests for data export/import, memory export/import.
 *
 * Covers: exportMemoryItems, importMemoryItems (upsert, format detection),
 * importData (full restore), edge cases.
 *
 * Note: exportAllData and exportMemoryItems use DOM APIs (Blob, createElement)
 * which are stubbed in setup.js. We test the logic, not the download trigger.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../db/database.js';
import { importMemoryItems, importData } from '../../db/exportImport.js';
import { addMemoryItem, getMemoryItemsForWorkspace } from '../../db/memoryHelpers.js';
import { clearAllTables, createTestMemoryItem } from '../../test/helpers.js';

const WS = 'export-ws';

beforeEach(async () => {
  await clearAllTables();
});

// ── Helper: create a File-like object from JSON ──
function jsonFile(data) {
  const text = JSON.stringify(data);
  return {
    text: () => Promise.resolve(text),
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT MEMORY ITEMS
// ══════════════════════════════════════════════════════════════════════════════

describe('importMemoryItems', () => {
  it('imports items from snapshot-ai-memory format', async () => {
    const items = [
      createTestMemoryItem(WS, { id: 'imp-1', content: 'Imported fact' }),
      createTestMemoryItem(WS, { id: 'imp-2', content: 'Another fact' }),
    ];

    const file = jsonFile({
      _format: 'snapshot-ai-memory',
      _version: 1,
      items,
    });

    const result = await importMemoryItems(file);
    expect(result.success).toBe(true);
    expect(result.imported).toBe(2);

    const fromDb = await db.memoryItems.get('imp-1');
    expect(fromDb.content).toBe('Imported fact');
  });

  it('imports items from full backup format (extracts memoryItems)', async () => {
    const items = [
      createTestMemoryItem(WS, { id: 'backup-1', content: 'From backup' }),
    ];

    const file = jsonFile({
      workspaces: [],
      chats: [],
      memoryItems: items,
    });

    const result = await importMemoryItems(file);
    expect(result.success).toBe(true);
    expect(result.imported).toBe(1);
  });

  it('upserts by ID — keeps newer on conflict', async () => {
    // Existing item with older timestamp
    const existing = createTestMemoryItem(WS, {
      id: 'upsert-1',
      content: 'Old content',
      updatedAt: 1000,
    });
    await db.memoryItems.add(existing);

    // Import with newer timestamp
    const file = jsonFile({
      _format: 'snapshot-ai-memory',
      _version: 1,
      items: [
        { ...existing, content: 'New content', updatedAt: 2000 },
      ],
    });

    await importMemoryItems(file);
    const fromDb = await db.memoryItems.get('upsert-1');
    expect(fromDb.content).toBe('New content');
  });

  it('upserts by ID — keeps existing if newer', async () => {
    const existing = createTestMemoryItem(WS, {
      id: 'upsert-2',
      content: 'Newer content',
      updatedAt: 3000,
    });
    await db.memoryItems.add(existing);

    // Import with older timestamp
    const file = jsonFile({
      _format: 'snapshot-ai-memory',
      _version: 1,
      items: [
        { ...existing, content: 'Old import content', updatedAt: 1000 },
      ],
    });

    await importMemoryItems(file);
    const fromDb = await db.memoryItems.get('upsert-2');
    expect(fromDb.content).toBe('Newer content'); // kept existing
  });

  it('re-scopes to target workspace when provided', async () => {
    const item = createTestMemoryItem('original-ws', { id: 'resc-1', scope: 'workspace' });
    const file = jsonFile({
      _format: 'snapshot-ai-memory',
      _version: 1,
      items: [item],
    });

    await importMemoryItems(file, { targetWorkspaceId: 'new-ws' });
    const fromDb = await db.memoryItems.get('resc-1');
    expect(fromDb.workspaceId).toBe('new-ws');
  });

  it('preserves global scope (workspaceId=null) when re-scoping', async () => {
    const item = createTestMemoryItem(null, { id: 'glob-1', scope: 'global' });
    const file = jsonFile({
      _format: 'snapshot-ai-memory',
      _version: 1,
      items: [item],
    });

    await importMemoryItems(file, { targetWorkspaceId: 'new-ws' });
    const fromDb = await db.memoryItems.get('glob-1');
    expect(fromDb.workspaceId).toBeNull(); // global stays null
  });

  it('rejects unrecognized format', async () => {
    const file = jsonFile({ random: 'data' });
    const result = await importMemoryItems(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain('Unrecognized');
  });

  it('rejects empty items array', async () => {
    const file = jsonFile({
      _format: 'snapshot-ai-memory',
      _version: 1,
      items: [],
    });

    const result = await importMemoryItems(file);
    expect(result.success).toBe(false);
    expect(result.error).toContain('No memory items');
  });

  it('handles invalid JSON gracefully', async () => {
    const file = { text: () => Promise.resolve('not json at all') };
    const result = await importMemoryItems(file);
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// IMPORT DATA (full restore)
// ══════════════════════════════════════════════════════════════════════════════

describe('importData', () => {
  it('clears and restores all tables', async () => {
    // Add some existing data
    await db.settings.put({ key: 'old', value: 'data' });

    const backupData = {
      workspaces: [{ id: 'ws-1', name: 'Restored', createdAt: 1000, updatedAt: 1000 }],
      chats: [{ id: 'chat-1', workspaceId: 'ws-1', title: 'Chat', createdAt: 1000, updatedAt: 1000 }],
      messages: [{ id: 'msg-1', chatId: 'chat-1', role: 'user', content: 'Hello', timestamp: 1000 }],
      snapshots: [],
      settings: [{ key: 'restored', value: true }],
      memoryItems: [],
    };

    const file = jsonFile(backupData);
    const result = await importData(file);
    expect(result.success).toBe(true);

    // Old data should be gone
    expect(await db.settings.get('old')).toBeUndefined();

    // Restored data should be present
    expect(await db.workspaces.get('ws-1')).toBeDefined();
    expect(await db.chats.get('chat-1')).toBeDefined();
    expect(await db.messages.get('msg-1')).toBeDefined();
    expect(await db.settings.get('restored')).toBeDefined();
  });

  it('handles invalid JSON gracefully', async () => {
    const file = { text: () => Promise.resolve('broken json') };
    const result = await importData(file);
    expect(result.success).toBe(false);
  });
});
