/**
 * Dynamic OpenRouter model discovery.
 *
 * Fetches the live model catalogue from OpenRouter, filters for free models,
 * and caches the result in localStorage for 1 hour so we don't spam the API.
 *
 * If the network request fails we fall back to a small hardcoded list that is
 * only used until the next successful fetch.
 */

const CACHE_KEY = 'openrouter_free_models';
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

// ── Minimal fallback in case the API is unreachable ────────────────────────

const FALLBACK_FREE_MODELS = [
  { id: 'meta-llama/llama-4-maverick:free', name: 'Llama 4 Maverick', free: true },
  { id: 'meta-llama/llama-4-scout:free', name: 'Llama 4 Scout', free: true },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', free: true },
  { id: 'deepseek/deepseek-r1-0528:free', name: 'DeepSeek R1', free: true },
  { id: 'deepseek/deepseek-v3-0324:free', name: 'DeepSeek V3', free: true },
  { id: 'qwen/qwen3-235b-a22b:free', name: 'Qwen 3 235B', free: true },
  { id: 'qwen/qwen3-32b:free', name: 'Qwen 3 32B', free: true },
  { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B', free: true },
  { id: 'microsoft/phi-4-multimodal-instruct:free', name: 'Phi-4 Multimodal', free: true },
  { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1', free: true },
];

// ── In-memory singleton so multiple imports share the same promise ─────────

let _fetchPromise = null;

// ── Helpers ────────────────────────────────────────────────────────────────

function cleanName(raw) {
  // API returns names like "DeepSeek: DeepSeek V3 0324 (free)"
  // Strip the "(free)" / ":free" suffix and leading vendor prefix if it
  // duplicates info already visible in the provider column.
  return raw
    .replace(/\s*\(free\)\s*$/i, '')
    .replace(/:free$/i, '')
    .trim();
}

function getCached() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const { ts, models } = JSON.parse(raw);
    if (Date.now() - ts > CACHE_TTL) return null;
    return models;
  } catch {
    return null;
  }
}

function setCache(models) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ts: Date.now(), models }));
  } catch { /* quota exceeded – fine, we'll just refetch next time */ }
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Return a list of every free model currently available on OpenRouter.
 *
 * Each item: `{ id, name, free: true, contextLength?, description? }`
 *
 * Results are cached in localStorage for 1 h.  If the network call fails the
 * hardcoded fallback list is returned instead.
 */
export async function fetchFreeOpenRouterModels() {
  // 1. Check localStorage cache
  const cached = getCached();
  if (cached) return cached;

  // 2. De-duplicate concurrent callers
  if (_fetchPromise) return _fetchPromise;

  _fetchPromise = (async () => {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/models');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();

      const models = data.data
        .filter(m =>
          m.pricing &&
          parseFloat(m.pricing.prompt) === 0 &&
          parseFloat(m.pricing.completion) === 0
        )
        .map(m => ({
          id: m.id,
          name: cleanName(m.name || m.id),
          free: true,
          contextLength: m.context_length || undefined,
          description: m.description?.slice(0, 120) || undefined,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      setCache(models);
      console.log(`[OpenRouter] Fetched ${models.length} free models`);
      return models;
    } catch (err) {
      console.warn('[OpenRouter] Failed to fetch models, using fallback:', err);
      return FALLBACK_FREE_MODELS;
    } finally {
      _fetchPromise = null;
    }
  })();

  return _fetchPromise;
}

/**
 * Force-clear the cache so the next call to fetchFreeOpenRouterModels()
 * will hit the network.
 */
export function clearModelCache() {
  _fetchPromise = null;
  try { localStorage.removeItem(CACHE_KEY); } catch { /* noop */ }
}

/**
 * Given an array of free model IDs, return a list suitable for OpenRouter's
 * fallback / model routing feature.  Pass the returned array as the `model`
 * field in the chat completion request body instead of a single model string.
 *
 * Example:
 *   const ids = (await fetchFreeOpenRouterModels()).map(m => m.id);
 *   const fallbackList = buildFallbackModelList(ids, 'meta-llama/llama-4-maverick:free');
 *   // fallbackList = ['meta-llama/llama-4-maverick:free', ...rest]
 */
export function buildFallbackModelList(freeModelIds, preferredModelId) {
  if (!preferredModelId) return freeModelIds;
  // Put the user's preferred model first, then all others as fallbacks
  const rest = freeModelIds.filter(id => id !== preferredModelId);
  return [preferredModelId, ...rest];
}
