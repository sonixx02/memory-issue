import { getRecentMessages } from '../db/messageHelpers.js';
import { getWorkspace } from '../db/workspaceHelpers.js';
import { getGlobalProfile } from '../db/settingsHelpers.js';
import { searchMemory } from './ragService.js';
import { getPinnedMemories, bumpMemoryUsage } from '../db/memoryHelpers.js';
import { getRollingSummary } from './summaryService.js';
import { embedText } from './embeddingService.js';
import { debugLog } from './debugLogger.js';

// ── Token budget constants ──
const CHARS_PER_TOKEN = 4; // rough estimate for English text
const MEMORY_TOKEN_BUDGET = 2000;
export const MEMORY_CHAR_BUDGET = MEMORY_TOKEN_BUDGET * CHARS_PER_TOKEN;

// Category display labels
const CATEGORY_ORDER = ['decision', 'rejected', 'fact', 'preference', 'code_style'];
const CATEGORY_LABELS = {
  decision: '🔒 Locked Decisions',
  rejected: '🚫 Rejected Ideas',
  fact: '📌 Key Facts',
  preference: '⚙️ Preferences',
  code_style: '🎨 Code Style',
};

// Category priority bonus — decisions/rejected always get a slight boost
const CATEGORY_RELEVANCE_BONUS = {
  decision: 0.15,
  rejected: 0.12,
  fact: 0.05,
  preference: 0.03,
  code_style: 0.02,
};

/**
 * Builds the full message array to send to the LLM.
 *
 * Layers injected into system prompt (in order):
 *   1. Global Profile (role, tone, instructions)
 *   2. Pinned Memory Items grouped by category (global first, then workspace)
 *   3. Rolling conversation summary (if available)
 *   4. RAG results from past conversations
 *   5. Behavioral guardrails
 *
 * @returns {{ messages: Array, metadata: object }}
 */
export async function compileContext(chatId, workspaceId, { maxMessages = 50 } = {}) {
  const t0 = performance.now();
  const [workspace, globalProfile, recentMessages, pinnedMemories, rollingSummary] = await Promise.all([
    workspaceId ? getWorkspace(workspaceId) : null,
    getGlobalProfile(),
    getRecentMessages(chatId, maxMessages),
    workspaceId ? getPinnedMemories(workspaceId) : {},
    chatId ? getRollingSummary(chatId) : null,
  ]);

  debugLog('context:data-fetched', {
    workspaceName: workspace?.name,
    profileRole: globalProfile?.role,
    profileTone: globalProfile?.tone,
    recentMessageCount: recentMessages.length,
    pinnedItemCount: Object.values(pinnedMemories?.grouped || pinnedMemories || {}).flat().length,
    hasRollingSummary: !!rollingSummary,
    rollingSummaryLength: rollingSummary?.length || 0,
  });

  // Get the user's latest message for RAG search
  const lastUserMsg = [...recentMessages].reverse().find(m => m.role === 'user');
  let ragResults = [];
  let queryEmbedding = null;
  if (lastUserMsg && workspaceId) {
    try {
      // Embed query once — reused for RAG search AND memory relevance scoring
      queryEmbedding = await embedText(lastUserMsg.content);
      ragResults = await searchMemory(workspaceId, lastUserMsg.content, 8);
      // Filter out chunks already covered by the recent message history window
      const oldestRecentTs = recentMessages.length > 0
        ? recentMessages[0].timestamp
        : Infinity;
      ragResults = ragResults.filter(r => r.timestamp < oldestRecentTs);
    } catch (err) {
      console.warn('RAG search skipped:', err.message);
    }
  }

  // getPinnedMemories returns { items, grouped } — extract the grouped map
  // so buildSystemPrompt can access pinnedGrouped['decision'], etc.
  const pinnedGrouped = pinnedMemories?.grouped || pinnedMemories || {};

  const { systemPrompt, injectedItemIds } = buildSystemPrompt(
    globalProfile, workspace, pinnedGrouped, ragResults, rollingSummary, queryEmbedding
  );

  // Bump usage stats for injected memory items (fire-and-forget)
  if (injectedItemIds.length > 0) {
    Promise.all(injectedItemIds.map(id => bumpMemoryUsage(id))).catch(() => {});
  }

  // Convert DB messages to the OpenAI-style role/content format
  const history = recentMessages.map(m => ({
    role: m.role,
    content: m.content,
  }));

  const messages = [{ role: 'system', content: systemPrompt }, ...history];

  const duration = Math.round(performance.now() - t0);
  const metadata = {
    pinnedCount: injectedItemIds.length,
    ragResultCount: ragResults.length,
    hasRollingSummary: !!rollingSummary,
    tokenEstimate: Math.ceil(systemPrompt.length / CHARS_PER_TOKEN),
  };

  debugLog('context:compiled', {
    duration,
    systemPromptLength: systemPrompt.length,
    systemPromptPreview: systemPrompt.slice(0, 500) + (systemPrompt.length > 500 ? '...' : ''),
    fullSystemPrompt: systemPrompt,
    historyLength: history.length,
    totalMessages: messages.length,
    ragResults: ragResults.map(r => ({ text: r.text?.slice(0, 120), score: r.score, timestamp: r.timestamp })),
    ...metadata,
  });

  return { messages, metadata };
}

/**
 * Build the system prompt with Memory Items, profile, and RAG.
 * Uses relevance-scored assembly when a query embedding is available:
 * each memory item gets a cosine similarity score + category bonus,
 * then items are packed in descending relevance order until budget is full.
 * Falls back to fixed category order if no embedding is available.
 *
 * Returns the prompt string and IDs of injected items (for usage tracking).
 */
function buildSystemPrompt(globalProfile, workspace, pinnedMemories, ragResults = [], rollingSummary = null, queryEmbedding = null) {
  const lines = [
    'You are Snapshot AI — a project-aware assistant embedded in a local-first workspace.',
    'You help the user make decisions, write code, and think through architecture.',
    'Be concise, direct, and technical. Use markdown formatting.',
    '',
  ];
  const injectedItemIds = [];

  // ── 1. Global Profile ──
  lines.push('## User Profile & Global Preferences');
  if (globalProfile?.role || globalProfile?.tone || globalProfile?.preferences?.length > 0) {
    if (globalProfile.role) lines.push(`- **User Role:** ${globalProfile.role}`);
    if (globalProfile.tone) lines.push(`- **Preferred Tone:** ${globalProfile.tone}`);
    if (globalProfile.preferences?.length > 0) {
      lines.push('- **Global Instructions:**');
      globalProfile.preferences.forEach(p => lines.push(`  - ${p}`));
    }
  } else {
    lines.push('No global preferences set yet.');
  }
  lines.push('');

  // ── 2. Pinned Memory Items (relevance-scored if embedding available) ──
  const allPinnedItems = [];
  for (const category of CATEGORY_ORDER) {
    const items = pinnedMemories[category];
    if (!items?.length) continue;
    for (const item of items) {
      allPinnedItems.push(item);
    }
  }

  if (allPinnedItems.length > 0) {
    lines.push('## Workspace Memory');
    lines.push('');

    let charBudgetRemaining = MEMORY_CHAR_BUDGET;

    if (queryEmbedding) {
      // ── Relevance-scored assembly ──
      // Score each item against the query embedding using cosine similarity
      const scored = allPinnedItems.map(item => {
        let relevance = CATEGORY_RELEVANCE_BONUS[item.category] || 0;

        // If item has an embedding cached, compute similarity
        // Otherwise use category bonus only (still better than no ranking)
        if (item._embedding) {
          relevance += cosineSimilarity(queryEmbedding, item._embedding);
        } else {
          // Lightweight keyword overlap score as fallback
          relevance += keywordOverlap(item.content, queryEmbedding._queryText || '');
        }

        return { item, relevance };
      });

      // Sort by relevance descending
      scored.sort((a, b) => b.relevance - a.relevance);

      // Group by category for display (but iterate in relevance order for budget)
      const selectedByCategory = {};
      for (const { item } of scored) {
        const line = `- ${item.content}`;
        if (charBudgetRemaining - line.length < 0) continue;
        charBudgetRemaining -= line.length;
        if (!selectedByCategory[item.category]) selectedByCategory[item.category] = [];
        selectedByCategory[item.category].push(item);
        injectedItemIds.push(item.id);
      }

      // Render grouped by category for readability
      for (const category of CATEGORY_ORDER) {
        const items = selectedByCategory[category];
        if (!items?.length) continue;
        const label = CATEGORY_LABELS[category] || category;
        lines.push(`### ${label}`);
        for (const item of items) {
          lines.push(`- ${item.content}`);
        }
        lines.push('');
      }
    } else {
      // ── Fallback: fixed category order (original behavior) ──
      for (const category of CATEGORY_ORDER) {
        const items = pinnedMemories[category];
        if (!items?.length) continue;
        if (charBudgetRemaining <= 0) break;

        const label = CATEGORY_LABELS[category] || category;
        const sectionHeader = `### ${label}`;
        charBudgetRemaining -= sectionHeader.length;

        const itemLines = [];
        for (const item of items) {
          const line = `- ${item.content}`;
          if (charBudgetRemaining - line.length < 0) break;
          charBudgetRemaining -= line.length;
          itemLines.push(line);
          injectedItemIds.push(item.id);
        }

        if (itemLines.length > 0) {
          lines.push(sectionHeader);
          lines.push(...itemLines);
          lines.push('');
        }
      }
    }

    lines.push('Respect locked decisions. Do not suggest rejected ideas unless the user explicitly reconsiders.');
  } else if (workspace?.stateFile) {
    // ── Fallback: legacy stateFile ──
    const s = workspace.stateFile;
    lines.push('## Current Workspace Memory');
    lines.push('');
    if (s.project_goal) lines.push(`**Project Goal:** ${s.project_goal}`);
    if (s.current_status) lines.push(`**Current Status:** ${s.current_status}`);
    if (s.locked_decisions?.length) lines.push(`**Locked Decisions:** ${s.locked_decisions.join(' • ')}`);
    if (s.rejected_ideas?.length) lines.push(`**Rejected Ideas:** ${s.rejected_ideas.join(' • ')}`);
    if (s.key_insights?.length) lines.push(`**Key Insights:** ${s.key_insights.join(' • ')}`);
    lines.push('');
    lines.push('Respect locked decisions. Do not suggest rejected ideas unless the user explicitly reconsiders.');
  } else {
    lines.push('No workspace memory has been committed yet. The user should use "Commit Snapshot" to lock in important decisions.');
  }

  // ── 3. Rolling Conversation Summary ──
  if (rollingSummary) {
    lines.push('');
    lines.push('## Conversation Summary (older messages)');
    lines.push('The following summarizes earlier parts of this conversation:');
    lines.push('');
    lines.push(rollingSummary);
    lines.push('');
    lines.push('Use this summary for continuity. The full recent messages follow below.');
  }

  // ── 4. RAG — relevant past context ──
  if (ragResults.length > 0) {
    lines.push('');
    lines.push('## Relevant Past Context');
    lines.push('The following are relevant excerpts from previous conversations in this workspace:');
    lines.push('');
    for (const result of ragResults) {
      const date = new Date(result.timestamp).toLocaleDateString();
      lines.push(`> [${date}] ${result.text}`);
    }
    lines.push('');
    lines.push('Use this past context to maintain continuity. Do not contradict previously discussed details unless the user explicitly changes direction.');
  }

  // ── 5. Behavioral guardrails ──
  lines.push('');
  lines.push('## Important Rules');
  lines.push('- When the user makes an important decision, remind them to hit "Commit Snapshot" to persist it.');
  lines.push('- If your memory contains conflicting information, acknowledge the conflict and ask the user to clarify.');
  lines.push('- Never fabricate details about past conversations — if you are unsure, say so.');

  return { systemPrompt: lines.join('\n'), injectedItemIds };
}

/**
 * Calculate memory budget usage for a workspace.
 * Mirrors the exact same budget logic used by buildSystemPrompt so the UI
 * accurately reflects what the LLM will see.
 *
 * @returns {{ totalChars: number, budgetLimit: number, injectedIds: Set<number>,
 *             droppedIds: Set<number>, categoryBreakdown: Record<string, { used: number, items: number }> }}
 */
export async function getMemoryBudgetUsage(workspaceId) {
  if (!workspaceId) {
    return { totalChars: 0, budgetLimit: MEMORY_CHAR_BUDGET, injectedIds: new Set(), droppedIds: new Set(), categoryBreakdown: {} };
  }

  const pinnedMemories = await getPinnedMemories(workspaceId);
  const grouped = pinnedMemories?.grouped || {};

  let charBudgetRemaining = MEMORY_CHAR_BUDGET;
  const injectedIds = new Set();
  const droppedIds = new Set();
  const categoryBreakdown = {};
  let totalChars = 0;

  for (const category of CATEGORY_ORDER) {
    const items = grouped[category];
    if (!items?.length) continue;

    const label = CATEGORY_LABELS[category] || category;
    const sectionHeader = `### ${label}`;
    const headerCost = sectionHeader.length;

    let catUsed = 0;
    let catItems = 0;
    let headerCounted = false;

    for (const item of items) {
      const lineCost = `- ${item.content}`.length;

      // Account for header cost on first item of category
      const fullCost = !headerCounted ? headerCost + lineCost : lineCost;

      if (charBudgetRemaining - fullCost >= 0) {
        charBudgetRemaining -= fullCost;
        totalChars += fullCost;
        catUsed += fullCost;
        catItems++;
        injectedIds.add(item.id);
        headerCounted = true;
      } else {
        droppedIds.add(item.id);
      }
    }

    if (catItems > 0) {
      categoryBreakdown[category] = { used: catUsed, items: catItems };
    }
  }

  return {
    totalChars,
    budgetLimit: MEMORY_CHAR_BUDGET,
    injectedIds,
    droppedIds,
    categoryBreakdown,
  };
}

// ── Helper: cosine similarity between two vectors ──
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

// ── Helper: lightweight keyword overlap score ──
function keywordOverlap(memoryContent, queryText) {
  if (!memoryContent || !queryText) return 0;
  const memWords = new Set(memoryContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
  const queryWords = queryText.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (queryWords.length === 0) return 0;
  const matches = queryWords.filter(w => memWords.has(w)).length;
  return (matches / queryWords.length) * 0.3; // scale to [0, 0.3] range
}
