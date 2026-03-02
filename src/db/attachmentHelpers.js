import { v4 as uuidv4 } from 'uuid';
import db from './database.js';

/**
 * Supported file type categories
 */
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime'];
const PDF_TYPES = ['application/pdf'];
const DOC_TYPES = [
  'text/plain', 'text/csv', 'text/html', 'text/css', 'text/javascript',
  'application/json', 'application/xml', 'text/xml', 'text/markdown',
  'application/x-yaml', 'text/yaml',
];

/**
 * Classify a file's MIME type into a category.
 * @param {string} mimeType
 * @returns {'image'|'video'|'pdf'|'document'|'file'}
 */
export function classifyFile(mimeType) {
  if (IMAGE_TYPES.includes(mimeType)) return 'image';
  if (VIDEO_TYPES.includes(mimeType)) return 'video';
  if (PDF_TYPES.includes(mimeType)) return 'pdf';
  if (DOC_TYPES.includes(mimeType)) return 'document';
  return 'file';
}

/**
 * Read a File object and convert to base64 data URL.
 * @param {File} file
 * @returns {Promise<string>} base64 data URL
 */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Read a file as text.
 * @param {File} file
 * @returns {Promise<string>}
 */
export function fileToText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

/**
 * Read a file as ArrayBuffer.
 * @param {File} file
 * @returns {Promise<ArrayBuffer>}
 */
export function fileToArrayBuffer(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Save an attachment to the database.
 * Stores the actual file data (base64 or text) in IndexedDB.
 *
 * @param {Object} opts
 * @param {string} opts.messageId - Message this attachment belongs to
 * @param {string} opts.chatId - Chat ID for querying
 * @param {string} opts.fileName - Original file name
 * @param {string} opts.mimeType - MIME type
 * @param {number} opts.size - File size in bytes
 * @param {string} opts.data - Base64 data URL for images/videos/PDFs, or text content for docs
 * @param {string} [opts.extractedText] - Extracted text (for PDFs)
 * @returns {Promise<Object>} The saved attachment record
 */
export async function addAttachment({ messageId, chatId, fileName, mimeType, size, data, extractedText }) {
  const attachment = {
    id: uuidv4(),
    messageId,
    chatId,
    fileName,
    mimeType,
    size,
    type: classifyFile(mimeType),
    data,  // base64 URI or text content
    extractedText: extractedText || null,
    createdAt: Date.now(),
  };
  await db.attachments.add(attachment);
  return attachment;
}

/**
 * Get all attachments for a specific message.
 */
export async function getAttachmentsByMessage(messageId) {
  return db.attachments.where('messageId').equals(messageId).toArray();
}

/**
 * Get all attachments for a chat.
 */
export async function getAttachmentsByChat(chatId) {
  return db.attachments.where('chatId').equals(chatId).sortBy('createdAt');
}

/**
 * Delete an attachment by ID.
 */
export async function deleteAttachment(id) {
  await db.attachments.delete(id);
}

/**
 * Delete all attachments for a message.
 */
export async function deleteAttachmentsByMessage(messageId) {
  await db.attachments.where('messageId').equals(messageId).delete();
}

/**
 * Process files for upload: reads them, classifies them, and returns
 * processed attachment data ready for storage.
 *
 * @param {FileList|File[]} files
 * @returns {Promise<Array<{fileName, mimeType, size, type, data, extractedText}>>}
 */
export async function processFiles(files) {
  const results = [];

  for (const file of files) {
    const type = classifyFile(file.type);
    let data;
    let extractedText = null;

    if (type === 'document') {
      // Store as text for documents
      data = await fileToText(file);
      extractedText = data;
    } else {
      // Store as base64 for images, videos, PDFs, and other files
      data = await fileToBase64(file);
    }

    // PDF text extraction is handled separately via pdfService
    results.push({
      fileName: file.name,
      mimeType: file.type || 'application/octet-stream',
      size: file.size,
      type,
      data,
      extractedText,
    });
  }

  return results;
}

/**
 * Format file size for display (e.g., "1.2 MB")
 */
export function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
