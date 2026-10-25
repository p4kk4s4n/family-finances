import { db } from '../db/schema';
import { findDuplicate } from '../db/dedupe';
import type { BankTransaction, Budget, Item, Receipt } from '../types';

export interface ExportFile {
  app: 'family-finances';
  format: 1 | 2;
  exportedAt: string;
  receipts: Omit<Receipt, 'image' | 'draft'>[];
  items: Item[];
  budgets: Budget[];
  bankTransactions?: BankTransaction[];
}

/** JSON export of saved data. Photos and the API key are never included. */
export async function buildExport(): Promise<ExportFile> {
  const receipts = (await db.receipts.where('status').equals('saved').toArray()).map(({ image: _i, draft: _d, ...r }) => r);
  return {
    app: 'family-finances',
    format: 2,
    exportedAt: new Date().toISOString(),
    receipts,
    items: await db.items.toArray(),
    budgets: await db.budgets.toArray(),
    bankTransactions: await db.bankTransactions.toArray(),
  };
}

export async function exportBlob(): Promise<Blob> {
  return new Blob([JSON.stringify(await buildExport(), null, 2)], { type: 'application/json' });
}

export function exportFilename(): string {
  return `family-finances-${new Date().toISOString().slice(0, 10)}.json`;
}

/** Merge a partner's (or backup) export into local data, skipping receipts that already exist. */
export async function importExport(file: Blob, opts: { replaceBudgets?: boolean } = {}): Promise<{ added: number; skipped: number }> {
  const data = JSON.parse(await file.text()) as ExportFile;
  if (data?.app !== 'family-finances' || !Array.isArray(data.receipts)) throw new Error('Not a Family Finances export file.');
  let added = 0;
  let skipped = 0;
  await db.transaction('rw', db.receipts, db.items, db.budgets, db.bankTransactions, async () => {
    const existing = await db.receipts.where('status').equals('saved').toArray();
    for (const r of data.receipts) {
      const { id: oldId, ...rest } = r;
      if (findDuplicate({ merchant: r.merchant, date: r.date, total: r.total }, existing)) {
        skipped++;
        continue;
      }
      const newId = await db.receipts.add({ ...rest, status: 'saved', source: 'import' } as Receipt);
      const items = data.items.filter((i) => i.receiptId === oldId).map(({ id: _x, ...i }) => ({ ...i, receiptId: newId }));
      await db.items.bulkAdd(items as Item[]);
      existing.push({ ...(rest as Receipt), id: newId });
      added++;
    }
    if (opts.replaceBudgets && Array.isArray(data.budgets)) await db.budgets.bulkPut(data.budgets);
  });
  return { added, skipped };
}
