import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  SendHorizonal, Database, Zap, Loader2, Settings, AlertTriangle,
  CheckCircle2, Bookmark, ChevronDown, Sparkles,
  Paperclip, X, FileText, Image, Film, File, Search,
  Pencil, Check, Copy, Trash2, RefreshCw, Globe,
} from 'lucide-react';
import MarkdownRenderer from './MarkdownRenderer.jsx';
import { fetchFreeOpenRouterModels, clearModelCache } from '../../ai/openRouterModels.js';
import { getMessagesByChat, addMessage, updateMessageContent, deleteMessage } from '../../db/messageHelpers.js';
import { compileContext } from '../../ai/contextCompiler.js';
import { streamChat } from '../../ai/llmService.js';
import { previewSnapshot, commitPreviewedItems } from '../../ai/snapshotEngine.js';
import SnapshotDiffModal from './SnapshotDiffModal.jsx';
import { addMemoryItem, suggestTags, promoteToGlobal } from '../../db/memoryHelpers.js';
import { indexNewMessages } from '../../ai/ragService.js';
import { loadEmbeddingModel, getEmbeddingStatus, onEmbeddingStatusChange } from '../../ai/embeddingService.js';
import { autoTitleChat } from '../../ai/autoTitle.js';
import { getCachedResponse, setCachedResponse, invalidateCache } from '../../ai/responseCache.js';
import { needsSummary, generateRollingSummary } from '../../ai/summaryService.js';
import { getAISettings, saveAISettings } from '../../db/settingsHelpers.js';
import { tv } from '../../theme/ThemeContext.jsx';
import {
  processFiles, addAttachment, getAttachmentsByMessage,
  classifyFile, formatFileSize,
} from '../../db/attachmentHelpers.js';
import { extractPdfText } from '../../ai/pdfService.js';

// Static providers (non-OpenRouter stay hardcoded; OpenRouter paid models too)
const STATIC_PROVIDERS = [
  {
    id: 'openrouter', label: 'OpenRouter', defaultModel: 'meta-llama/llama-4-maverick:free',
    models: [], // free models are fetched dynamically
    paidModels: [
      { id: 'meta-llama/llama-4-maverick', name: 'Llama 4 Maverick (Paid)', free: false },
      { id: 'meta-llama/llama-4-scout', name: 'Llama 4 Scout (Paid)', free: false },
      { id: 'deepseek/deepseek-r1-0528', name: 'DeepSeek R1 (Paid)', free: false },
      { id: 'deepseek/deepseek-v3-0324', name: 'DeepSeek V3 (Paid)', free: false },
      { id: 'moonshotai/kimi-k2', name: 'Kimi K2', free: false },
      { id: 'qwen/qwen3-235b-a22b', name: 'Qwen 3 235B (Paid)', free: false },
      { id: 'mistralai/mistral-large-2411', name: 'Mistral Large', free: false },
      { id: 'mistralai/mixtral-8x22b-instruct', name: 'Mixtral 8x22B', free: false },
    ],
  },
  {
    id: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o-mini',
    models: [
      { id: 'gpt-4o', name: 'GPT-4o' },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini' },
      { id: 'gpt-4.1', name: 'GPT-4.1' },
      { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini' },
      { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano' },
      { id: 'o3-mini', name: 'O3 Mini' },
    ],
  },
  {
    id: 'anthropic', label: 'Anthropic', defaultModel: 'claude-sonnet-4-20250514',
    models: [
      { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4' },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku' },
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet' },
    ],
  },
  {
    id: 'gemini', label: 'Gemini', defaultModel: 'gemini-2.0-flash',
    models: [
      { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Lite' },
      { id: 'gemini-1.5-pro', name: 'Gemini 1.5 Pro' },
      { id: 'gemini-1.5-flash', name: 'Gemini 1.5 Flash' },
    ],
  },
];

export default function ChatArea({ currentChatId, currentWorkspaceId, onOpenSettings }) {
  const [input, setInput] = useState('');
  const [sendHovered, setSendHovered] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [snapshotStatus, setSnapshotStatus] = useState(null);
  const [snapshotPreview, setSnapshotPreview] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);
  const abortRef = useRef(null);
  const streamingRef = useRef({ id: null, text: '' });
  const fileInputRef = useRef(null);

  const [embeddingStatus, setEmbeddingStatus] = useState(getEmbeddingStatus());
  const [streamingText, setStreamingText] = useState('');
  const [pendingFiles, setPendingFiles] = useState([]); // files queued to send

  // Snapshot nudge toast (smart detection of decisions in AI responses)
  const [snapshotNudge, setSnapshotNudge] = useState(false);

  // Correction capture: auto-suggest memory item when user edits + resends
  const [correctionSuggestion, setCorrectionSuggestion] = useState(null);

  // Post-snapshot global promote prompt
  const [globalPromoteItems, setGlobalPromoteItems] = useState(null); // array of {id, content, category, selected}
  const [promotingGlobal, setPromotingGlobal] = useState(false);

  // Model picker state
  const [showModelPicker, setShowModelPicker] = useState(false);
  const [currentProvider, setCurrentProvider] = useState('openrouter');
  const [currentModel, setCurrentModel] = useState('');
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerTab, setPickerTab] = useState('openrouter');
  const [pickerPos, setPickerPos] = useState({ bottom: 0, left: 0 });
  const modelPickerRef = useRef(null);
  const modelBtnRef = useRef(null);
  const pickerDropdownRef = useRef(null);

  // Dynamic OpenRouter free models
  const [orFreeModels, setOrFreeModels] = useState([]);
  const [orModelsLoading, setOrModelsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setOrModelsLoading(true);
    fetchFreeOpenRouterModels().then(models => {
      if (!cancelled) {
        setOrFreeModels(models);
        setOrModelsLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, []);

  const handleRefreshModels = useCallback(() => {
    setOrModelsLoading(true);
    clearModelCache();
    fetchFreeOpenRouterModels().then(models => {
      setOrFreeModels(models);
      setOrModelsLoading(false);
    });
  }, []);

  // Build dynamic providers list: merge fetched free models into OpenRouter
  const providers = useMemo(() => {
    return STATIC_PROVIDERS.map(p => {
      if (p.id !== 'openrouter') return p;
      return { ...p, models: [...orFreeModels, ...p.paidModels] };
    });
  }, [orFreeModels]);

  // Resolve a model ID → display name using the (possibly dynamic) providers list
  const shortModelName = useCallback((modelId) => {
    if (!modelId) return 'Select model';
    for (const p of providers) {
      const m = p.models.find(mod => mod.id === modelId);
      if (m) return m.name;
    }
    const parts = modelId.split('/');
    return parts[parts.length - 1].replace(/:free$/, '');
  }, [providers]);

  useEffect(() => {
    getAISettings().then(s => {
      setCurrentProvider(s.provider || 'openrouter');
      setCurrentModel(s.model || 'meta-llama/llama-4-maverick:free');
      setPickerTab(s.provider || 'openrouter');
    });
  }, []);

  useEffect(() => {
    const handler = (e) => {
      const inBtn = modelBtnRef.current && modelBtnRef.current.contains(e.target);
      const inDrop = pickerDropdownRef.current && pickerDropdownRef.current.contains(e.target);
      if (!inBtn && !inDrop) {
        setShowModelPicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const filteredPickerModels = useMemo(() => {
    const prov = providers.find(p => p.id === pickerTab);
    if (!prov) return [];
    if (!pickerSearch.trim()) return prov.models;
    const q = pickerSearch.toLowerCase();
    return prov.models.filter(m =>
      m.name.toLowerCase().includes(q) || m.id.toLowerCase().includes(q)
    );
  }, [pickerTab, pickerSearch, providers]);

  const handleModelSelect = async (providerId, modelId) => {
    setCurrentProvider(providerId);
    setCurrentModel(modelId);
    setShowModelPicker(false);
    const settings = await getAISettings();
    await saveAISettings({ ...settings, provider: providerId, model: modelId });
  };

  const dbMessages = useLiveQuery(
    () => currentChatId ? getMessagesByChat(currentChatId) : [],
    [currentChatId],
    []
  );

  const messages = useMemo(() => {
    if (!streamingRef.current.id || !streamingText) return dbMessages;
    return dbMessages?.map(m =>
      m.id === streamingRef.current.id ? { ...m, content: streamingText } : m
    ) ?? [];
  }, [dbMessages, streamingText]);

  useEffect(() => {
    if (!currentWorkspaceId) return;
    loadEmbeddingModel().catch(() => {});
    const unsub = onEmbeddingStatusChange(setEmbeddingStatus);
    return unsub;
  }, [currentWorkspaceId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
  }, [input]);

  const handleSend = useCallback(async () => {
    if ((!input.trim() && pendingFiles.length === 0) || !currentChatId || isStreaming) return;
    const userText = input.trim();
    const filesToSend = [...pendingFiles];
    setInput('');
    setPendingFiles([]);
    setErrorMsg('');

    // Build user message text, appending file context
    let fullUserText = userText;
    const fileContextParts = [];
    const storedAttachments = [];

    // Process files: extract text from PDFs, prepare image data
    for (const pf of filesToSend) {
      if (pf.type === 'pdf') {
        try {
          const pdfText = await extractPdfText(pf.file);
          pf.extractedText = pdfText;
          fileContextParts.push(`[PDF: ${pf.file.name}]\n${pdfText}`);
        } catch (err) {
          console.warn('PDF extraction failed:', err);
          fileContextParts.push(`[PDF: ${pf.file.name}] (text extraction failed)`);
        }
      } else if (pf.type === 'document') {
        const text = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsText(pf.file);
        });
        pf.extractedText = text;
        fileContextParts.push(`[File: ${pf.file.name}]\n${text}`);
      } else if (pf.type === 'image') {
        fileContextParts.push(`[Image: ${pf.file.name}]`);
      } else if (pf.type === 'video') {
        fileContextParts.push(`[Video: ${pf.file.name}]`);
      } else {
        fileContextParts.push(`[File: ${pf.file.name}]`);
      }
    }

    // If there are file context parts, append them to the user message
    if (fileContextParts.length > 0) {
      const fileBlock = fileContextParts.join('\n\n');
      fullUserText = fullUserText
        ? `${fullUserText}\n\n---\nAttached files:\n${fileBlock}`
        : `Attached files:\n${fileBlock}`;
    }

    const userMsg = await addMessage(currentChatId, 'user', fullUserText);

    // Store attachments in DB
    for (const pf of filesToSend) {
      try {
        const data = pf.preview || await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = reject;
          reader.readAsDataURL(pf.file);
        });
        const att = await addAttachment({
          messageId: userMsg.id,
          chatId: currentChatId,
          fileName: pf.file.name,
          mimeType: pf.file.type,
          size: pf.file.size,
          data,
          extractedText: pf.extractedText || null,
        });
        storedAttachments.push(att);
      } catch (err) {
        console.warn('Failed to store attachment:', err);
      }
    }

    const assistantMsg = await addMessage(currentChatId, 'assistant', '...');
    setIsStreaming(true);

    const cached = await getCachedResponse(currentWorkspaceId, fullUserText);
    if (cached) {
      const speed = 15;
      let text = '';
      for (let i = 0; i < cached.length; i++) {
        text += cached[i];
        if (i % 5 === 0) await updateMessageContent(assistantMsg.id, text);
        await new Promise(r => setTimeout(r, speed));
      }
      await updateMessageContent(assistantMsg.id, cached);
      setIsStreaming(false);
      return;
    }

    try {
      const { messages: compiled, metadata: contextMeta } = await compileContext(currentChatId, currentWorkspaceId);
      if (contextMeta) {
        console.log(`Context: ${contextMeta.pinnedCount} pinned, ${contextMeta.ragResultCount} RAG, ~${contextMeta.tokenEstimate} tokens`);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      let latestText = '';
      let writeTimer = null;
      streamingRef.current = { id: assistantMsg.id, text: '' };
      const DB_WRITE_INTERVAL = 800;

      const flushToDb = () => {
        if (latestText) updateMessageContent(assistantMsg.id, latestText);
        writeTimer = null;
      };

      await streamChat(compiled, (accumulated) => {
        latestText = accumulated;
        streamingRef.current.text = accumulated;
        setStreamingText(accumulated);
        if (!writeTimer) writeTimer = setTimeout(flushToDb, DB_WRITE_INTERVAL);
      }, controller.signal);

      if (writeTimer) clearTimeout(writeTimer);
      streamingRef.current = { id: null, text: '' };
      setStreamingText('');
      if (latestText) {
        await updateMessageContent(assistantMsg.id, latestText);
        await setCachedResponse(currentWorkspaceId, fullUserText, latestText);

        // ── Smart snapshot nudge: detect decision-like language in AI response ──
        const decisionPatterns = [
          /\b(?:I recommend|I suggest|let'?s go with|the (?:best|right) (?:approach|choice|option)|we should use|final decision|decided to|going (?:forward )?with)\b/i,
          /\b(?:architecture|stack|framework|database|deployment) (?:will be|is|should be|we'?ll use)\b/i,
          /\b(?:trade-?off|pros? and cons?|weighing|comparing)\b/i,
        ];
        const hasDecision = decisionPatterns.some(p => p.test(latestText));
        if (hasDecision && !snapshotNudge) {
          setSnapshotNudge(true);
          setTimeout(() => setSnapshotNudge(false), 8000); // auto-dismiss after 8s
        }
      }

      const currentMessages = await getMessagesByChat(currentChatId);
      if (currentMessages.length <= 2) {
        autoTitleChat(currentChatId, fullUserText, latestText).catch(() => {});
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // cancelled
      } else if (err.message === 'NO_API_KEY') {
        await updateMessageContent(assistantMsg.id,
          'No API key configured. Click Settings to add your key.');
        setErrorMsg('Configure your API key in Settings to chat with AI.');
      } else {
        await updateMessageContent(assistantMsg.id,
          `Error: ${err.message}\n\nCheck your API key and network connection.`);
        setErrorMsg(err.message);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;

      if (currentWorkspaceId) {
        const doIndex = () => indexNewMessages(currentWorkspaceId).catch(() => {});
        if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(doIndex);
        else setTimeout(doIndex, 500);
      }

      if (currentChatId) {
        setTimeout(async () => {
          try {
            if (await needsSummary(currentChatId)) await generateRollingSummary(currentChatId);
          } catch (err) { console.warn('Rolling summary skipped:', err.message); }
        }, 2000);
      }
    }
  }, [input, pendingFiles, currentChatId, currentWorkspaceId, isStreaming]);

  const handleStop = () => abortRef.current?.abort();

  // Edit a user message and re-run the LLM
  const handleEditResend = useCallback(async (messageId, newContent, nextAssistantId) => {
    if (!currentChatId || isStreaming) return;
    setErrorMsg('');

    // ── Correction capture: compare original vs edited text ──
    const originalMsg = messages.find(m => m.id === messageId);
    const originalContent = originalMsg?.content || '';

    // 1. Update the user message text
    await updateMessageContent(messageId, newContent);

    // 2. Delete the old AI response if it exists
    if (nextAssistantId) {
      await deleteMessage(nextAssistantId);
    }

    // 3. Create a fresh assistant message and stream
    const assistantMsg = await addMessage(currentChatId, 'assistant', '...');
    setIsStreaming(true);

    try {
      const { messages: compiled, metadata: contextMeta } = await compileContext(currentChatId, currentWorkspaceId);
      if (contextMeta) {
        console.log(`Context (edit-resend): ${contextMeta.pinnedCount} pinned, ${contextMeta.ragResultCount} RAG, ~${contextMeta.tokenEstimate} tokens`);
      }

      const controller = new AbortController();
      abortRef.current = controller;

      let latestText = '';
      let writeTimer = null;
      streamingRef.current = { id: assistantMsg.id, text: '' };
      const DB_WRITE_INTERVAL = 800;

      const flushToDb = () => {
        if (latestText) updateMessageContent(assistantMsg.id, latestText);
        writeTimer = null;
      };

      await streamChat(compiled, (accumulated) => {
        latestText = accumulated;
        streamingRef.current.text = accumulated;
        setStreamingText(accumulated);
        if (!writeTimer) writeTimer = setTimeout(flushToDb, DB_WRITE_INTERVAL);
      }, controller.signal);

      if (writeTimer) clearTimeout(writeTimer);
      streamingRef.current = { id: null, text: '' };
      setStreamingText('');
      if (latestText) {
        await updateMessageContent(assistantMsg.id, latestText);
        await setCachedResponse(currentWorkspaceId, newContent, latestText);
      }

      // ── Correction capture: if user changed factual content, suggest a memory item ──
      if (originalContent && newContent && originalContent !== newContent) {
        const origWords = new Set(originalContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        const newWords = new Set(newContent.toLowerCase().split(/\s+/).filter(w => w.length > 3));
        // Count how many significant words changed
        const removed = [...origWords].filter(w => !newWords.has(w));
        const added = [...newWords].filter(w => !origWords.has(w));
        // If substantial change (not just typo fix), suggest a correction memory
        if (removed.length + added.length >= 3) {
          setCorrectionSuggestion({
            original: originalContent,
            corrected: newContent,
            timestamp: Date.now(),
          });
          // Auto-dismiss after 12s
          setTimeout(() => setCorrectionSuggestion(prev =>
            prev?.timestamp === Date.now() ? null : prev
          ), 12000);
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // cancelled
      } else if (err.message === 'NO_API_KEY') {
        await updateMessageContent(assistantMsg.id,
          'No API key configured. Click Settings to add your key.');
        setErrorMsg('Configure your API key in Settings to chat with AI.');
      } else {
        await updateMessageContent(assistantMsg.id,
          `Error: ${err.message}\n\nCheck your API key and network connection.`);
        setErrorMsg(err.message);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;

      if (currentWorkspaceId) {
        const doIndex = () => indexNewMessages(currentWorkspaceId).catch(() => {});
        if (typeof requestIdleCallback !== 'undefined') requestIdleCallback(doIndex);
        else setTimeout(doIndex, 500);
      }

      if (currentChatId) {
        setTimeout(async () => {
          try {
            if (await needsSummary(currentChatId)) await generateRollingSummary(currentChatId);
          } catch (err) { console.warn('Rolling summary skipped:', err.message); }
        }, 2000);
      }
    }
  }, [currentChatId, currentWorkspaceId, isStreaming]);

  const handleSnapshot = useCallback(async () => {
    if (!currentWorkspaceId || !currentChatId || snapshotStatus === 'loading') return;
    setSnapshotStatus('loading');
    const result = await previewSnapshot(currentWorkspaceId, currentChatId);
    if (result.success) {
      setSnapshotStatus(null);
      setSnapshotPreview(result);
    } else {
      setSnapshotStatus('error');
      if (result.error === 'NO_API_KEY') setErrorMsg('Configure your API key in Settings to use snapshots.');
      else setErrorMsg(`Snapshot failed: ${result.error}`);
      setTimeout(() => setSnapshotStatus(null), 4000);
    }
  }, [currentWorkspaceId, currentChatId, snapshotStatus]);

  const handleDiffCommit = useCallback(async (acceptedItems) => {
    if (!currentWorkspaceId || !currentChatId || !snapshotPreview) return;
    setSnapshotPreview(null);
    setSnapshotStatus('loading');

    const result = await commitPreviewedItems(
      currentWorkspaceId, currentChatId,
      acceptedItems, snapshotPreview.messageCount, snapshotPreview.stateFile
    );

    if (result.success) {
      setSnapshotStatus('success');
      let msg = 'Snapshot committed!\n\n';
      if (result.newItems?.length > 0) {
        const byCategory = {};
        for (const item of result.newItems) {
          if (!byCategory[item.category]) byCategory[item.category] = [];
          byCategory[item.category].push(item.content);
        }
        const categoryLabels = { decision: 'Decisions', fact: 'Facts', preference: 'Preferences', rejected: 'Rejected', code_style: 'Code Style' };
        for (const [cat, items] of Object.entries(byCategory)) {
          msg += `**${categoryLabels[cat] || cat}:**\n`;
          items.forEach(i => { msg += `- ${i}\n`; });
          msg += '\n';
        }
        if (result.skipped > 0) msg += `_${result.skipped} duplicate item${result.skipped !== 1 ? 's' : ''} skipped._\n`;
        msg += '\nItems are now in your Memory Panel.';
      } else {
        msg = 'Snapshot committed! No new information was detected.';
      }
      await addMessage(currentChatId, 'assistant', msg);
      // Invalidate response cache since memories changed
      invalidateCache(currentWorkspaceId).catch(() => {});

      // Offer to promote workspace-scoped items to global
      const promotable = (result.newItems || []).filter(
        item => item.scope !== 'global' && item.category !== 'rejected' && item.id
      );
      if (promotable.length > 0) {
        setGlobalPromoteItems(promotable.map(item => ({
          id: item.id,
          content: item.content,
          category: item.category,
          selected: false,
        })));
      }

      setTimeout(() => setSnapshotStatus(null), 3000);
    } else {
      setSnapshotStatus('error');
      setErrorMsg(`Snapshot commit failed: ${result.error}`);
      setTimeout(() => setSnapshotStatus(null), 4000);
    }
  }, [currentWorkspaceId, currentChatId, snapshotPreview]);

  const handleDiffCancel = useCallback(() => setSnapshotPreview(null), []);
  const handleKeyDown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); } };

  // ─── File upload handlers ───
  const handleFileSelect = useCallback(async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;

    const newPending = files.map(file => ({
      id: Math.random().toString(36).slice(2),
      file,
      type: classifyFile(file.type),
      preview: null,
    }));

    // Generate previews for images
    for (const pf of newPending) {
      if (pf.type === 'image') {
        pf.preview = await new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.readAsDataURL(pf.file);
        });
      }
    }

    setPendingFiles(prev => [...prev, ...newPending]);
    // Reset file input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const removePendingFile = useCallback((id) => {
    setPendingFiles(prev => prev.filter(f => f.id !== id));
  }, []);

  const handlePaste = useCallback((e) => {
    const items = Array.from(e.clipboardData?.items || []);
    const files = items
      .filter(item => item.kind === 'file')
      .map(item => item.getAsFile())
      .filter(Boolean);

    if (files.length > 0) {
      e.preventDefault();
      const newPending = files.map(file => ({
        id: Math.random().toString(36).slice(2),
        file,
        type: classifyFile(file.type),
        preview: null,
      }));

      // Generate previews for pasted images
      Promise.all(newPending.map(async (pf) => {
        if (pf.type === 'image') {
          pf.preview = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(pf.file);
          });
        }
      })).then(() => {
        setPendingFiles(prev => [...prev, ...newPending]);
      });
    }
  }, []);

  // ─── Empty state ───
  if (!currentChatId) {
    return (
      <div style={{
        height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        backgroundColor: tv('--bg-primary'),
      }}>
        <div style={{ textAlign: 'center', maxWidth: '400px', padding: '0 24px' }}>
          <div style={{
            width: '64px', height: '64px', borderRadius: '20px',
            background: `linear-gradient(135deg, ${tv('--bg-tertiary')}, ${tv('--bg-secondary')})`,
            border: `1px solid ${tv('--border')}`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 24px',
          }}>
            <Sparkles size={28} color={tv('--accent')} />
          </div>
          <h2 style={{ margin: '0 0 12px', fontSize: '20px', fontWeight: '600', color: tv('--text-primary'), letterSpacing: '-0.02em' }}>
            Create or select a chat
          </h2>
          <p style={{ margin: 0, fontSize: '14px', color: tv('--text-muted'), lineHeight: 1.75 }}>
            Conversations live inside workspaces. Everything you discuss feeds the workspace memory loop.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: tv('--bg-primary') }}>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '20px 0' }}>
        {messages?.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', textAlign: 'center', padding: '0 24px' }}>
            <div style={{
              width: '52px', height: '52px', borderRadius: '16px',
              background: `linear-gradient(135deg, ${tv('--accent-soft')}, ${tv('--purple-soft')})`,
              border: `1px solid ${tv('--border')}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px',
            }}>
              <Zap size={24} color={tv('--accent')} />
            </div>
            <h3 style={{ margin: '0 0 8px', fontSize: '17px', fontWeight: '600', color: tv('--text-primary') }}>
              Start a conversation
            </h3>
            <p style={{ margin: 0, color: tv('--text-muted'), fontSize: '13.5px', lineHeight: 1.7, maxWidth: '340px' }}>
              Type your message below. Use <strong style={{ color: tv('--purple') }}>Snapshot</strong> to save important decisions to memory.
            </p>
            <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
              {embeddingStatus !== 'idle' && (
                <StatusPill
                  color={embeddingStatus === 'ready' ? tv('--success') : embeddingStatus === 'loading' ? tv('--warning') : tv('--error')}
                  text={embeddingStatus === 'ready' ? 'Memory active' : embeddingStatus === 'loading' ? 'Loading memory…' : 'Memory unavailable'}
                  pulse={embeddingStatus === 'loading'}
                />
              )}
              <StatusPill color={tv('--accent')} text={shortModelName(currentModel)} />
            </div>
          </div>
        ) : (
          <div style={{ maxWidth: '800px', margin: '0 auto', padding: '0 24px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {messages?.map((msg, idx) => (
              <MessageBubble key={msg.id} message={msg} messages={messages} msgIndex={idx} workspaceId={currentWorkspaceId} chatId={currentChatId} onEditResend={handleEditResend} />
            ))}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* ─── Input Area ─── */}
      <div style={{ padding: '0 20px 20px', flexShrink: 0 }}>
        <div style={{ maxWidth: '800px', margin: '0 auto' }}>

          {/* ── Snapshot Nudge Toast ── */}
          {snapshotNudge && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px 12px', marginBottom: '10px', borderRadius: '10px',
              backgroundColor: '#f59e0b15', border: '1px solid #f59e0b30',
              fontSize: '12px', color: '#f59e0b', animation: 'fadeIn 0.3s ease',
            }}>
              <Database size={13} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>Decision detected — consider committing a <strong>Snapshot</strong> to preserve it.</span>
              <button
                onClick={() => { setSnapshotNudge(false); handleSnapshot(); }}
                style={{
                  background: 'none', border: '1px solid #f59e0b40', color: '#f59e0b',
                  padding: '3px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: '600',
                }}
              >
                Snapshot
              </button>
              <button
                onClick={() => setSnapshotNudge(false)}
                style={{ background: 'none', border: 'none', color: '#f59e0b60', cursor: 'pointer', padding: '2px' }}
              >
                <X size={12} />
              </button>
            </div>
          )}

          {/* ── Correction Capture Suggestion ── */}
          {correctionSuggestion && (
            <div style={{
              display: 'flex', alignItems: 'flex-start', gap: '8px',
              padding: '10px 12px', marginBottom: '10px', borderRadius: '10px',
              backgroundColor: '#3b82f615', border: '1px solid #3b82f630',
              fontSize: '12px', color: '#93c5fd',
            }}>
              <Bookmark size={13} style={{ flexShrink: 0, marginTop: 2 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: '600', marginBottom: '4px', color: '#60a5fa' }}>Correction detected</div>
                <div style={{ color: '#8b949e', lineHeight: 1.5 }}>
                  You edited your message significantly. Save this as a memory item so the AI remembers the correction?
                </div>
                <div style={{ marginTop: '6px', padding: '4px 8px', backgroundColor: '#0d111766', borderRadius: '4px', fontSize: '11px', color: '#c9d1d9' }}>
                  "{correctionSuggestion.corrected.slice(0, 120)}{correctionSuggestion.corrected.length > 120 ? '…' : ''}"
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <button
                  onClick={async () => {
                    try {
                      await addMemoryItem({
                        workspaceId: currentWorkspaceId,
                        chatId: currentChatId,
                        content: `Correction: User clarified — "${correctionSuggestion.corrected.slice(0, 300)}"`,
                        category: 'fact',
                        tags: suggestTags(correctionSuggestion.corrected),
                        source: 'ai-suggested',
                        scope: 'workspace',
                      });
                      setCorrectionSuggestion(null);
                    } catch (_) {}
                  }}
                  style={{
                    background: 'none', border: '1px solid #3b82f640', color: '#60a5fa',
                    padding: '3px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: '600',
                  }}
                >
                  Save
                </button>
                <button
                  onClick={() => setCorrectionSuggestion(null)}
                  style={{ background: 'none', border: 'none', color: '#3b82f660', cursor: 'pointer', padding: '2px', fontSize: '11px' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* ── Post-Snapshot Global Promote Prompt ── */}
          {globalPromoteItems && globalPromoteItems.length > 0 && (
            <div style={{
              padding: '10px 12px', marginBottom: '10px', borderRadius: '10px',
              backgroundColor: '#8b5cf615', border: '1px solid #8b5cf630',
              fontSize: '12px', color: '#c4b5fd',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
                <Globe size={13} style={{ flexShrink: 0, color: '#a78bfa' }} />
                <span style={{ fontWeight: '600', color: '#a78bfa', flex: 1 }}>Make any of these global?</span>
                <button
                  onClick={() => setGlobalPromoteItems(null)}
                  style={{ background: 'none', border: 'none', color: '#8b5cf660', cursor: 'pointer', padding: '2px' }}
                >
                  <X size={12} />
                </button>
              </div>
              <div style={{ color: '#8b949e', marginBottom: '8px', lineHeight: 1.4 }}>
                Global items apply across all workspaces. Select any to promote:
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '8px' }}>
                {globalPromoteItems.map((item, idx) => (
                  <label
                    key={item.id}
                    style={{
                      display: 'flex', alignItems: 'flex-start', gap: '6px', cursor: 'pointer',
                      padding: '4px 8px', borderRadius: '4px', backgroundColor: '#0d111766',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={item.selected}
                      onChange={() => {
                        setGlobalPromoteItems(prev => prev.map((it, i) =>
                          i === idx ? { ...it, selected: !it.selected } : it
                        ));
                      }}
                      style={{ marginTop: '2px', accentColor: '#a78bfa' }}
                    />
                    <span style={{ color: '#c9d1d9', fontSize: '11px', lineHeight: 1.5 }}>
                      <span style={{
                        color: '#a78bfa', fontSize: '10px', fontWeight: 600,
                        textTransform: 'uppercase', marginRight: '6px',
                      }}>
                        {item.category}
                      </span>
                      {item.content.slice(0, 140)}{item.content.length > 140 ? '…' : ''}
                    </span>
                  </label>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                <button
                  onClick={() => setGlobalPromoteItems(null)}
                  style={{ background: 'none', border: 'none', color: '#8b5cf660', cursor: 'pointer', fontSize: '11px' }}
                >
                  Skip
                </button>
                <button
                  disabled={promotingGlobal || !globalPromoteItems.some(i => i.selected)}
                  onClick={async () => {
                    setPromotingGlobal(true);
                    try {
                      const selected = globalPromoteItems.filter(i => i.selected);
                      await Promise.all(selected.map(i => promoteToGlobal(i.id)));
                      setGlobalPromoteItems(null);
                    } catch (err) {
                      setErrorMsg(`Promote failed: ${err.message}`);
                    } finally {
                      setPromotingGlobal(false);
                    }
                  }}
                  style={{
                    background: 'none', border: '1px solid #8b5cf640', color: '#a78bfa',
                    padding: '3px 12px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer',
                    fontWeight: '600', opacity: (!globalPromoteItems.some(i => i.selected) || promotingGlobal) ? 0.4 : 1,
                  }}
                >
                  {promotingGlobal ? 'Promoting…' : `Promote${globalPromoteItems.filter(i => i.selected).length > 0 ? ` (${globalPromoteItems.filter(i => i.selected).length})` : ''}`}
                </button>
              </div>
            </div>
          )}

          {errorMsg && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '8px',
              padding: '8px 12px', marginBottom: '10px', borderRadius: '10px',
              backgroundColor: tv('--warning-soft'), border: `1px solid ${tv('--warning')}30`,
              fontSize: '12px', color: tv('--warning'),
            }}>
              <AlertTriangle size={13} style={{ flexShrink: 0 }} />
              <span style={{ flex: 1 }}>{errorMsg}</span>
              {errorMsg.includes('API key') && onOpenSettings && (
                <button onClick={onOpenSettings} style={{
                  background: 'none', border: `1px solid ${tv('--warning')}40`, color: tv('--warning'),
                  padding: '3px 10px', borderRadius: '6px', fontSize: '11px', cursor: 'pointer', fontWeight: '600',
                }}>
                  Open Settings
                </button>
              )}
            </div>
          )}

          <div style={{
            backgroundColor: tv('--bg-secondary'),
            border: `1px solid ${tv('--border')}`,
            borderRadius: '16px', overflow: 'hidden',
            boxShadow: `0 2px 12px ${tv('--shadow')}`,
          }}>
            {/* Pending file previews */}
            {pendingFiles.length > 0 && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: '8px',
                padding: '10px 12px 4px',
              }}>
                {pendingFiles.map(pf => (
                  <PendingFileChip key={pf.id} file={pf} onRemove={() => removePendingFile(pf.id)} />
                ))}
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,video/*,.pdf,.txt,.csv,.json,.xml,.yaml,.yml,.md,.js,.ts,.jsx,.tsx,.py,.java,.html,.css"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
            />

            <textarea
              ref={textareaRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={isStreaming ? "AI is responding…" : "Ask anything…"}
              disabled={isStreaming}
              style={{
                width: '100%', background: 'none', border: 'none', outline: 'none',
                padding: '14px 16px 8px', fontSize: '14px', color: tv('--text-primary'),
                resize: 'none', lineHeight: 1.6, boxSizing: 'border-box',
                minHeight: '48px', maxHeight: '200px', overflowY: 'auto',
                fontFamily: 'inherit', opacity: isStreaming ? 0.5 : 1,
              }}
            />

            {/* Bottom toolbar */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '4px 8px 8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} ref={modelPickerRef}>
                <button
                  ref={modelBtnRef}
                  onClick={() => {
                    setShowModelPicker(v => {
                      if (!v) {
                        setPickerSearch(''); setPickerTab(currentProvider);
                        // Calculate position from button rect
                        if (modelBtnRef.current) {
                          const r = modelBtnRef.current.getBoundingClientRect();
                          setPickerPos({ bottom: window.innerHeight - r.top + 6, left: r.left });
                        }
                      }
                      return !v;
                    });
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '5px',
                    padding: '5px 10px', borderRadius: '8px',
                    border: `1px solid ${tv('--border')}`,
                    backgroundColor: showModelPicker ? tv('--bg-tertiary') : tv('--bg-primary'),
                    color: tv('--text-secondary'), fontSize: '12px', fontWeight: '500',
                    cursor: 'pointer', transition: 'all 0.15s',
                  }}
                >
                  <Sparkles size={12} color={tv('--accent')} />
                  <span>{shortModelName(currentModel)}</span>
                  <ChevronDown size={11} style={{ transform: showModelPicker ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
                </button>

                {showModelPicker && createPortal(
                  <div ref={pickerDropdownRef} style={{
                    position: 'fixed', bottom: pickerPos.bottom, left: pickerPos.left,
                    width: '340px', maxHeight: 'min(440px, 70vh)',
                    backgroundColor: tv('--bg-surface'), border: `1px solid ${tv('--border')}`,
                    borderRadius: '14px', boxShadow: `0 12px 40px ${tv('--shadow')}`,
                    zIndex: 9999, display: 'flex', flexDirection: 'column',
                    animation: 'fadeIn 0.15s ease', overflow: 'hidden',
                  }}>
                    {/* Search */}
                    <div style={{ padding: '10px 10px 6px' }}>
                      <div style={{ position: 'relative' }}>
                        <Search size={13} style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: tv('--text-muted'), pointerEvents: 'none' }} />
                        <input
                          type="text"
                          value={pickerSearch}
                          onChange={e => setPickerSearch(e.target.value)}
                          placeholder="Search models…"
                          autoFocus
                          style={{
                            width: '100%', boxSizing: 'border-box',
                            padding: '8px 12px 8px 32px', borderRadius: '8px',
                            border: `1px solid ${tv('--border')}`,
                            backgroundColor: tv('--bg-primary'),
                            color: tv('--text-primary'), fontSize: '12px',
                            outline: 'none', fontFamily: 'inherit',
                          }}
                        />
                      </div>
                    </div>

                    {/* Provider tabs */}
                    <div style={{
                      display: 'flex', gap: '2px', padding: '2px 10px 8px',
                      borderBottom: `1px solid ${tv('--border')}`,
                      overflowX: 'auto',
                    }}>
                      {providers.map(p => (
                        <button
                          key={p.id}
                          onClick={() => { setPickerTab(p.id); setPickerSearch(''); }}
                          style={{
                            padding: '5px 10px', borderRadius: '7px', border: 'none',
                            fontSize: '11px', fontWeight: pickerTab === p.id ? '600' : '400',
                            backgroundColor: pickerTab === p.id ? tv('--accent-soft') : 'transparent',
                            color: pickerTab === p.id ? tv('--accent') : tv('--text-secondary'),
                            cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.12s',
                          }}
                        >
                          {p.label}
                        </button>
                      ))}
                    </div>

                    {/* Model list */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '6px', maxHeight: '300px' }}>
                      {pickerTab === 'openrouter' && orModelsLoading && (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '12px', fontSize: '12px', color: tv('--text-muted') }}>
                          <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} />
                          Loading models…
                        </div>
                      )}
                      {filteredPickerModels.length === 0 && !(pickerTab === 'openrouter' && orModelsLoading) && (
                        <div style={{ padding: '16px', textAlign: 'center', fontSize: '12px', color: tv('--text-muted') }}>
                          No models found
                        </div>
                      )}
                      {filteredPickerModels.map(m => (
                        <ModelOption
                          key={m.id}
                          model={m}
                          isActive={currentProvider === pickerTab && currentModel === m.id}
                          onClick={() => handleModelSelect(pickerTab, m.id)}
                        />
                      ))}
                    </div>

                    {/* Footer hint */}
                    {pickerTab === 'openrouter' && (
                      <div style={{
                        padding: '6px 12px', borderTop: `1px solid ${tv('--border')}`,
                        fontSize: '10px', color: tv('--text-muted'),
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}>
                        <span>
                          {orFreeModels.length} free model{orFreeModels.length !== 1 ? 's' : ''} · No API key needed
                        </span>
                        <button
                          onClick={handleRefreshModels}
                          disabled={orModelsLoading}
                          title="Refresh model list from OpenRouter"
                          style={{
                            background: 'none', border: 'none', cursor: orModelsLoading ? 'default' : 'pointer',
                            color: tv('--text-muted'), padding: '2px', display: 'flex', alignItems: 'center',
                            opacity: orModelsLoading ? 0.4 : 0.7, transition: 'opacity 0.15s',
                          }}
                        >
                          <RefreshCw size={12} style={{ animation: orModelsLoading ? 'spin 1s linear infinite' : 'none' }} />
                        </button>
                      </div>
                    )}
                  </div>,
                  document.body
                )}

                <SnapshotButton onClick={handleSnapshot} status={snapshotStatus} />

                <AttachButton onClick={() => fileInputRef.current?.click()} />

                {embeddingStatus !== 'idle' && messages?.length > 0 && (
                  <StatusDot status={embeddingStatus} />
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                {isStreaming && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Loader2 size={12} color={tv('--accent')} style={{ animation: 'spin 1s linear infinite' }} />
                    <span style={{ fontSize: '11px', color: tv('--accent') }}>streaming…</span>
                  </div>
                )}
                {isStreaming ? (
                  <StopButton onClick={handleStop} />
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!input.trim() && pendingFiles.length === 0}
                    onMouseEnter={() => setSendHovered(true)}
                    onMouseLeave={() => setSendHovered(false)}
                    style={{
                      width: '32px', height: '32px', borderRadius: '10px', border: 'none',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      cursor: (input.trim() || pendingFiles.length > 0) ? 'pointer' : 'default',
                      backgroundColor: (input.trim() || pendingFiles.length > 0) ? (sendHovered ? tv('--accent-hover') : tv('--accent')) : tv('--bg-tertiary'),
                      color: (input.trim() || pendingFiles.length > 0) ? '#fff' : tv('--text-muted'),
                      transition: 'background-color 0.15s',
                    }}
                  >
                    <SendHorizonal size={15} />
                  </button>
                )}
              </div>
            </div>
          </div>

          <div style={{ marginTop: '8px', textAlign: 'center', fontSize: '11px', color: tv('--text-muted') }}>
            AI responses are generated with your API key. Verify critical decisions.
          </div>
        </div>
      </div>

      {snapshotPreview && (
        <SnapshotDiffModal preview={snapshotPreview} onCommit={handleDiffCommit} onCancel={handleDiffCancel} />
      )}
    </div>
  );
}

function ModelOption({ model, isActive, onClick }) {
  const [h, setH] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
        padding: '8px 10px', borderRadius: '8px', border: 'none',
        backgroundColor: isActive ? tv('--accent-soft') : (h ? tv('--bg-hover') : 'transparent'),
        color: isActive ? tv('--accent') : tv('--text-primary'),
        fontSize: '13px', fontWeight: isActive ? '600' : '400',
        cursor: 'pointer', textAlign: 'left', transition: 'all 0.1s',
      }}
    >
      {isActive && <CheckCircle2 size={12} color={tv('--accent')} style={{ flexShrink: 0 }} />}
      <span style={{ flex: 1 }}>{model.name}</span>
      {model.free && (
        <span style={{
          fontSize: '9px', fontWeight: '700', color: tv('--success'),
          backgroundColor: `${tv('--success')}15`, padding: '2px 6px',
          borderRadius: '4px', letterSpacing: '0.04em', flexShrink: 0,
        }}>
          FREE
        </span>
      )}
    </button>
  );
}

function StatusDot({ status }) {
  const color = status === 'ready' ? tv('--success') : status === 'loading' ? tv('--warning') : tv('--error');
  const label = status === 'ready' ? 'Memory active' : status === 'loading' ? 'Loading memory…' : 'Memory unavailable';
  return (
    <div title={label} style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color, animation: status === 'loading' ? 'pulse 1.5s infinite' : 'none' }} />
      <span style={{ fontSize: '10px', color: tv('--text-muted') }}>{label}</span>
    </div>
  );
}

function StatusPill({ color, text, pulse }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '4px 10px', borderRadius: '20px',
      backgroundColor: `${color}12`, border: `1px solid ${color}25`,
    }}>
      <div style={{ width: '6px', height: '6px', borderRadius: '50%', backgroundColor: color, animation: pulse ? 'pulse 1.5s infinite' : 'none' }} />
      <span style={{ fontSize: '11px', color, fontWeight: '500' }}>{text}</span>
    </div>
  );
}

function SnapshotButton({ onClick, status }) {
  const [h, setH] = useState(false);
  const isLoading = status === 'loading';
  const isSuccess = status === 'success';
  const isError = status === 'error';

  let bgColor = h ? tv('--purple-soft') : 'transparent';
  let textColor = h ? tv('--purple') : tv('--text-muted');
  let label = 'Snapshot';
  let icon = <Database size={12} />;

  if (isLoading) { bgColor = tv('--purple-soft'); textColor = tv('--purple'); label = 'Analyzing…'; icon = <Loader2 size={12} style={{ animation: 'spin 1s linear infinite' }} />; }
  else if (isSuccess) { bgColor = tv('--success-soft'); textColor = tv('--success'); label = 'Done!'; icon = <CheckCircle2 size={12} />; }
  else if (isError) { bgColor = tv('--error-soft'); textColor = tv('--error'); label = 'Failed'; icon = <AlertTriangle size={12} />; }

  return (
    <button onClick={onClick} disabled={isLoading}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontSize: '11.5px', fontWeight: '500', cursor: isLoading ? 'wait' : 'pointer',
        color: textColor, backgroundColor: bgColor,
        border: `1px solid ${tv('--border')}`, padding: '5px 10px', borderRadius: '8px',
        transition: 'all 0.15s',
      }}
    >
      {icon} {label}
    </button>
  );
}

function StopButton({ onClick }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      style={{
        height: '32px', borderRadius: '10px', border: 'none',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        gap: '5px', cursor: 'pointer', padding: '0 12px',
        backgroundColor: h ? tv('--error-soft') : tv('--bg-tertiary'),
        color: h ? tv('--error') : tv('--text-secondary'),
        fontSize: '12px', fontWeight: '500', transition: 'all 0.15s',
      }}
    >
      <div style={{ width: '8px', height: '8px', borderRadius: '2px', backgroundColor: 'currentColor' }} />
      Stop
    </button>
  );
}

function AttachButton({ onClick }) {
  const [h, setH] = useState(false);
  return (
    <button onClick={onClick}
      onMouseEnter={() => setH(true)} onMouseLeave={() => setH(false)}
      title="Attach files"
      style={{
        display: 'flex', alignItems: 'center', gap: '5px',
        fontSize: '11.5px', fontWeight: '500', cursor: 'pointer',
        color: h ? tv('--accent') : tv('--text-muted'),
        backgroundColor: h ? tv('--accent-soft') : 'transparent',
        border: `1px solid ${tv('--border')}`, padding: '5px 10px', borderRadius: '8px',
        transition: 'all 0.15s',
      }}
    >
      <Paperclip size={12} /> Attach
    </button>
  );
}

function PendingFileChip({ file, onRemove }) {
  const iconMap = { image: <Image size={14} />, video: <Film size={14} />, pdf: <FileText size={14} />, document: <FileText size={14} /> };
  const icon = iconMap[file.type] || <File size={14} />;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: '6px',
      padding: '4px 8px', borderRadius: '8px',
      backgroundColor: tv('--bg-tertiary'),
      border: `1px solid ${tv('--border')}`,
      fontSize: '11px', color: tv('--text-secondary'),
      maxWidth: '180px', animation: 'fadeIn 0.15s ease',
    }}>
      {file.preview ? (
        <img src={file.preview} alt="" style={{ width: '24px', height: '24px', borderRadius: '4px', objectFit: 'cover' }} />
      ) : (
        <span style={{ color: tv('--accent'), flexShrink: 0 }}>{icon}</span>
      )}
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
        {file.file.name}
      </span>
      <button onClick={onRemove} style={{
        background: 'none', border: 'none', padding: '2px',
        cursor: 'pointer', color: tv('--text-muted'), flexShrink: 0,
        display: 'flex', alignItems: 'center',
      }}>
        <X size={12} />
      </button>
    </div>
  );
}

/* ─── Attachment grid shown inside messages ──────────────────── */
function AttachmentGrid({ attachments }) {
  if (!attachments || attachments.length === 0) return null;

  const images = attachments.filter(a => a.type === 'image');
  const videos = attachments.filter(a => a.type === 'video');
  const others = attachments.filter(a => a.type !== 'image' && a.type !== 'video');

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '6px' }}>
      {/* Image grid */}
      {images.length > 0 && (
        <div style={{
          display: 'grid',
          gridTemplateColumns: images.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(140px, 1fr))',
          gap: '6px',
        }}>
          {images.map(att => (
            <a key={att.id} href={att.data} target="_blank" rel="noopener noreferrer"
              style={{ display: 'block', borderRadius: '8px', overflow: 'hidden', border: `1px solid ${tv('--border')}` }}>
              <img src={att.data} alt={att.fileName}
                style={{ width: '100%', maxHeight: '260px', objectFit: 'cover', display: 'block', cursor: 'pointer' }}
              />
            </a>
          ))}
        </div>
      )}

      {/* Video players */}
      {videos.map(att => (
        <video key={att.id} controls preload="metadata"
          style={{
            width: '100%', maxWidth: '420px', borderRadius: '8px',
            border: `1px solid ${tv('--border')}`, backgroundColor: '#000',
          }}>
          <source src={att.data} type={att.mimeType} />
        </video>
      ))}

      {/* Other files (PDF, docs, etc.) */}
      {others.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {others.map(att => {
            const iconMap = {
              pdf: <FileText size={14} style={{ color: '#ef4444' }} />,
              document: <FileText size={14} style={{ color: '#3b82f6' }} />,
            };
            const icon = iconMap[att.type] || <File size={14} style={{ color: tv('--text-secondary') }} />;
            return (
              <div key={att.id} style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '6px 10px', borderRadius: '8px',
                backgroundColor: tv('--bg-tertiary'),
                border: `1px solid ${tv('--border')}`,
                fontSize: '12px', color: tv('--text-secondary'),
                maxWidth: '220px',
              }}>
                {icon}
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.fileName}
                </span>
                <span style={{ fontSize: '10px', color: tv('--text-muted'), flexShrink: 0 }}>
                  {formatFileSize(att.size)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MessageBubble({ message, messages, msgIndex, workspaceId, chatId, onEditResend }) {
  const isUser = message.role === 'user';
  const [hovered, setHovered] = useState(false);
  const [teachMode, setTeachMode] = useState(false);
  const [teachCategory, setTeachCategory] = useState('fact');
  const [teachContent, setTeachContent] = useState('');
  const [teachSaved, setTeachSaved] = useState(false);
  const [attachments, setAttachments] = useState([]);
  const [editing, setEditing] = useState(false);
  const [editDraft, setEditDraft] = useState('');
  const [copied, setCopied] = useState(false);
  const editRef = useRef(null);

  useEffect(() => {
    if (editing && editRef.current) {
      editRef.current.focus();
      editRef.current.selectionStart = editRef.current.value.length;
    }
  }, [editing]);

  const handleEditStart = () => {
    setEditDraft(message.content || '');
    setEditing(true);
  };

  const handleEditSave = async () => {
    const trimmed = editDraft.trim();
    if (!trimmed) { setEditing(false); return; }
    if (trimmed !== message.content) {
      // Find the next AI response to replace
      const next = messages[msgIndex + 1];
      const nextAiId = next && next.role === 'assistant' ? next.id : null;
      setEditing(false);
      // Re-run the LLM with the edited message
      onEditResend(message.id, trimmed, nextAiId);
    } else {
      setEditing(false);
    }
  };

  const handleEditCancel = () => {
    setEditDraft('');
    setEditing(false);
  };

  const handleEditKeyDown = (e) => {
    if (e.key === 'Escape') handleEditCancel();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEditSave(); }
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content || '').then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  // Load attachments for this message
  useEffect(() => {
    if (message.id) {
      getAttachmentsByMessage(message.id).then(setAttachments).catch(() => {});
    }
  }, [message.id]);

  const handleRemember = () => {
    setTeachContent(message.content?.slice(0, 200) || '');
    setTeachMode(true);
    setTeachSaved(false);
  };

  const handleTeachSave = async () => {
    if (!teachContent.trim() || !workspaceId) return;
    const tags = suggestTags(teachContent, '');
    await addMemoryItem({
      workspaceId, chatId, messageId: message.id,
      content: teachContent.trim(), category: teachCategory,
      tags, source: 'teach-mode', scope: 'workspace',
    });
    setTeachSaved(true);
    setTimeout(() => { setTeachMode(false); setTeachSaved(false); }, 1200);
  };

  const TEACH_CATS = [
    { key: 'decision', label: 'Decision', color: '#f59e0b' },
    { key: 'fact', label: 'Fact', color: '#3b82f6' },
    { key: 'preference', label: 'Preference', color: '#10b981' },
    { key: 'code_style', label: 'Code Style', color: '#a78bfa' },
  ];

  return (
    <div
      style={{ padding: '16px 0', borderBottom: `1px solid ${tv('--border')}08`, animation: 'fadeIn 0.2s ease' }}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
        <div style={{
          width: '24px', height: '24px', borderRadius: '7px', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '10px', fontWeight: '700',
          backgroundColor: isUser ? tv('--bg-tertiary') : tv('--purple-soft'),
          color: isUser ? tv('--text-secondary') : tv('--purple'),
        }}>
          {isUser ? 'U' : <Sparkles size={12} />}
        </div>
        <span style={{ fontSize: '13px', fontWeight: '600', color: tv('--text-primary') }}>
          {isUser ? 'You' : 'Snapshot AI'}
        </span>
      </div>

      <div style={{ paddingLeft: '32px', fontSize: '14px', lineHeight: 1.75, color: tv('--text-primary') }}>
        {isUser ? (
          editing ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <textarea
                ref={editRef}
                value={editDraft}
                onChange={e => setEditDraft(e.target.value)}
                onKeyDown={handleEditKeyDown}
                rows={3}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: tv('--bg-input'), border: `1px solid ${tv('--accent')}`,
                  borderRadius: '8px', padding: '10px 12px',
                  color: tv('--text-primary'), fontSize: '14px', lineHeight: 1.6,
                  resize: 'vertical', minHeight: '48px', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end' }}>
                <button onClick={handleEditCancel} style={{
                  fontSize: '11px', color: tv('--text-secondary'), background: 'none',
                  border: `1px solid ${tv('--border')}`, borderRadius: '6px',
                  padding: '4px 12px', cursor: 'pointer', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <X size={11} /> Cancel
                </button>
                <button onClick={handleEditSave} style={{
                  fontSize: '11px', color: '#fff', background: tv('--accent'),
                  border: 'none', borderRadius: '6px',
                  padding: '4px 12px', cursor: 'pointer', fontWeight: '600', fontFamily: 'inherit',
                  display: 'flex', alignItems: 'center', gap: '4px',
                }}>
                  <Check size={11} /> Save
                </button>
              </div>
            </div>
          ) : (
            <span style={{ whiteSpace: 'pre-wrap' }}>{message.content}</span>
          )
        ) : (
          <MarkdownRenderer content={message.content} />
        )}
      </div>

      {/* Action buttons on hover */}
      {hovered && !editing && !teachMode && (
        <div style={{ paddingLeft: '32px', marginTop: '4px', display: 'flex', gap: '4px' }}>
          {isUser && (
            <MsgActionBtn icon={<Pencil size={11} />} label="Edit" onClick={handleEditStart} />
          )}
          <MsgActionBtn
            icon={copied ? <CheckCircle2 size={11} /> : <Copy size={11} />}
            label={copied ? 'Copied' : 'Copy'}
            onClick={handleCopy}
            accent={copied}
          />
          {isUser && (
            <MsgActionBtn
              icon={<Trash2 size={11} />}
              label="Delete"
              onClick={async () => {
                const next = messages[msgIndex + 1];
                const willDeletePair = next && next.role === 'assistant';
                const msg = willDeletePair
                  ? 'Delete this message and its AI response?'
                  : 'Delete this message?';
                if (!confirm(msg)) return;
                await deleteMessage(message.id);
                if (willDeletePair) await deleteMessage(next.id);
              }}
              danger
            />
          )}
        </div>
      )}

      {/* Attachment previews */}
      {attachments.length > 0 && (
        <div style={{ paddingLeft: '32px', marginTop: '8px' }}>
          <AttachmentGrid attachments={attachments} />
        </div>
      )}

      {!isUser && hovered && !teachMode && workspaceId && (
        <div style={{ paddingLeft: '32px', marginTop: '6px', display: 'flex' }}>
          <button onClick={handleRemember} style={{
            display: 'flex', alignItems: 'center', gap: '4px',
            fontSize: '11px', color: tv('--purple'), background: 'none',
            border: `1px solid ${tv('--purple')}33`, borderRadius: '6px',
            padding: '3px 9px', cursor: 'pointer', fontWeight: '500',
          }}>
            <Bookmark size={10} /> Remember this
          </button>
        </div>
      )}


      {teachMode && (
        <div style={{
          marginLeft: '32px', marginTop: '8px', padding: '10px 12px', borderRadius: '10px',
          backgroundColor: tv('--bg-secondary'), border: `1px solid ${tv('--border')}`,
        }}>
          {teachSaved ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: tv('--success'), fontSize: '12px', fontWeight: '500' }}>
              <CheckCircle2 size={13} /> Saved to memory
            </div>
          ) : (
            <>
              <textarea
                value={teachContent} onChange={e => setTeachContent(e.target.value)}
                placeholder="What should I remember?" autoFocus rows={2}
                style={{
                  width: '100%', boxSizing: 'border-box',
                  background: tv('--bg-input'), border: `1px solid ${tv('--border')}`,
                  borderRadius: '8px', padding: '8px 10px',
                  color: tv('--text-primary'), fontSize: '12px', lineHeight: 1.5,
                  resize: 'vertical', minHeight: '36px', outline: 'none', fontFamily: 'inherit',
                }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '8px', flexWrap: 'wrap' }}>
                {TEACH_CATS.map(c => (
                  <button key={c.key} onClick={() => setTeachCategory(c.key)} style={{
                    fontSize: '10px', padding: '2px 8px', borderRadius: '5px',
                    border: `1px solid ${teachCategory === c.key ? c.color : tv('--border')}`,
                    backgroundColor: teachCategory === c.key ? `${c.color}1a` : 'transparent',
                    color: teachCategory === c.key ? c.color : tv('--text-muted'),
                    cursor: 'pointer', fontWeight: teachCategory === c.key ? '600' : '400',
                  }}>
                    {c.label}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button onClick={() => setTeachMode(false)} style={{
                  fontSize: '11px', color: tv('--text-secondary'), background: 'none',
                  border: `1px solid ${tv('--border')}`, borderRadius: '6px', padding: '3px 9px', cursor: 'pointer',
                }}>Cancel</button>
                <button onClick={handleTeachSave} style={{
                  fontSize: '11px', color: tv('--success'), background: tv('--success-soft'),
                  border: `1px solid ${tv('--success')}44`, borderRadius: '6px', padding: '3px 9px', cursor: 'pointer', fontWeight: '500',
                }}>Save</button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function MsgActionBtn({ icon, label, onClick, accent, danger }) {
  const [h, setH] = useState(false);
  const color = danger ? tv('--error') : accent ? tv('--success') : tv('--text-muted');
  const hoverColor = danger ? tv('--error') : accent ? tv('--success') : tv('--text-secondary');
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setH(true)}
      onMouseLeave={() => setH(false)}
      title={label}
      style={{
        display: 'flex', alignItems: 'center', gap: '4px',
        fontSize: '11px', fontWeight: '500', fontFamily: 'inherit',
        color: h ? hoverColor : color,
        background: h ? `${color}15` : 'none',
        border: `1px solid ${h ? `${color}40` : tv('--border')}`,
        borderRadius: '6px', padding: '3px 9px', cursor: 'pointer',
        transition: 'all 0.12s',
      }}
    >
      {icon} {label}
    </button>
  );
}