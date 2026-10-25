import { db, getSettings } from '../db/schema';
import { sameMerchant } from '../db/dedupe';
import { normalizeItemName } from '../capture/validate';
import { categoryDef, normalizeCategory } from '../lib/categories';
import { resolveRate, round2, toUSD } from '../lib/currency';
import { toTime } from '../insights/metrics';
import type { BankTransaction, Item, Receipt } from '../types';
import { parseStatementCSV, parseStatementOFX, parseStatementWithGemini, type RawBankRow } from './parser';

const DAY = 86_400_000;

/**
 * Matches bank statement charges against saved receipts (within ±maxDaysDiff days),
 * assigning at most one bank charge per receipt.
 */
export function matchTransactionsToReceipts(
  txs: BankTransaction[],
  receipts: Receipt[],
  maxDaysDiff = 3,
): BankTransaction[] {
  const saved = receipts.filter((r) => r.status === 'saved' && r.id != null && r.date && typeof r.total === 'number');
  const alreadyClaimed = new Set<number>(
    txs.filter((t) => t.status === 'matched' || t.status === 'imported').map((t) => t.matchedReceiptId!).filter(Boolean),
  );

  interface Candidate {
    txIdx: number;
    receiptId: number;
    score: number;
  }

  const candidates: Candidate[] = [];

  txs.forEach((tx, txIdx) => {
    if (tx.status !== 'unmatched') return;
    const txTime = toTime(tx.date);
    if (isNaN(txTime)) return;

    for (const r of saved) {
      if (alreadyClaimed.has(r.id!)) continue;
      const rTime = toTime(r.date!);
      if (isNaN(rTime)) continue;

      const dayDiff = Math.abs(txTime - rTime) / DAY;
      if (dayDiff > maxDaysDiff) continue;

      const sameCurr = (tx.currency || 'USD') === (r.currency || 'USD');
      const origDiff = sameCurr ? Math.abs(tx.amount - (r.total ?? 0)) : Infinity;
      const usdDiff = Math.abs(tx.amountUSD - (r.totalUSD ?? r.total ?? 0));
      const usdTol = Math.max(0.05, tx.amountUSD * 0.015);

      const amountMatches = origDiff <= 0.05 || usdDiff <= usdTol;
      if (!amountMatches) continue;

      const merchantMatch = sameMerchant(tx.merchant, r.merchant) || sameMerchant(tx.description, r.merchant);
      const exactAmountAndCloseDate = (origDiff <= 0.01 || usdDiff <= 0.01) && dayDiff <= 2;

      if (!merchantMatch && !exactAmountAndCloseDate) continue;

      const score = (merchantMatch ? 100 : 40) - dayDiff * 5 - Math.min(origDiff, usdDiff) * 10;
      candidates.push({ txIdx, receiptId: r.id!, score });
    }
  });

  candidates.sort((a, b) => b.score - a.score);

  const matchedTxIndices = new Set<number>();
  const result = txs.map((t) => ({ ...t }));

  for (const c of candidates) {
    if (matchedTxIndices.has(c.txIdx) || alreadyClaimed.has(c.receiptId)) continue;
    matchedTxIndices.add(c.txIdx);
    alreadyClaimed.add(c.receiptId);
    result[c.txIdx] = {
      ...result[c.txIdx],
      status: 'matched',
      matchedReceiptId: c.receiptId,
    };
  }

  return result;
}

/**
 * Converts raw parsed statement rows into BankTransactions (with FX conversion and receipt matching).
 */
export async function buildBankTransactions(
  rawRows: RawBankRow[],
  existingReceipts: Receipt[],
  statementName?: string,
): Promise<BankTransaction[]> {
  const settings = await getSettings();
  const rateCache = new Map<string, number>();

  const preliminary: BankTransaction[] = [];
  const now = Date.now();

  for (const r of rawRows) {
    const cacheKey = `${r.currency}:${r.date}`;
    let rate = rateCache.get(cacheKey);
    if (rate == null) {
      rate = (await resolveRate(r.currency, r.date, settings)).rate;
      rateCache.set(cacheKey, rate);
    }
    preliminary.push({
      importedAt: now,
      date: r.date,
      description: r.description,
      merchant: r.merchant,
      amount: r.amount,
      currency: r.currency,
      fxRate: rate,
      amountUSD: toUSD(r.amount, rate),
      suggestedCategory: normalizeCategory(r.suggestedCategory),
      status: 'unmatched',
      statementName,
    });
  }

  return matchTransactionsToReceipts(preliminary, existingReceipts);
}

/**
 * High-level statement file ingestion: parses CSV/OFX locally or PDF/image/fallback via Gemini,
 * deduplicates against already-imported bank rows, matches against saved receipts, and saves to IndexedDB.
 */
export async function ingestStatementFile(
  file: File,
  opts: { forceGemini?: boolean; defaultCurrency?: string } = {},
): Promise<{ total: number; matched: number; unmatched: number; skippedDuplicates: number }> {
  const settings = await getSettings();
  const name = file.name || 'statement';
  const lower = name.toLowerCase();
  const mime = file.type || (lower.endsWith('.pdf') ? 'application/pdf' : 'text/csv');
  const isPdfOrImage =
    mime === 'application/pdf' || mime.startsWith('image/') || /\.(pdf|png|jpe?g|webp)$/i.test(lower);

  let rawRows: RawBankRow[] = [];

  if (opts.forceGemini || isPdfOrImage) {
    if (!settings.apiKey) {
      throw new Error('Add your Gemini API key in Settings to parse PDF or image statements.');
    }
    rawRows = await parseStatementWithGemini(file, mime, settings.apiKey, settings.model);
  } else {
    const text = await file.text();
    if (/\.q?ofx$/i.test(lower) || /<OFX|<STMTTRN>/i.test(text)) {
      rawRows = parseStatementOFX(text, opts.defaultCurrency);
    } else {
      rawRows = parseStatementCSV(text, opts.defaultCurrency);
    }
    if (rawRows.length === 0 && settings.apiKey) {
      rawRows = await parseStatementWithGemini(file, 'text/csv', settings.apiKey, settings.model);
    }
  }

  if (rawRows.length === 0) {
    throw new Error('No expense transactions found in that file.');
  }

  const existingBank = await db.bankTransactions.toArray();
  const dedupedRaw = rawRows.filter(
    (r) =>
      !existingBank.some(
        (eb) =>
          eb.date === r.date &&
          Math.abs(eb.amount - r.amount) < 0.01 &&
          (sameMerchant(eb.merchant, r.merchant) || eb.description === r.description),
      ),
  );
  const skippedDuplicates = rawRows.length - dedupedRaw.length;

  const savedReceipts = await db.receipts.where('status').equals('saved').toArray();
  const built = await buildBankTransactions(dedupedRaw, savedReceipts, name);

  if (built.length > 0) {
    await db.bankTransactions.bulkAdd(built);
  }

  const matched = built.filter((b) => b.status === 'matched').length;
  const unmatched = built.filter((b) => b.status === 'unmatched').length;

  return { total: built.length, matched, unmatched, skippedDuplicates };
}

/**
 * One-tap import: converts an unmatched bank charge into a saved Receipt + Item (`source: 'bank'`).
 */
export async function importChargeAsReceipt(txId: number, categoryOverride?: string): Promise<number> {
  const tx = await db.bankTransactions.get(txId);
  if (!tx) throw new Error('Bank transaction not found.');
  if (tx.status === 'imported' && tx.matchedReceiptId) return tx.matchedReceiptId;

  const category = normalizeCategory(categoryOverride ?? tx.suggestedCategory);
  const disc = categoryDef(category).discretionary;

  let receiptId = 0;
  await db.transaction('rw', db.receipts, db.items, db.bankTransactions, async () => {
    receiptId = await db.receipts.add({
      createdAt: Date.now(),
      status: 'saved',
      source: 'bank',
      merchant: tx.merchant,
      date: tx.date,
      currency: tx.currency,
      fxRate: tx.fxRate,
      fxSource: tx.currency === 'USD' ? 'none' : 'auto',
      subtotal: tx.amount,
      tax: null,
      total: tx.amount,
      totalUSD: round2(tx.amountUSD),
      paymentMethod: 'Bank Statement',
    });

    const item: Item = {
      receiptId,
      date: tx.date,
      merchant: tx.merchant,
      rawName: tx.description || tx.merchant,
      normalizedName: normalizeItemName(tx.merchant),
      category,
      quantity: 1,
      unitPrice: tx.amount,
      total: tx.amount,
      currency: tx.currency,
      fxRate: tx.fxRate,
      unitPriceUSD: round2(tx.amountUSD),
      totalUSD: round2(tx.amountUSD),
      isDiscretionary: disc,
      brandTier: 'unknown',
    };

    await db.items.add(item);
    await db.bankTransactions.update(txId, {
      status: 'imported',
      matchedReceiptId: receiptId,
      suggestedCategory: category,
    });
  });

  return receiptId;
}

export async function importAllUnmatchedCharges(): Promise<number> {
  const unmatched = await db.bankTransactions.where('status').equals('unmatched').toArray();
  for (const tx of unmatched) {
    if (tx.id != null) await importChargeAsReceipt(tx.id);
  }
  return unmatched.length;
}

export async function linkChargeToReceipt(txId: number, receiptId: number): Promise<void> {
  await db.bankTransactions.update(txId, { status: 'matched', matchedReceiptId: receiptId });
}

export async function ignoreBankTransaction(txId: number): Promise<void> {
  await db.bankTransactions.update(txId, { status: 'ignored' });
}

/**
 * Re-runs automatic receipt matching across all currently unmatched bank transactions
 * (e.g. after snapping a receipt for an earlier purchase).
 */
export async function rescanUnmatchedTransactions(): Promise<number> {
  const allTx = await db.bankTransactions.toArray();
  const savedReceipts = await db.receipts.where('status').equals('saved').toArray();
  const updated = matchTransactionsToReceipts(allTx, savedReceipts);
  let newlyMatched = 0;
  await db.transaction('rw', db.bankTransactions, async () => {
    for (let i = 0; i < allTx.length; i++) {
      if (allTx[i].status === 'unmatched' && updated[i].status === 'matched' && allTx[i].id != null) {
        await db.bankTransactions.update(allTx[i].id!, {
          status: 'matched',
          matchedReceiptId: updated[i].matchedReceiptId,
        });
        newlyMatched++;
      }
    }
  });
  return newlyMatched;
}
