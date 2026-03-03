import { useState, useEffect, useRef } from 'react';
import { X, Key, Bot, Check, AlertCircle, Download, Upload, Globe, Trash2, Pin, Edit3, Palette } from 'lucide-react';
import { getAISettings, saveAISettings, getGlobalProfile, saveGlobalProfile } from '../../db/settingsHelpers.js';
import { exportAllData, importData } from '../../db/exportImport.js';
import db from '../../db/database.js';
import { deleteMemoryItem, updateMemoryItem, demoteToWorkspace } from '../../db/memoryHelpers.js';
import { useTheme, tv, THEMES } from '../../theme/ThemeContext.jsx';

const PROVIDERS = [
  {
    id: 'openrouter', label: 'OpenRouter', placeholder: 'sk-or-v1-...', defaultModel: 'meta-llama/llama-4-maverick:free',
    models: [
      { id: 'meta-llama/llama-4-maverick:free', name: 'Llama 4 Maverick', free: true },
      { id: 'meta-llama/llama-4-scout:free', name: 'Llama 4 Scout', free: true },
      { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B', free: true },
      { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1', free: true },
      { id: 'deepseek/deepseek-chat-v3-0324:free', name: 'DeepSeek V3', free: true },
      { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B', free: true },
      { id: 'qwen/qwen-2.5-coder-32b-instruct:free', name: 'Qwen Coder 32B', free: true },
      { id: 'google/gemma-3-27b-it:free', name: 'Gemma 3 27B', free: true },
      { id: 'microsoft/phi-4:free', name: 'Phi-4', free: true },
      { id: 'mistralai/mistral-small-3.1-24b-instruct:free', name: 'Mistral Small 3.1', free: true },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', name: 'Nemotron 70B', free: true },
      { id: 'nousresearch/deephermes-3-llama-3-8b:free', name: 'DeepHermes 3 8B', free: true },
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick (Paid)', free: false },
      { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout (Paid)', free: false },
      { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 (Paid)', free: false },
      { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek V3 (Paid)', free: false },
      { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', free: false },
      { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B', free: false },
      { id: 'qwen/qwen-2.5-72b-instruct', name: 'Qwen 2.5 72B (Paid)', free: false },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', placeholder: 'sk-...', defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'o3-mini', name: 'O3 Mini' },
    ],
  },
  {
    id: 'anthropic', label: 'Anthropic', placeholder: 'sk-ant-...', defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    ],
  },
  {
    id: 'gemini', label: 'Gemini', placeholder: 'AIza...', defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Lite' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    ],
  },
  {
    id: 'groq', label: 'Groq', placeholder: 'gsk_...', defaultModel: 'llama-3.3-70b-versatile',
    models: [
      { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B Versatile' },
      { id: 'llama-3.1-8b-instant', name: 'Llama 3.1 8B Instant' },
      { id: 'llama3-70b-8192', name: 'Llama 3 70B' },
      { id: 'llama3-8b-8192', name: 'Llama 3 8B' },
      { id: 'meta-llama/llama-4-scout-17b-16e-instruct', name: 'Llama 4 Scout 17B' },
      { id: 'meta-llama/llama-4-maverick-17b-128e-instruct', name: 'Llama 4 Maverick 17B' },
      { id: 'mixtral-8x7b-32768', name: 'Mixtral 8x7B' },
      { id: 'gemma2-9b-it', name: 'Gemma 2 9B' },
      { id: 'qwen/qwen3-32b', name: 'Qwen 3 32B' },
      { id: 'deepseek-r1-distill-llama-70b', name: 'DeepSeek R1 Distill 70B' },
      { id: 'mistral-saba-24b', name: 'Mistral Saba 24B' },
      { id: 'compound-beta', name: 'Compound Beta (Agentic)' },
      { id: 'compound-beta-mini', name: 'Compound Beta Mini' },
      { id: 'openai/gpt-oss-20b', name: 'GPT-OSS 20B' },
      { id: 'openai/gpt-oss-120b', name: 'GPT-OSS 120B' },
    ],
  },
];

export default function SettingsModal({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('models');
  // AI Settings
  const [provider, setProvider] = useState('openrouter');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [providerKeys, setProviderKeys] = useState({});
  // Profile Settings
  const [profileRole, setProfileRole] = useState('');
  const [profileTone, setProfileTone] = useState('');
  const [profilePrefs, setProfilePrefs] = useState('');

  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalItems, setGlobalItems] = useState([]);
  const fileInputRef = useRef(null);

  const loadGlobalItems = async () => {
    const items = await db.memoryItems.where('scope').equals('global').toArray();
    setGlobalItems(items.sort((a, b) => b.createdAt - a.createdAt));
  };

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setSaved(false);
    Promise.all([getAISettings(), getGlobalProfile()]).then(([aiSet, profSet]) => {
      setProvider(aiSet.provider || 'openrouter');
      setProviderKeys(aiSet.providerKeys || {});
      setApiKey(aiSet.providerKeys?.[aiSet.provider] || aiSet.apiKey || '');
      setModel(aiSet.model || '');
      
      setProfileRole(profSet.role || '');
      setProfileTone(profSet.tone || '');
      setProfilePrefs(profSet.preferences?.join('\n') || '');
      
      setLoading(false);
    });
    loadGlobalItems();
  }, [open]);

  const currentProvider = PROVIDERS.find(p => p.id === provider) || PROVIDERS[0];

  const handleProviderChange = (id) => {
    // Save current key for active provider before switching
    if (apiKey) setProviderKeys(prev => ({ ...prev, [provider]: apiKey }));
    setProvider(id);
    const p = PROVIDERS.find(x => x.id === id);
    setModel(p?.defaultModel || '');
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
    const keys = { ...providerKeys, [provider]: apiKey };
    
    await Promise.all([
      saveAISettings({ provider, apiKey, model: model || currentProvider.defaultModel, providerKeys: keys }),
      saveGlobalProfile({ role: profileRole, tone: profileTone, preferences: prefsArray })
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
                    {PROVIDERS.map(p => (
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
                      placeholder={currentProvider.placeholder}
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
                  <select
                    value={model || currentProvider.defaultModel}
                    onChange={e => { setModel(e.target.value); setSaved(false); }}
                    style={{ ...inputStyle, cursor: 'pointer', appearance: 'none' }}
                  >
                    {currentProvider.models.map(m => (
                      <option key={m.id} value={m.id}>{m.name}{m.free ? ' ★ Free' : ''}</option>
                    ))}
                  </select>
                </FieldGroup>

                {!apiKey && provider !== 'openrouter' && (
                  <div style={{
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
