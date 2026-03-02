import { useState, useRef, useEffect, useCallback } from 'react';
import { Search, X, MessageSquare, Clock, ArrowRight } from 'lucide-react';
import { searchMemory } from '../../ai/ragService.js';
import { getChat } from '../../db/chatHelpers.js';

/**
 * SearchModal — semantic search across all conversations in a workspace.
 *
 * Uses the existing RAG service (Orama + MiniLM embeddings) to find
 * relevant past conversation chunks. Results show the matched text,
 * source chat name, timestamp, and relevance score. Clicking a result
 * navigates to that chat.
 */

const S = {
  overlay: {
    position: 'fixed', inset: 0, backgroundColor: 'rgba(0,0,0,0.6)',
    display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
    paddingTop: '12vh', zIndex: 999,
  },
  modal: {
    width: '580px', maxHeight: '70vh', backgroundColor: '#161b22',
    border: '1px solid #30363d', borderRadius: '12px',
    boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
    display: 'flex', flexDirection: 'column', overflow: 'hidden',
  },
  inputRow: {
    display: 'flex', alignItems: 'center', gap: '10px',
    padding: '14px 16px', borderBottom: '1px solid #21262d',
  },
  input: {
    flex: 1, background: 'none', border: 'none', outline: 'none',
    fontSize: '15px', color: '#e6edf3', fontFamily: 'inherit',
  },
  results: {
    flex: 1, overflowY: 'auto', padding: '6px',
  },
  emptyState: {
    padding: '40px 20px', textAlign: 'center', color: '#484f58', fontSize: '13px',
    lineHeight: 1.7,
  },
  resultItem: (hovered) => ({
    padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
    backgroundColor: hovered ? '#21262d' : 'transparent',
    transition: 'background 0.1s', marginBottom: '2px',
  }),
  resultText: {
    fontSize: '13px', color: '#c9d1d9', lineHeight: 1.5,
    overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
  },
  resultMeta: {
    display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px',
    fontSize: '11px', color: '#484f58',
  },
  scoreBadge: (score) => ({
    fontSize: '10px', fontWeight: '600', padding: '1px 5px', borderRadius: '4px',
    backgroundColor: score > 0.7 ? '#238636' : score > 0.5 ? '#9e6a03' : '#30363d',
    color: score > 0.7 ? '#3fb950' : score > 0.5 ? '#d29922' : '#8b949e',
  }),
  footer: {
    padding: '8px 16px', borderTop: '1px solid #21262d',
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    fontSize: '11px', color: '#484f58',
  },
  kbd: {
    fontSize: '10px', padding: '1px 5px', borderRadius: '3px',
    border: '1px solid #30363d', backgroundColor: '#21262d', color: '#8b949e',
  },
};

export default function SearchModal({ open, onClose, workspaceId, onNavigateToChat }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [chatNames, setChatNames] = useState({});
  const inputRef = useRef(null);
  const debounceRef = useRef(null);

  // Focus input on open
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery('');
      setResults([]);
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Debounced search
  const doSearch = useCallback(async (q) => {
    if (!q.trim() || !workspaceId) {
      setResults([]);
      return;
    }
    setLoading(true);
    try {
      const hits = await searchMemory(workspaceId, q, 10);
      setResults(hits);

      // Resolve chat names for results
      const uniqueChatIds = [...new Set(hits.map(h => h.chatId).filter(Boolean))];
      const names = {};
      await Promise.all(uniqueChatIds.map(async (id) => {
        try {
          const chat = await getChat(id);
          names[id] = chat?.title || 'Untitled Chat';
        } catch { names[id] = 'Unknown Chat'; }
      }));
      setChatNames(prev => ({ ...prev, ...names }));
    } catch (err) {
      console.warn('Search failed:', err.message);
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  const handleInput = (e) => {
    const val = e.target.value;
    setQuery(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => doSearch(val), 300);
  };

  const handleResultClick = (result) => {
    if (result.chatId && onNavigateToChat) {
      onNavigateToChat(result.chatId);
    }
    onClose();
  };

  if (!open) return null;

  return (
    <div style={S.overlay} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>

        {/* Search input */}
        <div style={S.inputRow}>
          <Search size={16} color="#484f58" style={{ flexShrink: 0 }} />
          <input
            ref={inputRef}
            style={S.input}
            placeholder="Search conversations…"
            value={query}
            onChange={handleInput}
          />
          {query && (
            <button
              onClick={() => { setQuery(''); setResults([]); inputRef.current?.focus(); }}
              style={{ background: 'none', border: 'none', color: '#484f58', cursor: 'pointer', display: 'flex', padding: '2px' }}
            >
              <X size={14} />
            </button>
          )}
        </div>

        {/* Results */}
        <div style={S.results}>
          {!query.trim() ? (
            <div style={S.emptyState}>
              Search across all conversations in this workspace.<br />
              Uses semantic search — try natural language queries.
            </div>
          ) : loading ? (
            <div style={S.emptyState}>
              <span style={{ animation: 'spin 1s linear infinite', display: 'inline-block' }}>⟳</span> Searching…
            </div>
          ) : results.length === 0 ? (
            <div style={S.emptyState}>
              No results found for "{query}"
            </div>
          ) : (
            results.map((r, i) => (
              <ResultItem
                key={i}
                result={r}
                chatName={chatNames[r.chatId]}
                onClick={() => handleResultClick(r)}
              />
            ))
          )}
        </div>

        {/* Footer */}
        <div style={S.footer}>
          <span>{results.length > 0 ? `${results.length} result${results.length !== 1 ? 's' : ''}` : 'Semantic search'}</span>
          <span>
            <span style={S.kbd}>esc</span> to close
          </span>
        </div>
      </div>
    </div>
  );
}

function ResultItem({ result, chatName, onClick }) {
  const [hovered, setHovered] = useState(false);
  const date = new Date(result.timestamp).toLocaleDateString();

  return (
    <div
      style={S.resultItem(hovered)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
    >
      <div style={S.resultText}>{result.text}</div>
      <div style={S.resultMeta}>
        <span style={S.scoreBadge(result.score)}>
          {Math.round(result.score * 100)}%
        </span>
        {chatName && (
          <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
            <MessageSquare size={10} /> {chatName}
          </span>
        )}
        <span style={{ display: 'flex', alignItems: 'center', gap: '3px' }}>
          <Clock size={10} /> {date}
        </span>
        {hovered && (
          <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '3px', color: '#58a6ff' }}>
            Open <ArrowRight size={10} />
          </span>
        )}
      </div>
    </div>
  );
}
