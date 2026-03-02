import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  Bug, Trash2, ChevronDown, ChevronRight, Eye, EyeOff, Search,
  Database, Brain, Zap, MessageSquare, Bookmark, Clock, FileText,
  Activity, Copy, Check,
} from 'lucide-react';
import { getDebugEvents, onDebugEvent, clearDebugEvents, setDebugEnabled, isDebugEnabled } from '../../ai/debugLogger.js';
import { tv } from '../../theme/ThemeContext.jsx';

// ── Event type config ──
const EVENT_CONFIG = {
  'context:data-fetched': { icon: Database, color: '#3b82f6', label: 'Context Data', group: 'Context Compiler' },
  'context:compiled':     { icon: Brain,    color: '#a78bfa', label: 'Context Built', group: 'Context Compiler' },
  'rag:indexed':          { icon: Database, color: '#10b981', label: 'RAG Indexed',   group: 'RAG Service' },
  'rag:search':           { icon: Search,   color: '#f59e0b', label: 'RAG Search',    group: 'RAG Service' },
  'llm:stream-start':     { icon: Zap,      color: '#6366f1', label: 'LLM Start',     group: 'LLM Service' },
  'llm:stream-end':       { icon: Zap,      color: '#34d399', label: 'LLM Done',      group: 'LLM Service' },
  'llm:completion-start':  { icon: Zap,      color: '#6366f1', label: 'LLM Call',      group: 'LLM Service' },
  'llm:completion-end':    { icon: Zap,      color: '#34d399', label: 'LLM Response',  group: 'LLM Service' },
  'snapshot:preview':     { icon: Eye,      color: '#f472b6', label: 'Snapshot Preview', group: 'Snapshot' },
  'snapshot:commit':      { icon: Check,    color: '#34d399', label: 'Snapshot Commit',  group: 'Snapshot' },
  'summary:generated':    { icon: FileText, color: '#fb923c', label: 'Summary',       group: 'Summary' },
  'cache:lookup':         { icon: Bookmark, color: '#94a3b8', label: 'Cache Lookup',  group: 'Cache' },
  'auto-title:generated': { icon: MessageSquare, color: '#8b5cf6', label: 'Auto Title', group: 'Auto Title' },
};

const ALL_GROUPS = [...new Set(Object.values(EVENT_CONFIG).map(c => c.group))];

export default function DebugPanel() {
  const [events, setEvents] = useState(getDebugEvents);
  const [enabled, setEnabled] = useState(isDebugEnabled);
  const [expandedIds, setExpandedIds] = useState(new Set());
  const [activeGroups, setActiveGroups] = useState(new Set(ALL_GROUPS));
  const [searchText, setSearchText] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef(null);

  useEffect(() => {
    const unsub = onDebugEvent(setEvents);
    return unsub;
  }, []);

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const toggleExpand = useCallback((id) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const toggleGroup = useCallback((group) => {
    setActiveGroups(prev => {
      const next = new Set(prev);
      if (next.has(group)) next.delete(group); else next.add(group);
      return next;
    });
  }, []);

  const handleToggleEnabled = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    setDebugEnabled(next);
  }, [enabled]);

  const filteredEvents = useMemo(() => {
    return events.filter(e => {
      const cfg = EVENT_CONFIG[e.type];
      if (!cfg) return true;
      if (!activeGroups.has(cfg.group)) return false;
      if (searchText) {
        const s = searchText.toLowerCase();
        const str = JSON.stringify(e.data).toLowerCase();
        if (!str.includes(s) && !e.type.includes(s)) return false;
      }
      return true;
    });
  }, [events, activeGroups, searchText]);

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', fontSize: '12px' }}>
      {/* Header */}
      <div style={{ padding: '10px 12px', borderBottom: `1px solid ${tv('--border')}`, flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
          <Bug size={14} color={tv('--accent')} />
          <span style={{ fontSize: '11px', fontWeight: 700, color: tv('--text-muted'), textTransform: 'uppercase', letterSpacing: '0.08em', flex: 1 }}>
            Debug Pipeline
          </span>
          <span style={{ ...S.badge, background: enabled ? tv('--success-soft') : tv('--error-soft'), color: enabled ? tv('--success') : tv('--error') }}>
            {enabled ? 'ON' : 'OFF'}
          </span>
          <HoverBtn onClick={handleToggleEnabled} title={enabled ? 'Pause logging' : 'Resume logging'}>
            {enabled ? <EyeOff size={13} /> : <Eye size={13} />}
          </HoverBtn>
          <HoverBtn onClick={() => clearDebugEvents()} title="Clear events">
            <Trash2 size={13} />
          </HoverBtn>
        </div>

        {/* Search */}
        <div style={{ position: 'relative', marginBottom: '8px' }}>
          <Search size={12} style={{ position: 'absolute', left: '8px', top: '7px', color: tv('--text-muted') }} />
          <input
            value={searchText}
            onChange={e => setSearchText(e.target.value)}
            placeholder="Filter events..."
            style={{
              width: '100%', padding: '5px 8px 5px 26px', fontSize: '11px',
              background: tv('--bg-input'), border: `1px solid ${tv('--border')}`,
              borderRadius: '6px', color: tv('--text-primary'), outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Filter chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
          {ALL_GROUPS.map(group => (
            <button
              key={group}
              onClick={() => toggleGroup(group)}
              style={{
                padding: '2px 7px', fontSize: '10px', borderRadius: '10px',
                border: `1px solid ${activeGroups.has(group) ? tv('--accent') : tv('--border')}`,
                background: activeGroups.has(group) ? tv('--accent-soft') : 'transparent',
                color: activeGroups.has(group) ? tv('--text-accent') : tv('--text-muted'),
                cursor: 'pointer', transition: 'all 0.15s',
              }}
            >
              {group}
            </button>
          ))}
        </div>
      </div>

      {/* Event count */}
      <div style={{ padding: '4px 12px', fontSize: '10px', color: tv('--text-muted'), borderBottom: `1px solid ${tv('--border')}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
        <span>{filteredEvents.length} events</span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => setAutoScroll(v => !v)}
          style={{ background: 'none', border: 'none', color: autoScroll ? tv('--success') : tv('--text-muted'), cursor: 'pointer', fontSize: '10px', padding: 0 }}
        >
          {autoScroll ? '⬇ Auto-scroll' : '⏸ Scroll paused'}
        </button>
      </div>

      {/* Events list */}
      <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {filteredEvents.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '40px 16px', color: tv('--text-muted') }}>
            <Activity size={24} style={{ margin: '0 auto 8px', opacity: 0.3 }} />
            <p style={{ fontSize: '12px' }}>
              {enabled ? 'Send a message to see pipeline events here' : 'Debug logging is paused'}
            </p>
          </div>
        ) : (
          filteredEvents.map(event => (
            <EventRow
              key={event.id}
              event={event}
              expanded={expandedIds.has(event.id)}
              onToggle={() => toggleExpand(event.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ── Single event row ──
function EventRow({ event, expanded, onToggle }) {
  const cfg = EVENT_CONFIG[event.type] || { icon: Activity, color: '#6b7280', label: event.type };
  const Icon = cfg.icon;
  const time = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div style={{ borderBottom: `1px solid ${tv('--border')}` }}>
      {/* Header row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: '6px',
          padding: '6px 12px', cursor: 'pointer',
          transition: 'background 0.1s',
        }}
        onMouseEnter={e => e.currentTarget.style.background = tv('--bg-hover')}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {expanded ? <ChevronDown size={12} color={tv('--text-muted')} /> : <ChevronRight size={12} color={tv('--text-muted')} />}
        <Icon size={12} color={cfg.color} />
        <span style={{ fontSize: '11px', fontWeight: 600, color: cfg.color, flex: 1 }}>
          {cfg.label}
        </span>
        <QuickBadges event={event} />
        <span style={{ fontSize: '10px', color: tv('--text-muted'), fontFamily: 'monospace' }}>
          {time}
        </span>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{ padding: '0 12px 10px 30px' }}>
          <EventDetail event={event} />
        </div>
      )}
    </div>
  );
}

// ── Quick at-a-glance badges on collapsed row ──
function QuickBadges({ event }) {
  const d = event.data;

  switch (event.type) {
    case 'context:compiled':
      return (
        <div style={{ display: 'flex', gap: '4px' }}>
          <MicroBadge color="#a78bfa" text={`~${d.tokenEstimate} tok`} />
          <MicroBadge color="#f59e0b" text={`${d.ragResultCount} RAG`} />
          <MicroBadge color="#3b82f6" text={`${d.pinnedCount} pinned`} />
          {d.duration && <MicroBadge color="#6b7280" text={`${d.duration}ms`} />}
        </div>
      );
    case 'rag:search':
      return (
        <div style={{ display: 'flex', gap: '4px' }}>
          <MicroBadge color="#f59e0b" text={`${d.resultCount} results`} />
        </div>
      );
    case 'rag:indexed':
      return <MicroBadge color="#10b981" text={`${d.chunkCount} chunks`} />;
    case 'llm:stream-start':
      return <MicroBadge color="#6366f1" text={`${d.provider}/${d.model}`} />;
    case 'llm:stream-end':
      return (
        <div style={{ display: 'flex', gap: '4px' }}>
          <MicroBadge color="#34d399" text={`${d.responseLength} chars`} />
          {d.duration && <MicroBadge color="#6b7280" text={`${d.duration}ms`} />}
        </div>
      );
    case 'llm:completion-end':
      return (
        <div style={{ display: 'flex', gap: '4px' }}>
          <MicroBadge color="#34d399" text={`${d.responseLength} chars`} />
          {d.duration && <MicroBadge color="#6b7280" text={`${d.duration}ms`} />}
        </div>
      );
    case 'cache:lookup':
      return <MicroBadge color={d.hit ? '#34d399' : '#ef4444'} text={d.hit ? 'HIT' : 'MISS'} />;
    case 'snapshot:preview':
      return <MicroBadge color="#f472b6" text={`${d.extractedCount} items`} />;
    case 'summary:generated':
      return <MicroBadge color="#fb923c" text={`${d.summaryLength} chars`} />;
    default:
      return null;
  }
}

function MicroBadge({ color, text }) {
  return (
    <span style={{
      padding: '1px 5px', fontSize: '9px', borderRadius: '8px',
      background: `${color}18`, color, fontWeight: 600, whiteSpace: 'nowrap',
    }}>
      {text}
    </span>
  );
}

// ── Expanded event detail ──
function EventDetail({ event }) {
  const d = event.data;

  // Specialized renderers per type
  switch (event.type) {
    case 'context:compiled':
      return <ContextCompiledDetail data={d} />;
    case 'rag:search':
      return <RagSearchDetail data={d} />;
    case 'rag:indexed':
      return <RagIndexedDetail data={d} />;
    case 'llm:stream-start':
    case 'llm:completion-start':
      return <LlmStartDetail data={d} />;
    case 'llm:stream-end':
    case 'llm:completion-end':
      return <LlmEndDetail data={d} />;
    case 'snapshot:preview':
      return <SnapshotPreviewDetail data={d} />;
    case 'snapshot:commit':
      return <SnapshotCommitDetail data={d} />;
    case 'context:data-fetched':
      return <ContextDataDetail data={d} />;
    default:
      return <JsonView data={d} />;
  }
}

// ── Specialized detail components ──

function ContextCompiledDetail({ data }) {
  const [showFull, setShowFull] = useState(false);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <StatRow label="Token estimate" value={`~${data.tokenEstimate}`} />
      <StatRow label="System prompt" value={`${data.systemPromptLength} chars`} />
      <StatRow label="History messages" value={data.historyLength} />
      <StatRow label="Total messages" value={data.totalMessages} />
      <StatRow label="Pinned injected" value={data.pinnedCount} />
      <StatRow label="RAG results" value={data.ragResultCount} />
      <StatRow label="Has summary" value={data.hasRollingSummary ? 'Yes' : 'No'} />
      {data.duration && <StatRow label="Build time" value={`${data.duration}ms`} />}

      {data.ragResults?.length > 0 && (
        <div>
          <SectionLabel>RAG Results Injected</SectionLabel>
          {data.ragResults.map((r, i) => (
            <div key={i} style={{ ...S.codeBlock, marginBottom: '4px' }}>
              <span style={{ color: '#f59e0b', fontSize: '10px' }}>score: {r.score}</span>
              <span style={{ color: tv('--text-muted'), fontSize: '10px', marginLeft: '8px' }}>
                {r.timestamp ? new Date(r.timestamp).toLocaleDateString() : ''}
              </span>
              <div style={{ color: tv('--text-secondary'), fontSize: '11px', marginTop: '2px' }}>{r.text}</div>
            </div>
          ))}
        </div>
      )}

      <button onClick={() => setShowFull(v => !v)} style={S.linkBtn}>
        {showFull ? 'Hide' : 'Show'} full system prompt
      </button>
      {showFull && (
        <div style={{ position: 'relative' }}>
          <CopyButton text={data.fullSystemPrompt} />
          <pre style={{ ...S.codeBlock, maxHeight: '400px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {data.fullSystemPrompt}
          </pre>
        </div>
      )}
    </div>
  );
}

function ContextDataDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <StatRow label="Workspace" value={data.workspaceName || 'None'} />
      <StatRow label="Profile role" value={data.profileRole || 'Not set'} />
      <StatRow label="Profile tone" value={data.profileTone || 'Not set'} />
      <StatRow label="Recent messages" value={data.recentMessageCount} />
      <StatRow label="Pinned items" value={data.pinnedItemCount} />
      <StatRow label="Rolling summary" value={data.hasRollingSummary ? `Yes (${data.rollingSummaryLength} chars)` : 'No'} />
    </div>
  );
}

function RagSearchDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <StatRow label="Query" value={data.query} />
      <StatRow label="Top K" value={data.topK} />
      <StatRow label="Results returned" value={data.resultCount} />
      {data.results?.length > 0 && (
        <div>
          <SectionLabel>Results (by relevance)</SectionLabel>
          {data.results.map((r, i) => (
            <div key={i} style={{ ...S.codeBlock, marginBottom: '4px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ color: scoreColor(r.score), fontSize: '10px', fontWeight: 700 }}>
                  {r.score.toFixed(3)}
                </span>
                <span style={{ color: tv('--text-muted'), fontSize: '10px' }}>{r.role}</span>
                <span style={{ color: tv('--text-muted'), fontSize: '10px' }}>{r.date}</span>
              </div>
              <div style={{ color: tv('--text-secondary'), fontSize: '11px' }}>{r.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function RagIndexedDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <StatRow label="Messages processed" value={data.messageCount} />
      <StatRow label="Chunks created" value={data.chunkCount} />
      {data.sampleChunks?.length > 0 && (
        <div>
          <SectionLabel>Sample Chunks</SectionLabel>
          {data.sampleChunks.map((c, i) => (
            <div key={i} style={{ ...S.codeBlock, marginBottom: '4px' }}>
              <span style={{ color: tv('--text-muted'), fontSize: '10px' }}>{c.role}</span>
              <div style={{ color: tv('--text-secondary'), fontSize: '11px', marginTop: '2px' }}>{c.text}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LlmStartDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <StatRow label="Provider" value={data.provider} />
      <StatRow label="Model" value={data.model} />
      <StatRow label="Message count" value={data.messageCount} />
      <StatRow label="System prompt length" value={`${data.systemPromptLength} chars`} />
      {data.lastUserMessage && (
        <>
          <SectionLabel>Last User Message</SectionLabel>
          <div style={S.codeBlock}>{data.lastUserMessage}</div>
        </>
      )}
    </div>
  );
}

function LlmEndDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <StatRow label="Provider" value={data.provider} />
      <StatRow label="Response length" value={`${data.responseLength} chars`} />
      <StatRow label="Duration" value={`${data.duration}ms`} />
      {data.responsePreview && (
        <>
          <SectionLabel>Response Preview</SectionLabel>
          <div style={S.codeBlock}>{data.responsePreview}</div>
        </>
      )}
    </div>
  );
}

function SnapshotPreviewDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
      <StatRow label="Messages analyzed" value={data.messageCount} />
      <StatRow label="Existing memory items" value={data.existingMemoryCount} />
      <StatRow label="Items extracted" value={data.extractedCount} />
      <StatRow label="Duplicates found" value={data.skippedDupes} />
      {data.items?.length > 0 && (
        <div>
          <SectionLabel>Extracted Items</SectionLabel>
          {data.items.map((item, i) => (
            <div key={i} style={{ ...S.codeBlock, marginBottom: '4px', display: 'flex', gap: '6px', alignItems: 'flex-start' }}>
              <span style={{ ...S.badge, background: item.isDuplicate ? tv('--error-soft') : tv('--success-soft'), color: item.isDuplicate ? tv('--error') : tv('--success'), flexShrink: 0 }}>
                {item.isDuplicate ? 'DUPE' : 'NEW'}
              </span>
              <div>
                <span style={{ color: '#f59e0b', fontSize: '10px' }}>[{item.category}]</span>
                <span style={{ color: tv('--text-secondary'), fontSize: '11px', marginLeft: '6px' }}>{item.content}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function SnapshotCommitDetail({ data }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      <StatRow label="New items saved" value={data.newItemCount} />
      <StatRow label="Skipped" value={data.skipped} />
      {data.items?.length > 0 && (
        <div>
          <SectionLabel>Committed Items</SectionLabel>
          {data.items.map((item, i) => (
            <div key={i} style={{ ...S.codeBlock, marginBottom: '2px', fontSize: '11px' }}>
              <span style={{ color: '#f59e0b' }}>[{item.category}]</span>
              <span style={{ color: tv('--text-secondary'), marginLeft: '6px' }}>{item.content}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Utility components ──

function StatRow({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
      <span style={{ color: tv('--text-muted'), fontSize: '10px', minWidth: '100px' }}>{label}</span>
      <span style={{ color: tv('--text-primary'), fontSize: '11px', fontFamily: 'monospace' }}>
        {typeof value === 'number' ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

function SectionLabel({ children }) {
  return (
    <div style={{ fontSize: '10px', fontWeight: 700, color: tv('--text-muted'), textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: '4px' }}>
      {children}
    </div>
  );
}

function JsonView({ data }) {
  return (
    <pre style={{ ...S.codeBlock, maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      style={{ position: 'absolute', top: '4px', right: '4px', ...S.linkBtn, display: 'flex', alignItems: 'center', gap: '3px' }}
    >
      {copied ? <Check size={10} color={tv('--success')} /> : <Copy size={10} />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

function HoverBtn({ onClick, title, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: hovered ? tv('--bg-tertiary') : 'none',
        border: 'none', color: hovered ? tv('--text-primary') : tv('--text-secondary'),
        cursor: 'pointer', padding: '4px', borderRadius: '4px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      {children}
    </button>
  );
}

function scoreColor(score) {
  if (score >= 0.7) return '#34d399';
  if (score >= 0.5) return '#f59e0b';
  return '#ef4444';
}

// ── Styles ──
const S = {
  badge: {
    padding: '1px 6px', fontSize: '9px', borderRadius: '8px', fontWeight: 700,
  },
  codeBlock: {
    background: tv('--bg-primary'),
    border: `1px solid ${tv('--border')}`,
    borderRadius: '6px',
    padding: '6px 8px',
    fontSize: '11px',
    fontFamily: 'monospace',
    color: tv('--text-secondary'),
  },
  linkBtn: {
    background: 'none', border: 'none', color: tv('--text-accent'),
    fontSize: '10px', cursor: 'pointer', padding: '2px 0',
  },
  headerLabel: {
    fontSize: '11px', fontWeight: 700, color: tv('--text-muted'),
    textTransform: 'uppercase', letterSpacing: '0.08em',
  },
};
