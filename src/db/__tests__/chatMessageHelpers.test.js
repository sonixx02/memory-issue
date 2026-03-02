/**
 * chatHelpers.test.js — Tests for chat CRUD + delete with memory unlink.
 * messageHelpers.test.js — Tests for message CRUD + getRecentMessages.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import db from '../../db/database.js';
import {
  createChat,
  getChatsByWorkspace,
  getChat,
  renameChat,
  deleteChat,
} from '../../db/chatHelpers.js';
import {
  addMessage,
  getMessagesByChat,
  updateMessageContent,
  deleteMessage,
  getRecentMessages,
} from '../../db/messageHelpers.js';
import { clearAllTables, createTestWorkspace, createTestMemoryItem } from '../../test/helpers.js';

const WS_ID = 'test-ws-id';

beforeEach(async () => {
  await clearAllTables();
  // Ensure workspace exists for foreign key consistency
  const ws = createTestWorkspace({ id: WS_ID });
  await db.workspaces.add(ws);
});

// ══════════════════════════════════════════════════════════════════════════════
// CHAT HELPERS
// ══════════════════════════════════════════════════════════════════════════════

describe('createChat', () => {
  it('creates a chat with UUID, title, and timestamps', async () => {
    const chat = await createChat(WS_ID, 'Test Title');
    expect(chat.id).toBeTruthy();
    expect(chat.workspaceId).toBe(WS_ID);
    expect(chat.title).toBe('Test Title');
    expect(chat.createdAt).toBeLessThanOrEqual(Date.now());
  });

  it('defaults title to "New Chat"', async () => {
    const chat = await createChat(WS_ID);
    expect(chat.title).toBe('New Chat');
  });
});

describe('getChatsByWorkspace', () => {
  it('returns chats for workspace, newest first', async () => {
    await createChat(WS_ID, 'Old');
    await new Promise(r => setTimeout(r, 5));
    await createChat(WS_ID, 'New');

    const chats = await getChatsByWorkspace(WS_ID);
    expect(chats).toHaveLength(2);
    expect(chats[0].title).toBe('New');
  });

  it('returns empty array for workspace with no chats', async () => {
    const chats = await getChatsByWorkspace('no-chats-ws');
    expect(chats).toEqual([]);
  });
});

describe('getChat', () => {
  it('returns chat by ID', async () => {
    const chat = await createChat(WS_ID, 'Lookup');
    const found = await getChat(chat.id);
    expect(found.title).toBe('Lookup');
  });

  it('returns undefined for missing chat', async () => {
    expect(await getChat('missing')).toBeUndefined();
  });
});

describe('renameChat', () => {
  it('updates title and updatedAt', async () => {
    const chat = await createChat(WS_ID, 'Before');
    await new Promise(r => setTimeout(r, 5));
    await renameChat(chat.id, 'After');
    const updated = await getChat(chat.id);
    expect(updated.title).toBe('After');
    expect(updated.updatedAt).toBeGreaterThan(chat.updatedAt);
  });
});

describe('deleteChat', () => {
  it('deletes chat and its messages', async () => {
    const chat = await createChat(WS_ID);
    await addMessage(chat.id, 'user', 'Hello');
    await addMessage(chat.id, 'assistant', 'Hi');

    await deleteChat(chat.id);

    expect(await getChat(chat.id)).toBeUndefined();
    expect(await getMessagesByChat(chat.id)).toEqual([]);
  });

  it('unlinks memory items (chatId → null) but keeps them', async () => {
    const chat = await createChat(WS_ID);
    const mem = createTestMemoryItem(WS_ID, { chatId: chat.id, messageId: 'msg-1' });
    await db.memoryItems.add(mem);

    await deleteChat(chat.id);

    const memAfter = await db.memoryItems.get(mem.id);
    expect(memAfter).toBeDefined();
    expect(memAfter.chatId).toBeNull();
    expect(memAfter.content).toBe(mem.content); // content preserved
  });

  it('does not affect other chats', async () => {
    const chat1 = await createChat(WS_ID, 'Keep');
    const chat2 = await createChat(WS_ID, 'Delete');
    await addMessage(chat1.id, 'user', 'keep this');
    await addMessage(chat2.id, 'user', 'delete this');

    await deleteChat(chat2.id);

    expect(await getChat(chat1.id)).toBeDefined();
    const msgs = await getMessagesByChat(chat1.id);
    expect(msgs).toHaveLength(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// MESSAGE HELPERS
// ══════════════════════════════════════════════════════════════════════════════

describe('addMessage', () => {
  it('creates a message with UUID, role, content, and timestamp', async () => {
    const chat = await createChat(WS_ID);
    const msg = await addMessage(chat.id, 'user', 'Hello world');
    expect(msg.id).toBeTruthy();
    expect(msg.chatId).toBe(chat.id);
    expect(msg.role).toBe('user');
    expect(msg.content).toBe('Hello world');
    expect(msg.timestamp).toBeLessThanOrEqual(Date.now());
  });

  it('updates parent chat updatedAt', async () => {
    const chat = await createChat(WS_ID);
    const beforeUpdate = chat.updatedAt;
    await new Promise(r => setTimeout(r, 5));
    await addMessage(chat.id, 'user', 'trigger update');
    const updated = await getChat(chat.id);
    expect(updated.updatedAt).toBeGreaterThan(beforeUpdate);
  });
});

describe('getMessagesByChat', () => {
  it('returns messages sorted oldest first', async () => {
    const chat = await createChat(WS_ID);
    await addMessage(chat.id, 'user', 'First');
    await new Promise(r => setTimeout(r, 5));
    await addMessage(chat.id, 'assistant', 'Second');

    const msgs = await getMessagesByChat(chat.id);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].content).toBe('First');
    expect(msgs[1].content).toBe('Second');
  });

  it('returns empty array for chat with no messages', async () => {
    const msgs = await getMessagesByChat('empty-chat');
    expect(msgs).toEqual([]);
  });
});

describe('updateMessageContent', () => {
  it('updates content (streaming use case)', async () => {
    const chat = await createChat(WS_ID);
    const msg = await addMessage(chat.id, 'assistant', 'part 1');
    await updateMessageContent(msg.id, 'part 1 part 2 part 3');
    const updated = await db.messages.get(msg.id);
    expect(updated.content).toBe('part 1 part 2 part 3');
  });
});

describe('deleteMessage', () => {
  it('removes a single message', async () => {
    const chat = await createChat(WS_ID);
    const msg = await addMessage(chat.id, 'user', 'to delete');
    await deleteMessage(msg.id);
    expect(await db.messages.get(msg.id)).toBeUndefined();
  });
});

describe('getRecentMessages', () => {
  it('returns the last N messages (default 20)', async () => {
    const chat = await createChat(WS_ID);
    for (let i = 0; i < 30; i++) {
      await addMessage(chat.id, 'user', `msg ${i}`);
    }

    const recent = await getRecentMessages(chat.id);
    expect(recent).toHaveLength(20);
    expect(recent[0].content).toBe('msg 10'); // First of last 20
    expect(recent[19].content).toBe('msg 29'); // Last
  });

  it('respects custom limit', async () => {
    const chat = await createChat(WS_ID);
    for (let i = 0; i < 10; i++) {
      await addMessage(chat.id, 'user', `msg ${i}`);
    }

    const recent = await getRecentMessages(chat.id, 5);
    expect(recent).toHaveLength(5);
    expect(recent[0].content).toBe('msg 5');
  });

  it('returns all messages when count < limit', async () => {
    const chat = await createChat(WS_ID);
    await addMessage(chat.id, 'user', 'only one');

    const recent = await getRecentMessages(chat.id, 20);
    expect(recent).toHaveLength(1);
  });

  it('returns empty array for empty chat', async () => {
    const recent = await getRecentMessages('empty', 10);
    expect(recent).toEqual([]);
  });
});
