import { getRecentMessages } from '../db/messageHelpers.js';
import { getWorkspace } from '../db/workspaceHelpers.js';
import { getGlobalProfile } from '../db/settingsHelpers.js';
import { searchMemory } from './ragService.js';
import { getPinnedMemories, bumpMemoryUsage } from '../db/memoryHelpers.js';
import { getRollingSummary } from './summaryService.js';
import { embedText } from './embeddingService.js';
import { debugLog } from './debugLogger.js';

// ── Casual / greeting detection ──
const CASUAL_PATTERNS = /^\s*(hi+|hey+|hello+|howdy|yo+|sup|what'?s? ?up|how ?are ?you|good ?(morning|afternoon|evening|night)|thanks?|thank ?you|ok+|okay|bye+|goodbye|see ?ya|lol|lmao|rofl|haha|heh|hmm+|wow|cool|nice|great|awesome|gm|gn|bruh|yep|yea+h?|nah|nope|sure|kk?|ty|np|gg|omg|oh+|ah+|ugh|hm+)\s*[!?.~]*\s*$/i;
const MAX_CASUAL_LENGTH = 50;

function isCasualMessage(text) {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (trimmed.length > MAX_CASUAL_LENGTH) return false;
  return CASUAL_PATTERNS.test(trimmed);
}

// ── Token budget constants ──
const CHARS_PER_TOKEN = 4; // rough estimate for English text
const MEMORY_TOKEN_BUDGET = 2000;
export const MEMORY_CHAR_BUDGET = MEMORY_TOKEN_BUDGET * CHARS_PER_TOKEN;
const RAG_CHAR_BUDGET = 3000 * CHARS_PER_TOKEN; // ~3000 tokens for RAG context

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
export async function compileContext(chatId, workspaceId, { maxMessages = 50, chatMode } = {}) {
  // Auto-detect mode if not explicitly set
  if (!chatMode) {
    chatMode = workspaceId ? 'workspace' : 'normal';
  }

  const t0 = performance.now();
  const isWorkspace = chatMode === 'workspace';
  const isTemp = chatMode === 'temporary';

  const [workspace, globalProfile, recentMessages, pinnedMemories, rollingSummary] = await Promise.all([
    isWorkspace && workspaceId ? getWorkspace(workspaceId) : null,
    !isTemp ? getGlobalProfile() : null,
    chatId ? getRecentMessages(chatId, maxMessages) : [],
    isWorkspace && workspaceId ? getPinnedMemories(workspaceId) : {},
    isWorkspace && chatId ? getRollingSummary(chatId) : null,
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
  const casual = lastUserMsg ? isCasualMessage(lastUserMsg.content) : false;

  if (lastUserMsg && isWorkspace && workspaceId && !casual) {
    try {
      // Embed query once — reused for RAG search AND memory relevance scoring
      queryEmbedding = await embedText(lastUserMsg.content);
      ragResults = await searchMemory(workspaceId, lastUserMsg.content, 8);
      // Filter out chunks already covered by the recent message history window
      const oldestRecentTs = recentMessages.length > 0
        ? recentMessages[0].timestamp
        : Infinity;
      ragResults = ragResults.filter(r => r.timestamp < oldestRecentTs);
      // Drop low-relevance results (score < 0.4) to avoid injecting loosely related context
      ragResults = ragResults.filter(r => (r.score ?? 1) >= 0.4);
      // Enforce RAG character budget
      let ragCharsRemaining = RAG_CHAR_BUDGET;
      ragResults = ragResults.filter(r => {
        const cost = (r.text?.length || 0) + 20; // +20 for date prefix
        if (ragCharsRemaining - cost < 0) return false;
        ragCharsRemaining -= cost;
        return true;
      });
    } catch (err) {
      console.warn('RAG search skipped:', err.message);
    }
  } else if (casual) {
    debugLog('context:casual-skip', { message: lastUserMsg?.content, reason: 'casual/greeting detected — skipping RAG' });
  }

  // getPinnedMemories returns { items, grouped } — extract the grouped map
  // so buildSystemPrompt can access pinnedGrouped['decision'], etc.
  const pinnedGrouped = pinnedMemories?.grouped || pinnedMemories || {};

  const { systemPrompt, injectedItemIds } = buildSystemPrompt(
    globalProfile, workspace, pinnedGrouped, ragResults, rollingSummary, queryEmbedding, casual, chatMode
  );

  // Bump usage stats for injected memory items (fire-and-forget)
  if (injectedItemIds.length > 0) {
    Promise.all(injectedItemIds.map(id => bumpMemoryUsage(id))).catch(() => { });
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
function buildSystemPrompt(globalProfile, workspace, pinnedMemories, ragResults = [], rollingSummary = null, queryEmbedding = null, isCasual = false, chatMode = 'workspace') {
  const lines = [];
  const injectedItemIds = [];

  // ── Core Identity ──
  lines.push('<identity>');
  lines.push('You are Synapse — a knowledgeable, versatile assistant.');
  lines.push('- Be concise and direct. Short answers for simple questions, detailed for complex ones.');
  lines.push('- Use markdown formatting: code blocks with language tags, lists, headers, bold/italic.');
  lines.push('- Match the user\'s tone — casual for casual, technical for technical, thorough when depth is needed.');
  lines.push('- Show reasoning naturally when solving complex problems. Don\'t force rigid section headers.');
  lines.push('- When thinking through complex problems, wrap your internal reasoning in <think>...</think> tags. This reasoning will be shown in a collapsible section — the user sees only your final answer by default.');
  lines.push('- Never pad responses with filler, unnecessary pleasantries, or redundant caveats.');
  lines.push('</identity>');
  lines.push('');

  // ── Casual fast-path ──
  if (isCasual) {
    lines.push('<mode>casual</mode>');
    lines.push('The user sent a casual greeting or short social message.');
    lines.push('Respond warmly but briefly — one or two sentences, like a friendly colleague.');
    lines.push('Do not reference workspace, memory, or project context.');
    lines.push('');
    return { systemPrompt: lines.join('\n'), injectedItemIds };
  }

  // ── Chat mode tag ──
  lines.push(`<mode>${chatMode}</mode>`);
  lines.push('');

  // ── User Profile (workspace + normal modes) ──
  if (chatMode !== 'temporary') {
    lines.push('<user-profile>');
    if (globalProfile?.role || globalProfile?.tone || globalProfile?.preferences?.length > 0) {
      if (globalProfile.role) lines.push(`Role: ${globalProfile.role}`);
      if (globalProfile.tone) lines.push(`Preferred tone: ${globalProfile.tone}`);
      if (globalProfile.preferences?.length > 0) {
        lines.push('Custom instructions:');
        globalProfile.preferences.forEach(p => lines.push(`- ${p}`));
      }
    } else {
      lines.push('No user preferences set.');
    }
    lines.push('</user-profile>');
    lines.push('');
  }

  // ── Workspace Memory (workspace mode only) ──
  if (chatMode === 'workspace') {
    const allPinnedItems = [];
    for (const category of CATEGORY_ORDER) {
      const items = pinnedMemories[category];
      if (!items?.length) continue;
      for (const item of items) {
        allPinnedItems.push(item);
      }
    }

    if (allPinnedItems.length > 0) {
      lines.push('<workspace-memory>');

      let charBudgetRemaining = MEMORY_CHAR_BUDGET;

      if (queryEmbedding) {
        // ── Relevance-scored assembly ──
        const scored = allPinnedItems.map(item => {
          let relevance = CATEGORY_RELEVANCE_BONUS[item.category] || 0;
          if (item._embedding) {
            relevance += cosineSimilarity(queryEmbedding, item._embedding);
          } else {
            relevance += keywordOverlap(item.content, queryEmbedding._queryText || '');
          }
          return { item, relevance };
        });

        scored.sort((a, b) => b.relevance - a.relevance);

        const selectedByCategory = {};
        for (const { item } of scored) {
          const line = `- ${item.content}`;
          if (charBudgetRemaining - line.length < 0) continue;
          charBudgetRemaining -= line.length;
          if (!selectedByCategory[item.category]) selectedByCategory[item.category] = [];
          selectedByCategory[item.category].push(item);
          injectedItemIds.push(item.id);
        }

        for (const category of CATEGORY_ORDER) {
          const items = selectedByCategory[category];
          if (!items?.length) continue;
          const label = CATEGORY_LABELS[category] || category;
          lines.push(`[${label}]`);
          for (const item of items) {
            lines.push(`- ${item.content}`);
          }
        }
      } else {
        // ── Fallback: fixed category order ──
        for (const category of CATEGORY_ORDER) {
          const items = pinnedMemories[category];
          if (!items?.length) continue;
          if (charBudgetRemaining <= 0) break;

          const label = CATEGORY_LABELS[category] || category;
          const sectionHeader = `[${label}]`;
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
          }
        }
      }

      lines.push('</workspace-memory>');
      lines.push('');
    } else if (workspace?.stateFile) {
      // ── Fallback: legacy stateFile ──
      const s = workspace.stateFile;
      lines.push('<workspace-memory>');
      if (s.project_goal) lines.push(`Project Goal: ${s.project_goal}`);
      if (s.current_status) lines.push(`Current Status: ${s.current_status}`);
      if (s.locked_decisions?.length) lines.push(`Locked Decisions: ${s.locked_decisions.join(' • ')}`);
      if (s.rejected_ideas?.length) lines.push(`Rejected Ideas: ${s.rejected_ideas.join(' • ')}`);
      if (s.key_insights?.length) lines.push(`Key Insights: ${s.key_insights.join(' • ')}`);
      lines.push('</workspace-memory>');
      lines.push('');
    }
  }

  // ── Rolling Conversation Summary (workspace mode only) ──
  if (chatMode === 'workspace' && rollingSummary) {
    lines.push('<conversation-summary>');
    lines.push('Summary of earlier parts of this conversation:');
    lines.push(rollingSummary);
    lines.push('</conversation-summary>');
    lines.push('');
  }

  // ── RAG — relevant past context (workspace mode only) ──
  if (chatMode === 'workspace' && ragResults.length > 0) {
    lines.push('<relevant-history>');
    lines.push('Relevant excerpts from previous conversations in this workspace:');
    for (const result of ragResults) {
      const date = new Date(result.timestamp).toLocaleDateString();
      lines.push(`[${date}] ${result.text}`);
    }
    lines.push('</relevant-history>');
    lines.push('');
  }

  // ── Guidelines ──
  lines.push('<guidelines>');
  if (chatMode === 'workspace') {
    lines.push('- When using workspace memory in your response, acknowledge it naturally: "Based on your preference for..." or "Since you decided to use..."');
    lines.push('- Don\'t list every memory reference mechanically — weave relevant context into your answer.');
    lines.push('- For important decisions or insights worth persisting, suggest the user save them with "Commit Snapshot".');
    lines.push('- If memory contains conflicting information, point out the conflict and ask for clarification.');
    lines.push('- Respect locked decisions. Do not re-suggest rejected ideas unless the user explicitly reconsiders.');
  }
  if (chatMode === 'normal') {
    lines.push('- This is a general chat without workspace context. Focus on being helpful with broad knowledge.');
    lines.push('- User profile preferences above still apply.');
  }
  if (chatMode === 'temporary') {
    lines.push('- This is a temporary chat — nothing is saved. Be helpful, concise, and treat each exchange fresh.');
  }
  lines.push('- Never fabricate details about past conversations or user information not provided in your context.');
  lines.push('- Web context may be injected above when the user uses @web. Treat it as live, real-world data and cite sources naturally.');
  lines.push('- IMPORTANT: When web context is provided, only cite specific numbers, facts, and data that appear verbatim in the web context. Never fabricate or guess values not present in the results.');
  lines.push('- If the web context does not contain the requested information (e.g. a stock price), say so clearly and suggest the user try a more specific @web query.');
  lines.push('- For real-time data not provided in context (live prices, breaking news, etc.), mention the user can use @web to fetch it.');
  lines.push('- Do not hallucinate or assume facts about the user that are not in the provided context.');
  lines.push('</guidelines>');

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

