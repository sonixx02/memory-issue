import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Key, Bot, Check, AlertCircle, Download, Upload, Globe, Trash2, Pin, Edit3, Palette, RefreshCw, Loader } from 'lucide-react';
import { getAISettings, saveAISettings, getGlobalProfile, saveGlobalProfile, getJinaApiKey, saveJinaApiKey } from '../../db/settingsHelpers.js';
import { exportAllData, importData } from '../../db/exportImport.js';
import db from '../../db/database.js';
import { deleteMemoryItem, updateMemoryItem, demoteToWorkspace } from '../../db/memoryHelpers.js';
import { useTheme, tv, THEMES } from '../../theme/ThemeContext.jsx';
import { PROVIDER_META, fetchModelsForProvider, clearModelsCache } from '../../ai/modelRegistry.js';

export default function SettingsModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('models');
  // AI Settings
  const [provider, setProvider] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [providerKeys, setProviderKeys] = useState({});
  // Dynamic model list
  const [dynamicModels, setDynamicModels] = useState([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState('');
  // Profile Settings
  const [profileRole, setProfileRole] = useState('');
  const [profileTone, setProfileTone] = useState('');
  const [profilePrefs, setProfilePrefs] = useState('');
  // Web Search
  const [jinaApiKey, setJinaApiKey] = useState('');

  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalItems, setGlobalItems] = useState([]);
  const fileInputRef = useRef(null);
  const debounceRef = useRef(null);

  const loadGlobalItems = async () => {
    const items = await db.memoryItems.where('scope').equals('global').toArray();
    setGlobalItems(items.sort((a, b) => b.createdAt - a.createdAt));
  };

  // ── Fetch models dynamically ──
  const loadModels = useCallback(async (providerId, key) => {
    setModelsLoading(true);
    setModelsError('');
    const { models, error } = await fetchModelsForProvider(providerId, key);
    setDynamicModels(models);
    if (error) setModelsError(error);
    // If saved model is not in the new list, auto-select the first one
    if (models.length > 0) {
      setModel(prev => {
        if (!prev || !models.find(m => m.id === prev)) return models[0].id;
        return prev;
      });
    }
    setModelsLoading(false);
  }, []);

  const handleRefreshModels = useCallback(() => {
    clearModelsCache(provider);
    loadModels(provider, apiKey);
  }, [provider, apiKey, loadModels]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaved(false);
    Promise.all([getAISettings(), getGlobalProfile(), getJinaApiKey()]).then(([aiSet, profSet, jinaKey]) => {
      const prov = aiSet.provider || 'openrouter';
      const keys = aiSet.providerKeys || {};
      const key = keys[prov] || aiSet.apiKey || '';
      setProvider(prov);
      setProviderKeys(keys);
      setApiKey(key);
      setModel(aiSet.model || '');

      setProfileRole(profSet.role || '');
      setProfileTone(profSet.tone || '');
      setProfilePrefs(profSet.preferences?.join('\n') || '');

      setJinaApiKey(jinaKey || '');

      setLoading(false);
      // Fetch models for the loaded provider
      loadModels(prov, key);
    });
    loadGlobalItems();
  }, [open, loadModels]);

  // Re-fetch models when provider or apiKey changes (debounced for key input)
  useEffect(() => {
    if (loading || !open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      loadModels(provider, apiKey);
    }, 500);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [provider, apiKey, loading, open, loadModels]);

  const currentProviderMeta = PROVIDER_META.find(p => p.id === provider) || PROVIDER_META[0];

  const handleProviderChange = (id) => {
    // Save current key for active provider before switching
    if (apiKey) setProviderKeys(prev => ({ ...prev, [provider]: apiKey }));
    setProvider(id);
    setModel(''); // will be auto-selected when models load
    // Load key for the new provider
    setApiKey(providerKeys[id] || '');
    setSaved(false);
  };

  const handleApiKeyChange = (val) => {
    setApiKey(val);
    setProviderKeys(prev => ({ ...prev, [provider]: val }));
    setSaved(false);
  };

  const handleSave = async () => {
    const prefsArray = profilePrefs.split('\n').map(p => p.trim()).filter(Boolean);
    const trimmedKey = apiKey.trim();
    const keys = { ...providerKeys, [provider]: trimmedKey };

    await Promise.all([
      saveAISettings({ provider, apiKey: trimmedKey, model: model || dynamicModels[0]?.id || '', providerKeys: keys }),
      saveGlobalProfile({ role: profileRole, tone: profileTone, preferences: prefsArray }),
      saveJinaApiKey(jinaApiKey.trim()),
    ]);

    setSaved(true);
    setTimeout(() => onClose(), 600);
  };

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '440px', backgroundColor: tv('--bg-secondary'),
          border: `1px solid ${tv('--border')}`, borderRadius: '14px',
          boxShadow: `0 20px 60px ${tv('--shadow')}`,
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 20px', borderBottom: `1px solid ${tv('--border')}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={15} color={tv('--accent')} />
            <span style={{ fontSize: '14px', fontWeight: '600', color: tv('--text-primary') }}>Settings</span>
          </div>
          <CloseBtn onClick={onClose} />
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: `1px solid ${tv('--border')}`, padding: '0 20px' }}>
          {[
            { key: 'models', label: 'AI Providers' },
            { key: 'theme', label: 'Theme', icon: <Palette size={12} /> },
            { key: 'profile', label: 'Profile' },
            { key: 'global_memory', label: 'Memory', icon: <Globe size={12} />, badge: globalItems.length || null },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                background: 'none', border: 'none',
                color: activeTab === t.key ? tv('--text-primary') : tv('--text-secondary'),
                padding: '10px 12px', fontSize: '12px', fontWeight: activeTab === t.key ? '600' : '500',
                borderBottom: activeTab === t.key ? `2px solid ${tv('--accent')}` : '2px solid transparent',
                cursor: 'pointer', transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', gap: '5px',
              }}
            >
              {t.icon} {t.label}
              {t.badge && (
                <span style={{ fontSize: '10px', backgroundColor: tv('--bg-tertiary'), color: tv('--text-secondary'), padding: '1px 5px', borderRadius: '8px', fontWeight: '600' }}>
                  {t.badge}
                </span>
              )}
            </button>
          ))}
        </div>

        {loading ? (
          <div style={{ padding: '40px', textAlign: 'center', color: tv('--text-muted'), fontSize: '13px' }}>Loading…</div>
        ) : (
          <div style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '20px', maxHeight: '60vh', overflowY: 'auto' }}>

            {activeTab === 'theme' && (
              <ThemeTab />
            )}

            {activeTab === 'models' && (
              <>
                <FieldGroup label="Provider">
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                    {PROVIDER_META.map(p => (
                      <ToggleChip
                        key={p.id}
                        active={provider === p.id}
                        onClick={() => handleProviderChange(p.id)}
                        label={p.label}
                      />
                    ))}
                  </div>
                  {provider === 'openrouter' && (
                    <p style={{ margin: '6px 0 0', fontSize: '11px', color: tv('--accent'), lineHeight: 1.5 }}>
                      Access 200+ open-source & commercial models via{' '}
                      <a href="https://openrouter.ai" target="_blank" rel="noopener noreferrer"
                        style={{ color: tv('--accent'), textDecoration: 'underline' }}>openrouter.ai</a>
                    </p>
                  )}
                </FieldGroup>

                <FieldGroup label="API Key">
                  <div style={{ position: 'relative' }}>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={e => handleApiKeyChange(e.target.value)}
                      placeholder={currentProviderMeta.placeholder}
                      style={inputStyle}
                    />
                  </div>
                  <p style={{ margin: '6px 0 0', fontSize: '11px', color: tv('--text-muted'), lineHeight: 1.5 }}>
                    Your key is stored locally in IndexedDB. Never sent anywhere except the provider API.
                    {provider === 'openrouter' && (
                      <span style={{ display: 'block', marginTop: '4px', color: tv('--success') }}>
                        Free models work without an API key. Add a key to unlock paid models and higher rate limits.
                      </span>
                    )}
                  </p>
                </FieldGroup>

                <FieldGroup label="Model">
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <div style={{ flex: 1, position: 'relative' }}>
                      {modelsLoading ? (
                        <div style={{
                          ...inputStyle,
                          display: 'flex', alignItems: 'center', gap: '8px',
                          color: tv('--text-muted'),
                        }}>
                          <Loader size={14} style={{ animation: 'spin 1s linear infinite' }} />
                          Loading models...
                        </div>
                      ) : dynamicModels.length > 0 ? (
                        <select
                          value={model}
                          onChange={e => { setModel(e.target.value); setSaved(false); }}
                          style={{ ...inputStyle, cursor: 'pointer', appearance: 'none' }}
                        >
                          {/* Group free models first for OpenRouter */}
                          {provider === 'openrouter' && dynamicModels.some(m => m.free) && (
                            <optgroup label="Free Models">
                              {dynamicModels.filter(m => m.free).map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </optgroup>
                          )}
                          {provider === 'openrouter' && dynamicModels.some(m => !m.free) && (
                            <optgroup label="Paid Models">
                              {dynamicModels.filter(m => !m.free).map(m => (
                                <option key={m.id} value={m.id}>{m.name}</option>
                              ))}
                            </optgroup>
                          )}
                          {/* For non-OpenRouter providers, just list all */}
                          {provider !== 'openrouter' && dynamicModels.map(m => (
                            <option key={m.id} value={m.id}>{m.name}</option>
                          ))}
                        </select>
                      ) : (
                        <div style={{
                          ...inputStyle,
                          display: 'flex', alignItems: 'center', gap: '8px',
                          color: tv('--text-muted'), fontSize: '12px',
                        }}>
                          {modelsError || 'No models available'}
                        </div>
                      )}
                    </div>
                    <button
                      onClick={handleRefreshModels}
                      disabled={modelsLoading}
                      title="Refresh models"
                      style={{
                        padding: '8px', borderRadius: '8px', border: `1px solid ${tv('--border')}`,
                        backgroundColor: tv('--bg-secondary'), color: tv('--text-secondary'),
                        cursor: modelsLoading ? 'not-allowed' : 'pointer',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        opacity: modelsLoading ? 0.5 : 1,
                        transition: 'opacity 0.2s',
                      }}
                    >
                      <RefreshCw size={14} style={modelsLoading ? { animation: 'spin 1s linear infinite' } : {}} />
                    </button>
                  </div>
                  {dynamicModels.length > 0 && (
                    <p style={{ margin: '4px 0 0', fontSize: '10px', color: tv('--text-muted') }}>
                      {dynamicModels.length} model{dynamicModels.length !== 1 ? 's' : ''} available · cached for 1 hr
                    </p>
                  )}
                </FieldGroup>

                {/* ── Web Search ── */}
                <div style={{ paddingTop: '4px', borderTop: `1px solid ${tv('--border')}` }}>
                  <FieldGroup label="Web Search (optional)">
                    <input
                      type="password"
                      value={jinaApiKey}
                      onChange={e => { setJinaApiKey(e.target.value); setSaved(false); }}
                      placeholder="Jina AI API key — jina.ai"
                      style={inputStyle}
                    />
                    <p style={{ margin: '6px 0 0', fontSize: '11px', color: tv('--text-muted'), lineHeight: 1.5 }}>
                      Powers <strong style={{ color: tv('--text-secondary') }}>@web</strong> search in chat.
                      Get a <strong>free</strong> key at{' '}
                      <a href="https://jina.ai" target="_blank" rel="noopener noreferrer"
                        style={{ color: tv('--accent'), textDecoration: 'underline' }}>jina.ai</a>
                      {' '}(1M tokens/month free). URL reading works without a key.
                      {jinaApiKey && (
                        <span style={{ display: 'block', marginTop: '4px', color: tv('--success') }}>
                          ✓ Key saved — @web search is enabled.
                        </span>
                      )}
                    </p>
                  </FieldGroup>
                </div>

                {!apiKey && provider !== 'openrouter' && (                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px',
                    backgroundColor: tv('--warning-soft'), border: '1px solid #f59e0b30',
                  }}>
                    <AlertCircle size={14} color="#f59e0b" style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '12px', color: '#f59e0b', lineHeight: 1.4 }}>
                      Enter an API key to enable AI responses and snapshot extraction.
                    </span>
                  </div>
                )}
                {provider === 'openrouter' && !apiKey && (
                  <div style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '10px 14px', borderRadius: '8px',
                    backgroundColor: `${tv('--success')}10`, border: `1px solid ${tv('--success')}30`,
                  }}>
                    <Check size={14} color={tv('--success')} style={{ flexShrink: 0 }} />
                    <span style={{ fontSize: '12px', color: tv('--success'), lineHeight: 1.4 }}>
                      Free models are ready to use! Add an API key from{' '}
                      <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer"
                        style={{ color: tv('--accent'), textDecoration: 'underline' }}>openrouter.ai/keys</a>
                      {' '}to unlock paid models and higher rate limits.
                    </span>
                  </div>
                )}
              </>
            )}

            {activeTab === 'profile' && (
              <>
                <div style={{ fontSize: '12px', color: tv('--text-secondary'), marginBottom: '-8px', lineHeight: 1.5 }}>
                  These instructions are injected into the context of <strong>every workspace</strong>. Use this for your global preferences.
                </div>

                <FieldGroup label="Your Role">
                  <input
                    type="text"
                    value={profileRole}
                    onChange={e => { setProfileRole(e.target.value); setSaved(false); }}
                    placeholder="e.g. Senior React Developer, Beginner Python Student"
                    style={inputStyle}
                  />
                </FieldGroup>

                <FieldGroup label="Preferred Tone">
                  <input
                    type="text"
                    value={profileTone}
                    onChange={e => { setProfileTone(e.target.value); setSaved(false); }}
                    placeholder="e.g. Direct, no fluff, strictly technical code blocks"
                    style={inputStyle}
                  />
                </FieldGroup>

                <FieldGroup label="Global Instructions (one per line)">
                  <textarea
                    value={profilePrefs}
                    onChange={e => { setProfilePrefs(e.target.value); setSaved(false); }}
                    placeholder="Always use TailwindCSS for styling&#10;Never use var, only let/const"
                    style={{ ...inputStyle, minHeight: '100px', resize: 'vertical', fontFamily: 'inherit' }}
                  />
                </FieldGroup>

                {/* Import/Export */}
                <div style={{ marginTop: '10px', paddingTop: '20px', borderTop: `1px solid ${tv('--border')}` }}>
                  <FieldGroup label="Backup & Restore">
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button onClick={exportAllData} style={secBtnStyle}>
                        <Download size={14} /> Export Backup
                      </button>
                      <button onClick={() => fileInputRef.current?.click()} style={secBtnStyle}>
                        <Upload size={14} /> Import Data
                      </button>
                      <input
                        type="file" accept=".json"
                        ref={fileInputRef} style={{ display: 'none' }}
                        onChange={async (e) => {
                          if (!e.target.files?.[0]) return;
                          if (confirm('Importing will overwrite all existing workspaces. Continue?')) {
                            const res = await importData(e.target.files[0]);
                            if (res.success) window.location.reload();
                            else alert('Import failed: ' + res.error);
                          }
                          e.target.value = '';
                        }}
                      />
                    </div>
                    <p style={{ margin: '6px 0 0', fontSize: '11px', color: tv('--text-muted'), lineHeight: 1.5 }}>
                      Export all workspaces, messages, and state files to a JSON backup.
                    </p>
                  </FieldGroup>
                </div>
              </>
            )}

            {activeTab === 'global_memory' && (
              <GlobalMemorySection
                items={globalItems}
                onRefresh={loadGlobalItems}
              />
            )}

            {activeTab !== 'global_memory' && activeTab !== 'theme' && (
              <div style={{ paddingTop: '8px' }}>
                <button
                  onClick={handleSave}
                  style={{
                    width: '100%', padding: '10px', borderRadius: '8px', border: 'none',
                    fontSize: '13px', fontWeight: '600', cursor: 'pointer',
                    backgroundColor: saved ? '#238636' : tv('--accent'),
                    color: '#fff',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
                    transition: 'background-color 0.2s',
                  }}
                >
                  {saved ? <><Check size={14} /> Saved!</> : <><Bot size={14} /> Save All Settings</>}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ThemeTab() {
  const { themeId, changeTheme, themes } = useTheme();
  return (
    <div>
      <div style={{ fontSize: '12px', color: tv('--text-secondary'), marginBottom: '14px', lineHeight: 1.5 }}>
        Choose a color theme for the entire app. Changes apply instantly.
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
        {Object.values(themes).map(t => {
          const active = t.id === themeId;
          return (
            <button
              key={t.id}
              onClick={() => changeTheme(t.id)}
              style={{
                padding: '14px', borderRadius: '10px',
                border: `2px solid ${active ? tv('--accent') : tv('--border')}`,
                backgroundColor: t.vars['--bg-secondary'],
                cursor: 'pointer', textAlign: 'left',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                boxShadow: active ? `0 0 0 1px ${t.vars['--accent']}40` : 'none',
                position: 'relative', overflow: 'hidden',
              }}
            >
              {active && (
                <div style={{
                  position: 'absolute', top: '8px', right: '8px',
                  width: '18px', height: '18px', borderRadius: '50%',
                  backgroundColor: t.vars['--accent'],
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Check size={10} color="#fff" />
                </div>
              )}
              <div style={{ display: 'flex', gap: '4px', marginBottom: '10px' }}>
                {t.preview.map((c, i) => (
                  <div key={i} style={{
                    width: '20px', height: '20px', borderRadius: '50%',
                    backgroundColor: c, border: `1px solid ${t.vars['--border']}`,
                  }} />
                ))}
              </div>
              <div style={{ fontSize: '13px', fontWeight: '600', color: t.vars['--text-primary'], marginBottom: '2px' }}>
                {t.name}
              </div>
              <div style={{ fontSize: '11px', color: t.vars['--text-secondary'], lineHeight: 1.4 }}>
                {t.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const CATEGORY_COLORS = {
  decision:   { color: '#f59e0b', bg: '#2d1b02' },
  fact:       { color: '#3b82f6', bg: '#0c1929' },
  preference: { color: '#10b981', bg: '#082f1a' },
  rejected:   { color: '#ef4444', bg: '#2a0808' },
  code_style: { color: '#a78bfa', bg: '#1e1b38' },
  snippet:    { color: '#6b7280', bg: '#1a1c20' },
};

function GlobalMemorySection({ items, onRefresh }) {
  const [editingId, setEditingId] = useState(null);
  const [editDraft, setEditDraft] = useState('');

  const handleDemote = async (id) => {
    await demoteToWorkspace(id);
    onRefresh();
  };

  const handleDelete = async (id) => {
    await deleteMemoryItem(id);
    onRefresh();
  };

  const handleSaveEdit = async (id) => {
    if (editDraft.trim()) {
      await updateMemoryItem(id, { content: editDraft.trim() });
      onRefresh();
    }
    setEditingId(null);
  };

  if (!items.length) {
    return (
      <div style={{ textAlign: 'center', padding: '30px 20px' }}>
        <Globe size={24} color={tv('--text-muted')} style={{ margin: '0 auto 12px' }} />
        <p style={{ color: tv('--text-muted'), fontSize: '13px', lineHeight: 1.7 }}>
          No global memory items yet.<br />
          Promote items from any workspace using the <span style={{ color: tv('--purple') }}>globe</span> button.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div style={{ fontSize: '12px', color: tv('--text-secondary'), marginBottom: '12px', lineHeight: 1.5 }}>
        Global memory items are injected into <strong>every workspace's</strong> context. Manage them here.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
        {items.map(item => {
          const cc = CATEGORY_COLORS[item.category] || CATEGORY_COLORS.fact;
          const isEditing = editingId === item.id;

          return (
            <GlobalItemRow
              key={item.id}
              item={item}
              cc={cc}
              isEditing={isEditing}
              editDraft={editDraft}
              onStartEdit={() => { setEditingId(item.id); setEditDraft(item.content); }}
              onCancelEdit={() => setEditingId(null)}
              onSaveEdit={() => handleSaveEdit(item.id)}
              onDraftChange={setEditDraft}
              onDemote={() => handleDemote(item.id)}
              onDelete={() => handleDelete(item.id)}
            />
          );
        })}
      </div>
      <div style={{ marginTop: '10px', fontSize: '10px', color: tv('--text-muted'), textAlign: 'center' }}>
        {items.length} global item{items.length !== 1 ? 's' : ''} across all workspaces
      </div>
    </div>
  );
}

function GlobalItemRow({ item, cc, isEditing, editDraft, onStartEdit, onCancelEdit, onSaveEdit, onDraftChange, onDemote, onDelete }) {
  const [h, setH] = useState(false);

  if (isEditing) {
    return (
      <div style={{ padding: '8px', borderRadius: '6px', border: `1px solid ${tv('--border')}`, backgroundColor: tv('--bg-primary') }}>
        <textarea
          value={editDraft}
          onChange={e => onDraftChange(e.target.value)}
          autoFocus
          style={{ ...inputStyle, minHeight: '50px', resize: 'vertical', fontFamily: 'inherit' }}
          rows={2}
        />
        <div style={{ display: 'flex', gap: '6px', marginTop: '6px', justifyContent: 'flex-end' }}>
          <button onClick={onCancelEdit} style={{ ...secBtnStyle, flex: 'none', padding: '4px 10px', fontSize: '11px' }}>
            <X size={10} /> Cancel
          </button>
          <button onClick={onSaveEdit} style={{ ...secBtnStyle, flex: 'none', padding: '4px 10px', fontSize: '11px', color: '#4ade80', borderColor: '#4ade8040' }}>
            <Check size={10} /> Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        padding: '6px 8px', borderRadius: '6px',
        backgroundColor: h ? tv('--bg-hover') : 'transparent',
        transition: 'background 0.1s',
        display: 'flex', alignItems: 'flex-start', gap: '6px',
      }}
    >
      {item.pinned && <Pin size={10} color={cc.color} style={{ flexShrink: 0, marginTop: '3px' }} />}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: '12.5px', color: tv('--text-primary'), lineHeight: 1.55 }}>
          {item.content}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '2px', flexWrap: 'wrap' }}>
          <span style={{
            fontSize: '9px', fontWeight: '600', padding: '1px 5px', borderRadius: '3px',
            backgroundColor: cc.bg, color: cc.color,
            textTransform: 'uppercase', letterSpacing: '0.04em',
          }}>
            {item.category}
          </span>
          {item.tags?.slice(0, 3).map(t => (
            <span key={t} style={{ fontSize: '10px', color: tv('--text-muted') }}>#{t}</span>
          ))}
        </div>
      </div>
      {h && (
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0, marginLeft: '4px' }}>
          <SmallBtn onClick={onStartEdit} title="Edit" color={tv('--accent')}><Edit3 size={11} /></SmallBtn>
          <SmallBtn onClick={onDemote} title="Demote to workspace" color={tv('--purple')}><Globe size={11} /></SmallBtn>
          <SmallBtn onClick={onDelete} title="Delete" color={tv('--error')}><Trash2 size={11} /></SmallBtn>
        </div>
      )}
    </div>
  );
}

function SmallBtn({ onClick, title, color, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: h ? `${color}22` : 'none', border: 'none',
        color: h ? color : tv('--text-muted'), cursor: 'pointer',
        padding: '3px', borderRadius: '4px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', transition: 'color 0.15s',
      }}
    >
      {children}
    </button>
  );
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '10px 14px', fontSize: '13px',
  backgroundColor: tv('--bg-input'), border: `1px solid ${tv('--border')}`,
  borderRadius: '8px', color: tv('--text-primary'), outline: 'none',
};

const secBtnStyle = {
  flex: 1, padding: '8px', borderRadius: '6px', border: `1px solid ${tv('--border')}`,
  backgroundColor: tv('--bg-secondary'), color: tv('--text-primary'), fontSize: '12px', fontWeight: '500',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
};

function FieldGroup({ label, children }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: tv('--text-secondary'), textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
        {label}
      </label>
      {children}
    </div>
  );
}

function ToggleChip({ active, onClick, label }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        padding: '7px 16px', borderRadius: '8px',
        fontSize: '13px', fontWeight: '500', cursor: 'pointer',
        backgroundColor: active ? tv('--accent-soft') : (h ? tv('--bg-tertiary') : tv('--bg-primary')),
        color: active ? tv('--accent') : tv('--text-secondary'),
        border: `1px solid ${active ? tv('--accent-soft') : tv('--border')}`,
        transition: 'all 0.15s',
      }}
    >
      {label}
    </button>
  );
}

function CloseBtn({ onClick }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: h ? tv('--bg-tertiary') : 'none', border: 'none',
        color: h ? tv('--text-primary') : tv('--text-secondary'), cursor: 'pointer',
        padding: '4px', borderRadius: '6px', display: 'flex',
        alignItems: 'center', justifyContent: 'center',
      }}
    >
      <X size={16} />
    </button>
  );
}
