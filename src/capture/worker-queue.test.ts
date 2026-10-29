import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { db, saveSettings } from '../db/schema';
import { GeminiError } from './gemini';
import { reclaimExpiredLeases, runWorkerQueue } from './worker-queue';
import type { ParsedReceipt } from '../types';

const imgBlob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

const mockDraft = (merchant = 'Target'): ParsedReceipt => ({
  merchant,
  date: '2026-10-25',
  currency: 'USD',
  subtotal: 20,
  tax: null,
  total: 20,
  paymentMethod: null,
  items: [],
});

describe('worker-queue (background resilience, strikes & lease management)', () => {
  beforeEach(async () => {
    await db.receipts.clear();
    await db.settings.clear();
    await saveSettings({ apiKey: 'TEST-KEY', ocrFallback: true, ocrOnly: false });
  });

  it('does NOT count a strike or jump to OCR when a request is interrupted by screen lock / hidden tab', async () => {
    const id = await db.receipts.add({
      createdAt: 1000,
      status: 'queued',
      source: 'photo',
      image: imgBlob,
      imageType: 'image/jpeg',
    });

    const ai = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });

    // Simulate page hidden (screen timed out mid-upload)
    await runWorkerQueue({
      ai,
      online: () => true,
      hidden: () => true,
      now: () => 2000,
    });

    const after = await db.receipts.get(id);
    expect(after?.status).toBe('queued');
    expect(after?.strikes ?? 0).toBe(0);
    expect(after?.attempts).toBe(1);
    expect(after?.nextAttemptAt).toBeGreaterThan(2000);
  });

  it('transitions to ai_failed (triggering OCR) after 2 genuine AI failures', async () => {
    const id = await db.receipts.add({
      createdAt: 1000,
      status: 'queued',
      source: 'photo',
      image: imgBlob,
      imageType: 'image/jpeg',
    });

    const ai = vi.fn(async () => {
      throw new GeminiError('Gemini error 503', 503);
    });

    // Strike 1
    await runWorkerQueue({
      ai,
      online: () => true,
      hidden: () => false,
      now: () => 2000,
      retryBackoffMs: 100,
    });

    let r = await db.receipts.get(id);
    expect(r?.status).toBe('queued');
    expect(r?.strikes).toBe(1);

    // Strike 2 (after backoff) -> reaches MAX_AI_STRIKES (2) -> ai_failed
    await runWorkerQueue({
      ai,
      online: () => true,
      hidden: () => false,
      now: () => 3000,
      retryBackoffMs: 100,
    });

    r = await db.receipts.get(id);
    expect(r?.status).toBe('ai_failed');
    expect(r?.strikes).toBe(2);
    expect(r?.aiError).toMatch(/temporarily busy/i);
  });

  it('transitions to ai_failed when receipt has waited >= 10 minutes since capture', async () => {
    const createdAt = 1_000_000;
    const tenMinLater = createdAt + 10 * 60 * 1000;
    const id = await db.receipts.add({
      createdAt,
      status: 'queued',
      source: 'photo',
      image: imgBlob,
      imageType: 'image/jpeg',
    });

    const ai = vi.fn(async () => mockDraft());
    await runWorkerQueue({
      ai,
      online: () => true,
      hidden: () => false,
      now: () => tenMinLater,
    });

    const r = await db.receipts.get(id);
    expect(r?.status).toBe('ai_failed');
    expect(r?.aiError).toMatch(/10 minutes/);
    expect(ai).not.toHaveBeenCalled();
  });

  it('reclaims expired processing leases so killed workers do not leave receipts stuck', async () => {
    const id = await db.receipts.add({
      createdAt: 1000,
      status: 'processing',
      source: 'photo',
      image: imgBlob,
      imageType: 'image/jpeg',
      leaseUntil: 5000,
    });

    // Before lease expiry -> untouched
    expect(await reclaimExpiredLeases(4000)).toBe(0);
    expect((await db.receipts.get(id))?.status).toBe('processing');

    // After lease expiry -> reclaimed back to queued
    expect(await reclaimExpiredLeases(5001)).toBe(1);
    expect((await db.receipts.get(id))?.status).toBe('queued');
  });

  it('goes straight to ai_failed (for immediate OCR) when offline or no API key', async () => {
    await saveSettings({ apiKey: undefined, ocrFallback: true });
    const id = await db.receipts.add({
      createdAt: 1000,
      status: 'queued',
      source: 'photo',
      image: imgBlob,
      imageType: 'image/jpeg',
    });

    const ai = vi.fn(async () => mockDraft());
    await runWorkerQueue({ ai, online: () => true, hidden: () => false });

    const r = await db.receipts.get(id);
    expect(r?.status).toBe('ai_failed');
    expect(r?.aiError).toMatch(/No Gemini API key/i);
    expect(ai).not.toHaveBeenCalled();
  });
});
