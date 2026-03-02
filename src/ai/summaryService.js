import { getMessagesByChat } from '../db/messageHelpers.js';
import { streamChat } from './llmService.js';
import db from '../db/database.js';
import { debugLog } from './debugLogger.js';

/**
 * Rolling Conversation Summary
 *
 * Problem: Long conversations (50+ messages) degrade LLM quality because
 * early context falls out of the recent-history window.
 *
 * Solution: After SUMMARY_TRIGGER_COUNT messages, generate a topic-organized
 * summary of older messages. The summary is injected into the system prompt
 * between Memory Items and RAG results, giving the LLM a compressed view
 * of the full conversation. The last SUMMARY_OVERLAP messages are always
 * sent in full for immediate context.
 *
 * Storage: rollingSummary + lastSummaryMessageCount stored on the chat record
 * (no schema change needed — Dexie allows non-indexed fields freely).
 */

const SUMMARY_TRIGGER_COUNT = 12; // messages since last summary to trigger re-summarization
const SUMMARY_OVERLAP = 8; // always keep last N messages as full history

/**
 * Check if a chat needs a rolling summary update.
 */
export async function needsSummary(chatId) {
  const chat = await db.chats.get(chatId);
  if (!chat) return false;

  const messages = await getMessagesByChat(chatId);
  const lastSummaryAt = chat.lastSummaryMessageCount || 0;

  return messages.length - lastSummaryAt >= SUMMARY_TRIGGER_COUNT;
}

/**
 * Generate/update a rolling conversation summary.
 * Summarizes older messages to prevent context degradation in long conversations.
 *
 * @param {string} chatId
 * @returns {Promise<{ summary: string, messageCount: number } | null>}
 */
export async function generateRollingSummary(chatId) {
  const chat = await db.chats.get(chatId);
  if (!chat) return null;

  const messages = await getMessagesByChat(chatId);
  if (messages.length < SUMMARY_TRIGGER_COUNT) return null;

  // Summarize everything except the last SUMMARY_OVERLAP messages
  const messagesToSummarize = messages.slice(0, -SUMMARY_OVERLAP);
  if (messagesToSummarize.length === 0) return null;

  const existingSummary = chat.rollingSummary || '';

  const conversation = messagesToSummarize
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  const prompt = [
    {
      role: 'system',
      content: `You are a conversation summarizer. Create a concise summary that preserves:
- Key decisions made and their rationale
- Technical choices (tools, frameworks, patterns)
- Important facts (names, versions, file paths, URLs)
- Unanswered questions or pending items
- Code patterns or architectures discussed

${existingSummary ? `Previous summary to incorporate and update:\n${existingSummary}\n\n` : ''}Rules:
- Be factual and specific — preserve concrete details
- Organize by topic, not chronologically
- Keep under 500 words
- Use bullet points
- Do NOT include conversational filler or greetings
- Return ONLY the summary text, no preamble`,
    },
    {
      role: 'user',
      content: `Summarize this conversation:\n\n${conversation}`,
    },
  ];

  let summary = '';
  try {
    await streamChat(prompt, (accumulated) => {
      summary = accumulated;
    });
  } catch (err) {
    console.warn('Rolling summary generation failed:', err.message);
    return null;
  }

  if (!summary.trim()) return null;

  // Store on the chat record (non-indexed fields — no schema change needed)
  await db.chats.update(chatId, {
    rollingSummary: summary.trim(),
    lastSummaryMessageCount: messages.length,
    updatedAt: Date.now(),
  });

  console.log(`📝 Rolling summary updated for chat ${chatId} (${messages.length} messages)`);

  debugLog('summary:generated', {
    chatId,
    messageCount: messages.length,
    summarizedCount: messagesToSummarize.length,
    summaryLength: summary.trim().length,
    summaryPreview: summary.trim().slice(0, 300),
  });

  return {
    summary: summary.trim(),
    messageCount: messages.length,
  };
}

/**
 * Get the current rolling summary for a chat.
 */
export async function getRollingSummary(chatId) {
  const chat = await db.chats.get(chatId);
  return chat?.rollingSummary || null;
}
