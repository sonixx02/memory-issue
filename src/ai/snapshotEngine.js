import { v4 as uuidv4 } from 'uuid';
import db from '../db/database.js';
import { getWorkspace } from '../db/workspaceHelpers.js';
import { getRecentMessages } from '../db/messageHelpers.js';
import { chatCompletion } from './llmService.js';
import { addMemoryItem, getMemoryItemsForWorkspace, suggestTags } from '../db/memoryHelpers.js';
import { debugLog } from './debugLogger.js';

/**
 * Preview a snapshot: extract Memory Items *without* saving.
 * This enables a diff-review UI before final commit.
 *
 * @returns {{ success, extractedItems?, existingItems?, skippedDupes?, error? }}
 */
export async function previewSnapshot(workspaceId, chatId) {
  try {
    const [workspace, messages, existingMemory] = await Promise.all([
      getWorkspace(workspaceId),
      getRecentMessages(chatId, 30),
      getMemoryItemsForWorkspace(workspaceId),
    ]);

    if (!workspace) throw new Error('Workspace not found');
    if (!messages.length) throw new Error('No messages to analyze');

    const existingSummary = existingMemory
      .filter(m => m.category !== 'snippet')
      .map(m => `[${m.category}] ${m.content}`)
      .join('\n');

    const extractionMessages = buildMemoryExtractionPrompt(messages, existingSummary);
    const raw = await chatCompletion(extractionMessages);
    const parsed = parseMemoryItemsResponse(raw);

    // Mark duplicates but don't discard — let the user decide
    const extractedItems = parsed.map(item => {
      const isDupe = existingMemory.some(
        e => e.category === item.category &&
             normalizeForCompare(e.content) === normalizeForCompare(item.content)
      );
      return { ...item, isDuplicate: isDupe, accepted: !isDupe };
    });

    const skippedDupes = extractedItems.filter(i => i.isDuplicate).length;

    debugLog('snapshot:preview', {
      workspaceId,
      chatId,
      messageCount: messages.length,
      existingMemoryCount: existingMemory.length,
      extractedCount: extractedItems.length,
      skippedDupes,
      items: extractedItems.map(i => ({
        category: i.category,
        content: i.content?.slice(0, 100),
        isDuplicate: i.isDuplicate,
        accepted: i.accepted,
      })),
    });

    return {
      success: true,
      extractedItems,
      existingItems: existingMemory,
      messageCount: messages.length,
      skippedDupes,
      stateFile: workspace.stateFile || null,
    };
  } catch (err) {
    console.error('Snapshot preview failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Commit previously previewed items. Only saves accepted items.
 *
 * @param {string} workspaceId
 * @param {string} chatId
 * @param {object[]} acceptedItems — items the user accepted from the preview
 * @param {number} messageCount — from the preview result
 * @param {object|null} stateFile — for legacy compat
 * @returns {{ success, newItems, skipped }}
 */
export async function commitPreviewedItems(workspaceId, chatId, acceptedItems, messageCount, stateFile) {
  try {
    const newItems = [];
    let skipped = 0;

    for (const item of acceptedItems) {
      try {
        const created = await addMemoryItem({
          workspaceId,
          chatId,
          content: item.content,
          category: item.category,
          tags: item.tags?.length ? item.tags : suggestTags(item.content, ''),
          source: 'snapshot',
          scope: 'workspace',
        });
        newItems.push(created);
      } catch (err) {
        console.warn('Skipping invalid memory item:', err.message, item);
        skipped++;
      }
    }

    await db.snapshots.add({
      id: uuidv4(),
      workspaceId,
      timestamp: Date.now(),
      memoryItemIds: newItems.map(i => i.id),
      itemCount: newItems.length,
      skippedCount: skipped,
      messageCount: messageCount || 0,
      stateFile: stateFile || null,
    });

    debugLog('snapshot:commit', {
      workspaceId,
      newItemCount: newItems.length,
      skipped,
      items: newItems.map(i => ({ category: i.category, content: i.content?.slice(0, 100) })),
    });

    return { success: true, newItems, skipped };
  } catch (err) {
    console.error('Snapshot commit failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Commit a snapshot: extract decisions from recent conversation as Memory Items.
 * (Legacy one-step flow — still works for quick commits without review.)
 *
 * Flow:
 *  1. Gather recent messages + existing memory items
 *  2. LLM extracts new items as structured JSON array
 *  3. Each item → addMemoryItem() (with dedup against existing)
 *  4. Save a snapshot record for history / undo
 *
 * @param {string} workspaceId
 * @param {string} chatId
 * @returns {{ success: boolean, newItems?: object[], skipped?: number, error?: string }}
 */
export async function commitSnapshot(workspaceId, chatId) {
  try {
    // 1. Get context
    const [workspace, messages, existingMemory] = await Promise.all([
      getWorkspace(workspaceId),
      getRecentMessages(chatId, 30),
      getMemoryItemsForWorkspace(workspaceId),
    ]);

    if (!workspace) throw new Error('Workspace not found');
    if (!messages.length) throw new Error('No messages to analyze');

    // Build a summary of existing memory for dedup hints
    const existingSummary = existingMemory
      .filter(m => m.category !== 'snippet')
      .map(m => `[${m.category}] ${m.content}`)
      .join('\n');

    // 2. Ask the LLM to extract structured Memory Items
    const extractionMessages = buildMemoryExtractionPrompt(messages, existingSummary);
    const raw = await chatCompletion(extractionMessages);

    // 3. Parse and create items
    const parsed = parseMemoryItemsResponse(raw);
    const newItems = [];
    let skipped = 0;

    for (const item of parsed) {
      // Deduplicate: skip if content is substantially similar to existing
      const isDupe = existingMemory.some(
        e => e.category === item.category &&
             normalizeForCompare(e.content) === normalizeForCompare(item.content)
      );
      if (isDupe) { skipped++; continue; }

      try {
        const created = await addMemoryItem({
          workspaceId,
          chatId,
          content: item.content,
          category: item.category,
          tags: item.tags?.length ? item.tags : suggestTags(item.content, ''),
          source: 'snapshot',
          scope: 'workspace',
        });
        newItems.push(created);
      } catch (err) {
        console.warn('Skipping invalid memory item:', err.message, item);
        skipped++;
      }
    }

    // 4. Save snapshot history record
    await db.snapshots.add({
      id: uuidv4(),
      workspaceId,
      timestamp: Date.now(),
      // Store created item IDs for undo capability
      memoryItemIds: newItems.map(i => i.id),
      itemCount: newItems.length,
      skippedCount: skipped,
      messageCount: messages.length,
      // Legacy: keep stateFile reference for backwards compat
      stateFile: workspace.stateFile || null,
    });

    return { success: true, newItems, skipped };
  } catch (err) {
    console.error('Snapshot commit failed:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Build the extraction prompt that produces Memory Items (not flat stateFile).
 */
function buildMemoryExtractionPrompt(messages, existingMemorySummary) {
  const conversation = messages
    .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n');

  return [
    {
      role: 'system',
      content: `You are a memory extractor for a project workspace. Analyze the conversation and extract important items as a JSON array.

Each item should have:
- "content": concise text (under 20 words)
- "category": one of "decision", "fact", "preference", "rejected", "code_style"
- "tags": 1-3 short, meaningful lowercase tags (e.g. "react", "auth", "database"). Keep tags concise and descriptive. Avoid verbose multi-word tags.

Categories explained:
- decision: firm choices the user has made ("Use PostgreSQL for the database")
- fact: important context or truths ("The API rate limit is 100 req/min")
- preference: user's working style preferences ("Prefer functional components over class components")
- rejected: ideas explicitly rejected ("Don't use Redux for state management")
- code_style: coding conventions discussed ("Use camelCase for variables, PascalCase for components")

${existingMemorySummary ? `\nAlready stored in memory (DO NOT duplicate these):\n${existingMemorySummary}\n` : ''}
Rules:
- Return ONLY a JSON array, no markdown, no code fences, no explanation
- Only extract genuinely NEW information not already in memory
- Skip greetings, small talk, and meta-conversation
- Each item must be a clear, standalone statement
- If nothing meaningful was discussed, return an empty array: []
- Maximum 10 items per extraction`,
    },
    {
      role: 'user',
      content: `Extract memory items from this conversation:\n\n${conversation}`,
    },
  ];
}

/**
 * Parse LLM response into an array of memory item objects.
 */
function parseMemoryItemsResponse(raw) {
  try {
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    const parsed = JSON.parse(cleaned);

    if (!Array.isArray(parsed)) {
      console.warn('Snapshot extraction returned non-array, wrapping');
      return [];
    }

    const validCategories = new Set(['decision', 'fact', 'preference', 'rejected', 'code_style']);

    return parsed
      .filter(item => item && typeof item.content === 'string' && item.content.trim())
      .map(item => ({
        content: item.content.trim(),
        category: validCategories.has(item.category) ? item.category : 'fact',
        tags: Array.isArray(item.tags) ? item.tags.map(t => String(t).toLowerCase().trim()).filter(Boolean) : [],
      }));
  } catch (e) {
    console.warn('Failed to parse memory extraction response:', e);
    return [];
  }
}

/**
 * Normalize text for dedup comparison — lowercase, strip punctuation, collapse whitespace.
 */
function normalizeForCompare(text) {
  return text.toLowerCase().replace(/[^\w\s]/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * Legacy: keep dedupeArray for any external usage.
 */
export function dedupeArray(arr) {
  const seen = new Set();
  return arr.filter(item => {
    const lower = String(item).toLowerCase().trim();
    if (seen.has(lower)) return false;
    seen.add(lower);
    return true;
  });
}
