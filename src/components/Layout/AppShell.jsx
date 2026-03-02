import { useState, useEffect, useCallback, useRef } from 'react';
import { Brain, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings, Search, Palette, Bug } from 'lucide-react';
import Sidebar from '../Sidebar/Sidebar.jsx';
import ChatArea from '../Chat/ChatArea.jsx';
import MemoryPanel from '../StatePanel/MemoryPanel.jsx';
import DebugPanel from '../Debug/DebugPanel.jsx';
import SettingsModal from '../Settings/SettingsModal.jsx';
import SearchModal from '../Search/SearchModal.jsx';
import { tv } from '../../theme/ThemeContext.jsx';

const MIN_SIDEBAR = 220;
const MAX_SIDEBAR = 420;
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 320;

export default function AppShell() {
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [rightTab, setRightTab] = useState('memory'); // 'memory' | 'debug'

  // Resizable sidebar widths
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const dragging = useRef(null); // 'left' | 'right' | null

  // Ctrl+K / Cmd+K to open search
  useEffect(() => {
    const handler = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(v => !v);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Drag-to-resize handlers
  useEffect(() => {
    const onMouseMove = (e) => {
      if (!dragging.current) return;
      e.preventDefault();
      if (dragging.current === 'left') {
        const w = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, e.clientX));
        setLeftWidth(w);
      } else if (dragging.current === 'right') {
        const w = Math.min(MAX_SIDEBAR, Math.max(MIN_SIDEBAR, window.innerWidth - e.clientX));
        setRightWidth(w);
      }
    };
    const onMouseUp = () => {
      if (dragging.current) {
        dragging.current = null;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => { window.removeEventListener('mousemove', onMouseMove); window.removeEventListener('mouseup', onMouseUp); };
  }, []);

  const startDragLeft = useCallback(() => {
    dragging.current = 'left';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const startDragRight = useCallback(() => {
    dragging.current = 'right';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const handleSearchNavigate = useCallback((chatId) => {
    setSelectedChatId(chatId);
  }, []);

  return (
    <div style={{
      height: '100vh', width: '100vw', display: 'flex', flexDirection: 'column',
      backgroundColor: tv('--bg-primary'), color: tv('--text-primary'),
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      {/* ── Compact top strip ── */}
      <header style={{
        height: '40px', backgroundColor: tv('--bg-secondary'),
        borderBottom: `1px solid ${tv('--border')}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px', flexShrink: 0, zIndex: 10,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconBtn onClick={() => setShowLeft(v => !v)} title="Toggle sidebar">
            {showLeft ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>}
          </IconBtn>
          <div style={{ width: '1px', height: '16px', backgroundColor: tv('--border'), margin: '0 2px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <div style={{
              width: '22px', height: '22px', borderRadius: '6px',
              background: `linear-gradient(135deg, ${tv('--accent')} 0%, ${tv('--purple')} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 0 1px ${tv('--accent-soft')}`,
            }}>
              <Brain size={12} color="#fff" />
            </div>
            <span style={{ fontSize: '13px', fontWeight: '600', color: tv('--text-primary'), letterSpacing: '-0.01em' }}>
              Snapshot AI
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <span style={{ fontSize: '10px', color: tv('--text-muted'), marginRight: '4px' }}>local-first memory</span>
          <IconBtn onClick={() => setShowSearch(true)} title="Search (Ctrl+K)">
            <Search size={14} />
          </IconBtn>
          <IconBtn onClick={() => setShowSettings(true)} title="Settings">
            <Settings size={14} />
          </IconBtn>
          <IconBtn onClick={() => setShowRight(v => !v)} title="Toggle memory panel">
            {showRight ? <PanelRightClose size={15}/> : <PanelRightOpen size={15}/>}
          </IconBtn>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* Left sidebar — resizable */}
        <div style={{
          width: showLeft ? `${leftWidth}px` : '0px',
          minWidth: showLeft ? `${leftWidth}px` : '0px',
          overflow: 'hidden',
          transition: dragging.current ? 'none' : 'width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1)',
          backgroundColor: tv('--bg-secondary'),
          display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          <Sidebar
            selectedWorkspaceId={selectedWorkspaceId}
            selectedChatId={selectedChatId}
            onSelectWorkspace={setSelectedWorkspaceId}
            onSelectChat={setSelectedChatId}
          />
          {/* Resize handle */}
          {showLeft && (
            <div
              onMouseDown={startDragLeft}
              style={{
                position: 'absolute', top: 0, bottom: 0, right: -2, width: 5,
                cursor: 'col-resize', zIndex: 5,
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = `var(--accent)`}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            />
          )}
        </div>

        {/* Left border line */}
        {showLeft && (
          <div style={{ width: '1px', backgroundColor: tv('--border'), flexShrink: 0 }} />
        )}

        {/* Center — fills remaining space */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ChatArea
            currentChatId={selectedChatId}
            currentWorkspaceId={selectedWorkspaceId}
            onOpenSettings={() => setShowSettings(true)}
          />
        </div>

        {/* Right border line */}
        {showRight && (
          <div style={{ width: '1px', backgroundColor: tv('--border'), flexShrink: 0 }} />
        )}

        {/* Right state panel — resizable */}
        <div style={{
          width: showRight ? `${rightWidth}px` : '0px',
          minWidth: showRight ? `${rightWidth}px` : '0px',
          overflow: 'hidden',
          transition: dragging.current ? 'none' : 'width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1)',
          backgroundColor: tv('--bg-secondary'),
          display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Resize handle */}
          {showRight && (
            <div
              onMouseDown={startDragRight}
              style={{
                position: 'absolute', top: 0, bottom: 0, left: -2, width: 5,
                cursor: 'col-resize', zIndex: 5,
              }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = `var(--accent)`}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            />
          )}

          {/* Tab switcher */}
          <div style={{ display: 'flex', borderBottom: `1px solid ${tv('--border')}`, flexShrink: 0 }}>
            <RightTabBtn active={rightTab === 'memory'} onClick={() => setRightTab('memory')}>
              <Brain size={12} /> Memory
            </RightTabBtn>
            <RightTabBtn active={rightTab === 'debug'} onClick={() => setRightTab('debug')}>
              <Bug size={12} /> Debug
            </RightTabBtn>
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            {rightTab === 'memory' ? (
              <MemoryPanel workspaceId={selectedWorkspaceId} />
            ) : (
              <DebugPanel />
            )}
          </div>
        </div>
      </div>

      {/* Settings Modal */}
      <SettingsModal open={showSettings} onClose={() => setShowSettings(false)} />

      {/* Search Modal */}
      <SearchModal
        open={showSearch}
        onClose={() => setShowSearch(false)}
        workspaceId={selectedWorkspaceId}
        onNavigateToChat={handleSearchNavigate}
      />
    </div>
  );
}

function IconBtn({ onClick, title, children }) {
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
        cursor: 'pointer', padding: '5px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color 0.15s, background 0.15s',
      }}
    >
      {children}
    </button>
  );
}

function RightTabBtn({ active, onClick, children }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        flex: 1,
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
        padding: '8px 0', fontSize: '11px', fontWeight: active ? 700 : 500,
        color: active ? tv('--text-accent') : (hovered ? tv('--text-primary') : tv('--text-muted')),
        background: active ? tv('--accent-soft') : (hovered ? tv('--bg-hover') : 'transparent'),
        border: 'none', borderBottom: active ? `2px solid ${tv('--accent')}` : '2px solid transparent',
        cursor: 'pointer', transition: 'all 0.15s',
      }}
    >
      {children}
    </button>
  );
}
