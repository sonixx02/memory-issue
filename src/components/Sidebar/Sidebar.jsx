import { useLiveQuery } from 'dexie-react-hooks';
import { Plus, Trash2, ChevronRight, ChevronDown, MessageSquare, FolderOpen, Edit3, Check, X, Zap } from 'lucide-react';
import { getAllWorkspaces, createWorkspace, deleteWorkspace, renameWorkspace } from '../../db/workspaceHelpers.js';
import { getChatsByWorkspace, createChat, deleteChat, renameChat, getGeneralChats } from '../../db/chatHelpers.js';
import { useState, useRef, useEffect } from 'react';
import { tv } from '../../theme/ThemeContext.jsx';

export default function Sidebar({ selectedWorkspaceId, selectedChatId, onSelectWorkspace, onSelectChat, onStartTempChat, isTempChatActive }) {
  const workspaces = useLiveQuery(() => getAllWorkspaces(), []);
  const generalChats = useLiveQuery(() => getGeneralChats(), []);
  const [expanded, setExpanded] = useState({});
  const [generalExpanded, setGeneralExpanded] = useState(true);

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }));

  const handleNewWorkspace = async () => {
    const name = prompt('Workspace name:');
    if (!name?.trim()) return;
    const ws = await createWorkspace(name.trim());
    onSelectWorkspace(ws.id);
    setExpanded(p => ({ ...p, [ws.id]: true }));
  };

  const handleNewGeneralChat = async () => {
    const chat = await createChat(null, 'New Chat');
    onSelectWorkspace(null);
    onSelectChat(chat.id);
  };

  const handleDeleteWorkspace = async (e, id) => {
    e.stopPropagation();
    if (!confirm('Delete this workspace and all its chats?')) return;
    await deleteWorkspace(id);
    if (selectedWorkspaceId === id) { onSelectWorkspace(null); onSelectChat(null); }
  };

  const handleNewChat = async (e, wsId) => {
    e.stopPropagation();
    const chat = await createChat(wsId);
    onSelectWorkspace(wsId);
    onSelectChat(chat.id);
    setExpanded(p => ({ ...p, [wsId]: true }));
  };

  const handleDeleteChat = async (e, chatId) => {
    e.stopPropagation();
    await deleteChat(chatId);
    if (selectedChatId === chatId) onSelectChat(null);
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Action buttons */}
      <div style={{
        padding: '10px 10px 8px', borderBottom: `1px solid ${tv('--border')}`,
        display: 'flex', gap: '6px', flexShrink: 0,
      }}>
        <SidebarActionBtn onClick={handleNewGeneralChat} icon={<Plus size={13} />} label="New Chat" />
        <SidebarActionBtn onClick={onStartTempChat} icon={<Zap size={13} />} label="Temp Chat" active={isTempChatActive} accent />
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '6px 6px' }}>
        {/* General Chats section */}
        {generalChats && generalChats.length > 0 && (
          <div style={{ marginBottom: '4px' }}>
            <div
              onClick={() => setGeneralExpanded(p => !p)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 6px',
                cursor: 'pointer', borderRadius: '6px',
              }}
            >
              <span style={{ color: tv('--text-muted'), display: 'flex', flexShrink: 0 }}>
                {generalExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </span>
              <span style={{ fontSize: '11px', fontWeight: '700', color: tv('--text-muted'), textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Chats
              </span>
            </div>
            {generalExpanded && (
              <div style={{ marginLeft: '18px', marginTop: '1px', marginBottom: '4px' }}>
                {generalChats.map(chat => (
                  <ChatRow
                    key={chat.id}
                    chat={chat}
                    isSelected={selectedChatId === chat.id && !selectedWorkspaceId && !isTempChatActive}
                    onSelect={() => { onSelectWorkspace(null); onSelectChat(chat.id); }}
                    onDelete={(e) => handleDeleteChat(e, chat.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Workspaces section */}
        <div style={{
          padding: '4px 6px 6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: '700', color: tv('--text-muted'), textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            <FolderOpen size={13} /> Workspaces
          </span>
          <HoverBtn onClick={handleNewWorkspace} title="New Workspace"><Plus size={15} /></HoverBtn>
        </div>

        {!workspaces || workspaces.length === 0 ? (
          <div style={{ fontSize: '12.5px', color: tv('--text-muted'), textAlign: 'center', padding: '32px 16px', lineHeight: 1.7 }}>
            No workspaces yet.<br />Click <strong style={{ color: tv('--text-secondary') }}>+</strong> to create one.
          </div>
        ) : (
          workspaces.map(ws => (
            <WorkspaceRow
              key={ws.id}
              workspace={ws}
              isSelected={selectedWorkspaceId === ws.id}
              isExpanded={!!expanded[ws.id]}
              selectedChatId={selectedChatId}
              onToggle={() => toggle(ws.id)}
              onSelect={() => { onSelectWorkspace(ws.id); toggle(ws.id); }}
              onDelete={(e) => handleDeleteWorkspace(e, ws.id)}
              onNewChat={(e) => handleNewChat(e, ws.id)}
              onSelectChat={onSelectChat}
              onDeleteChat={handleDeleteChat}
            />
          ))
        )}
      </div>
    </div>
  );
}

function WorkspaceRow({ workspace, isSelected, isExpanded, selectedChatId, onToggle, onSelect, onDelete, onNewChat, onSelectChat, onDeleteChat }) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(workspace.name);
  const inputRef = useRef(null);
  const chats = useLiveQuery(() => getChatsByWorkspace(workspace.id), [workspace.id]);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  const handleRenameStart = (e) => {
    e.stopPropagation();
    setDraft(workspace.name);
    setRenaming(true);
  };

  const handleRenameConfirm = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== workspace.name) {
      await renameWorkspace(workspace.id, trimmed);
    }
    setRenaming(false);
  };

  const handleRenameCancel = () => {
    setDraft(workspace.name);
    setRenaming(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleRenameConfirm();
    if (e.key === 'Escape') handleRenameCancel();
  };

  return (
    <div style={{ marginBottom: '1px' }}>
      <div
        onClick={renaming ? undefined : onSelect}
        onDoubleClick={handleRenameStart}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        style={{
          display: 'flex', alignItems: 'center', gap: '4px',
          padding: '5px 6px', borderRadius: '6px', cursor: renaming ? 'default' : 'pointer',
          backgroundColor: isSelected ? tv('--bg-active') : hovered ? tv('--bg-hover') : 'transparent',
          transition: 'background 0.1s',
        }}
      >
        <span style={{ color: tv('--text-muted'), display: 'flex', flexShrink: 0 }}>
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {renaming ? (
          <input
            ref={inputRef}
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleRenameConfirm}
            onClick={e => e.stopPropagation()}
            style={{
              flex: 1, fontSize: '13px', color: tv('--text-primary'), background: tv('--bg-input'),
              border: `1px solid ${tv('--accent')}`, borderRadius: '4px', padding: '1px 6px',
              outline: 'none', fontFamily: 'inherit', minWidth: 0,
            }}
          />
        ) : (
          <span style={{ fontSize: '13px', color: isSelected ? tv('--text-primary') : tv('--text-secondary'), flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? '500' : '400' }}>
            {workspace.name}
          </span>
        )}
        {hovered && !renaming && (
          <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
            <MiniBtn onClick={onNewChat} title="New Chat" color={tv('--accent')}><Plus size={12} /></MiniBtn>
            <MiniBtn onClick={handleRenameStart} title="Rename" color={tv('--text-secondary')}><Edit3 size={12} /></MiniBtn>
            <MiniBtn onClick={onDelete} title="Delete" color={tv('--error')}><Trash2 size={12} /></MiniBtn>
          </div>
        )}
      </div>

      {isExpanded && chats && (
        <div style={{ marginLeft: '18px', marginTop: '1px', marginBottom: '2px' }}>
          {chats.length === 0 ? (
            <div style={{ fontSize: '11.5px', color: tv('--text-muted'), padding: '4px 8px' }}>No chats yet</div>
          ) : (
            chats.map(chat => <ChatRow key={chat.id} chat={chat} isSelected={selectedChatId === chat.id} onSelect={() => onSelectChat(chat.id)} onDelete={(e) => onDeleteChat(e, chat.id)} />)
          )}
        </div>
      )}
    </div>
  );
}

function ChatRow({ chat, isSelected, onSelect, onDelete }) {
  const [hovered, setHovered] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(chat.title);
  const [ctxMenu, setCtxMenu] = useState(null);       // { x, y } or null
  const inputRef = useRef(null);

  useEffect(() => {
    if (renaming && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [renaming]);

  // Close context menu on any outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctxMenu]);

  const handleRenameStart = (e) => {
    e?.stopPropagation?.();
    setCtxMenu(null);
    setDraft(chat.title);
    setRenaming(true);
  };

  const handleRenameConfirm = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== chat.title) {
      await renameChat(chat.id, trimmed);
    }
    setRenaming(false);
  };

  const handleRenameCancel = () => {
    setDraft(chat.title);
    setRenaming(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleRenameConfirm();
    if (e.key === 'Escape') handleRenameCancel();
  };

  const handleContextMenu = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const showActions = hovered || isSelected;

  return (
    <div
      onClick={renaming ? undefined : onSelect}
      onDoubleClick={handleRenameStart}
      onContextMenu={handleContextMenu}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '6px', padding: '4px 8px',
        borderRadius: '6px', cursor: renaming ? 'default' : 'pointer',
        backgroundColor: isSelected ? tv('--accent-soft') : hovered ? tv('--bg-hover') : 'transparent',
        transition: 'background 0.1s', position: 'relative',
      }}
    >
      <MessageSquare size={11} color={isSelected ? tv('--accent') : tv('--text-muted')} style={{ flexShrink: 0 }} />
      {renaming ? (
        <input
          ref={inputRef}
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          onBlur={handleRenameConfirm}
          onClick={e => e.stopPropagation()}
          style={{
            flex: 1, fontSize: '12.5px', color: tv('--text-primary'), background: tv('--bg-input'),
            border: `1px solid ${tv('--accent')}`, borderRadius: '4px', padding: '1px 6px',
            outline: 'none', fontFamily: 'inherit', minWidth: 0,
          }}
        />
      ) : (
        <span style={{ fontSize: '12.5px', color: isSelected ? tv('--accent') : tv('--text-secondary'), flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {chat.title}
        </span>
      )}
      {showActions && !renaming && (
        <div style={{ display: 'flex', gap: '2px', flexShrink: 0 }}>
          <MiniBtn onClick={handleRenameStart} title="Rename" color={tv('--text-secondary')}><Edit3 size={11} /></MiniBtn>
          <MiniBtn onClick={onDelete} title="Delete" color={tv('--error')}><Trash2 size={11} /></MiniBtn>
        </div>
      )}

      {/* Right-click context menu */}
      {ctxMenu && (
        <ChatContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          onRename={handleRenameStart}
          onDelete={(e) => { setCtxMenu(null); onDelete(e); }}
        />
      )}
    </div>
  );
}

function ChatContextMenu({ x, y, onRename, onDelete }) {
  return (
    <div
      onMouseDown={e => e.stopPropagation()}
      style={{
        position: 'fixed', top: y, left: x, zIndex: 9999,
        minWidth: '140px', padding: '4px',
        backgroundColor: tv('--bg-surface'), border: `1px solid ${tv('--border')}`,
        borderRadius: '8px', boxShadow: `0 8px 24px ${tv('--shadow')}`,
      }}
    >
      <CtxItem icon={<Edit3 size={12} />} label="Rename" onClick={onRename} />
      <CtxItem icon={<Trash2 size={12} />} label="Delete" onClick={onDelete} danger />
    </div>
  );
}

function CtxItem({ icon, label, onClick, danger }) {
  const [h, setH] = useState(false);
  const color = danger ? tv('--error') : tv('--text-primary');
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
        padding: '6px 10px', borderRadius: '6px', border: 'none',
        fontSize: '12px', fontWeight: '500', cursor: 'pointer',
        color: h ? color : tv('--text-secondary'),
        backgroundColor: h ? (danger ? `${tv('--error')}15` : tv('--bg-hover')) : 'transparent',
        transition: 'all 0.1s', textAlign: 'left', fontFamily: 'inherit',
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function HoverBtn({ onClick, title, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? tv('--bg-active') : 'none', border: 'none', color: h ? tv('--text-primary') : tv('--text-secondary'), cursor: 'pointer', padding: '4px', borderRadius: '5px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );
}

function MiniBtn({ onClick, title, color, children }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick} title={title} onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{ background: h ? `${color}22` : 'none', border: 'none', color: h ? color : tv('--text-muted'), cursor: 'pointer', padding: '3px', borderRadius: '4px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      {children}
    </button>
  );
}

function SidebarActionBtn({ onClick, icon, label, active, accent }) {
  const [h, setH] = useState(false);
  const bg = active ? tv('--accent-soft') : h ? tv('--bg-hover') : 'transparent';
  const color = active ? tv('--accent') : accent && h ? tv('--accent') : h ? tv('--text-primary') : tv('--text-secondary');
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
        padding: '6px 8px', borderRadius: '7px', border: `1px solid ${active ? tv('--accent') : tv('--border')}`,
        fontSize: '12px', fontWeight: '600', cursor: 'pointer', fontFamily: 'inherit',
        background: bg, color, transition: 'all 0.15s',
      }}
    >
      {icon} {label}
    </button>
  );
}
