import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

// Create a new chat thread. workspaceId=null for general (non-workspace) chats.
export async function createChat(workspaceId = null, title = 'New Chat') {
  const now = Date.now();
  const chat = {
    id: uuidv4(),
    workspaceId: workspaceId ?? null,
    title,
    createdAt: now,
    updatedAt: now,
  };
  await db.chats.add(chat);
  return chat;
}

// Get all chats for a workspace, newest first
export function getChatsByWorkspace(workspaceId) {
  return db.chats.where('workspaceId').equals(workspaceId).reverse().sortBy('createdAt');
}

// Get all general chats (no workspace), newest first
export async function getGeneralChats() {
  const all = await db.chats.toArray();
  return all
    .filter(c => c.workspaceId === null || c.workspaceId === undefined)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

// Get a single chat by ID
export function getChat(id) {
  return db.chats.get(id);
}

// Rename a chat
export async function renameChat(id, newTitle) {
  await db.chats.update(id, {
    title: newTitle,
    updatedAt: Date.now(),
  });
}

// Delete a chat and all its messages; unlink memory items (keep them under workspace)
export async function deleteChat(id) {
  await db.transaction('rw', db.chats, db.messages, db.memoryItems, async () => {
    await db.messages.where('chatId').equals(id).delete();
    // Unlink memory items from this chat but keep them (they belong to workspace)
    await db.memoryItems.where('chatId').equals(id).modify({ chatId: null });
    await db.chats.delete(id);
  });
}
