import Dexie, { type Table } from 'dexie';
import type { BankTransaction, Budget, Item, Receipt, Settings } from '../types';
import { CATEGORIES } from '../lib/categories';

export class FamilyFinancesDB extends Dexie {
  receipts!: Table<Receipt, number>;
  items!: Table<Item, number>;
  budgets!: Table<Budget, string>;
  settings!: Table<Settings, string>;
  bankTransactions!: Table<BankTransaction, number>;

  constructor() {
    super('family-finances');
    this.version(1).stores({
      receipts: '++id, status, date, merchant, createdAt, imageHash',
      items: '++id, receiptId, date, category, normalizedName, merchant',
      budgets: 'category',
      settings: 'key',
    });
    this.version(2).stores({
      receipts: '++id, status, date, merchant, createdAt, imageHash',
      items: '++id, receiptId, date, category, normalizedName, merchant',
      budgets: 'category',
      settings: 'key',
      bankTransactions: '++id, status, date, merchant, matchedReceiptId',
    });
    this.on('populate', (tx) => {
      tx.table('budgets').bulkAdd(CATEGORIES.map((c) => ({ category: c.name, monthlyLimit: c.defaultBudget })));
    });
  }
}

export const db = new FamilyFinancesDB();

export const DEFAULT_SETTINGS: Settings = {
  key: 'app',
  model: 'gemini-flash-latest',
  brlRateFallback: 0.18,
  autoFxRate: true,
  leakageThreshold: 10,
  backupBeforeUpdate: true,
  ocrFallback: true,
  ocrOnly: false,
  notifyWhenReady: true,
  fontScale: 1,
  iconScale: 1,
  resolutionScale: 1,
};

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app');
  return { ...DEFAULT_SETTINGS, ...(s ?? {}) };
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = { ...(await getSettings()), ...patch, key: 'app' as const };
  await db.settings.put(next);
  return next;
}
