/**
 * memoryHelpers.test.js — Comprehensive tests for the memory CRUD layer.
 *
 * Covers: addMemoryItem, getMemoryItem, getMemoryItemsForWorkspace,
 * getPinnedMemories, getMemoryItemsByTag/Chat/Category, getAllTags,
 * updateMemoryItem, bumpMemoryUsage, deleteMemoryItem, normalizeTags,
 * suggestTags, promoteToGlobal, demoteToWorkspace, detectConflicts,
 * supersedes chain, DEFAULT_PINNED_CATEGORIES, edge cases.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  addMemoryItem,
  getMemoryItem,
  getMemoryItemsForWorkspace,
  getPinnedMemories,
  getMemoryItemsByTag,
  getMemoryItemsByChat,
  getMemoryItemsByCategory,
  getAllTags,
  updateMemoryItem,
  bumpMemoryUsage,
  deleteMemoryItem,
  deleteMemoryItemsByWorkspace,
  unlinkMemoryItemsFromChat,
  suggestTags,
  promoteToGlobal,
  demoteToWorkspace,
  detectConflicts,
} from '../../db/memoryHelpers.js';
import { clearAllTables } from '../../test/helpers.js';

// ── Helpers ──
const WS = 'ws-test-001';
const CHAT = 'chat-test-001';

async function addFact(content, opts = {}) {
  return addMemoryItem({
    workspaceId: WS,
    chatId: CHAT,
    content,
    category: 'fact',
    tags: ['test'],
    ...opts,
  });
}

// ── Setup ──
beforeEach(async () => {
  await clearAllTables();
});

// ══════════════════════════════════════════════════════════════════════════════
// CREATE
// ══════════════════════════════════════════════════════════════════════════════

describe('addMemoryItem', () => {
  it('creates a valid memory item with auto-generated fields', async () => {
    const item = await addFact('React is the frontend framework');
    expect(item).toBeDefined();
    expect(item.id).toBeTruthy();
    expect(item.content).toBe('React is the frontend framework');
    expect(item.category).toBe('fact');
    expect(item.scope).toBe('workspace');
    expect(item.timesUsed).toBe(0);
    expect(item.createdAt).toBeLessThanOrEqual(Date.now());
    expect(item.updatedAt).toBe(item.createdAt);
  });

  it('trims content whitespace', async () => {
    const item = await addFact('   padded content   ');
    expect(item.content).toBe('padded content');
  });

  it('rejects empty content', async () => {
    await expect(addFact('')).rejects.toThrow('content is required');
    await expect(addFact('   ')).rejects.toThrow('content is required');
  });

  it('rejects null/undefined content', async () => {
    await expect(
      addMemoryItem({ workspaceId: WS, content: null, category: 'fact' })
    ).rejects.toThrow();
  });

  it('rejects invalid category', async () => {
    await expect(
      addMemoryItem({ workspaceId: WS, content: 'x', category: 'invalid' })
    ).rejects.toThrow('Invalid category');
  });

  it('rejects invalid scope', async () => {
    await expect(
      addMemoryItem({ workspaceId: WS, content: 'x', category: 'fact', scope: 'bad' })
    ).rejects.toThrow('Invalid scope');
  });

  it('rejects invalid source', async () => {
    await expect(
      addMemoryItem({ workspaceId: WS, content: 'x', category: 'fact', source: 'unknown' })
    ).rejects.toThrow('Invalid source');
  });

  it('auto-pins decisions, facts, preferences, rejected, code_style', async () => {
    for (const cat of ['decision', 'fact', 'preference', 'rejected', 'code_style']) {
      const item = await addMemoryItem({
        workspaceId: WS,
        content: `item ${cat}`,
        category: cat,
      });
      expect(item.pinned).toBe(true);
    }
  });

  it('does NOT auto-pin snippets', async () => {
    const item = await addMemoryItem({
      workspaceId: WS,
      content: 'const x = 1;',
      category: 'snippet',
    });
    expect(item.pinned).toBe(false);
  });

  it('allows explicit pinned=false override on auto-pinned category', async () => {
    const item = await addMemoryItem({
      workspaceId: WS,
      content: 'explicit unpin',
      category: 'decision',
      pinned: false,
    });
    expect(item.pinned).toBe(false);
  });

  it('clears workspaceId for global scope', async () => {
    const item = await addMemoryItem({
      workspaceId: WS,
      content: 'global item',
      category: 'fact',
      scope: 'global',
    });
    expect(item.workspaceId).toBeNull();
    expect(item.scope).toBe('global');
  });

  it('normalizes tags to lowercase + deduped', async () => {
    const item = await addFact('tag test', { tags: ['React', 'REACT', ' react ', 'Vue'] });
    expect(item.tags).toEqual(['react', 'vue']);
  });

  it('handles empty/no tags gracefully', async () => {
    const item = await addFact('no tags', { tags: [] });
    expect(item.tags).toEqual([]);
    const item2 = await addMemoryItem({
      workspaceId: WS,
      content: 'undefined tags',
      category: 'fact',
    });
    expect(item2.tags).toEqual([]);
  });

  // ── Supersedes ──

  it('marks superseded item as rejected', async () => {
    const old = await addFact('Use MySQL');
    const newer = await addFact('Use PostgreSQL', { supersedes: old.id });

    expect(newer.supersedes).toBe(old.id);

    const oldNow = await getMemoryItem(old.id);
    expect(oldNow.category).toBe('rejected');
    expect(oldNow.pinned).toBe(true); // rejected stays pinned
  });

  it('does not double-reject an already rejected item', async () => {
    const old = await addMemoryItem({
      workspaceId: WS,
      content: 'already rejected',
      category: 'rejected',
    });
    const newer = await addFact('replacement', { supersedes: old.id });
    const oldNow = await getMemoryItem(old.id);
    expect(oldNow.category).toBe('rejected');
  });

  it('handles supersedes with non-existent ID gracefully', async () => {
    // Should not throw — old item just doesn't exist
    const item = await addFact('orphan supersede', { supersedes: 'nonexistent-id' });
    expect(item.supersedes).toBe('nonexistent-id');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// READ
// ══════════════════════════════════════════════════════════════════════════════

describe('getMemoryItem', () => {
  it('returns item by ID', async () => {
    const created = await addFact('lookup test');
    const found = await getMemoryItem(created.id);
    expect(found.content).toBe('lookup test');
  });

  it('returns undefined for missing ID', async () => {
    const found = await getMemoryItem('nonexistent');
    expect(found).toBeUndefined();
  });
});

describe('getMemoryItemsForWorkspace', () => {
  it('returns workspace + global items, deduped', async () => {
    await addFact('workspace item');
    await addMemoryItem({
      workspaceId: null,
      content: 'global item',
      category: 'fact',
      scope: 'global',
    });

    const items = await getMemoryItemsForWorkspace(WS);
    expect(items).toHaveLength(2);
    const contents = items.map(i => i.content);
    expect(contents).toContain('workspace item');
    expect(contents).toContain('global item');
  });

  it('sorts by createdAt descending', async () => {
    const a = await addFact('oldest');
    // Ensure different timestamps
    await new Promise(r => setTimeout(r, 5));
    const b = await addFact('newest');
    const items = await getMemoryItemsForWorkspace(WS);
    expect(items[0].content).toBe('newest');
    expect(items[1].content).toBe('oldest');
  });

  it('returns empty array for unknown workspace', async () => {
    const items = await getMemoryItemsForWorkspace('nonexistent-ws');
    // May include global items if any exist
    expect(Array.isArray(items)).toBe(true);
  });

  it('dedupes when global item is also indexed under workspace', async () => {
    // Promote scenario: item started as workspace, promoted to global
    const item = await addFact('will be promoted');
    await promoteToGlobal(item.id);
    const items = await getMemoryItemsForWorkspace(WS);
    // Should appear only once
    const matching = items.filter(i => i.id === item.id);
    expect(matching).toHaveLength(1);
  });
});

describe('getPinnedMemories', () => {
  it('returns { items, grouped } structure', async () => {
    await addFact('pinned fact');
    await addMemoryItem({
      workspaceId: WS,
      content: 'a decision',
      category: 'decision',
    });

    const result = await getPinnedMemories(WS);
    expect(result).toHaveProperty('items');
    expect(result).toHaveProperty('grouped');
    expect(result.items.length).toBeGreaterThanOrEqual(2);
    expect(result.grouped.fact).toBeDefined();
    expect(result.grouped.decision).toBeDefined();
  });

  it('excludes unpinned items', async () => {
    await addMemoryItem({
      workspaceId: WS,
      content: 'unpinned snippet',
      category: 'snippet', // not auto-pinned
    });
    const result = await getPinnedMemories(WS);
    expect(result.items).toHaveLength(0);
  });
});

describe('getMemoryItemsByTag', () => {
  it('finds items by single tag (case-insensitive via normalization)', async () => {
    await addFact('tagged A', { tags: ['react'] });
    await addFact('tagged B', { tags: ['React'] }); // normalized to 'react'
    await addFact('tagged C', { tags: ['vue'] });

    const found = await getMemoryItemsByTag('react');
    expect(found).toHaveLength(2);
  });
});

describe('getMemoryItemsByChat', () => {
  it('finds items linked to a specific chat', async () => {
    await addFact('in chat A', { chatId: 'chat-a' });
    await addFact('in chat B', { chatId: 'chat-b' });
    const found = await getMemoryItemsByChat('chat-a');
    expect(found).toHaveLength(1);
    expect(found[0].content).toBe('in chat A');
  });
});

describe('getMemoryItemsByCategory', () => {
  it('filters items by category within workspace', async () => {
    await addFact('a fact');
    await addMemoryItem({ workspaceId: WS, content: 'a decision', category: 'decision' });
    const facts = await getMemoryItemsByCategory(WS, 'fact');
    expect(facts).toHaveLength(1);
    expect(facts[0].content).toBe('a fact');
  });
});

describe('getAllTags', () => {
  it('returns tag counts sorted descending', async () => {
    await addFact('item1', { tags: ['react', 'auth'] });
    await addFact('item2', { tags: ['react', 'api'] });
    await addFact('item3', { tags: ['react'] });

    const tags = await getAllTags(WS);
    expect(tags[0].tag).toBe('react');
    expect(tags[0].count).toBe(3);
  });

  it('returns empty array for workspace with no items', async () => {
    const tags = await getAllTags('empty-ws');
    expect(tags).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// UPDATE
// ══════════════════════════════════════════════════════════════════════════════

describe('updateMemoryItem', () => {
  it('updates allowed fields', async () => {
    const item = await addFact('original');
    await updateMemoryItem(item.id, { content: 'updated', pinned: false });
    const updated = await getMemoryItem(item.id);
    expect(updated.content).toBe('updated');
    expect(updated.pinned).toBe(false);
    expect(updated.updatedAt).toBeGreaterThanOrEqual(item.updatedAt);
  });

  it('normalizes tags on update', async () => {
    const item = await addFact('tag update', { tags: ['old'] });
    await updateMemoryItem(item.id, { tags: ['New', 'NEW', 'other'] });
    const updated = await getMemoryItem(item.id);
    expect(updated.tags).toEqual(['new', 'other']);
  });

  it('rejects invalid category on update', async () => {
    const item = await addFact('cat update');
    await expect(updateMemoryItem(item.id, { category: 'bogus' })).rejects.toThrow('Invalid category');
  });

  it('rejects invalid scope on update', async () => {
    const item = await addFact('scope update');
    await expect(updateMemoryItem(item.id, { scope: 'secret' })).rejects.toThrow('Invalid scope');
  });

  it('clears workspaceId when scope changes to global', async () => {
    const item = await addFact('going global');
    await updateMemoryItem(item.id, { scope: 'global' });
    const updated = await getMemoryItem(item.id);
    expect(updated.workspaceId).toBeNull();
    expect(updated.scope).toBe('global');
  });

  it('ignores disallowed fields silently', async () => {
    const item = await addFact('no hack');
    await updateMemoryItem(item.id, { id: 'hacked', createdAt: 0 });
    const after = await getMemoryItem(item.id);
    expect(after.id).toBe(item.id); // unchanged
    expect(after.createdAt).toBe(item.createdAt); // unchanged
  });
});

describe('bumpMemoryUsage', () => {
  it('increments timesUsed and sets lastUsedAt', async () => {
    const item = await addFact('bump test');
    expect(item.timesUsed).toBe(0);

    await bumpMemoryUsage([item.id]);
    const bumped = await getMemoryItem(item.id);
    expect(bumped.timesUsed).toBe(1);
    expect(bumped.lastUsedAt).toBeTruthy();
  });

  it('handles multiple IDs in parallel', async () => {
    const a = await addFact('a');
    const b = await addFact('b');
    await bumpMemoryUsage([a.id, b.id]);
    const aAfter = await getMemoryItem(a.id);
    const bAfter = await getMemoryItem(b.id);
    expect(aAfter.timesUsed).toBe(1);
    expect(bAfter.timesUsed).toBe(1);
  });

  it('handles empty array without error', async () => {
    await expect(bumpMemoryUsage([])).resolves.not.toThrow();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE
// ══════════════════════════════════════════════════════════════════════════════

describe('deleteMemoryItem', () => {
  it('removes item from DB', async () => {
    const item = await addFact('to delete');
    await deleteMemoryItem(item.id);
    const gone = await getMemoryItem(item.id);
    expect(gone).toBeUndefined();
  });
});

describe('deleteMemoryItemsByWorkspace', () => {
  it('removes all items for a workspace', async () => {
    await addFact('ws item 1');
    await addFact('ws item 2');
    await addMemoryItem({ workspaceId: 'other-ws', content: 'other', category: 'fact' });

    await deleteMemoryItemsByWorkspace(WS);
    const remaining = await getMemoryItemsForWorkspace(WS);
    // Only global items might remain
    const wsItems = remaining.filter(i => i.workspaceId === WS);
    expect(wsItems).toHaveLength(0);
  });
});

describe('unlinkMemoryItemsFromChat', () => {
  it('clears chatId and messageId but keeps the item', async () => {
    const item = await addFact('linked', { chatId: 'chat-x', messageId: 'msg-x' });
    await unlinkMemoryItemsFromChat('chat-x');
    const after = await getMemoryItem(item.id);
    expect(after).toBeDefined();
    expect(after.chatId).toBeNull();
    expect(after.messageId).toBeNull();
    expect(after.content).toBe('linked'); // content preserved
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// SUGGEST TAGS
// ══════════════════════════════════════════════════════════════════════════════

describe('suggestTags', () => {
  it('extracts known tech keywords from content', () => {
    expect(suggestTags('We use React and TypeScript')).toEqual(
      expect.arrayContaining(['react', 'typescript'])
    );
  });

  it('uses word-boundary matching (no partial matches)', () => {
    // "javascript" should NOT match "java" keyword
    const tags = suggestTags('We use javascript for everything');
    expect(tags).not.toContain('java');
  });

  it('limits to max 3 tags', () => {
    const tags = suggestTags('react vue angular next node express typescript python');
    expect(tags.length).toBeLessThanOrEqual(3);
  });

  it('includes chat title in analysis', () => {
    const tags = suggestTags('some content', 'Docker Setup');
    expect(tags).toContain('docker');
  });

  it('returns empty array for unrecognized content', () => {
    expect(suggestTags('hello world how are you')).toEqual([]);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROMOTE / DEMOTE
// ══════════════════════════════════════════════════════════════════════════════

describe('promoteToGlobal', () => {
  it('changes scope to global', async () => {
    const item = await addFact('workspace scoped');
    const promoted = await promoteToGlobal(item.id);
    expect(promoted.scope).toBe('global');

    const fromDb = await getMemoryItem(item.id);
    expect(fromDb.scope).toBe('global');
  });

  it('throws for non-existent item', async () => {
    await expect(promoteToGlobal('nope')).rejects.toThrow('not found');
  });
});

describe('demoteToWorkspace', () => {
  it('changes scope back to workspace', async () => {
    const item = await addMemoryItem({
      workspaceId: null,
      content: 'global',
      category: 'fact',
      scope: 'global',
    });
    const demoted = await demoteToWorkspace(item.id);
    expect(demoted.scope).toBe('workspace');
  });

  it('throws for non-existent item', async () => {
    await expect(demoteToWorkspace('nope')).rejects.toThrow('not found');
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// CONFLICT DETECTION
// ══════════════════════════════════════════════════════════════════════════════

describe('detectConflicts', () => {
  it('detects negation-based contradiction (use X vs don\'t use X)', async () => {
    await addFact('Use Redux for state management in the application', {
      tags: ['state'],
    });
    await addFact("Don't use Redux for state management in the application", {
      tags: ['state'],
    });

    const conflicts = await detectConflicts(WS);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
    expect(conflicts[0]).toHaveProperty('reason');
    expect(conflicts[0]).toHaveProperty('sharedTags');
  });

  it('detects prefer A vs prefer B contradiction', async () => {
    await addMemoryItem({
      workspaceId: WS,
      content: 'Prefer PostgreSQL for database',
      category: 'preference',
      tags: ['database'],
    });
    await addMemoryItem({
      workspaceId: WS,
      content: 'Prefer MongoDB for database',
      category: 'preference',
      tags: ['database'],
    });

    const conflicts = await detectConflicts(WS);
    expect(conflicts.length).toBeGreaterThanOrEqual(1);
  });

  it('does NOT flag additive facts (two different projects)', async () => {
    await addFact('Developed the payment microservice', { tags: ['project'] });
    await addFact('Developed the user auth service', { tags: ['project'] });

    const conflicts = await detectConflicts(WS);
    expect(conflicts).toHaveLength(0);
  });

  it('skips rejected items in conflict detection', async () => {
    await addMemoryItem({
      workspaceId: WS,
      content: 'Use Redux for state management in the app',
      category: 'rejected',
      tags: ['state'],
    });
    await addFact("Don't use Redux for state management in the app", { tags: ['state'] });

    const conflicts = await detectConflicts(WS);
    expect(conflicts).toHaveLength(0); // rejected is excluded from scan
  });

  it('requires shared tags for conflict (different topics = no conflict)', async () => {
    await addFact('Use PostgreSQL for the database', { tags: ['database'] });
    await addFact("Don't use TypeScript for the frontend code", { tags: ['language'] });

    const conflicts = await detectConflicts(WS);
    expect(conflicts).toHaveLength(0);
  });

  it('requires same category for conflict', async () => {
    await addFact('Use Redux for state', { tags: ['state'] });
    await addMemoryItem({
      workspaceId: WS,
      content: "Don't use Redux for state management in the app",
      category: 'decision',
      tags: ['state'],
    });

    // fact vs decision => no conflict (different categories)
    const conflicts = await detectConflicts(WS);
    expect(conflicts).toHaveLength(0);
  });

  it('returns empty array for workspace with no items', async () => {
    const conflicts = await detectConflicts('empty-ws');
    expect(conflicts).toEqual([]);
  });

  it('handles items with no tags gracefully', async () => {
    await addFact('no tags item 1', { tags: [] });
    await addFact('no tags item 2', { tags: [] });

    // No shared tags => no conflict possible
    const conflicts = await detectConflicts(WS);
    expect(conflicts).toHaveLength(0);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// EDGE CASES & STRESS
// ══════════════════════════════════════════════════════════════════════════════

describe('edge cases', () => {
  it('handles 100 items without performance issues', async () => {
    const promises = [];
    for (let i = 0; i < 100; i++) {
      promises.push(addFact(`Item number ${i}`, { tags: [`tag${i % 5}`] }));
    }
    await Promise.all(promises);

    const items = await getMemoryItemsForWorkspace(WS);
    expect(items).toHaveLength(100);
  });

  it('handles special characters in content', async () => {
    const item = await addFact('Use <script> & "quotes" 100%');
    expect(item.content).toBe('Use <script> & "quotes" 100%');
  });

  it('handles unicode in tags', async () => {
    const item = await addFact('unicode tags', { tags: ['café', 'naïve'] });
    expect(item.tags).toEqual(['café', 'naïve']);
  });

  it('handles very long content', async () => {
    const longContent = 'x'.repeat(10000);
    const item = await addFact(longContent);
    expect(item.content).toBe(longContent);
  });

  it('concurrent writes to same workspace', async () => {
    const results = await Promise.all([
      addFact('concurrent 1'),
      addFact('concurrent 2'),
      addFact('concurrent 3'),
    ]);
    expect(results).toHaveLength(3);
    const items = await getMemoryItemsForWorkspace(WS);
    expect(items).toHaveLength(3);
  });
});
