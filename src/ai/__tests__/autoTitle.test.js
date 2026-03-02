/**
 * autoTitle.test.js — Tests for the auto-title chat feature.
 *
 * Mocks: llmService.chatCompletion + chatHelpers.renameChat
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the LLM and DB helpers
vi.mock('../../ai/llmService.js', () => ({
  chatCompletion: vi.fn(async () => 'React Hooks Tutorial'),
}));

vi.mock('../../db/chatHelpers.js', () => ({
  renameChat: vi.fn(async () => {}),
}));

const { autoTitleChat } = await import('../../ai/autoTitle.js');
const { chatCompletion } = await import('../../ai/llmService.js');
const { renameChat } = await import('../../db/chatHelpers.js');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('autoTitleChat', () => {
  it('generates a title and renames the chat', async () => {
    chatCompletion.mockResolvedValue('React Hooks Tutorial');

    const result = await autoTitleChat('chat1', 'How do I use hooks?', 'Hooks are...');
    expect(result).toBe('React Hooks Tutorial');
    expect(renameChat).toHaveBeenCalledWith('chat1', 'React Hooks Tutorial');
  });

  it('strips surrounding quotes from LLM output', async () => {
    chatCompletion.mockResolvedValue('"React Hooks Guide"');

    const result = await autoTitleChat('chat1', 'How do I use hooks?', 'Hooks are...');
    expect(result).toBe('React Hooks Guide');
    expect(result).not.toContain('"');
  });

  it('strips trailing periods', async () => {
    chatCompletion.mockResolvedValue('React Hooks Guide...');

    const result = await autoTitleChat('chat1', 'How?', 'Answer');
    expect(result).not.toMatch(/\.+$/);
  });

  it('truncates titles longer than 60 chars', async () => {
    chatCompletion.mockResolvedValue('A'.repeat(100));

    const result = await autoTitleChat('chat1', 'How?', 'Answer');
    expect(result.length).toBeLessThanOrEqual(60);
  });

  it('returns null when cleaned title is <= 2 chars', async () => {
    chatCompletion.mockResolvedValue('Hi');

    const result = await autoTitleChat('chat1', 'Hi', 'Hello');
    expect(result).toBeNull();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it('returns null when LLM returns empty string', async () => {
    chatCompletion.mockResolvedValue('');

    const result = await autoTitleChat('chat1', 'Hi', 'Hello');
    expect(result).toBeNull();
    expect(renameChat).not.toHaveBeenCalled();
  });

  it('returns null on LLM error', async () => {
    chatCompletion.mockRejectedValue(new Error('API rate limited'));

    const result = await autoTitleChat('chat1', 'msg', 'reply');
    expect(result).toBeNull();
  });

  it('slices long assistant messages in prompt', async () => {
    const longAssistant = 'B'.repeat(1000);
    chatCompletion.mockResolvedValue('Good Title');

    await autoTitleChat('chat1', 'user msg', longAssistant);

    const promptArg = chatCompletion.mock.calls[0][0];
    // The assistant message in the prompt should be sliced to 300
    const assistantMsg = promptArg.find(m => m.role === 'assistant');
    expect(assistantMsg.content.length).toBeLessThanOrEqual(300);
  });

  it('uses "..." when assistantMessage is null', async () => {
    chatCompletion.mockResolvedValue('Fallback Title');

    await autoTitleChat('chat1', 'user msg', null);

    const promptArg = chatCompletion.mock.calls[0][0];
    const assistantMsg = promptArg.find(m => m.role === 'assistant');
    expect(assistantMsg.content).toBe('...');
  });
});
