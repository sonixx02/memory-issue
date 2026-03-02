/**
 * settingsHelpers.test.js — Tests for settings CRUD, AI settings, and global profile.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getSetting,
  setSetting,
  getAISettings,
  saveAISettings,
  getGlobalProfile,
  saveGlobalProfile,
} from '../../db/settingsHelpers.js';
import { clearAllTables } from '../../test/helpers.js';

beforeEach(async () => {
  await clearAllTables();
});

describe('getSetting / setSetting', () => {
  it('stores and retrieves a string value', async () => {
    await setSetting('theme', 'dark');
    expect(await getSetting('theme')).toBe('dark');
  });

  it('stores and retrieves an object value', async () => {
    await setSetting('config', { a: 1, b: [2, 3] });
    const config = await getSetting('config');
    expect(config).toEqual({ a: 1, b: [2, 3] });
  });

  it('returns null for missing key', async () => {
    expect(await getSetting('nonexistent')).toBeNull();
  });

  it('overwrites existing key', async () => {
    await setSetting('key', 'first');
    await setSetting('key', 'second');
    expect(await getSetting('key')).toBe('second');
  });

  it('handles falsy values (0, false, "")', async () => {
    await setSetting('zero', 0);
    await setSetting('false', false);
    await setSetting('empty', '');

    // Note: 0 and false are falsy, so ?? will NOT trigger (it only checks null/undefined)
    expect(await getSetting('zero')).toBe(0);
    expect(await getSetting('false')).toBe(false);
    expect(await getSetting('empty')).toBe('');
  });
});

describe('getAISettings / saveAISettings', () => {
  it('returns defaults when no settings are saved', async () => {
    const settings = await getAISettings();
    expect(settings.provider).toBe('openrouter');
    expect(settings.apiKey).toBe('');
    expect(settings.model).toBe('');
    expect(settings.providerKeys).toEqual({});
  });

  it('saves and retrieves AI settings', async () => {
    await saveAISettings({
      provider: 'anthropic',
      apiKey: 'sk-test-123',
      model: 'claude-3-opus',
    });

    const settings = await getAISettings();
    expect(settings.provider).toBe('anthropic');
    expect(settings.apiKey).toBe('sk-test-123');
    expect(settings.model).toBe('claude-3-opus');
  });

  it('updates partially (other keys remain)', async () => {
    await saveAISettings({ provider: 'openai', apiKey: 'key1', model: 'gpt-4' });
    await saveAISettings({ provider: 'anthropic', apiKey: 'key2', model: 'claude' });

    const settings = await getAISettings();
    expect(settings.provider).toBe('anthropic');
    expect(settings.apiKey).toBe('key2');
  });

  it('stores and resolves per-provider keys', async () => {
    const keys = { openai: 'sk-openai', anthropic: 'sk-ant', openrouter: 'sk-or' };
    await saveAISettings({ provider: 'openai', apiKey: 'sk-openai', model: 'gpt-4o', providerKeys: keys });

    const settings = await getAISettings();
    expect(settings.providerKeys).toEqual(keys);
    expect(settings.provider).toBe('openai');
    expect(settings.apiKey).toBe('sk-openai'); // resolved from providerKeys

    // Switch provider — should resolve different key
    await saveAISettings({ ...settings, provider: 'anthropic', model: 'claude', providerKeys: keys });
    const s2 = await getAISettings();
    expect(s2.apiKey).toBe('sk-ant');
  });

  it('falls back to legacy key when providerKeys is empty', async () => {
    await saveAISettings({ provider: 'openai', apiKey: 'legacy-key', model: 'gpt-4o' });
    const settings = await getAISettings();
    expect(settings.apiKey).toBe('legacy-key');
    expect(settings.providerKeys).toEqual({});
  });
});

describe('getGlobalProfile / saveGlobalProfile', () => {
  it('returns DEFAULT_PROFILE when nothing saved', async () => {
    const profile = await getGlobalProfile();
    expect(profile.role).toBe('');
    expect(profile.tone).toBe('');
    expect(profile.preferences).toEqual([]);
  });

  it('saves and retrieves a full profile', async () => {
    const profileData = {
      role: 'Senior React Developer',
      tone: 'Direct, no fluff',
      preferences: ['Use TypeScript', 'Prefer functional components'],
    };
    await saveGlobalProfile(profileData);

    const loaded = await getGlobalProfile();
    expect(loaded.role).toBe('Senior React Developer');
    expect(loaded.tone).toBe('Direct, no fluff');
    expect(loaded.preferences).toEqual(['Use TypeScript', 'Prefer functional components']);
  });

  it('merges with defaults for partial profile', async () => {
    await saveGlobalProfile({ role: 'Junior Dev' });
    const loaded = await getGlobalProfile();
    expect(loaded.role).toBe('Junior Dev');
    expect(loaded.tone).toBe(''); // default
    expect(loaded.preferences).toEqual([]); // default
  });
});
