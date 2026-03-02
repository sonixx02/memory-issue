import { v4 as uuidv4 } from 'uuid';
import db from './database.js';
import { clearWorkspaceIndex } from '../ai/ragService.js';

// Create a new workspace with an empty state file
export async function createWorkspace(name) {
  const now = Date.now();
  const workspace = {
    id: uuidv4(),
    name,
    createdAt: now,
    updatedAt: now,
    stateFile: {
      project_goal: '',
      locked_decisions: [],
      rejected_ideas: [],
      current_status: '',
      key_insights: [],
    },
  };
  await db.workspaces.add(workspace);
  return workspace;
}

// Get all workspaces, newest first
export function getAllWorkspaces() {
  return db.workspaces.orderBy('createdAt').reverse().toArray();
}

// Get a single workspace by ID
export function getWorkspace(id) {
  return db.workspaces.get(id);
}

// Rename a workspace
export async function renameWorkspace(id, newName) {
  await db.workspaces.update(id, {
    name: newName,
    updatedAt: Date.now(),
  });
}

// Update a workspace's state file (called by Snapshot engine)
export async function updateStateFile(id, newStateFile) {
  await db.workspaces.update(id, {
    stateFile: newStateFile,
    updatedAt: Date.now(),
  });
}

// Delete a workspace and all its chats, messages, snapshots, and memory items
export async function deleteWorkspace(id) {
  await db.transaction('rw', db.workspaces, db.chats, db.messages, db.snapshots, db.memoryItems, async () => {
    // Get all chats in this workspace
    const chats = await db.chats.where('workspaceId').equals(id).toArray();
    const chatIds = chats.map((c) => c.id);

    // Delete all messages in those chats
    await db.messages.where('chatId').anyOf(chatIds).delete();

    // Delete all chats
    await db.chats.where('workspaceId').equals(id).delete();

    // Delete all snapshots
    await db.snapshots.where('workspaceId').equals(id).delete();

    // Delete all memory items for this workspace
    await db.memoryItems.where('workspaceId').equals(id).delete();

    // Delete the workspace itself
    await db.workspaces.delete(id);
  });

  // Clean up RAG index (in-memory Orama index + settings tracking key)
  await clearWorkspaceIndex(id);
}
