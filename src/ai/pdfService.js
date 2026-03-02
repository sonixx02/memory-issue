/* ─── pdfService.js ── PDF text extraction using pdf.js ──────────── */
import * as pdfjsLib from 'pdfjs-dist';

// Use the bundled worker shipped with pdfjs-dist
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url,
).toString();

/**
 * Extract all text from a PDF file.
 * @param {File|Blob|ArrayBuffer} input – the PDF source
 * @returns {Promise<string>} concatenated text of every page
 */
export async function extractPdfText(input) {
  let data;
  if (input instanceof ArrayBuffer) {
    data = new Uint8Array(input);
  } else if (input instanceof Blob || input instanceof File) {
    const buf = await input.arrayBuffer();
    data = new Uint8Array(buf);
  } else {
    throw new Error('extractPdfText: unsupported input type');
  }

  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const pageTexts = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((item) => item.str);
    pageTexts.push(strings.join(' '));
  }

  return pageTexts.join('\n\n');
}
