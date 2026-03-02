/**
 * summaryService.test.js — Tests for the rolling conversation summary system.
 *
 * Covers: needsSummary trigger logic, generateRollingSummary with mocked LLM,
 * getRollingSummary retrieval, overlap slicing, storage on chat record.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../../db/database.js';
import { clearAllTables, seedWorkspaceWithConversation } from '../../test/helpers.js';

// Mock LLM service
vi.mock('../../ai/llmService.js', () => ({
  streamChat: vi.fn(async (messages, onChunk) => {
    const summary = '- Key decision: use React\n- Framework: Vite\n- DB: Dexie';
    onChunk(summary);
    return summary;
  }),
  chatCompletion: vi.fn(async () => ''),
}));

const {
  needsSummary,
  generateRollingSummary,
  getRollingSummary,
} = await import('../../ai/summaryService.js');

const { streamChat } = await import('../../ai/llmService.js');

beforeEach(async () => {
  await clearAllTables();
  vi.clearAllMocks();
});

// ══════════════════════════════════════════════════════════════════════════════
// needsSummary
// ══════════════════════════════════════════════════════════════════════════════

describe('needsSummary', () => {
  it('returns false for non-existent chat', async () => {
    expect(await needsSummary('nonexistent')).toBe(false);
  });

  it('returns false when message count < SUMMARY_TRIGGER_COUNT (12)', async () => {
    const { chat } = await seedWorkspaceWithConversation(8);
    expect(await needsSummary(chat.id)).toBe(false);
  });

  it('returns true when messages >= SUMMARY_TRIGGER_COUNT from last summary', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);
    expect(await needsSummary(chat.id)).toBe(true);
  });

  it('returns false right after a summary was generated', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);

    // Simulate a summary having been generated
    await db.chats.update(chat.id, {
      lastSummaryMessageCount: 15,
      rollingSummary: 'existing summary',
    });

    expect(await needsSummary(chat.id)).toBe(false);
  });

  it('returns true when N new messages arrive after last summary', async () => {
    const { workspace, chat, messages } = await seedWorkspaceWithConversation(15);

    // Summary was at 15 messages
    await db.chats.update(chat.id, { lastSummaryMessageCount: 15 });

    // Add 12 more messages
    for (let i = 0; i < 12; i++) {
      await db.messages.add({
        id: `extra-msg-${i}`,
        chatId: chat.id,
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Extra message number ${i} with enough length`,
        timestamp: Date.now() + i,
      });
    }

    expect(await needsSummary(chat.id)).toBe(true);
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// generateRollingSummary
// ══════════════════════════════════════════════════════════════════════════════

describe('generateRollingSummary', () => {
  it('returns null for non-existent chat', async () => {
    expect(await generateRollingSummary('nonexistent')).toBeNull();
  });

  it('returns null when not enough messages', async () => {
    const { chat } = await seedWorkspaceWithConversation(5);
    expect(await generateRollingSummary(chat.id)).toBeNull();
  });

  it('generates summary for conversations >= SUMMARY_TRIGGER_COUNT', async () => {
    const { chat } = await seedWorkspaceWithConversation(20);

    const result = await generateRollingSummary(chat.id);
    expect(result).not.toBeNull();
    expect(result.summary).toContain('React');
    expect(result.messageCount).toBe(20);
  });

  it('stores summary on chat record', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);

    await generateRollingSummary(chat.id);

    const updated = await db.chats.get(chat.id);
    expect(updated.rollingSummary).toBeTruthy();
    expect(updated.lastSummaryMessageCount).toBe(15);
  });

  it('calls streamChat with system + user prompt', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);

    await generateRollingSummary(chat.id);

    expect(streamChat).toHaveBeenCalledOnce();
    const promptArg = streamChat.mock.calls[0][0];
    expect(promptArg).toHaveLength(2);
    expect(promptArg[0].role).toBe('system');
    expect(promptArg[1].role).toBe('user');
    expect(promptArg[1].content).toContain('Summarize');
  });

  it('includes existing summary in prompt when present', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);
    await db.chats.update(chat.id, { rollingSummary: 'Previous summary text here' });

    await generateRollingSummary(chat.id);

    const promptArg = streamChat.mock.calls[0][0];
    expect(promptArg[0].content).toContain('Previous summary text here');
  });

  it('summarizes only messages before the overlap window', async () => {
    const { chat } = await seedWorkspaceWithConversation(20);

    await generateRollingSummary(chat.id);

    // streamChat should receive a prompt that summarizes the first 12 messages
    // (20 total - 8 overlap = 12 to summarize)
    const userPromptContent = streamChat.mock.calls[0][0][1].content;
    // Count "User:" + "Assistant:" occurrences in the conversation text
    const matches = userPromptContent.match(/(User|Assistant):/g);
    expect(matches).toHaveLength(12); // 20 - 8 overlap
  });

  it('returns null when streamChat fails', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);

    streamChat.mockRejectedValue(new Error('Network error'));

    const result = await generateRollingSummary(chat.id);
    expect(result).toBeNull();
  });

  it('returns null when streamChat produces empty summary', async () => {
    const { chat } = await seedWorkspaceWithConversation(15);

    streamChat.mockImplementation(async (messages, onChunk) => {
      onChunk('');
      return '';
    });

    const result = await generateRollingSummary(chat.id);
    expect(result).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// getRollingSummary
// ══════════════════════════════════════════════════════════════════════════════

describe('getRollingSummary', () => {
  it('returns null for non-existent chat', async () => {
    expect(await getRollingSummary('nonexistent')).toBeNull();
  });

  it('returns null when chat has no summary', async () => {
    const { chat } = await seedWorkspaceWithConversation(5);
    expect(await getRollingSummary(chat.id)).toBeNull();
  });

  it('returns the stored summary', async () => {
    const { chat } = await seedWorkspaceWithConversation(5);
    await db.chats.update(chat.id, { rollingSummary: 'Stored summary text' });

    const result = await getRollingSummary(chat.id);
    expect(result).toBe('Stored summary text');
  });
});
