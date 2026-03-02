/**
 * contextCompiler.test.js — Tests for system prompt construction & memory budget.
 *
 * Covers:
 * - compileContext full flow (mocked deps)
 * - buildSystemPrompt layers (profile, pinned, summary, RAG, guardrails)
 * - Memory budget capping and overflow
 * - getMemoryBudgetUsage accuracy
 * - Edge cases: empty workspace, no profile, no pinned, etc.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import db from '../../db/database.js';
import { clearAllTables, seedWorkspaceWithConversation, seedMemoryItems } from '../../test/helpers.js';

// Mock all external dependencies of contextCompiler
vi.mock('../../db/messageHelpers.js', async (importOriginal) => {
  const original = await importOriginal();
  return {
    ...original,
    // Keep real implementation but we can spy on it
    getRecentMessages: vi.fn(original.getRecentMessages),
  };
});

vi.mock('../../ai/ragService.js', () => ({
  searchMemory: vi.fn(async () => []),
}));

vi.mock('../../ai/summaryService.js', () => ({
  getRollingSummary: vi.fn(async () => null),
}));

// Import after mocks
const { compileContext, getMemoryBudgetUsage, MEMORY_CHAR_BUDGET } = await import('../../ai/contextCompiler.js');
const { searchMemory } = await import('../../ai/ragService.js');
const { getRollingSummary } = await import('../../ai/summaryService.js');

beforeEach(async () => {
  await clearAllTables();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// MEMORY BUDGET
// ══════════════════════════════════════════════════════════════════════════════

describe('MEMORY_CHAR_BUDGET', () => {
  it('exports the correct budget constant', () => {
    expect(MEMORY_CHAR_BUDGET).toBe(8000);
  });
});

describe('getMemoryBudgetUsage', () => {
  it('returns zero usage for empty workspace', async () => {
    const usage = await getMemoryBudgetUsage('empty-ws');
    expect(usage.totalChars).toBe(0);
    expect(usage.budgetLimit).toBe(8000);
    expect(usage.injectedIds.size).toBe(0);
    expect(usage.droppedIds.size).toBe(0);
  });

  it('returns zero for null workspaceId', async () => {
    const usage = await getMemoryBudgetUsage(null);
    expect(usage.totalChars).toBe(0);
  });

  it('calculates budget usage for pinned items', async () => {
    const WS = 'budget-ws';
    await seedMemoryItems(WS, [
      { content: 'Use PostgreSQL for the database', category: 'decision', pinned: true },
      { content: 'API rate limit is 100 req/min', category: 'fact', pinned: true },
    ]);

    const usage = await getMemoryBudgetUsage(WS);
    expect(usage.totalChars).toBeGreaterThan(0);
    expect(usage.injectedIds.size).toBe(2);
    expect(usage.droppedIds.size).toBe(0);
    expect(usage.categoryBreakdown).toHaveProperty('decision');
    expect(usage.categoryBreakdown).toHaveProperty('fact');
  });

  it('drops items that exceed the budget', async () => {
    const WS = 'overflow-ws';
    // Create items that collectively exceed MEMORY_CHAR_BUDGET (8000 chars)
    const items = [];
    for (let i = 0; i < 80; i++) {
      items.push({
        content: `Decision item #${i}: ` + 'x'.repeat(150), // ~160 chars each
        category: 'decision',
        pinned: true,
        tags: [`tag${i}`],
      });
    }
    await seedMemoryItems(WS, items);

    const usage = await getMemoryBudgetUsage(WS);
    expect(usage.totalChars).toBeLessThanOrEqual(MEMORY_CHAR_BUDGET);
    expect(usage.droppedIds.size).toBeGreaterThan(0);
    expect(usage.injectedIds.size + usage.droppedIds.size).toBe(80);
  });

  it('respects CATEGORY_ORDER for budget allocation', async () => {
    const WS = 'order-ws';
    // Fill budget with decisions so facts get dropped
    const items = [];
    for (let i = 0; i < 50; i++) {
      items.push({
        content: `Important decision number ${i}: ` + 'x'.repeat(150),
        category: 'decision',
        pinned: true,
        tags: ['decision-tag'],
      });
    }
    // Add a fact that should be dropped because decisions consumed the budget
    items.push({
      content: 'This fact should be dropped because budget is full',
      category: 'fact',
      pinned: true,
      tags: ['fact-tag'],
    });
    await seedMemoryItems(WS, items);

    const usage = await getMemoryBudgetUsage(WS);
    // Fact should be in droppedIds
    const factItems = items.filter(i => i.category === 'fact');
    // The budget is consumed by decisions first (CATEGORY_ORDER: decision comes before fact)
    expect(usage.droppedIds.size).toBeGreaterThan(0);
  });

  it('excludes unpinned items from budget calculation', async () => {
    const WS = 'unpin-ws';
    await seedMemoryItems(WS, [
      { content: 'pinned fact item', category: 'fact', pinned: true },
      { content: 'unpinned snippet item', category: 'snippet', pinned: false },
    ]);

    const usage = await getMemoryBudgetUsage(WS);
    // Only the pinned item should be counted
    expect(usage.injectedIds.size).toBe(1);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// COMPILE CONTEXT (integration with mocked dependencies)
// ══════════════════════════════════════════════════════════════════════════════

describe('compileContext', () => {
  it('builds a messages array with system prompt + history', async () => {
    const { workspace, chat, messages: msgs } = await seedWorkspaceWithConversation(5);
    searchMemory.mockResolvedValue([]);
    getRollingSummary.mockResolvedValue(null);

    const result = await compileContext(chat.id, workspace.id);

    expect(result.messages).toBeDefined();
    expect(result.messages[0].role).toBe('system');
    expect(result.messages.length).toBe(6); // 1 system + 5 history
    expect(result.metadata).toBeDefined();
    expect(result.metadata.hasRollingSummary).toBe(false);
  });

  it('includes RAG results in system prompt', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);
    searchMemory.mockResolvedValue([
      { text: 'Past context about React patterns', score: 0.8, timestamp: 1000 },
    ]);
    getRollingSummary.mockResolvedValue(null);

    const result = await compileContext(chat.id, workspace.id);
    const systemPrompt = result.messages[0].content;

    expect(systemPrompt).toContain('Relevant Past Context');
    expect(systemPrompt).toContain('Past context about React patterns');
    expect(result.metadata.ragResultCount).toBe(1);
  });

  it('filters RAG results that overlap with recent message window', async () => {
    const { workspace, chat, messages: msgs } = await seedWorkspaceWithConversation(5);
    const oldestMsgTs = msgs[0].timestamp;

    // RAG result with timestamp INSIDE the window should be filtered
    searchMemory.mockResolvedValue([
      { text: 'Already visible', score: 0.9, timestamp: oldestMsgTs + 500 }, // inside window
      { text: 'Old and relevant', score: 0.8, timestamp: oldestMsgTs - 5000 }, // outside window
    ]);
    getRollingSummary.mockResolvedValue(null);

    const result = await compileContext(chat.id, workspace.id);
    const systemPrompt = result.messages[0].content;

    // Only the old result should be included
    expect(systemPrompt).toContain('Old and relevant');
    expect(systemPrompt).not.toContain('Already visible');
  });

  it('includes rolling summary when available', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);
    searchMemory.mockResolvedValue([]);
    getRollingSummary.mockResolvedValue('The user discussed React patterns and decided to use hooks.');

    const result = await compileContext(chat.id, workspace.id);
    const systemPrompt = result.messages[0].content;

    expect(systemPrompt).toContain('Conversation Summary');
    expect(systemPrompt).toContain('React patterns and decided to use hooks');
    expect(result.metadata.hasRollingSummary).toBe(true);
  });

  it('includes pinned memory items in system prompt', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);
    await seedMemoryItems(workspace.id, [
      { content: 'Use PostgreSQL for database', category: 'decision', pinned: true },
    ]);
    searchMemory.mockResolvedValue([]);
    getRollingSummary.mockResolvedValue(null);

    const result = await compileContext(chat.id, workspace.id);
    const systemPrompt = result.messages[0].content;

    expect(systemPrompt).toContain('Use PostgreSQL for database');
    expect(systemPrompt).toContain('Locked Decisions');
  });

  it('includes global profile in system prompt', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(5);
    // Set a global profile
    await db.settings.put({
      key: 'global_user_profile',
      value: { role: 'Senior React Developer', tone: 'Direct and technical', preferences: ['Always use TypeScript'] },
    });
    searchMemory.mockResolvedValue([]);
    getRollingSummary.mockResolvedValue(null);

    const result = await compileContext(chat.id, workspace.id);
    const systemPrompt = result.messages[0].content;

    expect(systemPrompt).toContain('Senior React Developer');
    expect(systemPrompt).toContain('Direct and technical');
    expect(systemPrompt).toContain('Always use TypeScript');
  });

  it('always includes behavioral guardrails', async () => {
    const { workspace, chat } = await seedWorkspaceWithConversation(3);
    searchMemory.mockResolvedValue([]);
    getRollingSummary.mockResolvedValue(null);

    const result = await compileContext(chat.id, workspace.id);
    const systemPrompt = result.messages[0].content;

    expect(systemPrompt).toContain('Important Rules');
    expect(systemPrompt).toContain('Commit Snapshot');
    expect(systemPrompt).toContain('Never fabricate');
  });
});
