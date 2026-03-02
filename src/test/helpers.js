/**
 * Shared test helpers — factory functions and DB utilities.
 */

import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';

// ── Factory functions ──

export function createTestWorkspace(overrides = {}) {
  const now = Date.now();
  return {
    id: uuidv4(),
    name: `Test Workspace ${Math.random().toString(36).slice(2, 6)}`,
    createdAt: now,
    updatedAt: now,
    stateFile: {
      project_goal: '',
      locked_decisions: [],
      rejected_ideas: [],
      current_status: '',
      key_insights: [],
    },
    ...overrides,
  };
}

export function createTestChat(workspaceId, overrides = {}) {
  const now = Date.now();
  return {
    id: uuidv4(),
    workspaceId,
    title: 'Test Chat',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createTestMessage(chatId, role = 'user', content = 'Hello', overrides = {}) {
  return {
    id: uuidv4(),
    chatId,
    role,
    content,
    timestamp: Date.now(),
    ...overrides,
  };
}

export function createTestMemoryItem(workspaceId, overrides = {}) {
  const now = Date.now();
  return {
    id: uuidv4(),
    workspaceId,
    chatId: null,
    messageId: null,
    content: 'Test memory item',
    category: 'fact',
    tags: ['test'],
    pinned: true,
    source: 'user',
    scope: 'workspace',
    supersedes: null,
    timesUsed: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

export function createTestSetting(key, value) {
  return { key, value };
}

// ── DB Utilities ──

/**
 * Clear all Dexie tables. Call in beforeEach() to reset state.
 */
export async function clearAllTables() {
  for (const table of db.tables) {
    await table.clear();
  }
}

/**
 * Seed the DB with a full workspace + chat + messages for integration tests.
 * Returns the IDs for chaining.
 */
export async function seedWorkspaceWithConversation(messageCount = 10) {
  const ws = createTestWorkspace();
  await db.workspaces.add(ws);

  const chat = createTestChat(ws.id);
  await db.chats.add(chat);

  const messages = [];
  for (let i = 0; i < messageCount; i++) {
    const msg = createTestMessage(
      chat.id,
      i % 2 === 0 ? 'user' : 'assistant',
      `Message ${i}: ${i % 2 === 0 ? 'Question about topic ' + i : 'Detailed answer about topic ' + (i - 1)}`,
      { timestamp: Date.now() - (messageCount - i) * 1000 }
    );
    await db.messages.add(msg);
    messages.push(msg);
  }

  return { workspace: ws, chat, messages };
}

/**
 * Seed multiple memory items at once for conflict/budget tests.
 */
export async function seedMemoryItems(workspaceId, items) {
  const created = [];
  for (const override of items) {
    const item = createTestMemoryItem(workspaceId, override);
    await db.memoryItems.add(item);
    created.push(item);
  }
  return created;
}

/**
 * Generate a fake 384-dim embedding from a string (deterministic).
 * Uses a simple hash-based approach so similar strings get similar vectors.
 */
export function fakeEmbed(text) {
  const arr = new Float32Array(384);
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  for (let i = 0; i < 384; i++) {
    // Deterministic pseudo-random from hash + index
    hash = ((hash << 5) - hash + i) | 0;
    arr[i] = (hash & 0xffff) / 0xffff - 0.5;
  }
  // Normalize to unit vector
  const norm = Math.sqrt(arr.reduce((s, v) => s + v * v, 0));
  if (norm > 0) for (let i = 0; i < 384; i++) arr[i] /= norm;
  return arr;
}
