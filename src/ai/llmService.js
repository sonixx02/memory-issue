import { getAISettings } from '../db/settingsHelpers.js';
import { debugLog } from './debugLogger.js';
import { fetchFreeOpenRouterModels, buildFallbackModelList } from './openRouterModels.js';

/**
 * Call the LLM and stream back the response.
 * Supports OpenAI and Anthropic APIs.
 *
 * @param {Array} messages - Array of { role, content } objects
 * @param {(chunk: string) => void} onChunk - Called with each text chunk
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {Promise<string>} - Full accumulated response text
 */
export async function streamChat(messages, onChunk, signal) {
  const settings = await getAISettings();

  // OpenRouter free models don't require an API key
  const isFreeModel = settings.provider === 'openrouter' && settings.model?.endsWith(':free');
  if (!settings.apiKey && !isFreeModel) {
    throw new Error('NO_API_KEY');
  }

  debugLog('llm:stream-start', {
    provider: settings.provider || 'openai',
    model: settings.model || 'gpt-4o-mini',
    messageCount: messages.length,
    systemPromptLength: messages.find(m => m.role === 'system')?.content?.length || 0,
    lastUserMessage: messages.filter(m => m.role === 'user').pop()?.content?.slice(0, 150) || '',
  });

  const t0 = performance.now();
  const wrappedOnChunk = (accumulated) => {
    onChunk(accumulated);
  };

  let result;
  if (settings.provider === 'anthropic') {
    result = await streamAnthropic(messages, settings, wrappedOnChunk, signal);
  } else if (settings.provider === 'gemini') {
    result = await streamGemini(messages, settings, wrappedOnChunk, signal);
  } else if (settings.provider === 'openrouter') {
    result = await streamOpenRouter(messages, settings, wrappedOnChunk, signal);
  } else {
    result = await streamOpenAI(messages, settings, wrappedOnChunk, signal);
  }

  debugLog('llm:stream-end', {
    provider: settings.provider || 'openai',
    model: settings.model || 'gpt-4o-mini',
    responseLength: result?.length || 0,
    responsePreview: result?.slice(0, 200) || '',
    duration: Math.round(performance.now() - t0),
  });

  return result;
}

// ── OpenAI-compatible streaming ─────────────────────────────────────────────

async function streamOpenAI(messages, settings, onChunk, signal) {
  const model = settings.model || 'gpt-4o-mini';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI API error (${res.status}): ${err}`);
  }

  return readSSEStream(res.body, (data) => {
    if (data === '[DONE]') return null;
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || '';
    } catch {
      return '';
    }
  }, onChunk, signal);
}

// ── Anthropic streaming ─────────────────────────────────────────────────────

async function streamAnthropic(messages, settings, onChunk, signal) {
  const model = settings.model || 'claude-sonnet-4-20250514';

  // Anthropic expects system prompt separately
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }));

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      system: systemMsg?.content || '',
      messages: chatMessages,
      stream: true,
      max_tokens: 4096,
      temperature: 0.7,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }

  return readSSEStream(res.body, (data) => {
    try {
      const parsed = JSON.parse(data);
      if (parsed.type === 'content_block_delta') {
        return parsed.delta?.text || '';
      }
      if (parsed.type === 'message_stop') return null;
      return '';
    } catch {
      return '';
    }
  }, onChunk, signal);
}

// ── Gemini streaming ────────────────────────────────────────────────────────

function toGeminiContents(messages) {
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');
  const contents = chatMessages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const systemInstruction = systemMsg
    ? { parts: [{ text: systemMsg.content }] }
    : undefined;
  return { contents, systemInstruction };
}

async function streamGemini(messages, settings, onChunk, signal) {
  const model = settings.model || 'gemini-2.0-flash';
  const { contents, systemInstruction } = toGeminiContents(messages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${settings.apiKey}`;

  const body = {
    contents,
    ...(systemInstruction && { systemInstruction }),
    generationConfig: { temperature: 0.7, maxOutputTokens: 4096 },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }

  return readSSEStream(res.body, (data) => {
    try {
      const parsed = JSON.parse(data);
      return parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
    } catch {
      return '';
    }
  }, onChunk, signal);
}

// ── OpenRouter streaming (OpenAI-compatible) ───────────────────────────────

async function streamOpenRouter(messages, settings, onChunk, signal) {
  const selectedModel = settings.model || 'meta-llama/llama-4-maverick:free';
  const isFree = selectedModel.endsWith(':free');

  // For free models, build a fallback list so OpenRouter auto-retries if one
  // model is down.  send the array as `models` instead of a single `model`.
  let modelField;
  if (isFree) {
    try {
      const freeIds = (await fetchFreeOpenRouterModels()).map(m => m.id);
      modelField = { models: buildFallbackModelList(freeIds, selectedModel), route: 'fallback' };
    } catch {
      modelField = { model: selectedModel };
    }
  } else {
    modelField = { model: selectedModel };
  }

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': globalThis.location?.origin || 'http://localhost',
    'X-Title': 'Snapshot AI',
  };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      ...modelField,
      messages,
      stream: true,
      temperature: 0.7,
      max_tokens: 4096,
    }),
    signal,
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter API error (${res.status}): ${err}`);
  }

  return readSSEStream(res.body, (data) => {
    if (data === '[DONE]') return null;
    try {
      const parsed = JSON.parse(data);
      return parsed.choices?.[0]?.delta?.content || '';
    } catch {
      return '';
    }
  }, onChunk, signal);
}

// ── Shared SSE reader ───────────────────────────────────────────────────────

async function readSSEStream(body, parseChunk, onChunk, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';
  let finished = false;

  try {
    while (!finished) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        // Skip empty lines and SSE comments (e.g. ": OPENROUTER PROCESSING")
        if (!trimmed || trimmed.startsWith(':')) continue;
        if (!trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        const text = parseChunk(data);
        if (text === null) { finished = true; break; }
        if (text) {
          accumulated += text;
          onChunk(accumulated);
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return accumulated;
}

/**
 * Non-streaming call for snapshot extraction (simpler, returns full text).
 */
export async function chatCompletion(messages) {
  const settings = await getAISettings();

  // OpenRouter free models don't require an API key
  const isFreeModel = settings.provider === 'openrouter' && settings.model?.endsWith(':free');
  if (!settings.apiKey && !isFreeModel) {
    throw new Error('NO_API_KEY');
  }

  debugLog('llm:completion-start', {
    provider: settings.provider || 'openai',
    model: settings.model || 'gpt-4o-mini',
    messageCount: messages.length,
  });

  const t0 = performance.now();
  let result;
  if (settings.provider === 'anthropic') {
    result = await completionAnthropic(messages, settings);
  } else if (settings.provider === 'gemini') {
    result = await completionGemini(messages, settings);
  } else if (settings.provider === 'openrouter') {
    result = await completionOpenRouter(messages, settings);
  } else {
    result = await completionOpenAI(messages, settings);
  }

  debugLog('llm:completion-end', {
    provider: settings.provider || 'openai',
    responseLength: result?.length || 0,
    responsePreview: result?.slice(0, 200) || '',
    duration: Math.round(performance.now() - t0),
  });

  return result;
}

async function completionOpenAI(messages, settings) {
  const model = settings.model || 'gpt-4o-mini';
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`,
    },
    body: JSON.stringify({ model, messages, temperature: 0.3, max_tokens: 2048 }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenAI API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}

async function completionAnthropic(messages, settings) {
  const model = settings.model || 'claude-sonnet-4-20250514';
  const systemMsg = messages.find(m => m.role === 'system');
  const chatMessages = messages.filter(m => m.role !== 'system');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      system: systemMsg?.content || '',
      messages: chatMessages,
      max_tokens: 2048,
      temperature: 0.3,
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Anthropic API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.content?.[0]?.text || '';
}

async function completionGemini(messages, settings) {
  const model = settings.model || 'gemini-2.0-flash';
  const { contents, systemInstruction } = toGeminiContents(messages);

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${settings.apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents,
      ...(systemInstruction && { systemInstruction }),
      generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Gemini API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

async function completionOpenRouter(messages, settings) {
  const selectedModel = settings.model || 'meta-llama/llama-4-maverick:free';
  const isFree = selectedModel.endsWith(':free');

  let modelField;
  if (isFree) {
    try {
      const freeIds = (await fetchFreeOpenRouterModels()).map(m => m.id);
      modelField = { models: buildFallbackModelList(freeIds, selectedModel), route: 'fallback' };
    } catch {
      modelField = { model: selectedModel };
    }
  } else {
    modelField = { model: selectedModel };
  }

  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': globalThis.location?.origin || 'http://localhost',
    'X-Title': 'Snapshot AI',
  };
  if (settings.apiKey) headers['Authorization'] = `Bearer ${settings.apiKey}`;

  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({ ...modelField, messages, temperature: 0.3, max_tokens: 2048 }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`OpenRouter API error (${res.status}): ${err}`);
  }
  const data = await res.json();
  return data.choices?.[0]?.message?.content || '';
}
