import type { ParsedReceipt, Settings } from '../types';
import { describeGeminiError, parseReceipt } from './gemini';
import { ocrReceipt } from './ocr';

export const MAX_AI_STRIKES = 2;
export const MAX_AI_WAIT_MS = 10 * 60 * 1000; // 10 minutes
export const LEASE_DURATION_MS = 90 * 1000; // 90 seconds
export const RETRY_BACKOFF_MS = 20 * 1000; // 20 seconds between strikes

export interface PipelineDeps {
  ai?: (file: Blob, mime: string, apiKey: string, model: string) => Promise<ParsedReceipt>;
  ocr?: (file: Blob, mime: string) => Promise<ParsedReceipt>;
  online?: () => boolean;
}

export interface ReadReceiptResult {
  draft: ParsedReceipt;
  parsedBy: 'gemini' | 'ocr';
  aiError?: string;
}

/**
 * Pure, injectable receipt reader:
 * 1. Tries Gemini AI when an API key exists, the device is online, and `ocrOnly` is false.
 * 2. Falls back to on-device OCR when AI fails (or immediately when offline / no key / ocrOnly)
 *    if `ocrFallback` (or `ocrOnly`) is enabled and the file is an image (not a PDF).
 */
export async function readReceipt(
  image: Blob,
  mime: string,
  settings: Settings,
  deps: PipelineDeps = {},
): Promise<ReadReceiptResult> {
  const aiFn = deps.ai ?? ((b, m, k, mod) => parseReceipt(b, m, k, mod));
  const ocrFn = deps.ocr ?? ((b, m) => ocrReceipt(b, m));
  const isOnline = deps.online ? deps.online() : typeof navigator !== 'undefined' ? navigator.onLine !== false : true;
  const isPdf = mime === 'application/pdf' || image.type === 'application/pdf';

  let aiError: string | undefined;

  if (!settings.ocrOnly && settings.apiKey && isOnline) {
    try {
      const draft = await aiFn(image, mime, settings.apiKey, settings.model);
      return { draft, parsedBy: 'gemini' };
    } catch (e) {
      aiError = describeGeminiError(e);
    }
  } else if (!settings.ocrOnly) {
    if (!settings.apiKey) {
      aiError = 'No Gemini API key configured.';
    } else if (!isOnline) {
      aiError = 'Device was offline when reading receipt.';
    }
  }

  const allowOcr = settings.ocrOnly || (settings.ocrFallback ?? true);
  if (allowOcr && !isPdf) {
    const draft = await ocrFn(image, mime);
    return { draft, parsedBy: 'ocr', aiError };
  }

  if (isPdf && allowOcr && aiError) {
    throw new Error(`${aiError} (PDF e-receipts cannot be read with on-device OCR.)`);
  }

  throw new Error(aiError || 'Failed to read receipt.');
}
