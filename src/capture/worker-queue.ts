import { db, getSettings } from '../db/schema';
import { findDuplicate } from '../db/dedupe';
import type { ParsedReceipt, Receipt, Settings } from '../types';
import { describeGeminiError, GeminiError, parseReceipt } from './gemini';
import { LEASE_DURATION_MS, MAX_AI_STRIKES, MAX_AI_WAIT_MS, RETRY_BACKOFF_MS } from './pipeline';

export interface WorkerQueueDeps {
  ai?: (file: Blob, mime: string, apiKey: string, model: string) => Promise<ParsedReceipt>;
  online?: () => boolean;
  hidden?: () => boolean;
  now?: () => number;
  onReceiptFinished?: (receipt: Receipt) => void | Promise<void>;
  maxStrikes?: number;
  maxWaitMs?: number;
  leaseDurationMs?: number;
  retryBackoffMs?: number;
}

/** Determine whether an error was caused by the OS/browser interrupting the page or connection (not a genuine AI error). */
export function isInterruptedFailure(err: unknown, isOnline: boolean, isHidden: boolean): boolean {
  if (!isOnline || isHidden) return true;
  if (err instanceof GeminiError) {
    // Timeouts with the network up and page visible ARE genuine failures; raw network drops when hidden/offline are interruptions.
    if (err.isTimeout) return false;
    if (err.status && err.status >= 400) return false;
  }
  const msg = (err as Error)?.message || String(err);
  if (/visibility|interrupted|page frozen|suspended/i.test(msg)) return true;
  return false;
}

/** Acquire a cross-context lock (page + Service Worker) so two contexts never process the same receipt concurrently. */
let fallbackMemoryLock = false;

export async function withQueueLock<T>(fn: () => Promise<T>): Promise<T | undefined> {
  const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined;
  if (locks && typeof locks.request === 'function') {
    return locks.request('ff-process-queue', { ifAvailable: true }, async (lock: unknown) => {
      if (!lock) return undefined;
      return fn();
    });
  }
  if (fallbackMemoryLock) return undefined;
  fallbackMemoryLock = true;
  try {
    return await fn();
  } finally {
    fallbackMemoryLock = false;
  }
}

/** Reclaim any receipts stuck in 'processing' whose lease has expired. */
export async function reclaimExpiredLeases(now = Date.now()): Promise<number> {
  const stuck = await db.receipts.where('status').equals('processing').toArray();
  let count = 0;
  for (const r of stuck) {
    if (r.id && (!r.leaseUntil || r.leaseUntil <= now)) {
      await db.receipts.update(r.id, { status: 'queued', leaseUntil: undefined });
      count++;
    }
  }
  return count;
}

/**
 * Shared DOM-free queue processor used by both the Service Worker and the page.
 * Handles AI calls, lease management, interruption vs. genuine strike counting,
 * and marks receipts as `ai_failed` when OCR should take over.
 */
export async function runWorkerQueue(deps: WorkerQueueDeps = {}): Promise<void> {
  await withQueueLock(async () => {
    const nowFn = deps.now ?? (() => Date.now());
    const onlineFn = deps.online ?? (() => (typeof navigator !== 'undefined' ? navigator.onLine !== false : true));
    const hiddenFn = deps.hidden ?? (() => (typeof document !== 'undefined' ? document.visibilityState === 'hidden' : false));
    const aiFn = deps.ai ?? ((b, m, k, mod) => parseReceipt(b, m, k, mod));
    const maxStrikes = deps.maxStrikes ?? MAX_AI_STRIKES;
    const maxWaitMs = deps.maxWaitMs ?? MAX_AI_WAIT_MS;
    const leaseMs = deps.leaseDurationMs ?? LEASE_DURATION_MS;
    const backoffMs = deps.retryBackoffMs ?? RETRY_BACKOFF_MS;

    await reclaimExpiredLeases(nowFn());

    for (;;) {
      const settings: Settings = await getSettings();
      const now = nowFn();
      const queued = await db.receipts.where('status').equals('queued').sortBy('createdAt');
      const next = queued.find((r) => !r.nextAttemptAt || r.nextAttemptAt <= now);
      if (!next?.id) break;

      const mime = next.imageType || next.image?.type || 'image/jpeg';
      const isPdf = mime === 'application/pdf';
      const allowOcr = settings.ocrOnly || (settings.ocrFallback ?? true);
      const isOnline = onlineFn();

      // Immediate OCR paths: privacy mode (ocrOnly), no API key, or device is offline
      if (settings.ocrOnly || !settings.apiKey || !isOnline) {
        const reason = settings.ocrOnly
          ? 'On-device only mode is enabled.'
          : !settings.apiKey
            ? 'No Gemini API key configured.'
            : 'Device was offline.';
        if (allowOcr && !isPdf) {
          await db.receipts.update(next.id, {
            status: 'ai_failed',
            aiError: reason,
            leaseUntil: undefined,
          });
          continue;
        }
        // If OCR is disabled or it's a PDF:
        if (!settings.apiKey || settings.ocrOnly) {
          await db.receipts.update(next.id, {
            status: 'error',
            error: isPdf ? `${reason} PDF e-receipts cannot be read with on-device OCR.` : reason,
            leaseUntil: undefined,
          });
          continue;
        }
        // Offline + OCR disabled: leave queued until back online
        break;
      }

      // Check if this receipt has already waited >= maxWaitMs (10 minutes)
      if (now - next.createdAt >= maxWaitMs) {
        if (allowOcr && !isPdf) {
          await db.receipts.update(next.id, {
            status: 'ai_failed',
            aiError: next.aiError || 'Timed out waiting for Gemini AI (>10 minutes).',
            leaseUntil: undefined,
          });
        } else {
          await db.receipts.update(next.id, {
            status: 'error',
            error: next.aiError || 'Timed out waiting for Gemini AI (>10 minutes).',
            leaseUntil: undefined,
          });
        }
        continue;
      }

      // Claim lease
      const attempts = (next.attempts ?? 0) + 1;
      await db.receipts.update(next.id, {
        status: 'processing',
        leaseUntil: now + leaseMs,
        attempts,
        error: undefined,
      });

      try {
        if (!next.image) throw new Error('No image attached.');
        const draft = await aiFn(next.image, mime, settings.apiKey, settings.model);
        const others = await db.receipts.where('status').anyOf('saved', 'needs_review').toArray();
        const dup = findDuplicate({ id: next.id, merchant: draft.merchant, date: draft.date, total: draft.total }, others);
        const updated: Partial<Receipt> = {
          status: 'needs_review',
          draft,
          parsedBy: 'gemini',
          aiError: undefined,
          error: undefined,
          leaseUntil: undefined,
          nextAttemptAt: undefined,
          duplicateOf: dup?.id ?? next.duplicateOf,
        };
        await db.receipts.update(next.id, updated);
        if (deps.onReceiptFinished) {
          await deps.onReceiptFinished({ ...next, ...updated });
        }
      } catch (e) {
        const currentNow = nowFn();
        const onlineNow = onlineFn();
        const hiddenNow = hiddenFn();
        const friendly = describeGeminiError(e);
        const is4xxKeyError = e instanceof GeminiError && !!e.status && e.status >= 400 && e.status < 500 && e.status !== 408 && e.status !== 429;

        // If the failure was caused by the screen locking / page hiding / connection dropping mid-flight,
        // do NOT count a strike and do NOT jump to OCR—re-queue cleanly so the Service Worker or next wakeup finishes it.
        if (!is4xxKeyError && isInterruptedFailure(e, onlineNow, hiddenNow)) {
          await db.receipts.update(next.id, {
            status: 'queued',
            leaseUntil: undefined,
            aiError: friendly,
            nextAttemptAt: currentNow + 1500,
          });
          break;
        }

        const strikes = is4xxKeyError ? maxStrikes : (next.strikes ?? 0) + 1;
        const waitedTooLong = currentNow - next.createdAt >= maxWaitMs;

        if (strikes >= maxStrikes || waitedTooLong) {
          if (allowOcr && !isPdf) {
            await db.receipts.update(next.id, {
              status: 'ai_failed',
              strikes,
              aiError: friendly,
              leaseUntil: undefined,
              nextAttemptAt: undefined,
            });
          } else {
            await db.receipts.update(next.id, {
              status: 'error',
              strikes,
              aiError: friendly,
              error: isPdf && allowOcr ? `${friendly} (PDF e-receipts cannot be read with on-device OCR.)` : friendly,
              leaseUntil: undefined,
              nextAttemptAt: undefined,
            });
          }
        } else {
          // Genuine failure #1 (below maxStrikes): schedule retry after backoff
          await db.receipts.update(next.id, {
            status: 'queued',
            strikes,
            aiError: friendly,
            leaseUntil: undefined,
            nextAttemptAt: currentNow + backoffMs,
          });
          // Break out of immediate tight loop so the timer / sync picks up the next strike
          break;
        }
      }
    }
  });
}
