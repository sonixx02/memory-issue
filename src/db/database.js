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

// v2 — add memoryItems table + archived flag on chats
db.version(2).stores({
  workspaces: '&id, name, createdAt, updatedAt',
  chats: '&id, workspaceId, createdAt, updatedAt',
  messages: '&id, chatId, timestamp',
  snapshots: '&id, workspaceId, timestamp',
  settings: '&key',

  // Memory Items — user-curated knowledge base
  // *tags = MultiEntry index (query by individual tag)
  memoryItems: '&id, workspaceId, chatId, category, *tags, pinned, scope, createdAt, updatedAt',
});

// v3 — add attachments table for file uploads (images, videos, PDFs, etc.)
db.version(3).stores({
  workspaces: '&id, name, createdAt, updatedAt',
  chats: '&id, workspaceId, createdAt, updatedAt',
  messages: '&id, chatId, timestamp',
  snapshots: '&id, workspaceId, timestamp',
  settings: '&key',
  memoryItems: '&id, workspaceId, chatId, category, *tags, pinned, scope, createdAt, updatedAt',

  // Attachments — file uploads (images, videos, PDFs, documents)
  // messageId links to the message they were sent with
  attachments: '&id, messageId, chatId, type, createdAt',
});

// Request persistent storage so the browser won't evict our data
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then((granted) => {
    if (granted) {
      console.log('✅ Persistent storage granted');
    } else {
      console.warn('⚠️ Persistent storage denied — data may be evicted');
    }
  });
}

export default db;
