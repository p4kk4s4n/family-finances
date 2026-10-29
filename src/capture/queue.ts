import { db, getSettings } from '../db/schema';
import { findDuplicate } from '../db/dedupe';
import type { Item, ParsedReceipt, Receipt, ReceiptSource } from '../types';
import { resolveRate, round2, toUSD } from '../lib/currency';
import { downscaleImage, imageDHash } from './image';
import { ocrReceipt } from './ocr';
import { emptyDraft } from './validate';
import { runWorkerQueue, type WorkerQueueDeps } from './worker-queue';
import { rescanUnmatchedTransactions } from '../bank/reconcile';

let wakeLockSentinel: any = null;
let ocrRunning = false;
let retryTimer: ReturnType<typeof setTimeout> | null = null;

/** Keep the screen awake while a receipt is actively uploading/parsing so Android doesn't freeze the tab. */
export async function acquireWakeLock(): Promise<void> {
  if (typeof navigator === 'undefined' || !('wakeLock' in navigator) || wakeLockSentinel) return;
  try {
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
    wakeLockSentinel?.addEventListener?.('release', () => {
      wakeLockSentinel = null;
    });
  } catch {
    wakeLockSentinel = null;
  }
}

export async function releaseWakeLock(): Promise<void> {
  if (!wakeLockSentinel) return;
  try {
    await wakeLockSentinel.release();
  } catch {
    // ignore
  } finally {
    wakeLockSentinel = null;
  }
}

/** Ask for one-time notification permission (when enabled in settings) so backgrounded receipts can alert the user. */
export async function maybeRequestNotificationPermission(): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'default') return;
  try {
    const s = await getSettings();
    if (s.notifyWhenReady) await Notification.requestPermission();
  } catch {
    // ignore
  }
}

/** Store captured files immediately (offline-safe), then process them in the background. */
export async function enqueueFiles(files: Blob[], source: ReceiptSource = 'photo'): Promise<number[]> {
  const ids: number[] = [];
  for (const f of files) {
    const image = await downscaleImage(f);
    const imageHash = await imageDHash(image);
    let duplicateOf: number | undefined;
    if (imageHash) {
      const sameHash = await db.receipts.where('imageHash').notEqual('').toArray();
      duplicateOf = findDuplicate({ imageHash }, sameHash)?.id;
    }
    const id = await db.receipts.add({
      createdAt: Date.now(),
      status: 'queued',
      source,
      image,
      imageType: image.type || f.type || 'image/jpeg',
      imageHash,
      duplicateOf,
    });
    ids.push(id);
  }
  navigator.vibrate?.(40);
  void maybeRequestNotificationPermission();
  void kickQueue();
  return ids;
}

export async function createManualReceipt(): Promise<number> {
  return db.receipts.add({ createdAt: Date.now(), status: 'needs_review', source: 'manual', draft: emptyDraft() });
}

/**
 * Process any receipts in `ai_failed` status using on-device Tesseract OCR in the open page.
 */
export async function runPendingOcr(ocrFn: (file: Blob, mime: string) => Promise<ParsedReceipt> = ocrReceipt): Promise<void> {
  if (ocrRunning) return;
  ocrRunning = true;
  try {
    for (;;) {
      const next = await db.receipts.where('status').equals('ai_failed').first();
      if (!next?.id) break;
      await db.receipts.update(next.id, { status: 'processing', error: undefined });
      try {
        if (!next.image) throw new Error('No image attached.');
        const draft = await ocrFn(next.image, next.imageType || next.image.type || 'image/jpeg');
        const others = await db.receipts.where('status').anyOf('saved', 'needs_review').toArray();
        const dup = findDuplicate({ id: next.id, merchant: draft.merchant, date: draft.date, total: draft.total }, others);
        await db.receipts.update(next.id, {
          status: 'needs_review',
          draft,
          parsedBy: 'ocr',
          error: undefined,
          duplicateOf: dup?.id ?? next.duplicateOf,
        });
      } catch (e) {
        const msg = (e as Error).message || 'On-device OCR failed.';
        await db.receipts.update(next.id, {
          status: 'error',
          error: next.aiError ? `${next.aiError} — ${msg}` : msg,
        });
      }
    }
  } finally {
    ocrRunning = false;
  }
}

function scheduleNextRetryIfNeeded(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  void db.receipts
    .where('status')
    .equals('queued')
    .toArray()
    .then((queued) => {
      const now = Date.now();
      const times = queued.map((r) => r.nextAttemptAt ?? now);
      if (!times.length) return;
      const earliest = Math.min(...times);
      const delay = Math.max(500, earliest - now + 50);
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void processQueue();
      }, delay);
    });
}

/**
 * Notify the Service Worker (and register Background Sync) so the Gemini call continues even if the screen locks,
 * and also run the shared queue loop + pending on-device OCR in the page.
 */
export async function kickQueue(): Promise<void> {
  void acquireWakeLock();
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      reg?.active?.postMessage({ type: 'PROCESS_QUEUE' });
      if (reg && 'sync' in reg) {
        await (reg as any).sync.register('ff-process-queue').catch(() => undefined);
      }
    } catch {
      // ignore SW registration lookup errors
    }
  }
  await processQueue();
}

export async function processQueue(deps?: WorkerQueueDeps): Promise<void> {
  await acquireWakeLock();
  try {
    await runWorkerQueue(deps);
    await runPendingOcr();
  } finally {
    const remaining = await db.receipts.where('status').anyOf('queued', 'processing', 'ai_failed').count();
    if (remaining === 0) {
      await releaseWakeLock();
    } else {
      scheduleNextRetryIfNeeded();
    }
  }
}

export async function requeue(id: number): Promise<void> {
  await db.receipts.update(id, {
    status: 'queued',
    error: undefined,
    aiError: undefined,
    parsedBy: undefined,
    strikes: 0,
    attempts: 0,
    leaseUntil: undefined,
    nextAttemptAt: undefined,
  });
  void kickQueue();
}

/** Called at startup or wakeup: anything stuck in "processing" with an expired lease goes back to the queue. */
export async function recoverQueue(): Promise<void> {
  await db.receipts.where('status').equals('processing').modify((r: Receipt) => {
    if (!r.leaseUntil || r.leaseUntil <= Date.now()) {
      r.status = 'queued';
      r.leaseUntil = undefined;
    }
  });
  void kickQueue();
}

/** Persist a reviewed draft as a saved receipt + line items, converting non-USD amounts to USD. */
export async function saveReviewed(id: number, draft: ParsedReceipt, manualRate?: number): Promise<void> {
  const settings = await getSettings();
  const resolved =
    manualRate && manualRate > 0
      ? { rate: manualRate, source: 'manual' as const }
      : await resolveRate(draft.currency, draft.date, settings);
  const rate = resolved.rate;

  const items: Item[] = draft.items.map((it) => ({
    receiptId: id,
    date: draft.date,
    merchant: draft.merchant,
    rawName: it.name,
    normalizedName: it.normalizedName,
    category: it.category,
    quantity: it.quantity,
    unitPrice: it.unitPrice,
    total: it.total,
    currency: draft.currency,
    fxRate: rate,
    unitPriceUSD: toUSD(it.unitPrice, rate),
    totalUSD: toUSD(it.total, rate),
    isDiscretionary: it.isDiscretionary,
    brandTier: it.brandTier,
  }));

  const patch: Partial<Receipt> = {
    status: 'saved',
    draft: undefined,
    error: undefined,
    merchant: draft.merchant,
    date: draft.date,
    currency: draft.currency,
    fxRate: rate,
    fxSource: resolved.source,
    subtotal: draft.subtotal,
    tax: draft.tax,
    total: draft.total,
    totalUSD: round2(draft.total * rate),
    paymentMethod: draft.paymentMethod,
  };

  await db.transaction('rw', db.receipts, db.items, async () => {
    await db.items.where('receiptId').equals(id).delete();
    await db.items.bulkAdd(items);
    await db.receipts.update(id, patch);
  });

  void rescanUnmatchedTransactions();
}

/** Re-open a saved receipt for editing. */
export async function reopenForEdit(id: number): Promise<void> {
  const r = await db.receipts.get(id);
  if (!r) return;
  const items = await db.items.where('receiptId').equals(id).toArray();
  const draft: ParsedReceipt = {
    merchant: r.merchant ?? '',
    date: r.date ?? new Date().toISOString().slice(0, 10),
    currency: r.currency ?? 'USD',
    subtotal: r.subtotal ?? null,
    tax: r.tax ?? null,
    total: r.total ?? 0,
    paymentMethod: r.paymentMethod ?? null,
    items: items.map((i) => ({
      name: i.rawName,
      normalizedName: i.normalizedName,
      category: i.category,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      total: i.total,
      isDiscretionary: i.isDiscretionary,
      brandTier: i.brandTier,
    })),
  };
  await db.receipts.update(id, { status: 'needs_review', draft });
}

export async function deleteReceipt(id: number): Promise<void> {
  await db.transaction('rw', db.receipts, db.items, async () => {
    await db.items.where('receiptId').equals(id).delete();
    await db.receipts.delete(id);
  });
}

/** Pull files shared into the app via the OS share sheet (stored by the service worker). */
export async function drainShareInbox(): Promise<number> {
  if (!('caches' in window)) return 0;
  const cache = await caches.open('share-inbox');
  const keys = await cache.keys();
  const blobs: Blob[] = [];
  for (const k of keys) {
    const res = await cache.match(k);
    if (res) blobs.push(await res.blob());
    await cache.delete(k);
  }
  if (blobs.length) await enqueueFiles(blobs, 'share');
  return blobs.length;
}
