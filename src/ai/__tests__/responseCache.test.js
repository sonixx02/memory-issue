/**
 * responseCache.test.js — Tests for the SHA-256 based question→response cache.
 *
 * Tests: cache hit, cache miss, case-insensitivity via hash, null/undefined guards.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { clearAllTables } from '../../test/helpers.js';
import { getCachedResponse, setCachedResponse } from '../../ai/responseCache.js';
import db from '../../db/database.js';

beforeEach(async () => {
  await clearAllTables();
});

describe('responseCache', () => {
  // ────────────────────────────────────────────────────────────────────────
  // SET + GET
  // ────────────────────────────────────────────────────────────────────────

  it('returns null for uncached question', async () => {
    const result = await getCachedResponse('ws1', 'What is React?');
    expect(result).toBeNull();
  });

  it('stores and retrieves a cached response', async () => {
    await setCachedResponse('ws1', 'What is React?', 'A UI library.');
    const result = await getCachedResponse('ws1', 'What is React?');
    expect(result).toBe('A UI library.');
  });

  it('hash is case-insensitive (matches lowered+trimmed)', async () => {
    await setCachedResponse('ws1', 'What Is React?', 'A UI library.');
    const result = await getCachedResponse('ws1', 'what is react?');
    expect(result).toBe('A UI library.');
  });

  it('different workspaces have independent caches', async () => {
    await setCachedResponse('ws1', 'question', 'answer1');
    await setCachedResponse('ws2', 'question', 'answer2');

    expect(await getCachedResponse('ws1', 'question')).toBe('answer1');
    expect(await getCachedResponse('ws2', 'question')).toBe('answer2');
  });

  it('overwrites existing cache entry', async () => {
    await setCachedResponse('ws1', 'question', 'old answer');
    await setCachedResponse('ws1', 'question', 'new answer');
    expect(await getCachedResponse('ws1', 'question')).toBe('new answer');
  });

  // ────────────────────────────────────────────────────────────────────────
  // NULL / UNDEFINED GUARDS
  // ────────────────────────────────────────────────────────────────────────

  it('getCachedResponse returns null when workspaceId is null', async () => {
    const result = await getCachedResponse(null, 'question');
    expect(result).toBeNull();
  });

  it('getCachedResponse returns null when question is null', async () => {
    const result = await getCachedResponse('ws1', null);
    expect(result).toBeNull();
  });

  it('getCachedResponse returns null when both args are null', async () => {
    const result = await getCachedResponse(null, null);
    expect(result).toBeNull();
  });

  it('setCachedResponse no-ops when workspaceId is null', async () => {
    await setCachedResponse(null, 'q', 'a');
    // Verify nothing stored
    const count = await db.settings.count();
    expect(count).toBe(0);
  });

  it('setCachedResponse no-ops when question is null', async () => {
    await setCachedResponse('ws1', null, 'a');
    const count = await db.settings.count();
    expect(count).toBe(0);
  });

  it('setCachedResponse no-ops when response is null', async () => {
    await setCachedResponse('ws1', 'q', null);
    const count = await db.settings.count();
    expect(count).toBe(0);
  });

  // ────────────────────────────────────────────────────────────────────────
  // EDGE CASES
  // ────────────────────────────────────────────────────────────────────────

  it('handles very long questions', async () => {
    const longQ = 'x'.repeat(10000);
    await setCachedResponse('ws1', longQ, 'long answer');
    expect(await getCachedResponse('ws1', longQ)).toBe('long answer');
  });

  it('handles unicode in question and response', async () => {
    await setCachedResponse('ws1', '日本語の質問', '日本語の回答');
    expect(await getCachedResponse('ws1', '日本語の質問')).toBe('日本語の回答');
  });

  it('handles empty string question gracefully', async () => {
    // Empty string is falsy in JS so guard should trigger
    await setCachedResponse('ws1', '', 'a');
    const result = await getCachedResponse('ws1', '');
    expect(result).toBeNull();
  });
});
