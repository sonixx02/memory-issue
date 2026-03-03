import { useState, useEffect, useCallback, useRef } from 'react';
import { Sparkles, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Settings, Search, Palette, Bug, Menu, X, LogOut } from 'lucide-react';
import Sidebar from '../Sidebar/Sidebar.jsx';
import ChatArea from '../Chat/ChatArea.jsx';
import MemoryPanel from '../StatePanel/MemoryPanel.jsx';
import DebugPanel from '../Debug/DebugPanel.jsx';
import SettingsModal from '../Settings/SettingsModal.jsx';
import SearchModal from '../Search/SearchModal.jsx';
import { tv } from '../../theme/ThemeContext.jsx';
import { useAuth } from '../../auth/AuthContext.jsx';

const MIN_SIDEBAR = 220;
const MAX_SIDEBAR = 420;
const DEFAULT_LEFT = 280;
const DEFAULT_RIGHT = 320;
const MOBILE_BREAKPOINT = 768;
const SWIPE_THRESHOLD = 50; // px to trigger swipe
const SWIPE_EDGE_ZONE = 30; // px from screen edge to start swipe

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);
  return isMobile;
}

export default function AppShell() {
  const { user, signOut } = useAuth();
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(null);
  const [selectedChatId, setSelectedChatId] = useState(null);
  const [showLeft, setShowLeft] = useState(true);
  const [showRight, setShowRight] = useState(true);
  const [showSettings, setShowSettings] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [rightTab, setRightTab] = useState('memory'); // 'memory' | 'debug'
  const isMobile = useIsMobile();

  // ── Temp chat state (in-memory only, never persisted) ──
  const [tempChatActive, setTempChatActive] = useState(false);
  const [tempMessages, setTempMessages] = useState([]);

  // On mobile, sidebars start closed
  useEffect(() => {
    if (isMobile) { setShowLeft(false); setShowRight(false); }
    else { setShowLeft(true); }
  }, [isMobile]);

  // Close sidebar on mobile when a chat is selected
  const handleSelectChat = useCallback((chatId) => {
    setSelectedChatId(chatId);
    setTempChatActive(false); // exit temp chat when selecting a real chat
    if (isMobile) setShowLeft(false);
  }, [isMobile]);

  // Start a temporary chat (ephemeral, not persisted)
  const handleStartTempChat = useCallback(() => {
    setTempChatActive(true);
    setTempMessages([]);
    setSelectedChatId(null);
    setSelectedWorkspaceId(null);
    if (isMobile) setShowLeft(false);
  }, [isMobile]);

  // When selecting a workspace, exit temp chat
  const handleSelectWorkspace = useCallback((wsId) => {
    setSelectedWorkspaceId(wsId);
    if (wsId !== null) setTempChatActive(false);
  }, []);

  // Resizable sidebar widths
  const [leftWidth, setLeftWidth] = useState(DEFAULT_LEFT);
  const [rightWidth, setRightWidth] = useState(DEFAULT_RIGHT);
  const dragging = useRef(null); // 'left' | 'right' | null

  // ── Swipe gesture handling for mobile ──
  const touchRef = useRef({ startX: 0, startY: 0, startTime: 0, swiping: false });

  useEffect(() => {
    if (!isMobile) return;

    const onTouchStart = (e) => {
      const touch = e.touches[0];
      touchRef.current = {
        startX: touch.clientX,
        startY: touch.clientY,
        startTime: Date.now(),
        swiping: false,
      };
    };

    const onTouchEnd = (e) => {
      const t = touchRef.current;
      if (!t.startX) return;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - t.startX;
      const dy = touch.clientY - t.startY;
      const elapsed = Date.now() - t.startTime;

      // Only count horizontal swipes (not vertical scroll)
      if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy) * 1.5 && elapsed < 400) {
        if (dx > 0) {
          // Swipe right
          if (t.startX < SWIPE_EDGE_ZONE && !showLeft) {
            setShowLeft(true);
          } else if (showRight) {
            setShowRight(false);
          }
        } else {
          // Swipe left
          const screenW = window.innerWidth;
          if (t.startX > screenW - SWIPE_EDGE_ZONE && !showRight) {
            setShowRight(true);
          } else if (showLeft) {
            setShowLeft(false);
          }
        }
      }
      touchRef.current = { startX: 0, startY: 0, startTime: 0, swiping: false };
    };

    window.addEventListener('touchstart', onTouchStart, { passive: true });
    window.addEventListener('touchend', onTouchEnd, { passive: true });
    return () => {
      window.removeEventListener('touchstart', onTouchStart);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isMobile, showLeft, showRight]);

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

  // Drag-to-resize handlers (desktop only)
  useEffect(() => {
    if (isMobile) return;
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
  }, [isMobile]);

  const startDragLeft = useCallback(() => {
    if (isMobile) return;
    dragging.current = 'left';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [isMobile]);

  const startDragRight = useCallback(() => {
    if (isMobile) return;
    dragging.current = 'right';
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, [isMobile]);

  const handleSearchNavigate = useCallback((chatId) => {
    setSelectedChatId(chatId);
  }, []);

  return (
    <div style={{
      ...(isMobile
        ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0 }
        : { height: '100dvh', width: '100vw' }),
      display: 'flex', flexDirection: 'column',
      backgroundColor: tv('--bg-primary'), color: tv('--text-primary'),
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      overflow: 'hidden',
    }}>
      {/* ── Compact top strip ── */}
      <header style={{
        minHeight: isMobile ? '48px' : '40px',
        backgroundColor: tv('--bg-secondary'),
        borderBottom: `1px solid ${tv('--border')}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: isMobile ? 'env(safe-area-inset-top, 0px)' : '0',
        paddingBottom: '0',
        paddingLeft: isMobile ? '12px' : '10px',
        paddingRight: isMobile ? '12px' : '10px',
        flexShrink: 0, zIndex: 50,
        position: 'relative',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <IconBtn onClick={() => setShowLeft(v => !v)} title="Toggle sidebar" isMobile={isMobile}>
            {isMobile ? (showLeft ? <X size={18}/> : <Menu size={18}/>) : (showLeft ? <PanelLeftClose size={15}/> : <PanelLeftOpen size={15}/>)}
          </IconBtn>
          <div style={{ width: '1px', height: '16px', backgroundColor: tv('--border'), margin: '0 2px' }} />
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <div style={{
              width: '22px', height: '22px', borderRadius: '6px',
              background: `linear-gradient(135deg, ${tv('--accent')} 0%, ${tv('--purple')} 100%)`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              boxShadow: `0 0 0 1px ${tv('--accent-soft')}`,
            }}>
              <Sparkles size={12} color="#fff" />
            </div>
            {!isMobile && (
              <span style={{ fontSize: '13px', fontWeight: '600', color: tv('--text-primary'), letterSpacing: '-0.01em' }}>
                Synapse
              </span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          {!isMobile && <span style={{ fontSize: '10px', color: tv('--text-muted'), marginRight: '4px' }}>your AI, your memory</span>}
          <IconBtn onClick={() => setShowSearch(true)} title="Search (Ctrl+K)" isMobile={isMobile}>
            <Search size={isMobile ? 16 : 14} />
          </IconBtn>
          <IconBtn onClick={() => setShowSettings(true)} title="Settings" isMobile={isMobile}>
            <Settings size={isMobile ? 16 : 14} />
          </IconBtn>
          <IconBtn onClick={() => setShowRight(v => !v)} title="Toggle memory panel" isMobile={isMobile}>
            {showRight ? <PanelRightClose size={isMobile ? 16 : 15}/> : <PanelRightOpen size={isMobile ? 16 : 15}/>}
          </IconBtn>
          {/* User avatar & sign-out */}
          {user && (
            <>
              <div style={{ width: '1px', height: '16px', backgroundColor: tv('--border'), margin: '0 2px' }} />
              {user.picture ? (
                <img
                  src={user.picture}
                  alt={user.name}
                  style={{ width: '22px', height: '22px', borderRadius: '50%', border: `1px solid ${tv('--border')}`, cursor: 'default' }}
                  title={user.name || user.email}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <span style={{ fontSize: '11px', fontWeight: 600, color: tv('--text-secondary') }} title={user.name}>
                  {user.name?.charAt(0)?.toUpperCase() || '?'}
                </span>
              )}
              <IconBtn onClick={signOut} title="Sign out" isMobile={isMobile}>
                <LogOut size={isMobile ? 16 : 14} />
              </IconBtn>
            </>
          )}
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0, position: 'relative' }}>

        {/* Mobile overlay backdrop */}
        {isMobile && (showLeft || showRight) && (
          <div
            onClick={() => { setShowLeft(false); setShowRight(false); }}
            style={{
              position: 'absolute', inset: 0, zIndex: 20,
              backgroundColor: 'rgba(0,0,0,0.5)',
              backdropFilter: 'blur(2px)',
              WebkitBackdropFilter: 'blur(2px)',
              transition: 'opacity 0.2s ease',
            }}
          />
        )}

        {/* Left sidebar — overlay on mobile, resizable on desktop */}
        <div style={isMobile ? {
          position: 'absolute', top: 0, bottom: 0, left: 0, zIndex: 30,
          width: '85vw', maxWidth: '320px',
          transform: showLeft ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          backgroundColor: tv('--bg-secondary'),
          display: 'flex', flexDirection: 'column',
          boxShadow: showLeft ? '4px 0 24px rgba(0,0,0,0.3)' : 'none',
          willChange: 'transform',
        } : {
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
            onSelectWorkspace={handleSelectWorkspace}
            onSelectChat={handleSelectChat}
            onStartTempChat={handleStartTempChat}
            isTempChatActive={tempChatActive}
          />
          {/* Resize handle (desktop only) */}
          {showLeft && !isMobile && (
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

        {/* Left border line (desktop only) */}
        {showLeft && !isMobile && (
          <div style={{ width: '1px', backgroundColor: tv('--border'), flexShrink: 0 }} />
        )}

        {/* Center — fills remaining space */}
        <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
          <ChatArea
            currentChatId={tempChatActive ? null : selectedChatId}
            currentWorkspaceId={tempChatActive ? null : selectedWorkspaceId}
            onOpenSettings={() => setShowSettings(true)}
            isMobile={isMobile}
            tempMode={tempChatActive}
            tempMessages={tempMessages}
            onTempMessagesChange={setTempMessages}
          />
        </div>

        {/* Right border line (desktop only) */}
        {showRight && !isMobile && (
          <div style={{ width: '1px', backgroundColor: tv('--border'), flexShrink: 0 }} />
        )}

        {/* Right state panel — overlay on mobile, resizable on desktop */}
        <div style={isMobile ? {
          position: 'absolute', top: 0, bottom: 0, right: 0, zIndex: 30,
          width: '85vw', maxWidth: '320px',
          transform: showRight ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
          backgroundColor: tv('--bg-secondary'),
          display: 'flex', flexDirection: 'column',
          boxShadow: showRight ? '-4px 0 24px rgba(0,0,0,0.3)' : 'none',
          willChange: 'transform',
        } : {
          width: showRight ? `${rightWidth}px` : '0px',
          minWidth: showRight ? `${rightWidth}px` : '0px',
          overflow: 'hidden',
          transition: dragging.current ? 'none' : 'width 0.25s cubic-bezier(0.4,0,0.2,1), min-width 0.25s cubic-bezier(0.4,0,0.2,1)',
          backgroundColor: tv('--bg-secondary'),
          display: 'flex', flexDirection: 'column',
          position: 'relative',
        }}>
          {/* Resize handle (desktop only) */}
          {showRight && !isMobile && (
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
              <Sparkles size={12} /> Memory
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

function IconBtn({ onClick, title, children, isMobile }) {
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
        cursor: 'pointer', padding: isMobile ? '8px' : '5px', borderRadius: '6px',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        transition: 'color 0.15s, background 0.15s',
        minWidth: isMobile ? '36px' : 'auto', minHeight: isMobile ? '36px' : 'auto',
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
