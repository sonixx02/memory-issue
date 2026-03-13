import db from './database.js';

// Get a setting value by key
export async function getSetting(key) {
  const row = await db.settings.get(key);
  return row?.value ?? null;
}

// Set a setting value
export async function setSetting(key, value) {
  await db.settings.put({ key, value });
}

// Get all AI-related settings at once
export async function getAISettings() {
  const [provider, apiKey, model, providerKeys] = await Promise.all([
    getSetting('ai_provider'),
    getSetting('ai_api_key'),
    getSetting('ai_model'),
    getSetting('ai_provider_keys'),
  ]);
  const keys = providerKeys || {};
  const activeProvider = provider || 'openrouter';
  // Prefer per-provider key, fall back to legacy single key
  const activeKey = keys[activeProvider] || apiKey || '';
  return {
    provider: activeProvider,
    apiKey: activeKey,
    model: model || '',
    providerKeys: keys,
  };
}

// Save all AI settings
export async function saveAISettings({ provider, apiKey, model, providerKeys }) {
  const saves = [
    setSetting('ai_provider', provider),
    setSetting('ai_model', model),
  ];
  if (providerKeys) {
    saves.push(setSetting('ai_provider_keys', providerKeys));
  }
  // Also keep legacy key in sync for backwards compat
  if (apiKey) {
    saves.push(setSetting('ai_api_key', apiKey));
  }
  await Promise.all(saves);
}

// ── Global User Profile ──

const DEFAULT_PROFILE = {
  role: '',         // e.g. "Senior React Developer", "Beginner python student"
  tone: '',         // e.g. "Direct, no fluff, technical", "Encouraging and explanatory"
  preferences: []   // e.g. ["Always use React server components", "Prefer snake_case in Python"]
};

export async function getGlobalProfile() {
  const profile = await getSetting('global_user_profile');
  return profile ? { ...DEFAULT_PROFILE, ...profile } : DEFAULT_PROFILE;
}

export async function saveGlobalProfile(profileData) {
  await setSetting('global_user_profile', profileData);
}

// ── Web Search Settings ──

export async function getJinaApiKey() {
  return (await getSetting('jina_api_key')) || '';
}

export async function saveJinaApiKey(key) {
  await setSetting('jina_api_key', key);
}
