/**
 * Web search and page reading via Jina AI.
 *
 * Search: https://s.jina.ai/<query>   — requires a free Jina API key (jina.ai)
 * Reader: https://r.jina.ai/<url>     — works without a key (rate-limited) or with one
 *
 * Usage in chat: type  @web <your query>  or paste a bare https:// URL.
 * Add your free Jina API key in Settings → Web Search to enable search.
 */

const JINA_SEARCH = 'https://s.jina.ai/';
const JINA_READER = 'https://r.jina.ai/';

function jinaHeaders(apiKey) {
  const h = {
    Accept: 'text/plain',
    'X-Retain-Images': 'none',
    'X-No-Cache': 'true',
  };
  if (apiKey) h['Authorization'] = `Bearer ${apiKey}`;
  return h;
}

/**
 * Search the web for a query. Returns markdown-formatted results.
 * Requires a Jina AI API key (free at jina.ai).
 * Automatically appends current date hint for time-sensitive queries.
 */
export async function searchWeb(query, apiKey) {
  if (!apiKey) {
    throw new Error('NO_JINA_KEY');
  }

  // Add freshness hints for time-sensitive queries (prices, news, current events)
  const timeSensitiveRe = /\b(price|stock|share|live|current|latest|today|news|score|weather|rate|exchange)\b/i;
  let enrichedQuery = query;
  if (timeSensitiveRe.test(query)) {
    const now = new Date();
    const month = now.toLocaleString('en', { month: 'long' });
    enrichedQuery = `${query} ${month} ${now.getFullYear()}`;
  }

  const url = JINA_SEARCH + encodeURIComponent(enrichedQuery);
  const res = await fetch(url, { headers: jinaHeaders(apiKey) });
  if (res.status === 401 || res.status === 403) throw new Error('INVALID_JINA_KEY');
  if (!res.ok) throw new Error(`Web search failed (${res.status})`);
  const text = await res.text();
  return text.slice(0, 8000);
}

/**
 * Fetch the content of a web page as clean markdown via Jina Reader.
 * Works without an API key, but a key increases rate limits.
 */
export async function fetchPage(pageUrl, apiKey) {
  const url = JINA_READER + pageUrl;
  const res = await fetch(url, { headers: jinaHeaders(apiKey) });
  if (!res.ok) throw new Error(`Page fetch failed (${res.status})`);
  const text = await res.text();
  return text.slice(0, 12000);
}

/**
 * Extract @web mentions and bare https:// URLs from a message.
 * Returns array of { type: 'search'|'url', value: string, raw: string }
 */
export function extractWebMentions(text) {
  const mentions = [];

  // @web <query> — matches to end of line
  const webRe = /@web\s+([^\n]+)/gi;
  let m;
  while ((m = webRe.exec(text)) !== null) {
    // Strip leading filler words: "search", "look up", "find", "google"
    let query = m[1].trim().replace(/^(?:search|search for|look\s*up|find|google|fetch)\s+/i, '').trim();
    mentions.push({ type: 'search', value: query, raw: m[0] });
  }

  // Bare https:// URLs not already captured via @web
  const urlRe = /https?:\/\/[^\s)>\]"']+/g;
  while ((m = urlRe.exec(text)) !== null) {
    const inWebMention = mentions.some(mn => mn.raw.includes(m[0]));
    if (!inWebMention) {
      mentions.push({ type: 'url', value: m[0], raw: m[0] });
    }
  }

  return mentions;
}

/**
 * Remove @web markers (and their query text) from user message text
 * so the stored/displayed message is clean.
 */
export function stripWebMentions(text) {
  return text.replace(/@web\s+[^\n]*/gi, '').replace(/\n{3,}/g, '\n\n').trim();
}

/**
 * Resolve all web mentions in a message — fetch results for each one.
 * Returns { contextBlock: string, errors: string[] }
 *
 * Errors are included in contextBlock so the AI can tell the user what went wrong.
 */
export async function resolveWebMentions(text, apiKey) {
  const mentions = extractWebMentions(text);
  if (mentions.length === 0) return { contextBlock: '', errors: [] };

  const parts = [];
  const errors = [];

  for (const mention of mentions) {
    try {
      if (mention.type === 'search') {
        const results = await searchWeb(mention.value, apiKey);
        parts.push(`[Web Search: "${mention.value}"]\n${results}`);
      } else {
        const content = await fetchPage(mention.value, apiKey);
        parts.push(`[Page Content: ${mention.value}]\n${content}`);
      }
    } catch (err) {
      let msg;
      if (err.message === 'NO_JINA_KEY') {
        msg = `Web search requires a free Jina AI API key. Go to Settings → Web Search to add one (get it free at jina.ai).`;
      } else if (err.message === 'INVALID_JINA_KEY') {
        msg = `Web search failed: invalid Jina API key. Check your key in Settings → Web Search.`;
      } else {
        msg = `Web search failed for "${mention.value}": ${err.message}`;
      }
      errors.push(msg);
      parts.push(`[Web Search Error: "${mention.value}"]\n${msg}`);
    }
  }

  const contextBlock = parts.join('\n\n---\n\n');
  return { contextBlock, errors };
}
