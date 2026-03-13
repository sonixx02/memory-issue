/**
 * Dynamic model registry — fetches available models from each provider's API.
 *
 * Zero hardcoded model lists.  Everything comes from the provider at runtime,
 * cached in localStorage for 1 hour.  If the fetch fails the UI shows a
 * retry button instead of stale data.
 */

const CACHE_PREFIX = 'models_cache_';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Cache helpers ──────────────────────────────────────────────────────────

function getCached(providerId) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + providerId);
    if (!raw) return null;
    const { ts, models } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return models;
  } catch {
    return null;
  }
}

function setCache(providerId, models) {
  try {
    localStorage.setItem(
      CACHE_PREFIX + providerId,
      JSON.stringify({ ts: Date.now(), models }),
    );
  } catch {
    /* quota exceeded – fine, refetch next time */
  }
}

export function clearModelsCache(providerId) {
  if (providerId) {
    try { localStorage.removeItem(CACHE_PREFIX + providerId); } catch { /* noop */ }
  } else {
    // Clear all provider caches
    try {
      Object.keys(localStorage)
        .filter(k => k.startsWith(CACHE_PREFIX))
        .forEach(k => localStorage.removeItem(k));
    } catch { /* noop */ }
  }
}

// ── Provider configurations ────────────────────────────────────────────────

export const PROVIDER_META = [
  { id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-v1-...', requiresKey: false },
  { id: 'openai',     label: 'OpenAI',     placeholder: 'sk-...',       requiresKey: true  },
  { id: 'anthropic',  label: 'Anthropic',  placeholder: 'sk-ant-...',   requiresKey: true  },
  { id: 'gemini',     label: 'Gemini',     placeholder: 'AIza...',      requiresKey: true  },
  { id: 'groq',       label: 'Groq',       placeholder: 'gsk_...',      requiresKey: true  },
];

// ── Per-provider fetchers ──────────────────────────────────────────────────

async function fetchOpenRouter() {
  const res = await fetch('https://openrouter.ai/api/v1/models');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  return data.data
    .filter(m => m.id && m.name)
    .map(m => {
      const isFree =
        m.pricing &&
        parseFloat(m.pricing.prompt) === 0 &&
        parseFloat(m.pricing.completion) === 0;
      return {
        id: m.id,
        name: cleanName(m.name),
        free: isFree,
        contextLength: m.context_length || undefined,
      };
    })
    .sort((a, b) => {
      // Free models first, then alphabetical
      if (a.free !== b.free) return a.free ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

async function fetchOpenAI(apiKey) {
  const res = await fetch('https://api.openai.com/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  // Filter to chat-capable models only (gpt-*, o1-*, o3-*, chatgpt-*)
  const chatPrefixes = ['gpt-', 'o1', 'o3', 'o4', 'chatgpt-'];
  const excludePatterns = ['instruct', 'realtime', 'audio', 'tts', 'whisper', 'dall-e', 'embedding', 'moderation', 'search'];

  return data.data
    .filter(m => {
      const id = m.id.toLowerCase();
      const isChat = chatPrefixes.some(p => id.startsWith(p));
      const isExcluded = excludePatterns.some(p => id.includes(p));
      return isChat && !isExcluded;
    })
    .map(m => ({ id: m.id, name: formatModelName(m.id), free: false }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchAnthropic(apiKey) {
  const res = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  return (data.data || [])
    .filter(m => m.id && m.type === 'model')
    .map(m => ({
      id: m.id,
      name: m.display_name || formatModelName(m.id),
      free: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchGemini(apiKey) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`,
  );
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  return (data.models || [])
    .filter(m => {
      // Only models that support generateContent (chat)
      const methods = m.supportedGenerationMethods || [];
      return methods.includes('generateContent') || methods.includes('streamGenerateContent');
    })
    .map(m => {
      // API returns name as "models/gemini-2.0-flash", we want just "gemini-2.0-flash"
      const id = m.name?.replace('models/', '') || m.name;
      return {
        id,
        name: m.displayName || formatModelName(id),
        free: false,
        contextLength: m.inputTokenLimit || undefined,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function fetchGroq(apiKey) {
  const res = await fetch('https://api.groq.com/openai/v1/models', {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();

  return (data.data || [])
    .filter(m => m.id && m.active !== false)
    .map(m => ({
      id: m.id,
      name: formatModelName(m.id),
      free: false, // Groq is free but we don't mark it specially
      contextLength: m.context_window || undefined,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Helpers ────────────────────────────────────────────────────────────────

function cleanName(raw) {
  return raw
    .replace(/\s*\(free\)\s*$/i, '')
    .replace(/:free$/i, '')
    .trim();
}

/** Turn "gpt-4o-mini" → "GPT 4o Mini", "claude-sonnet-4-20250514" → "Claude Sonnet 4 20250514" */
function formatModelName(id) {
  return id
    .replace(/^models\//, '')
    .split(/[-_/]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// Map of provider → fetcher
const FETCHERS = {
  openrouter: (_, __) => fetchOpenRouter(),
  openai:     (_, key) => fetchOpenAI(key),
  anthropic:  (_, key) => fetchAnthropic(key),
  gemini:     (_, key) => fetchGemini(key),
  groq:       (_, key) => fetchGroq(key),
};

// ── In-flight deduplication ────────────────────────────────────────────────

const _inFlight = {};

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Fetch available models for a provider.
 *
 * @param {string} providerId - One of 'openrouter','openai','anthropic','gemini','groq'
 * @param {string} [apiKey]   - The user's API key (not needed for OpenRouter)
 * @returns {Promise<{ models: Array<{id,name,free?}>, error?: string }>}
 */
export async function fetchModelsForProvider(providerId, apiKey) {
  const meta = PROVIDER_META.find(p => p.id === providerId);
  if (!meta) return { models: [], error: 'Unknown provider' };

  // Require API key for providers that need it
  if (meta.requiresKey && !apiKey) {
    return { models: [], error: 'Enter an API key to load available models' };
  }

  // 1. Return from cache
  const cached = getCached(providerId);
  if (cached) return { models: cached };

  // 2. Deduplicate concurrent calls
  const cacheKey = `${providerId}:${apiKey || ''}`;
  if (_inFlight[cacheKey]) return _inFlight[cacheKey];

  _inFlight[cacheKey] = (async () => {
    try {
      const fetcher = FETCHERS[providerId];
      if (!fetcher) return { models: [], error: 'No fetcher for this provider' };

      const models = await fetcher(providerId, apiKey);
      setCache(providerId, models);
      console.log(`[ModelRegistry] Fetched ${models.length} models for ${providerId}`);
      return { models };
    } catch (err) {
      console.warn(`[ModelRegistry] Failed to fetch models for ${providerId}:`, err);
      return { models: [], error: `Failed to load models: ${err.message}` };
    } finally {
      delete _inFlight[cacheKey];
    }
  })();

  return _inFlight[cacheKey];
}
