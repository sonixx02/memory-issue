/**
 * workspaceHelpers.test.js — Tests for workspace CRUD + cascading delete.
 *
 * Covers: createWorkspace, getAllWorkspaces, getWorkspace, renameWorkspace,
 * updateStateFile, deleteWorkspace (cascading: chats→messages→snapshots→memoryItems).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../../db/database.js';
import { clearAllTables, createTestChat, createTestMessage, createTestMemoryItem } from '../../test/helpers.js';

// Mock ragService.clearWorkspaceIndex since it relies on in-memory Orama state
vi.mock('../../ai/ragService.js', () => ({
  clearWorkspaceIndex: vi.fn(async () => {}),
}));

const {
  createWorkspace,
  getAllWorkspaces,
  getWorkspace,
  renameWorkspace,
  updateStateFile,
  deleteWorkspace,
} = await import('../../db/workspaceHelpers.js');

beforeEach(async () => {
  await clearAllTables();
  vi.clearAllMocks();
});

describe('createWorkspace', () => {
  it('creates a workspace with UUID, name, timestamps, and empty stateFile', async () => {
    const ws = await createWorkspace('My Project');
    expect(ws.id).toBeTruthy();
    expect(ws.name).toBe('My Project');
    expect(ws.createdAt).toBeLessThanOrEqual(Date.now());
    expect(ws.stateFile).toBeDefined();
    expect(ws.stateFile.project_goal).toBe('');
    expect(ws.stateFile.locked_decisions).toEqual([]);
  });

  it('persists to database', async () => {
    const ws = await createWorkspace('Persisted');
    const fromDb = await db.workspaces.get(ws.id);
    expect(fromDb).toBeDefined();
    expect(fromDb.name).toBe('Persisted');
  });
});

describe('getAllWorkspaces', () => {
  it('returns workspaces sorted newest first', async () => {
    const ws1 = await createWorkspace('First');
    await new Promise(r => setTimeout(r, 5));
    const ws2 = await createWorkspace('Second');

    const all = await getAllWorkspaces();
    expect(all).toHaveLength(2);
    expect(all[0].name).toBe('Second');
    expect(all[1].name).toBe('First');
  });

  it('returns empty array when no workspaces', async () => {
    const all = await getAllWorkspaces();
    expect(all).toEqual([]);
  });
});

describe('getWorkspace', () => {
  it('returns workspace by ID', async () => {
    const ws = await createWorkspace('Findable');
    const found = await getWorkspace(ws.id);
    expect(found.name).toBe('Findable');
  });

  it('returns undefined for missing ID', async () => {
    const found = await getWorkspace('nope');
    expect(found).toBeUndefined();
  });
});

describe('renameWorkspace', () => {
  it('updates name and updatedAt', async () => {
    const ws = await createWorkspace('Original');
    await new Promise(r => setTimeout(r, 5));
    await renameWorkspace(ws.id, 'Renamed');
    const updated = await getWorkspace(ws.id);
    expect(updated.name).toBe('Renamed');
    expect(updated.updatedAt).toBeGreaterThan(ws.updatedAt);
  });
});

describe('updateStateFile', () => {
  it('replaces the state file', async () => {
    const ws = await createWorkspace('State Test');
    const newState = { project_goal: 'Build a chat app', locked_decisions: ['Use React'], rejected_ideas: [], current_status: 'In progress', key_insights: [] };
    await updateStateFile(ws.id, newState);
    const updated = await getWorkspace(ws.id);
    expect(updated.stateFile.project_goal).toBe('Build a chat app');
    expect(updated.stateFile.locked_decisions).toEqual(['Use React']);
  });
});

describe('deleteWorkspace — cascading', () => {
  it('deletes workspace and all associated data', async () => {
    const ws = await createWorkspace('ToDelete');

    // Create associated data
    const chat = createTestChat(ws.id);
    await db.chats.add(chat);

    const msg1 = createTestMessage(chat.id, 'user', 'Hello');
    const msg2 = createTestMessage(chat.id, 'assistant', 'Hi there');
    await db.messages.bulkAdd([msg1, msg2]);

    const snapshot = { id: 'snap-1', workspaceId: ws.id, timestamp: Date.now(), memoryItemIds: [], itemCount: 0, skippedCount: 0, messageCount: 2, stateFile: null };
    await db.snapshots.add(snapshot);

    const mem = createTestMemoryItem(ws.id);
    await db.memoryItems.add(mem);

    // Delete workspace
    await deleteWorkspace(ws.id);

    // Verify everything is gone
    expect(await db.workspaces.get(ws.id)).toBeUndefined();
    expect(await db.chats.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.messages.where('chatId').equals(chat.id).count()).toBe(0);
    expect(await db.snapshots.where('workspaceId').equals(ws.id).count()).toBe(0);
    expect(await db.memoryItems.where('workspaceId').equals(ws.id).count()).toBe(0);
  });

  it('calls clearWorkspaceIndex for RAG cleanup', async () => {
    const { clearWorkspaceIndex } = await import('../../ai/ragService.js');
    const ws = await createWorkspace('RAG cleanup');
    await deleteWorkspace(ws.id);
    expect(clearWorkspaceIndex).toHaveBeenCalledWith(ws.id);
  });

  it('does not affect other workspaces', async () => {
    const ws1 = await createWorkspace('Keep');
    const ws2 = await createWorkspace('Delete');

    const chat1 = createTestChat(ws1.id);
    const chat2 = createTestChat(ws2.id);
    await db.chats.bulkAdd([chat1, chat2]);

    await deleteWorkspace(ws2.id);

    expect(await db.workspaces.get(ws1.id)).toBeDefined();
    expect(await db.chats.get(chat1.id)).toBeDefined();
  });

  it('handles workspace with no associated data', async () => {
    const ws = await createWorkspace('Empty');
    await expect(deleteWorkspace(ws.id)).resolves.not.toThrow();
    expect(await db.workspaces.get(ws.id)).toBeUndefined();
  });
});
