import { db, getSettings } from '../db/schema';
import { findDuplicate } from '../db/dedupe';
import type { Item, ParsedReceipt, Receipt, ReceiptSource } from '../types';
import { resolveRate, round2, toUSD } from '../lib/currency';
import { downscaleImage, imageDHash } from './image';
import { parseReceipt } from './gemini';
import { emptyDraft } from './validate';

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
  void processQueue();
  return ids;
}

export async function createManualReceipt(): Promise<number> {
  return db.receipts.add({ createdAt: Date.now(), status: 'needs_review', source: 'manual', draft: emptyDraft() });
}

let running = false;

export async function processQueue(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const settings = await getSettings();
    if (!settings.apiKey || !navigator.onLine) return;
    for (;;) {
      const next = await db.receipts.where('status').equals('queued').first();
      if (!next?.id) break;
      await db.receipts.update(next.id, { status: 'processing', error: undefined });
      try {
        if (!next.image) throw new Error('No image attached.');
        const draft = await parseReceipt(next.image, next.imageType || 'image/jpeg', settings.apiKey, settings.model);
        const others = await db.receipts.where('status').anyOf('saved', 'needs_review').toArray();
        const dup = findDuplicate({ id: next.id, merchant: draft.merchant, date: draft.date, total: draft.total }, others);
        await db.receipts.update(next.id, {
          status: 'needs_review',
          draft,
          duplicateOf: dup?.id ?? next.duplicateOf,
        });
      } catch (e) {
        await db.receipts.update(next.id, { status: 'error', error: (e as Error).message });
      }
    }
  } finally {
    running = false;
  }
}

export async function requeue(id: number): Promise<void> {
  await db.receipts.update(id, { status: 'queued', error: undefined });
  void processQueue();
}

/** Called at startup: anything stuck in "processing" (app closed mid-parse) goes back to the queue. */
export async function recoverQueue(): Promise<void> {
  await db.receipts.where('status').equals('processing').modify({ status: 'queued' });
  void processQueue();
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
