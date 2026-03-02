import { useState, useEffect, useCallback } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Brain, Target, Lock, XCircle, Activity, Lightbulb, Plus, Trash2, Edit3, Check, X, History, ChevronDown, ChevronRight } from 'lucide-react';
import { getWorkspace, updateStateFile } from '../../db/workspaceHelpers.js';
import db from '../../db/database.js';

export default function StatePanel({ workspaceId }) {
  const workspace = useLiveQuery(
    () => workspaceId ? getWorkspace(workspaceId) : null,
    [workspaceId]
  );

  const [showHistory, setShowHistory] = useState(false);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <div style={{ padding: '12px 16px', borderBottom: '1px solid #21262d', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <Brain size={14} color="#7c3aed" />
          <span style={{ fontSize: '11px', fontWeight: '700', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
            Project State
          </span>
          {workspaceId && (
            <HoverBtn onClick={() => setShowHistory(v => !v)} title="Snapshot history">
              <History size={13} />
            </HoverBtn>
          )}
        </div>
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px' }}>
        {!workspaceId || !workspace ? (
          <EmptyState />
        ) : showHistory ? (
          <SnapshotHistory workspaceId={workspaceId} onClose={() => setShowHistory(false)} />
        ) : (
          <EditableStateContent
            workspaceId={workspaceId}
            state={workspace.stateFile}
            workspaceName={workspace.name}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', paddingTop: '60px', textAlign: 'center' }}>
      <div style={{
        width: '48px', height: '48px', borderRadius: '14px',
        background: 'linear-gradient(135deg, #1a1f2e, #1e1b38)',
        border: '1px solid #30363d',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: '16px',
      }}>
        <Brain size={22} color="#374151" />
      </div>
      <p style={{ color: '#6e7681', fontSize: '13px', lineHeight: 1.7, maxWidth: '200px' }}>
        Select a workspace to see its AI memory state here.
      </p>
    </div>
  );
}

function EditableStateContent({ workspaceId, state, workspaceName }) {
  if (!state) return <EmptyState />;
  const { project_goal, locked_decisions, rejected_ideas, current_status, key_insights } = state;
  const hasAnyContent = project_goal || locked_decisions?.length || rejected_ideas?.length || current_status || key_insights?.length;

  const updateField = useCallback(async (field, value) => {
    const newState = { ...state, [field]: value };
    await updateStateFile(workspaceId, newState);
  }, [workspaceId, state]);

  if (!hasAnyContent) {
    return (
      <div style={{ textAlign: 'center', paddingTop: '40px' }}>
        <Brain size={24} color="#374151" style={{ margin: '0 auto 12px' }} />
        <p style={{ color: '#6e7681', fontSize: '13px', lineHeight: 1.7 }}>
          No memory yet for <strong style={{ color: '#8b949e' }}>{workspaceName}</strong>.
          <br />Start chatting and click <strong style={{ color: '#7c3aed' }}>Commit Snapshot</strong> to build memory.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Editable text fields */}
      <EditableTextField
        icon={<Target size={13} color="#3b82f6" />}
        label="Project Goal"
        value={project_goal || ''}
        onSave={(v) => updateField('project_goal', v)}
        placeholder="What is this project about?"
      />

      <EditableTextField
        icon={<Activity size={13} color="#10b981" />}
        label="Current Status"
        value={current_status || ''}
        onSave={(v) => updateField('current_status', v)}
        placeholder="What's currently being worked on?"
      />

      {/* Editable list fields */}
      <EditableListField
        icon={<Lock size={13} color="#f59e0b" />}
        label="Locked Decisions"
        items={locked_decisions || []}
        onUpdate={(items) => updateField('locked_decisions', items)}
        tagColor="#f59e0b"
        tagBg="#2d1b02"
        placeholder="Add a decision..."
      />

      <EditableListField
        icon={<XCircle size={13} color="#ef4444" />}
        label="Rejected Ideas"
        items={rejected_ideas || []}
        onUpdate={(items) => updateField('rejected_ideas', items)}
        tagColor="#ef4444"
        tagBg="#2a0808"
        strikethrough
        placeholder="Add a rejected idea..."
      />

      <EditableListField
        icon={<Lightbulb size={13} color="#a78bfa" />}
        label="Key Insights"
        items={key_insights || []}
        onUpdate={(items) => updateField('key_insights', items)}
        tagColor="#a78bfa"
        tagBg="#1e1b38"
        asList
        placeholder="Add an insight..."
      />
    </div>
  );
}

// ── Editable text field (project goal, current status) ──

function EditableTextField({ icon, label, value, onSave, placeholder }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => setDraft(value), [value]);

  const handleSave = () => {
    onSave(draft.trim());
    setEditing(false);
  };

  const handleCancel = () => {
    setDraft(value);
    setEditing(false);
  };

  return (
    <StateSection icon={icon} label={label} onEdit={() => setEditing(true)} editing={editing}>
      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            placeholder={placeholder}
            autoFocus
            style={{
              width: '100%', boxSizing: 'border-box', background: '#0d1117',
              border: '1px solid #30363d', borderRadius: '6px', padding: '8px 10px',
              color: '#e6edf3', fontSize: '13px', lineHeight: 1.5, resize: 'vertical',
              minHeight: '60px', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <div style={{ display: 'flex', gap: '6px', marginTop: '8px', justifyContent: 'flex-end' }}>
            <MiniAction onClick={handleCancel} color="#8b949e"><X size={12} /> Cancel</MiniAction>
            <MiniAction onClick={handleSave} color="#4ade80"><Check size={12} /> Save</MiniAction>
          </div>
        </div>
      ) : (
        <p style={{ margin: 0, fontSize: '13px', color: value ? '#c9d1d9' : '#484f58', lineHeight: 1.65, fontStyle: value ? 'normal' : 'italic' }}>
          {value || placeholder}
        </p>
      )}
    </StateSection>
  );
}

// ── Editable list field (locked decisions, rejected ideas, key insights) ──

function EditableListField({ icon, label, items, onUpdate, tagColor, tagBg, strikethrough, asList, placeholder }) {
  const [adding, setAdding] = useState(false);
  const [newItem, setNewItem] = useState('');

  const handleAdd = () => {
    if (!newItem.trim()) return;
    onUpdate([...items, newItem.trim()]);
    setNewItem('');
    setAdding(false);
  };

  const handleRemove = (index) => {
    onUpdate(items.filter((_, i) => i !== index));
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); handleAdd(); }
    if (e.key === 'Escape') { setAdding(false); setNewItem(''); }
  };

  return (
    <StateSection icon={icon} label={label} onAdd={() => setAdding(true)}>
      {items.length > 0 && (
        asList ? (
          <ul style={{ margin: 0, paddingLeft: '16px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {items.map((item, i) => (
              <li key={i} style={{ fontSize: '13px', color: '#c9d1d9', lineHeight: 1.6, display: 'flex', alignItems: 'flex-start', gap: '6px' }}>
                <span style={{ flex: 1 }}>{item}</span>
                <RemoveBtn onClick={() => handleRemove(i)} />
              </li>
            ))}
          </ul>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {items.map((item, i) => (
              <span key={i} style={{
                ...tagStyle(tagColor, tagBg),
                textDecoration: strikethrough ? 'line-through' : 'none',
                opacity: strikethrough ? 0.8 : 1,
                display: 'flex', alignItems: 'center', gap: '4px',
              }}>
                {item}
                <RemoveBtn onClick={() => handleRemove(i)} small />
              </span>
            ))}
          </div>
        )
      )}

      {adding && (
        <div style={{ marginTop: items.length ? '8px' : 0, display: 'flex', gap: '6px' }}>
          <input
            value={newItem}
            onChange={e => setNewItem(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            autoFocus
            style={{
              flex: 1, background: '#0d1117', border: '1px solid #30363d',
              borderRadius: '6px', padding: '6px 10px', color: '#e6edf3',
              fontSize: '12px', outline: 'none', fontFamily: 'inherit',
            }}
          />
          <MiniAction onClick={handleAdd} color="#4ade80"><Check size={12} /></MiniAction>
          <MiniAction onClick={() => { setAdding(false); setNewItem(''); }} color="#8b949e"><X size={12} /></MiniAction>
        </div>
      )}

      {!items.length && !adding && (
        <p style={{ margin: 0, fontSize: '12px', color: '#484f58', fontStyle: 'italic' }}>{placeholder}</p>
      )}
    </StateSection>
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

  const handleRevert = async (snapshot) => {
    if (!confirm('Revert to this snapshot? Current state will be overwritten.')) return;
    await updateStateFile(workspaceId, snapshot.stateFile);
  };

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <span style={{ fontSize: '12px', fontWeight: '600', color: '#8b949e' }}>Snapshot History</span>
        <MiniAction onClick={onClose} color="#8b949e"><X size={12} /> Close</MiniAction>
      </div>

      {!snapshots?.length ? (
        <p style={{ color: '#484f58', fontSize: '12px', textAlign: 'center', paddingTop: '20px' }}>
          No snapshots committed yet.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {snapshots.map((snap) => {
            const isExpanded = !!expanded[snap.id];
            const date = new Date(snap.timestamp);
            return (
              <div key={snap.id} style={{
                borderRadius: '8px', border: '1px solid #21262d',
                backgroundColor: '#0d1117', overflow: 'hidden',
              }}>
                <div
                  onClick={() => setExpanded(p => ({ ...p, [snap.id]: !p[snap.id] }))}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '8px',
                    padding: '8px 12px', cursor: 'pointer',
                    backgroundColor: '#161b22',
                  }}
                >
                  {isExpanded ? <ChevronDown size={12} color="#484f58" /> : <ChevronRight size={12} color="#484f58" />}
                  <span style={{ fontSize: '12px', color: '#c9d1d9', flex: 1 }}>
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ fontSize: '10px', color: '#484f58' }}>{snap.messageCount} msgs</span>
                </div>
                {isExpanded && (
                  <div style={{ padding: '10px 12px', fontSize: '12px' }}>
                    {snap.stateFile?.project_goal && (
                      <div style={{ marginBottom: '6px' }}><strong style={{ color: '#8b949e' }}>Goal:</strong> <span style={{ color: '#c9d1d9' }}>{snap.stateFile.project_goal}</span></div>
                    )}
                    {snap.stateFile?.locked_decisions?.length > 0 && (
                      <div style={{ marginBottom: '6px' }}><strong style={{ color: '#8b949e' }}>Decisions:</strong> <span style={{ color: '#c9d1d9' }}>{snap.stateFile.locked_decisions.join(', ')}</span></div>
                    )}
                    {snap.stateFile?.current_status && (
                      <div style={{ marginBottom: '8px' }}><strong style={{ color: '#8b949e' }}>Status:</strong> <span style={{ color: '#c9d1d9' }}>{snap.stateFile.current_status}</span></div>
                    )}
                    <button
                      onClick={() => handleRevert(snap)}
                      style={{
                        background: 'none', border: '1px solid #f59e0b40', color: '#f59e0b',
                        padding: '4px 12px', borderRadius: '6px', fontSize: '11px',
                        cursor: 'pointer', fontWeight: '600',
                      }}
                    >
                      Revert to this snapshot
                    </button>
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

// ── Shared small components ──

function StateSection({ icon, label, children, onEdit, onAdd, editing }) {
  return (
    <div style={{
      borderRadius: '10px', border: '1px solid #21262d',
      backgroundColor: '#0d1117', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: '7px',
        padding: '8px 12px', backgroundColor: '#161b22',
        borderBottom: '1px solid #21262d',
      }}>
        {icon}
        <span style={{ fontSize: '11px', fontWeight: '700', color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.07em', flex: 1 }}>
          {label}
        </span>
        {onEdit && !editing && <HoverBtn onClick={onEdit} title="Edit"><Edit3 size={11} /></HoverBtn>}
        {onAdd && <HoverBtn onClick={onAdd} title="Add item"><Plus size={12} /></HoverBtn>}
      </div>
      <div style={{ padding: '12px' }}>
        {children}
      </div>
    </div>
  );
}

function RemoveBtn({ onClick, small }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        background: 'none', border: 'none', cursor: 'pointer',
        color: h ? '#ef4444' : '#484f58', padding: small ? '0 2px' : '2px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexShrink: 0, transition: 'color 0.15s',
      }}
    >
      <Trash2 size={small ? 10 : 12} />
    </button>
  );
}

function HoverBtn({ onClick, title, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        background: h ? '#21262d' : 'none', border: 'none',
        color: h ? '#e6edf3' : '#484f58', cursor: 'pointer',
        padding: '3px', borderRadius: '4px', display: 'flex',
        alignItems: 'center', justifyContent: 'center', transition: 'all 0.15s',
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

const tagStyle = (color, bg) => ({
  fontSize: '12px',
  padding: '2px 10px',
  borderRadius: '20px',
  border: `1px solid ${color}40`,
  backgroundColor: bg,
  color: color,
  fontWeight: '500',
});
