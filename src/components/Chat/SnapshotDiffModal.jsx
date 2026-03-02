import { useState, useMemo } from 'react';
import {
  X, Check, Trash2, Lock, Lightbulb, Settings2, XCircle, Code2, Bookmark,
  ChevronDown, ChevronRight, Plus, Minus, ArrowRight, Eye,
} from 'lucide-react';

// ── Category config (shared with MemoryPanel) ──
const CATEGORIES = {
  decision:   { label: 'Decisions',   icon: Lock,      color: '#f59e0b', bg: '#2d1b02' },
  fact:       { label: 'Facts',       icon: Lightbulb, color: '#3b82f6', bg: '#0c1929' },
  preference: { label: 'Preferences', icon: Settings2, color: '#10b981', bg: '#082f1a' },
  rejected:   { label: 'Rejected',    icon: XCircle,   color: '#ef4444', bg: '#2a0808' },
  code_style: { label: 'Code Style',  icon: Code2,     color: '#a78bfa', bg: '#1e1b38' },
  snippet:    { label: 'Snippets',    icon: Bookmark,  color: '#6b7280', bg: '#1a1c20' },
};

export default function SnapshotDiffModal({ preview, onCommit, onCancel }) {
  // Items with accepted toggle
  const [items, setItems] = useState(() =>
    preview.extractedItems.map((item, idx) => ({ ...item, _idx: idx }))
  );

  const toggleItem = (idx) => {
    setItems(prev => prev.map(i => i._idx === idx ? { ...i, accepted: !i.accepted } : i));
  };

  const accepted = items.filter(i => i.accepted);
  const newCount = items.filter(i => !i.isDuplicate).length;
  const dupeCount = items.filter(i => i.isDuplicate).length;

  // Group existing by category for the "before" side
  const existingGrouped = useMemo(() => {
    const groups = {};
    for (const item of (preview.existingItems || [])) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }, [preview.existingItems]);

  // Group extracted by category for the "after" side
  const extractedGrouped = useMemo(() => {
    const groups = {};
    for (const item of items) {
      if (!groups[item.category]) groups[item.category] = [];
      groups[item.category].push(item);
    }
    return groups;
  }, [items]);

  return (
    <div style={S.backdrop} onClick={onCancel}>
      <div style={S.modal} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={S.header}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#e6edf3', margin: 0 }}>
                Snapshot Diff Review
              </h2>
              <span style={S.badge('yellow')}>Uncommitted</span>
            </div>
            <p style={{ fontSize: '12px', color: '#8b949e', margin: 0 }}>
              Review changes to your memory before committing. Toggle items to accept or reject.
            </p>
          </div>
          <button onClick={onCancel} style={S.closeBtn}><X size={16} /></button>
        </div>

        {/* Stats row */}
        <div style={S.statsRow}>
          <StatCard icon={<ArrowRight size={16} />} label="Extracted" value={`${items.length} Items`} color="#3b82f6" />
          <StatCard icon={<Plus size={16} />} label="New" value={`+${newCount} Memories`} color="#4ade80" />
          {dupeCount > 0 && (
            <StatCard icon={<Minus size={16} />} label="Duplicates" value={`${dupeCount} Skipped`} color="#ef4444" />
          )}
        </div>

        {/* Diff body */}
        <div style={S.diffBody}>
          {/* Column headers */}
          <div style={S.colHeaders}>
            <div style={S.colHeader}>Existing Memory</div>
            <div style={S.colHeader}>New / Updated</div>
          </div>

          {/* Rows per category */}
          {Object.keys(CATEGORIES).map(cat => {
            const existing = existingGrouped[cat] || [];
            const extracted = extractedGrouped[cat] || [];
            if (!existing.length && !extracted.length) return null;
            const cfg = CATEGORIES[cat];
            const Icon = cfg.icon;

            return (
              <div key={cat} style={{ borderBottom: '1px solid #21262d' }}>
                {/* Category label row */}
                <div style={S.catRow}>
                  <Icon size={12} color={cfg.color} />
                  <span style={{ fontSize: '11px', fontWeight: '700', color: cfg.color, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    {cfg.label}
                  </span>
                  <span style={{ fontSize: '10px', color: '#484f58' }}>
                    {existing.length} existing → {existing.length + extracted.filter(i => i.accepted && !i.isDuplicate).length} after
                  </span>
                </div>

                {/* Side-by-side */}
                <div style={S.diffRow}>
                  {/* Left: existing */}
                  <div style={S.diffCol}>
                    {existing.length === 0 ? (
                      <div style={S.placeholder}>No existing items</div>
                    ) : (
                      existing.map(item => (
                        <div key={item.id} style={S.existingItem}>
                          <span style={S.itemText}>{item.content}</span>
                          <div style={S.tagLine}>
                            {item.tags?.slice(0, 2).map(t => <span key={t} style={S.miniTag}>#{t}</span>)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Right: new */}
                  <div style={S.diffCol}>
                    {extracted.length === 0 ? (
                      <div style={S.placeholder}>No new items</div>
                    ) : (
                      extracted.map(item => (
                        <div
                          key={item._idx}
                          onClick={() => toggleItem(item._idx)}
                          style={{
                            ...S.newItem(item.accepted, item.isDuplicate),
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <div style={S.checkbox(item.accepted)}>
                              {item.accepted && <Check size={9} color="#fff" />}
                            </div>
                            <span style={{
                              ...S.itemText,
                              textDecoration: !item.accepted ? 'line-through' : 'none',
                              opacity: !item.accepted ? 0.5 : 1,
                            }}>
                              {item.content}
                            </span>
                          </div>
                          <div style={S.tagLine}>
                            {item.isDuplicate && <span style={S.dupBadge}>DUPE</span>}
                            {item.tags?.slice(0, 2).map(t => <span key={t} style={S.miniTag}>#{t}</span>)}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <span style={{ fontSize: '12px', color: '#8b949e' }}>
            {accepted.length} of {items.length} items selected
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onCancel} style={S.discardBtn}>Discard</button>
            <button
              onClick={() => onCommit(accepted)}
              disabled={accepted.length === 0}
              style={S.commitBtn(accepted.length > 0)}
            >
              <Check size={14} />
              Commit {accepted.length} Item{accepted.length !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', backgroundColor: '#161b22', border: '1px solid #21262d', borderRadius: '8px', flex: 1 }}>
      <div style={{ padding: '6px', borderRadius: '6px', backgroundColor: `${color}15`, color, display: 'flex' }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: '10px', color: '#484f58', fontWeight: '600', textTransform: 'uppercase' }}>{label}</div>
        <div style={{ fontSize: '14px', fontWeight: '700', color: '#e6edf3' }}>{value}</div>
      </div>
    </div>
  );
}

// ── Styles ──

const S = {
  backdrop: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.7)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    backdropFilter: 'blur(4px)',
  },
  modal: {
    width: '800px', maxWidth: '95vw', maxHeight: '85vh',
    backgroundColor: '#0d1117', border: '1px solid #30363d',
    borderRadius: '12px', display: 'flex', flexDirection: 'column',
    overflow: 'hidden', boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
  },
  header: {
    padding: '16px 20px', borderBottom: '1px solid #21262d',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    backgroundColor: '#161b22',
  },
  closeBtn: {
    background: 'none', border: 'none', color: '#8b949e', cursor: 'pointer',
    padding: '4px', borderRadius: '4px',
  },
  badge: (color) => ({
    fontSize: '10px', fontWeight: '700', padding: '2px 7px', borderRadius: '4px',
    textTransform: 'uppercase', letterSpacing: '0.04em',
    backgroundColor: color === 'yellow' ? '#f59e0b20' : '#4ade8020',
    color: color === 'yellow' ? '#f59e0b' : '#4ade80',
    border: `1px solid ${color === 'yellow' ? '#f59e0b30' : '#4ade8030'}`,
  }),
  statsRow: {
    display: 'flex', gap: '10px', padding: '14px 20px',
    borderBottom: '1px solid #21262d',
  },
  diffBody: {
    flex: 1, overflowY: 'auto',
  },
  colHeaders: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    borderBottom: '1px solid #21262d', backgroundColor: '#161b22',
  },
  colHeader: {
    padding: '8px 16px', fontSize: '10px', fontWeight: '700',
    color: '#484f58', textTransform: 'uppercase', letterSpacing: '0.06em',
  },
  catRow: {
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '6px 16px', backgroundColor: '#0d1117',
    borderBottom: '1px solid #21262d22',
  },
  diffRow: {
    display: 'grid', gridTemplateColumns: '1fr 1fr',
    minHeight: '40px',
  },
  diffCol: {
    padding: '8px 12px', display: 'flex', flexDirection: 'column', gap: '4px',
  },
  existingItem: {
    padding: '6px 8px', fontSize: '12px', color: '#8b949e',
    borderRadius: '4px', backgroundColor: '#161b2266',
    borderLeft: '2px solid #30363d',
  },
  newItem: (accepted, isDupe) => ({
    padding: '6px 8px', fontSize: '12px', borderRadius: '4px',
    borderLeft: `2px solid ${!accepted ? '#484f58' : isDupe ? '#f59e0b' : '#4ade80'}`,
    backgroundColor: !accepted ? 'transparent' : isDupe ? '#f59e0b08' : '#4ade8008',
    color: accepted ? '#c9d1d9' : '#484f58',
    transition: 'all 0.15s',
  }),
  itemText: {
    fontSize: '12px', lineHeight: 1.5,
  },
  tagLine: {
    display: 'flex', gap: '4px', marginTop: '2px',
  },
  miniTag: {
    fontSize: '9px', color: '#484f58',
  },
  dupBadge: {
    fontSize: '9px', fontWeight: '700', color: '#f59e0b',
    backgroundColor: '#f59e0b15', padding: '0 4px', borderRadius: '2px',
  },
  placeholder: {
    fontSize: '11px', color: '#30363d', fontStyle: 'italic', padding: '8px',
  },
  checkbox: (checked) => ({
    width: '14px', height: '14px', borderRadius: '3px', flexShrink: 0,
    border: `1px solid ${checked ? '#4ade80' : '#30363d'}`,
    backgroundColor: checked ? '#4ade80' : 'transparent',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s',
  }),
  footer: {
    padding: '12px 20px', borderTop: '1px solid #21262d',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#161b22',
  },
  discardBtn: {
    padding: '7px 16px', borderRadius: '6px',
    border: '1px solid #30363d', backgroundColor: '#161b22',
    color: '#8b949e', fontSize: '13px', fontWeight: '500', cursor: 'pointer',
  },
  commitBtn: (enabled) => ({
    display: 'flex', alignItems: 'center', gap: '6px',
    padding: '7px 16px', borderRadius: '6px',
    backgroundColor: enabled ? '#238636' : '#21262d',
    border: `1px solid ${enabled ? '#2ea043' : '#30363d'}`,
    color: enabled ? '#fff' : '#484f58',
    fontSize: '13px', fontWeight: '600', cursor: enabled ? 'pointer' : 'default',
    opacity: enabled ? 1 : 0.6,
  }),
};
