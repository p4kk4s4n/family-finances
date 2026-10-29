import { describe, expect, it, vi } from 'vitest';
import { readReceipt } from './pipeline';
import { DEFAULT_SETTINGS } from '../db/schema';
import { GeminiError } from './gemini';
import type { ParsedReceipt, Settings } from '../types';

const sampleDraft = (merchant: string): ParsedReceipt => ({
  merchant,
  date: '2026-10-25',
  currency: 'USD',
  subtotal: 10,
  tax: null,
  total: 10,
  paymentMethod: null,
  items: [],
});

const imgBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });
const pdfBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/pdf' });

describe('readReceipt pipeline', () => {
  const baseSettings: Settings = { ...DEFAULT_SETTINGS, apiKey: 'KEY-1', ocrFallback: true, ocrOnly: false };

  it('returns gemini result when AI succeeds', async () => {
    const ai = vi.fn(async () => sampleDraft('GeminiStore'));
    const ocr = vi.fn(async () => sampleDraft('OcrStore'));
    const res = await readReceipt(imgBlob, 'image/jpeg', baseSettings, { ai, ocr, online: () => true });
    expect(res.parsedBy).toBe('gemini');
    expect(res.draft.merchant).toBe('GeminiStore');
    expect(ocr).not.toHaveBeenCalled();
  });

  it('falls back to OCR with friendly aiError when AI throws 503', async () => {
    const ai = vi.fn(async () => {
      throw new GeminiError('Gemini error 503', 503);
    });
    const ocr = vi.fn(async () => sampleDraft('OcrFallbackStore'));
    const res = await readReceipt(imgBlob, 'image/jpeg', baseSettings, { ai, ocr, online: () => true });
    expect(res.parsedBy).toBe('ocr');
    expect(res.draft.merchant).toBe('OcrFallbackStore');
    expect(res.aiError).toMatch(/temporarily busy/i);
  });

  it('falls back to OCR when AI throws TypeError: Failed to fetch', async () => {
    const ai = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const ocr = vi.fn(async () => sampleDraft('OcrNetworkFallback'));
    const res = await readReceipt(imgBlob, 'image/jpeg', baseSettings, { ai, ocr, online: () => true });
    expect(res.parsedBy).toBe('ocr');
    expect(res.aiError).toMatch(/Couldn't reach Google AI/i);
  });

  it('runs OCR immediately without calling AI when offline or no API key', async () => {
    const ai = vi.fn(async () => sampleDraft('AI'));
    const ocr = vi.fn(async () => sampleDraft('OfflineOcr'));

    const resOffline = await readReceipt(imgBlob, 'image/jpeg', baseSettings, { ai, ocr, online: () => false });
    expect(resOffline.parsedBy).toBe('ocr');
    expect(ai).not.toHaveBeenCalled();

    const resNoKey = await readReceipt(imgBlob, 'image/jpeg', { ...baseSettings, apiKey: undefined }, { ai, ocr, online: () => true });
    expect(resNoKey.parsedBy).toBe('ocr');
    expect(ai).not.toHaveBeenCalled();
  });

  it('never calls AI when ocrOnly privacy toggle is enabled', async () => {
    const ai = vi.fn(async () => sampleDraft('AI'));
    const ocr = vi.fn(async () => sampleDraft('PrivateOcr'));
    const res = await readReceipt(imgBlob, 'image/jpeg', { ...baseSettings, ocrOnly: true }, { ai, ocr, online: () => true });
    expect(res.parsedBy).toBe('ocr');
    expect(res.draft.merchant).toBe('PrivateOcr');
    expect(ai).not.toHaveBeenCalled();
  });

  it('throws when ocrFallback is disabled and AI fails', async () => {
    const ai = vi.fn(async () => {
      throw new GeminiError('503', 503);
    });
    const ocr = vi.fn(async () => sampleDraft('Ocr'));
    await expect(
      readReceipt(imgBlob, 'image/jpeg', { ...baseSettings, ocrFallback: false }, { ai, ocr, online: () => true }),
    ).rejects.toThrow(/temporarily busy/i);
    expect(ocr).not.toHaveBeenCalled();
  });

  it('throws a clear message when a PDF fails AI (since PDFs cannot be OCRd on-device)', async () => {
    const ai = vi.fn(async () => {
      throw new GeminiError('503', 503);
    });
    const ocr = vi.fn(async () => sampleDraft('Ocr'));
    await expect(readReceipt(pdfBlob, 'application/pdf', baseSettings, { ai, ocr, online: () => true })).rejects.toThrow(
      /PDF e-receipts cannot be read with on-device OCR/i,
    );
    expect(ocr).not.toHaveBeenCalled();
  });
});
