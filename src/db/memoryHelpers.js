import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

// ── Constants ──

const VALID_CATEGORIES = ['decision', 'fact', 'preference', 'snippet', 'rejected', 'code_style'];
const VALID_SCOPES = ['global', 'workspace'];
const VALID_SOURCES = ['user', 'ai-suggested', 'snapshot', 'manual', 'teach-mode'];

// Categories that are pinned by default when created
const DEFAULT_PINNED_CATEGORIES = new Set(['decision', 'fact', 'preference', 'rejected', 'code_style']);

// ── Create ──

/**
 * Create a new Memory Item.
 *
 * @param {object} params
 * @param {string|null} params.workspaceId  - null for global items
 * @param {string|null} params.chatId       - origin chat (nullable)
 * @param {string|null} params.messageId    - origin message (nullable)
 * @param {string}      params.content      - the memory text
 * @param {string}      params.category     - decision|fact|preference|snippet|rejected|code_style
 * @param {string[]}    params.tags         - user-defined + auto-suggested tags
 * @param {string}      params.source       - user|ai-suggested|snapshot|manual|teach-mode
 * @param {string}      params.scope        - global|workspace
 * @param {boolean}     [params.pinned]     - override default pinning
 * @param {string|null} [params.supersedes] - ID of memory this replaces
 * @returns {Promise<object>} The created Memory Item
 */
export async function addMemoryItem({
  workspaceId = null,
  chatId = null,
  messageId = null,
  content,
  category,
  tags = [],
  source = 'user',
  scope = 'workspace',
  pinned,
  supersedes = null,
}) {
  if (!content?.trim()) throw new Error('Memory item content is required');
  if (!VALID_CATEGORIES.includes(category)) throw new Error(`Invalid category: ${category}`);
  if (!VALID_SCOPES.includes(scope)) throw new Error(`Invalid scope: ${scope}`);
  if (!VALID_SOURCES.includes(source)) throw new Error(`Invalid source: ${source}`);

  // Default pinning based on category if not explicitly set
  const isPinned = pinned !== undefined ? pinned : DEFAULT_PINNED_CATEGORIES.has(category);

  // Global items don't belong to a workspace
  const effectiveWorkspaceId = scope === 'global' ? null : workspaceId;

  const now = Date.now();
  const item = {
    id: uuidv4(),
    workspaceId: effectiveWorkspaceId,
    chatId,
    messageId,
    content: content.trim(),
    category,
    tags: normalizeTags(tags),
    pinned: isPinned,
    source,
    scope,
    supersedes,
    timesUsed: 0,
    lastUsedAt: null,
    createdAt: now,
    updatedAt: now,
  };

  await db.memoryItems.add(item);

  // If this supersedes another item, mark the old one as rejected
  if (supersedes) {
    const old = await db.memoryItems.get(supersedes);
    if (old && old.category !== 'rejected') {
      await db.memoryItems.update(supersedes, {
        category: 'rejected',
        pinned: true, // rejected items stay in context as negative signal
        updatedAt: now,
      });
    }
  }

  return item;
}

// ── Read ──

/**
 * Get a single Memory Item by ID.
 */
export function getMemoryItem(id) {
  return db.memoryItems.get(id);
}

/**
 * Get all Memory Items for a workspace (including global items).
 * Returns workspace-scoped items for the given workspace + all global items.
 */
export async function getMemoryItemsForWorkspace(workspaceId) {
  const [workspaceItems, globalItems] = await Promise.all([
    workspaceId
      ? db.memoryItems.where('workspaceId').equals(workspaceId).toArray()
      : [],
    db.memoryItems.where('scope').equals('global').toArray(),
  ]);

  // Merge and dedupe (global items have workspaceId = null)
  const seen = new Set();
  const result = [];
  for (const item of [...workspaceItems, ...globalItems]) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }

  return result.sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Get only pinned Memory Items for injection into the system prompt.
 * Returns global pinned + workspace pinned, grouped by category.
 */
export async function getPinnedMemories(workspaceId) {
  const all = await getMemoryItemsForWorkspace(workspaceId);
  const pinned = all.filter(item => item.pinned);

  // Group by category
  const grouped = {};
  for (const item of pinned) {
    if (!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  }

  return { items: pinned, grouped };
}

/**
 * Get Memory Items filtered by a specific tag.
 */
export function getMemoryItemsByTag(tag) {
  return db.memoryItems.where('tags').equals(tag.toLowerCase().trim()).toArray();
}

/**
 * Get Memory Items for a specific chat (to show what memories came from this chat).
 */
export function getMemoryItemsByChat(chatId) {
  return db.memoryItems.where('chatId').equals(chatId).toArray();
}

/**
 * Get Memory Items by category within a workspace (or global).
 */
export async function getMemoryItemsByCategory(workspaceId, category) {
  const all = await getMemoryItemsForWorkspace(workspaceId);
  return all.filter(item => item.category === category);
}

/**
 * Get all unique tags across all Memory Items for a workspace (+ global).
 * Returns [{tag, count}] sorted by count descending.
 */
export async function getAllTags(workspaceId) {
  const items = await getMemoryItemsForWorkspace(workspaceId);
  const tagCounts = {};
  for (const item of items) {
    for (const tag of (item.tags || [])) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
  }
  return Object.entries(tagCounts)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Get snippet-category Memory Items for a workspace (for fuzzy cache).
 */
export async function getSnippets(workspaceId) {
  const all = await getMemoryItemsForWorkspace(workspaceId);
  return all.filter(item => item.category === 'snippet');
}

// ── Update ──

/**
 * Update a Memory Item's fields.
 */
export async function updateMemoryItem(id, updates) {
  const allowed = ['content', 'category', 'tags', 'pinned', 'scope', 'supersedes'];
  const sanitized = { updatedAt: Date.now() };

  for (const key of allowed) {
    if (updates[key] !== undefined) {
      if (key === 'tags') {
        sanitized.tags = normalizeTags(updates.tags);
      } else if (key === 'category' && !VALID_CATEGORIES.includes(updates.category)) {
        throw new Error(`Invalid category: ${updates.category}`);
      } else if (key === 'scope' && !VALID_SCOPES.includes(updates.scope)) {
        throw new Error(`Invalid scope: ${updates.scope}`);
      } else {
        sanitized[key] = updates[key];
      }
    }
  }

  // If switching to global scope, clear workspaceId
  if (sanitized.scope === 'global') {
    sanitized.workspaceId = null;
  }

  await db.memoryItems.update(id, sanitized);
}

/**
 * Bump usage stats when a memory is injected into the context.
 * Call this from the Context Compiler.
 */
export async function bumpMemoryUsage(ids) {
  const now = Date.now();
  await Promise.all(
    ids.map(id =>
      db.memoryItems.where('id').equals(id).modify(item => {
        item.timesUsed = (item.timesUsed || 0) + 1;
        item.lastUsedAt = now;
      })
    )
  );
}

// ── Staleness Detection ──

const STALE_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const NEVER_USED_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days since creation

/**
 * Compute staleness info for a single memory item.
 * Returns { isStale, reason, daysSinceUsed, timesUsed }
 */
export function getStalenessInfo(item) {
  const now = Date.now();
  const timesUsed = item.timesUsed || 0;
  const lastUsedAt = item.lastUsedAt || null;
  const age = now - item.createdAt;

  // Never been used and older than 14 days
  if (timesUsed === 0 && age > NEVER_USED_THRESHOLD_MS) {
    return {
      isStale: true,
      reason: 'Never used in context',
      daysSinceUsed: null,
      timesUsed: 0,
    };
  }

  // Was used but not in the last 30 days
  if (lastUsedAt && (now - lastUsedAt) > STALE_THRESHOLD_MS) {
    const daysSinceUsed = Math.round((now - lastUsedAt) / (24 * 60 * 60 * 1000));
    return {
      isStale: true,
      reason: `Not used in ${daysSinceUsed} days`,
      daysSinceUsed,
      timesUsed,
    };
  }

  return {
    isStale: false,
    reason: null,
    daysSinceUsed: lastUsedAt ? Math.round((now - lastUsedAt) / (24 * 60 * 60 * 1000)) : null,
    timesUsed,
  };
}

/**
 * Get all stale memory items for a workspace.
 */
export async function getStaleItems(workspaceId) {
  const items = await getMemoryItemsForWorkspace(workspaceId);
  return items
    .filter(i => i.category !== 'rejected') // don't flag rejected items
    .map(i => ({ ...i, staleness: getStalenessInfo(i) }))
    .filter(i => i.staleness.isStale);
}

// ── Delete ──

/**
 * Delete a single Memory Item.
 */
export async function deleteMemoryItem(id) {
  await db.memoryItems.delete(id);
}

/**
 * Delete all Memory Items for a workspace (called when workspace is deleted).
 */
export async function deleteMemoryItemsByWorkspace(workspaceId) {
  await db.memoryItems.where('workspaceId').equals(workspaceId).delete();
}

/**
 * Delete all Memory Items originating from a specific chat.
 * Note: doesn't delete items — only clears the chatId/messageId reference.
 * The memories themselves may still be valuable.
 */
export async function unlinkMemoryItemsFromChat(chatId) {
  await db.memoryItems.where('chatId').equals(chatId).modify(item => {
    item.chatId = null;
    item.messageId = null;
  });
}

// ── Helpers ──

/**
 * Normalize tags: lowercase, trim, dedupe, remove empties.
 */
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return [];
  const seen = new Set();
  return tags
    .map(t => String(t).toLowerCase().trim())
    .filter(t => {
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    });
}

/**
 * Auto-suggest tags based on content and chat title.
 * Simple keyword extraction — no LLM call.
 */
export function suggestTags(content, chatTitle = '') {
  const text = `${content} ${chatTitle}`.toLowerCase();
  const suggestions = [];

  // Only high-confidence tech keywords (reduced list to avoid noisy tags)
  const techKeywords = [
    'react', 'vue', 'angular', 'next', 'node', 'express',
    'typescript', 'python', 'rust', 'java', 'go',
    'postgres', 'mongodb', 'redis', 'mysql',
    'docker', 'kubernetes', 'aws', 'api', 'auth',
    'tailwind', 'graphql',
  ];

  for (const kw of techKeywords) {
    // Word-boundary check to avoid partial matches (e.g. "javascript" matching "java")
    const re = new RegExp(`\\b${kw}\\b`);
    if (re.test(text)) {
      suggestions.push(kw);
    }
  }

  return [...new Set(suggestions)].slice(0, 3); // Max 3 fallback tags
}

// ── Promote / Demote scope ──

/**
 * Promote a workspace-scoped item to global scope so it appears in ALL workspaces.
 */
export async function promoteToGlobal(itemId) {
  const item = await db.memoryItems.get(itemId);
  if (!item) throw new Error('Item not found');
  await db.memoryItems.update(itemId, {
    scope: 'global',
    updatedAt: Date.now(),
  });
  return { ...item, scope: 'global' };
}

/**
 * Demote a global item back to workspace scope.
 */
export async function demoteToWorkspace(itemId) {
  const item = await db.memoryItems.get(itemId);
  if (!item) throw new Error('Item not found');
  await db.memoryItems.update(itemId, {
    scope: 'workspace',
    updatedAt: Date.now(),
  });
  return { ...item, scope: 'workspace' };
}

// ── Conflict Detection ──

/**
 * Detect potential conflicts between memory items in a workspace.
 * A conflict = two non-rejected items in the same category whose content
 * shares overlapping tags (same topic) but whose text differs noticeably.
 *
 * Returns an array of { itemA, itemB, reason } pairs.
 */
export async function detectConflicts(workspaceId) {
  const items = await getMemoryItemsForWorkspace(workspaceId);
  const active = items.filter(i => i.category !== 'rejected');

  const conflicts = [];
  const checked = new Set();

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      const pairKey = [a.id, b.id].sort().join(':');
      if (checked.has(pairKey)) continue;
      checked.add(pairKey);

      // Only compare within same category (decisions vs decisions, etc.)
      if (a.category !== b.category) continue;

      // Check tag overlap (need at least 1 shared tag)
      const sharedTags = a.tags?.filter(t => b.tags?.includes(t)) || [];
      if (sharedTags.length === 0) continue;

      // Check if content is meaningfully different (not near-duplicate)
      const normA = a.content.toLowerCase().replace(/[^\w\s]/g, '').trim();
      const normB = b.content.toLowerCase().replace(/[^\w\s]/g, '').trim();
      if (normA === normB) continue; // exact dupe, not a conflict

      // Heuristic: look for contradiction signals
      const isContradiction = detectContradictionSignals(a.content, b.content);
      if (isContradiction) {
        conflicts.push({
          itemA: a,
          itemB: b,
          sharedTags,
          reason: `Both are ${a.category}s about "${sharedTags[0]}" but appear to contradict each other.`,
        });
      }
    }
  }

  return conflicts;
}

/**
 * Heuristic: check if two content strings contain contradiction signals.
 * Looks for opposing terms (use X vs don't use X, prefer A vs prefer B).
 * Avoids false positives on additive facts (e.g. two different projects).
 */
function detectContradictionSignals(a, b) {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();

  // Skip items that use additive verbs — multiple instances are normal
  // e.g. "Developed X" and "Developed Y" are two different projects, not a conflict
  const additiveVerbs = ['developed', 'built', 'created', 'implemented', 'designed', 'made', 'completed', 'worked on', 'contributed to'];
  for (const verb of additiveVerbs) {
    if (la.startsWith(verb) && lb.startsWith(verb)) return false;
  }

  // Negation pattern: one says "use X" the other says "don't use X" or "avoid X"
  const negTerms = ["don't", "dont", "do not", "avoid", "never", "stop using"];
  for (const neg of negTerms) {
    if ((la.includes(neg) && !lb.includes(neg)) || (!la.includes(neg) && lb.includes(neg))) {
      // One has negation, other doesn't — require 3+ shared significant words
      // to avoid false positives on loosely related items
      const wordsA = new Set(la.split(/\s+/).filter(w => w.length > 3));
      const wordsB = new Set(lb.split(/\s+/).filter(w => w.length > 3));
      const shared = [...wordsA].filter(w => wordsB.has(w));
      if (shared.length >= 3) return true;
    }
  }

  // "Prefer X" vs "Prefer Y" — only truly exclusive verbs
  // Don't include "use"/"develop" — those are additive
  const preferA = la.match(/(?:prefer|choose|switch to|migrate to)\s+(\w+)/)?.[1];
  const preferB = lb.match(/(?:prefer|choose|switch to|migrate to)\s+(\w+)/)?.[1];
  if (preferA && preferB && preferA !== preferB) {
    return true;
  }

  return false;
}
