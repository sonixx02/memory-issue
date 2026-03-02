import { chatCompletion } from './llmService.js';
import { renameChat } from '../db/chatHelpers.js';
import { debugLog } from './debugLogger.js';

/**
 * Generate a short title for a chat based on the first exchange.
 * Uses a quick LLM call with low token output.
 */
export async function autoTitleChat(chatId, userMessage, assistantMessage) {
    try {
        const titlePrompt = [
            {
                role: 'system',
                content: 'Generate a concise 3-6 word title for this conversation. Return ONLY the title text, no quotes, no punctuation at the end, no explanation.',
            },
            { role: 'user', content: userMessage },
            { role: 'assistant', content: assistantMessage?.slice(0, 300) || '...' },
            { role: 'user', content: 'What would be a good short title for this conversation?' },
        ];

        const title = await chatCompletion(titlePrompt);
        const cleaned = title.trim().replace(/^["']|["']$/g, '').replace(/\.+$/, '').slice(0, 60);

        if (cleaned && cleaned.length > 2) {
            await renameChat(chatId, cleaned);
            debugLog('auto-title:generated', { chatId, title: cleaned });
            return cleaned;
        }
    } catch (err) {
        console.warn('Auto-title failed:', err.message);
    }
    return null;
}
