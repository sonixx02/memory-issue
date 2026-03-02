import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Brain, Lock, XCircle, Pin, Tag, Clock, Search, Plus, Trash2,
  Edit3, Check, X, ChevronDown, ChevronRight, History, Hash,
  Bookmark, Code2, Lightbulb, Settings2, Star, Eye, Download, Upload,
  AlertTriangle, Globe,
} from 'lucide-react';
import db from '../../db/database.js';
import {
  getMemoryItemsForWorkspace, addMemoryItem, updateMemoryItem,
  deleteMemoryItem, getAllTags, suggestTags, detectConflicts,
  promoteToGlobal, demoteToWorkspace, getStalenessInfo,
} from '../../db/memoryHelpers.js';
import { exportMemoryItems, importMemoryItems } from '../../db/exportImport.js';
import { tv } from '../../theme/ThemeContext.jsx';
import { getMemoryBudgetUsage, MEMORY_CHAR_BUDGET } from '../../ai/contextCompiler.js';

// ── Category config ──
const CATEGORIES = {
  decision:   { label: 'Decisions',   icon: Lock,       color: '#f59e0b', bg: '#2d1b02' },
  fact:       { label: 'Facts',       icon: Lightbulb,  color: '#3b82f6', bg: '#0c1929' },
  preference: { label: 'Preferences', icon: Settings2,  color: '#10b981', bg: '#082f1a' },
  rejected:   { label: 'Rejected',    icon: XCircle,    color: '#ef4444', bg: '#2a0808' },
  code_style: { label: 'Code Style',  icon: Code2,      color: '#a78bfa', bg: '#1e1b38' },
  snippet:    { label: 'Snippets',    icon: Bookmark,   color: '#6b7280', bg: '#1a1c20' },
};

const VIEWS = ['category', 'tags', 'timeline', 'search'];

export default function MemoryPanel({ workspaceId }) {
  const [view, setView] = useState('category');
  const [showHistory, setShowHistory] = useState(false);
  const [addingNew, setAddingNew] = useState(false);
  const [conflicts, setConflicts] = useState([]);
  const [budgetUsage, setBudgetUsage] = useState(null);
  const importRef = useRef(null);

  const items = useLiveQuery(
    () => workspaceId ? getMemoryItemsForWorkspace(workspaceId) : [],
    [workspaceId],
    []
  );

  const tagCloud = useLiveQuery(
    () => workspaceId ? getAllTags(workspaceId) : [],
    [workspaceId],
    []
  );

  // Run conflict detection when items change
  useEffect(() => {
    if (!workspaceId || !items.length) { setConflicts([]); return; }
    detectConflicts(workspaceId).then(setConflicts).catch(() => setConflicts([]));
  }, [workspaceId, items]);

  // Calculate memory budget usage when items change
  useEffect(() => {
    if (!workspaceId || !items.length) { setBudgetUsage(null); return; }
    getMemoryBudgetUsage(workspaceId).then(setBudgetUsage).catch(() => setBudgetUsage(null));
  }, [workspaceId, items]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 12px 0', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
          <Brain size={14} color={tv('--purple')} />
          <span style={S.headerLabel}>Memory</span>
          <span style={S.countBadge}>{items.length}</span>
          <div style={{ flex: 1 }} />
          {workspaceId && (
            <>
              <HoverBtn onClick={() => exportMemoryItems(workspaceId)} title="Export memory">
                <Download size={13} />
              </HoverBtn>
              <HoverBtn onClick={() => importRef.current?.click()} title="Import memory">
                <Upload size={13} />
              </HoverBtn>
              <input
                ref={importRef}
                type="file"
                accept=".json"
                style={{ display: 'none' }}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    const result = await importMemoryItems(file, { targetWorkspaceId: workspaceId });
                    if (!result.success) alert('Import failed: ' + result.error);
                    e.target.value = '';
                  }
                }}
              />
              <HoverBtn onClick={() => setShowHistory(v => !v)} title="Snapshot history">
                <History size={13} />
              </HoverBtn>
              <HoverBtn onClick={() => setAddingNew(true)} title="Add memory item">
                <Plus size={13} />
              </HoverBtn>
            </>
          )}
        </div>

        {/* View tabs */}
        {workspaceId && !showHistory && (
          <div style={S.tabRow}>
            {VIEWS.map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={S.tab(view === v)}
              >
                {v === 'category' && <Lock size={11} />}
                {v === 'tags' && <Tag size={11} />}
                {v === 'timeline' && <Clock size={11} />}
                {v === 'search' && <Search size={11} />}
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div style={{ borderBottom: `1px solid ${tv('--border')}` }} />

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
        {!workspaceId ? (
          <EmptyState />
        ) : showHistory ? (
          <SnapshotHistory workspaceId={workspaceId} onClose={() => setShowHistory(false)} />
        ) : (
          <>
            {addingNew && (
              <AddMemoryForm
                workspaceId={workspaceId}
                onDone={() => setAddingNew(false)}
              />
            )}
            {conflicts.length > 0 && <ConflictBanner conflicts={conflicts} />}
            {budgetUsage && <MemoryBudgetBar usage={budgetUsage} />}
            {view === 'category' && <CategoryView items={items} workspaceId={workspaceId} budgetUsage={budgetUsage} />}
            {view === 'tags' && <TagsView items={items} tagCloud={tagCloud} workspaceId={workspaceId} />}
            {view === 'timeline' && <TimelineView items={items} workspaceId={workspaceId} />}
            {view === 'search' && <SearchView items={items} workspaceId={workspaceId} />}
          </>
        )}
      </div>
    </div>
  );
}

// ── Conflict Banner ──

function ConflictBanner({ conflicts }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      borderRadius: '8px', border: '1px solid #f5a62340',
      backgroundColor: tv('--warning-soft'), marginBottom: '10px', overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '7px 10px', cursor: 'pointer',
        }}
      >
        <AlertTriangle size={12} color="#f59e0b" />
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#f59e0b', flex: 1 }}>
          {conflicts.length} Conflict{conflicts.length !== 1 ? 's' : ''} Detected
        </span>
        <span style={{ color: tv('--text-muted'), display: 'flex' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>
      {expanded && (
        <div style={{ padding: '6px 10px 10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {conflicts.map((c, i) => {
            const cfgA = CATEGORIES[c.itemA.category] || CATEGORIES.fact;
            return (
              <div key={i} style={{
                borderRadius: '6px', border: `1px solid ${tv('--border')}`,
                backgroundColor: tv('--bg-primary'), overflow: 'hidden',
              }}>
                <div style={{ padding: '6px 8px', borderBottom: `1px solid ${tv('--border')}`, background: tv('--bg-secondary') }}>
                  <span style={{ fontSize: '10px', color: '#f59e0b', fontWeight: '600' }}>{c.reason}</span>
                </div>
                <div style={{ display: 'flex', gap: '1px' }}>
                  <div style={{ flex: 1, padding: '6px 8px', borderRight: `1px solid ${tv('--border')}` }}>
                    <div style={{ fontSize: '9px', color: cfgA.color, fontWeight: '700', marginBottom: '2px', textTransform: 'uppercase' }}>Item A</div>
                    <div style={{ fontSize: '11.5px', color: tv('--text-primary'), lineHeight: 1.5 }}>{c.itemA.content}</div>
                    <div style={{ marginTop: '3px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {c.sharedTags?.map(t => <span key={t} style={{ fontSize: '9px', color: '#f59e0b', fontWeight: '500' }}>#{t}</span>)}
                    </div>
                  </div>
                  <div style={{ flex: 1, padding: '6px 8px' }}>
                    <div style={{ fontSize: '9px', color: cfgA.color, fontWeight: '700', marginBottom: '2px', textTransform: 'uppercase' }}>Item B</div>
                    <div style={{ fontSize: '11.5px', color: tv('--text-primary'), lineHeight: 1.5 }}>{c.itemB.content}</div>
                    <div style={{ marginTop: '3px', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                      {c.sharedTags?.map(t => <span key={t} style={{ fontSize: '9px', color: '#f59e0b', fontWeight: '500' }}>#{t}</span>)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <p style={{ fontSize: '10px', color: tv('--text-muted'), margin: 0 }}>
            Resolve by editing or deleting one of the conflicting items.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Memory Budget Bar ──

function MemoryBudgetBar({ usage }) {
  const { totalChars, budgetLimit, droppedIds, categoryBreakdown } = usage;
  const pct = Math.min((totalChars / budgetLimit) * 100, 100);
  const droppedCount = droppedIds.size;

  // Color based on usage level
  let barColor = '#10b981'; // green
  let statusColor = '#10b981';
  let statusLabel = 'Healthy';
  if (pct >= 90) {
    barColor = '#ef4444'; statusColor = '#ef4444'; statusLabel = 'Full';
  } else if (pct >= 70) {
    barColor = '#f59e0b'; statusColor = '#f59e0b'; statusLabel = 'Filling Up';
  }

  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{
      borderRadius: '8px', border: `1px solid ${tv('--border')}`,
      backgroundColor: tv('--bg-primary'), marginBottom: '10px', overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: '8px',
          padding: '8px 10px', cursor: 'pointer',
        }}
      >
        <Brain size={12} color={statusColor} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: '10px', fontWeight: '700', color: statusColor, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Context Budget — {statusLabel}
            </span>
            <span style={{ fontSize: '10px', color: tv('--text-muted'), fontWeight: '500' }}>
              {Math.round(pct)}% · {(totalChars / 1000).toFixed(1)}k / {(budgetLimit / 1000).toFixed(1)}k chars
            </span>
          </div>
          {/* Progress bar */}
          <div style={{
            height: '4px', borderRadius: '2px',
            backgroundColor: `${barColor}20`, overflow: 'hidden',
          }}>
            <div style={{
              height: '100%', width: `${pct}%`, borderRadius: '2px',
              backgroundColor: barColor, transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
        <span style={{ color: tv('--text-muted'), display: 'flex' }}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </div>

      {expanded && (
        <div style={{ padding: '4px 10px 10px', borderTop: `1px solid ${tv('--border')}` }}>
          {/* Category breakdown */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: droppedCount > 0 ? '8px' : 0 }}>
            {Object.entries(categoryBreakdown).map(([cat, info]) => {
              const cfg = CATEGORIES[cat] || CATEGORIES.fact;
              const catPct = ((info.used / budgetLimit) * 100).toFixed(1);
              return (
                <div key={cat} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ fontSize: '10px', color: cfg.color, fontWeight: '600', width: '70px', textTransform: 'uppercase' }}>
                    {cfg.label}
                  </span>
                  <div style={{
                    flex: 1, height: '3px', borderRadius: '2px',
                    backgroundColor: `${cfg.color}18`, overflow: 'hidden',
                  }}>
                    <div style={{
                      height: '100%', width: `${catPct}%`, borderRadius: '2px',
                      backgroundColor: `${cfg.color}80`,
                    }} />
                  </div>
                  <span style={{ fontSize: '9px', color: tv('--text-muted'), fontWeight: '500', minWidth: '36px', textAlign: 'right' }}>
                    {info.items} item{info.items !== 1 ? 's' : ''}
                  </span>
                </div>
              );
            })}
          </div>

          {/* Dropped items warning */}
          {droppedCount > 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '6px',
              padding: '6px 8px', borderRadius: '6px',
              backgroundColor: '#ef444415', border: '1px solid #ef444430',
            }}>
              <AlertTriangle size={11} color="#ef4444" />
              <span style={{ fontSize: '10px', color: '#ef4444', fontWeight: '600' }}>
                {droppedCount} pinned item{droppedCount !== 1 ? 's' : ''} won't fit — AI won't see {droppedCount === 1 ? 'it' : 'them'}.
              </span>
            </div>
          )}

          {droppedCount > 0 && (
            <p style={{ fontSize: '10px', color: tv('--text-muted'), margin: '6px 0 0', lineHeight: 1.5 }}>
              Unpin or delete low-priority items to free up space. Decisions & Rejected items are injected first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Category View ──

function CategoryView({ items, workspaceId, budgetUsage }) {
  const [collapsed, setCollapsed] = useState({});

  const grouped = useMemo(() => {
    const groups = {};
    for (const cat of Object.keys(CATEGORIES)) {
      groups[cat] = items.filter(i => i.category === cat);
    }
    return groups;
  }, [items]);

  if (!items.length) {
    return <EmptyMemory />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      {Object.entries(CATEGORIES).map(([cat, cfg]) => {
        const catItems = grouped[cat] || [];
        if (!catItems.length) return null;
        const isCollapsed = !!collapsed[cat];
        const Icon = cfg.icon;

        return (
          <div key={cat} style={S.section}>
            <div
              onClick={() => setCollapsed(p => ({ ...p, [cat]: !p[cat] }))}
              style={S.sectionHeader}
            >
              <span style={{ color: tv('--text-muted'), display: 'flex' }}>
                {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              </span>
              <Icon size={12} color={cfg.color} />
              <span style={{ ...S.sectionLabel, color: cfg.color }}>{cfg.label}</span>
              <span style={S.sectionCount}>{catItems.length}</span>
            </div>
            {!isCollapsed && (
              <div style={S.sectionBody}>
                {catItems.map(item => (
                  <MemoryItemRow key={item.id} item={item} isDropped={budgetUsage?.droppedIds?.has(item.id)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Tags View ──

function TagsView({ items, tagCloud }) {
  const [selectedTag, setSelectedTag] = useState(null);

  const filteredItems = useMemo(() => {
    if (!selectedTag) return [];
    return items.filter(i => i.tags?.includes(selectedTag));
  }, [items, selectedTag]);

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '12px' }}>
        {tagCloud.length === 0 ? (
          <p style={S.muted}>No tags yet. Tags are auto-generated or added manually.</p>
        ) : (
          tagCloud.map(({ tag, count }) => (
            <button
              key={tag}
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              style={S.tagChip(selectedTag === tag)}
            >
              <Hash size={10} /> {tag} <span style={{ opacity: 0.6 }}>{count}</span>
            </button>
          ))
        )}
      </div>

      {selectedTag && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <div style={{ fontSize: '11px', color: tv('--text-secondary'), marginBottom: '6px' }}>
            {filteredItems.length} item{filteredItems.length !== 1 ? 's' : ''} tagged "{selectedTag}"
          </div>
          {filteredItems.map(item => (
            <MemoryItemRow key={item.id} item={item} showCategory />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Timeline View ──

function TimelineView({ items }) {
  const sorted = useMemo(() =>
    [...items].sort((a, b) => b.createdAt - a.createdAt),
    [items]
  );

  if (!sorted.length) return <EmptyMemory />;

  let lastDate = '';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
      {sorted.map(item => {
        const dateStr = new Date(item.createdAt).toLocaleDateString();
        const showDate = dateStr !== lastDate;
        lastDate = dateStr;
        return (
          <div key={item.id}>
            {showDate && (
              <div style={{ fontSize: '10px', color: tv('--text-muted'), padding: '8px 0 4px', fontWeight: '600' }}>
                {dateStr}
              </div>
            )}
            <MemoryItemRow item={item} showCategory showTime />
          </div>
        );
      })}
    </div>
  );
}

// ── Search View ──

function SearchView({ items }) {
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    if (!query.trim()) return items;
    const q = query.toLowerCase();
    return items.filter(i =>
      i.content.toLowerCase().includes(q) ||
      i.tags?.some(t => t.includes(q)) ||
      i.category.includes(q)
    );
  }, [items, query]);

  return (
    <div>
      <div style={{ marginBottom: '10px' }}>
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Filter memory items..."
          style={S.searchInput}
        />
      </div>
      <div style={{ fontSize: '11px', color: tv('--text-muted'), marginBottom: '6px' }}>
        {filtered.length} of {items.length} items
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
        {filtered.map(item => (
          <MemoryItemRow key={item.id} item={item} showCategory />
        ))}
      </div>
    </div>
  );
}

// ── Memory Item Row ──

function MemoryItemRow({ item, showCategory, showTime, isDropped }) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.content);
  const [tagDraft, setTagDraft] = useState((item.tags || []).join(', '));
  const cfg = CATEGORIES[item.category] || CATEGORIES.fact;
  const staleness = useMemo(() => getStalenessInfo(item), [item]);

  const handleSave = async () => {
    const updates = {};
    if (draft.trim() && draft.trim() !== item.content) {
      updates.content = draft.trim();
    }
    const newTags = tagDraft.split(',').map(t => t.trim().toLowerCase().replace(/^#/, '')).filter(Boolean);
    const oldTags = (item.tags || []).join(',');
    if (newTags.join(',') !== oldTags) {
      updates.tags = newTags;
    }
    if (Object.keys(updates).length > 0) {
      await updateMemoryItem(item.id, updates);
    }
    setEditing(false);
  };

  const handleDelete = async () => {
    await deleteMemoryItem(item.id);
  };

  const handleTogglePin = async () => {
    await updateMemoryItem(item.id, { pinned: !item.pinned });
  };

  const handleToggleScope = async () => {
    if (item.scope === 'global') {
      await demoteToWorkspace(item.id);
    } else {
      await promoteToGlobal(item.id);
    }
  };

  if (editing) {
    return (
      <div style={S.itemRow(true)}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          autoFocus
          style={S.editTextarea}
          rows={2}
        />
        <input
          value={tagDraft}
          onChange={e => setTagDraft(e.target.value)}
          placeholder="Tags (comma-separated)"
          style={{ ...S.editTextarea, minHeight: 'auto', padding: '5px 8px', fontSize: '11px', marginTop: '4px' }}
        />
        <div style={{ display: 'flex', gap: '4px', marginTop: '4px', justifyContent: 'flex-end' }}>
          <MiniAction onClick={() => { setDraft(item.content); setTagDraft((item.tags || []).join(', ')); setEditing(false); }} color={tv('--text-secondary')}><X size={10} /></MiniAction>
          <MiniAction onClick={handleSave} color={tv('--success')}><Check size={10} /></MiniAction>
        </div>
      </div>
    );
  }

  return (
    <div
      style={S.itemRow(hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
        {item.pinned && <Pin size={10} color={isDropped ? tv('--text-muted') : cfg.color} style={{ flexShrink: 0, marginTop: '3px' }} />}
        <div style={{ flex: 1, minWidth: 0, opacity: isDropped ? 0.45 : 1 }}>
          <div style={{
            fontSize: '12.5px', color: tv('--text-primary'), lineHeight: 1.55,
            textDecoration: item.category === 'rejected' ? 'line-through' : 'none',
            opacity: item.category === 'rejected' ? 0.75 : 1,
          }}>
            {item.content}
          </div>

          {/* Meta line: category badge + tags + time */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '3px', flexWrap: 'wrap' }}>
            {isDropped && item.pinned && (
              <span style={{
                fontSize: '9px', fontWeight: '600', color: '#ef4444',
                padding: '1px 5px', borderRadius: '3px',
                backgroundColor: '#ef444415', border: '1px solid #ef444430',
              }}>
                OVER BUDGET
              </span>
            )}
            {staleness.isStale && (
              <span style={{
                fontSize: '9px', fontWeight: '600', color: '#f59e0b',
                padding: '1px 5px', borderRadius: '3px',
                backgroundColor: '#f59e0b15', border: '1px solid #f59e0b30',
              }} title={staleness.reason}>
                STALE
              </span>
            )}
            {showCategory && (
              <span style={S.catBadge(cfg.color, cfg.bg)}>
                {cfg.label}
              </span>
            )}
            {item.tags?.slice(0, 3).map(t => (
              <span key={t} style={S.tagSmall}>#{t}</span>
            ))}
            {item.tags?.length > 3 && (
              <span style={S.tagSmall}>+{item.tags.length - 3}</span>
            )}
            {showTime && (
              <span style={{ fontSize: '10px', color: tv('--text-muted') }}>
                {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            {item.scope === 'global' && (
              <span style={{ fontSize: '9px', color: tv('--purple'), fontWeight: '600' }}>GLOBAL</span>
            )}
            {item.timesUsed > 0 && (
              <span style={{ fontSize: '10px', color: tv('--text-muted'), display: 'flex', alignItems: 'center', gap: '2px' }}>
                <Eye size={9} /> {item.timesUsed}
              </span>
            )}
          </div>
        </div>

        {/* Actions on hover */}
        {hovered && (
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0, marginLeft: '4px' }}>
            <MiniBtn onClick={handleToggleScope} title={item.scope === 'global' ? 'Make workspace-only' : 'Make global'} color={item.scope === 'global' ? tv('--purple') : tv('--text-muted')}>
              <Globe size={11} />
            </MiniBtn>
            <MiniBtn onClick={handleTogglePin} title={item.pinned ? 'Unpin' : 'Pin'} color={item.pinned ? '#f59e0b' : tv('--text-muted')}>
              <Pin size={11} />
            </MiniBtn>
            <MiniBtn onClick={() => { setDraft(item.content); setTagDraft((item.tags || []).join(', ')); setEditing(true); }} title="Edit" color={tv('--accent')}>
              <Edit3 size={11} />
            </MiniBtn>
            <MiniBtn onClick={handleDelete} title="Delete" color={tv('--error')}>
              <Trash2 size={11} />
            </MiniBtn>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add Memory Form ──

function AddMemoryForm({ workspaceId, onDone }) {
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('fact');
  const [tagInput, setTagInput] = useState('');
  const [scope, setScope] = useState('workspace');

  const handleSubmit = async () => {
    if (!content.trim()) return;
    const tags = tagInput.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
    const finalTags = tags.length ? tags : suggestTags(content, '');
    await addMemoryItem({
      workspaceId,
      content: content.trim(),
      category,
      tags: finalTags,
      source: 'manual',
      scope,
    });
    onDone();
  };

  return (
    <div style={{ ...S.section, marginBottom: '12px' }}>
      <div style={{ ...S.sectionHeader, borderBottom: `1px solid ${tv('--border')}` }}>
        <Plus size={12} color={tv('--accent')} />
        <span style={{ ...S.sectionLabel, color: tv('--accent') }}>New Memory Item</span>
      </div>
      <div style={{ padding: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <textarea
          value={content}
          onChange={e => setContent(e.target.value)}
          placeholder="What should I remember?"
          autoFocus
          style={S.editTextarea}
          rows={2}
        />
        <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {Object.entries(CATEGORIES).filter(([k]) => k !== 'snippet').map(([key, cfg]) => (
            <button
              key={key}
              onClick={() => setCategory(key)}
              style={S.catSelect(category === key, cfg.color, cfg.bg)}
            >
              {cfg.label}
            </button>
          ))}
        </div>
        <input
          value={tagInput}
          onChange={e => setTagInput(e.target.value)}
          placeholder="Tags (comma-separated, or auto-generated)"
          style={S.smallInput}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <label style={{ fontSize: '11px', color: tv('--text-secondary'), display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
            <input type="checkbox" checked={scope === 'global'} onChange={e => setScope(e.target.checked ? 'global' : 'workspace')} />
            Also save globally
          </label>
          <div style={{ flex: 1 }} />
          <MiniAction onClick={onDone} color={tv('--text-secondary')}><X size={10} /> Cancel</MiniAction>
          <MiniAction onClick={handleSubmit} color={tv('--success')}><Check size={10} /> Save</MiniAction>
        </div>
      </div>
    </div>
  );
}

// ── Snapshot History ──

function SnapshotHistory({ workspaceId, onClose }) {
  const snapshots = useLiveQuery(
    () => db.snapshots.where('workspaceId').equals(workspaceId).reverse().sortBy('timestamp'),
    [workspaceId],
    []
  );

  const [expanded, setExpanded] = useState({});

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: '600', color: tv('--text-secondary') }}>Snapshot History</span>
        <MiniAction onClick={onClose} color={tv('--text-secondary')}><X size={12} /> Close</MiniAction>
      </div>

      {!snapshots?.length ? (
        <p style={{ color: tv('--text-muted'), fontSize: '12px', textAlign: 'center', paddingTop: '20px' }}>
          No snapshots committed yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {snapshots.map((snap) => {
            const isExpanded = !!expanded[snap.id];
            const date = new Date(snap.timestamp);
            const isNew = !!snap.memoryItemIds;
            return (
              <div key={snap.id} style={S.section}>
                <div
                  onClick={() => setExpanded(p => ({ ...p, [snap.id]: !p[snap.id] }))}
                  style={{ ...S.sectionHeader, cursor: 'pointer' }}
                >
                  {isExpanded ? <ChevronDown size={12} color={tv('--text-muted')} /> : <ChevronRight size={12} color={tv('--text-muted')} />}
                  <span style={{ fontSize: '12px', color: tv('--text-primary'), flex: 1 }}>
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ fontSize: '10px', color: tv('--text-muted') }}>
                    {isNew ? `${snap.itemCount || 0} items` : `${snap.messageCount} msgs`}
                  </span>
                </div>
                {isExpanded && (
                  <div style={{ padding: '8px 10px', fontSize: '12px', color: tv('--text-secondary') }}>
                    {isNew ? (
                      <div>
                        <div>Created {snap.itemCount || 0} memory items</div>
                        {snap.skippedCount > 0 && <div>Skipped {snap.skippedCount} duplicates</div>}
                        <div style={{ color: tv('--text-muted'), marginTop: '4px' }}>From {snap.messageCount} messages</div>
                      </div>
                    ) : (
                      /* Legacy snapshot */
                      <div>
                        {snap.stateFile?.project_goal && <div><strong>Goal:</strong> {snap.stateFile.project_goal}</div>}
                        {snap.stateFile?.locked_decisions?.length > 0 && (
                          <div><strong>Decisions:</strong> {snap.stateFile.locked_decisions.join(', ')}</div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Empty states ──

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '60px', textAlign: 'center' }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '14px',
        background: `linear-gradient(135deg, ${tv('--bg-secondary')}, ${tv('--bg-tertiary')})`,
        border: `1px solid ${tv('--border')}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '16px',
      }}>
        <Brain size={22} color={tv('--text-muted')} />
      </div>
      <p style={{ color: tv('--text-muted'), fontSize: '13px', lineHeight: 1.7, maxWidth: '200px' }}>
        Select a workspace to see its memory here.
      </p>
    </div>
  );
}

function EmptyMemory() {
  return (
    <div style={{ textAlign: 'center', paddingTop: '40px' }}>
      <Brain size={24} color={tv('--text-muted')} style={{ margin: '0 auto 12px' }} />
      <p style={{ color: tv('--text-muted'), fontSize: '13px', lineHeight: 1.7 }}>
        No memory items yet.<br />
        Use <strong style={{ color: tv('--purple') }}>Commit Snapshot</strong> or the <strong style={{ color: tv('--accent') }}>+</strong> button to add items.
      </p>
    </div>
  );
}

// ── Shared small components ──

function HoverBtn({ onClick, title, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: h ? tv('--bg-tertiary') : 'none', border: 'none',
        color: h ? tv('--text-primary') : tv('--text-muted'), cursor: 'pointer',
        padding: '3px', borderRadius: '4px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function MiniBtn({ onClick, title, color, children }) {
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

function MiniAction({ onClick, color, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        background: h ? `${color}22` : 'none', border: `1px solid ${color}40`,
        color, cursor: 'pointer', padding: '3px 8px', borderRadius: '5px',
        fontSize: '11px', fontWeight: '500', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}

// ── Styles ──

const S = {
  headerLabel: {
    fontSize: '11px', fontWeight: '700', color: tv('--text-secondary'),
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
  countBadge: {
    fontSize: '10px', fontWeight: '600', color: tv('--text-secondary'),
    backgroundColor: tv('--bg-tertiary'), padding: '1px 6px', borderRadius: '10px',
  },
  tabRow: {
    display: 'flex', gap: '2px', marginBottom: '0',
  },
  tab: (active) => ({
    display: 'flex', alignItems: 'center', gap: '4px',
    fontSize: '11px', fontWeight: active ? '600' : '400',
    color: active ? tv('--text-primary') : tv('--text-muted'),
    background: active ? tv('--bg-tertiary') : 'none',
    border: 'none', borderRadius: '6px 6px 0 0',
    padding: '5px 10px', cursor: 'pointer',
    transition: 'all 0.15s',
  }),
  section: {
    borderRadius: '8px', border: `1px solid ${tv('--border')}`,
    backgroundColor: tv('--bg-primary'), overflow: 'hidden',
  },
  sectionHeader: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '7px 10px', backgroundColor: tv('--bg-secondary'),
    cursor: 'pointer',
  },
  sectionLabel: {
    fontSize: '11px', fontWeight: '700', textTransform: 'uppercase',
    letterSpacing: '0.06em', flex: 1,
  },
  sectionCount: {
    fontSize: '10px', color: tv('--text-muted'), fontWeight: '600',
  },
  sectionBody: {
    padding: '4px',
  },
  itemRow: (hovered) => ({
    padding: '6px 8px', borderRadius: '6px',
    backgroundColor: hovered ? tv('--bg-hover') : 'transparent',
    transition: 'background 0.1s',
  }),
  catBadge: (color, bg) => ({
    fontSize: '9px', fontWeight: '600', padding: '1px 5px',
    borderRadius: '3px', backgroundColor: bg, color,
    textTransform: 'uppercase', letterSpacing: '0.04em',
  }),
  tagSmall: {
    fontSize: '10px', color: tv('--text-muted'),
  },
  tagChip: (active) => ({
    display: 'flex', alignItems: 'center', gap: '3px',
    fontSize: '11px', padding: '3px 8px', borderRadius: '12px',
    border: `1px solid ${active ? tv('--accent') : tv('--border')}`,
    backgroundColor: active ? tv('--accent-soft') : tv('--bg-primary'),
    color: active ? tv('--accent') : tv('--text-secondary'),
    cursor: 'pointer', fontWeight: active ? '600' : '400',
    transition: 'all 0.15s',
  }),
  searchInput: {
    width: '100%', boxSizing: 'border-box',
    background: tv('--bg-input'), border: `1px solid ${tv('--border')}`,
    borderRadius: '6px', padding: '7px 10px',
    color: tv('--text-primary'), fontSize: '12px', outline: 'none',
    fontFamily: 'inherit',
  },
  editTextarea: {
    width: '100%', boxSizing: 'border-box',
    background: tv('--bg-input'), border: `1px solid ${tv('--border')}`,
    borderRadius: '6px', padding: '8px 10px',
    color: tv('--text-primary'), fontSize: '12.5px', lineHeight: 1.5,
    resize: 'vertical', minHeight: '50px', outline: 'none',
    fontFamily: 'inherit',
  },
  smallInput: {
    width: '100%', boxSizing: 'border-box',
    background: tv('--bg-input'), border: `1px solid ${tv('--border')}`,
    borderRadius: '6px', padding: '6px 10px',
    color: tv('--text-primary'), fontSize: '11px', outline: 'none',
    fontFamily: 'inherit',
  },
  catSelect: (active, color, bg) => ({
    fontSize: '10px', padding: '2px 8px', borderRadius: '4px',
    border: `1px solid ${active ? color : tv('--border')}`,
    backgroundColor: active ? bg : 'transparent',
    color: active ? color : tv('--text-muted'),
    cursor: 'pointer', fontWeight: active ? '600' : '400',
    transition: 'all 0.15s',
  }),
  muted: {
    fontSize: '12px', color: tv('--text-muted'), fontStyle: 'italic',
  },
};
