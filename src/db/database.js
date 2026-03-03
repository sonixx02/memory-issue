import Dexie from 'dexie';

// Create the database instance
const db = new Dexie('SnapshotAI');

// v1 — original schema
db.version(1).stores({
  workspaces: '&id, name, createdAt, updatedAt',
  chats: '&id, workspaceId, createdAt, updatedAt',
  messages: '&id, chatId, timestamp',
  snapshots: '&id, workspaceId, timestamp',
  settings: '&key',
});

// v2 — add memoryItems table
db.version(2).stores({
  workspaces: '&id, name, createdAt, updatedAt',
  chats: '&id, workspaceId, createdAt, updatedAt',
  messages: '&id, chatId, timestamp',
  snapshots: '&id, workspaceId, timestamp',
  settings: '&key',
  memoryItems: '&id, workspaceId, chatId, category, *tags, pinned, scope, createdAt, updatedAt',
});

// v3 — add attachments table
db.version(3).stores({
  workspaces: '&id, name, createdAt, updatedAt',
  chats: '&id, workspaceId, createdAt, updatedAt',
  messages: '&id, chatId, timestamp',
  snapshots: '&id, workspaceId, timestamp',
  settings: '&key',
  memoryItems: '&id, workspaceId, chatId, category, *tags, pinned, scope, createdAt, updatedAt',
  attachments: '&id, messageId, chatId, type, createdAt',
});

// Request persistent storage so the browser won't evict our data
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((granted) => {
    if (granted) console.log('✅ Persistent storage granted');
    else console.warn('⚠️ Persistent storage denied — data may be evicted');
  });
}

// No-op for now — per-user DB can be added later via a React context approach
export function initDb() { return db; }

export default db;
