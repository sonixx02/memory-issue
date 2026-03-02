import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

// Add a message to a chat
// role: 'user' | 'assistant' | 'system'
export async function addMessage(chatId, role, content) {
  const message = {
    id: uuidv4(),
    chatId,
    role,
    content,
    timestamp: Date.now(),
  };
  await db.messages.add(message);

  // Update the parent chat's updatedAt
  await db.chats.update(chatId, { updatedAt: Date.now() });

  return message;
}

// Get all messages in a chat, oldest first
export function getMessagesByChat(chatId) {
  return db.messages.where('chatId').equals(chatId).sortBy('timestamp');
}

// Update a message's content (used during streaming to build up the AI response)
export async function updateMessageContent(id, content) {
  await db.messages.update(id, { content });
}

// Delete a single message
export async function deleteMessage(id) {
  await db.messages.delete(id);
}

// Get the last N messages from a chat (for context window management)
export async function getRecentMessages(chatId, limit = 20) {
  const all = await db.messages.where('chatId').equals(chatId).sortBy('timestamp');
  return all.slice(-limit);
}
