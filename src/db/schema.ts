import Dexie, { type Table } from 'dexie';
import type { Budget, Item, Receipt, Settings } from '../types';
import { CATEGORIES } from '../lib/categories';

export class FamilyFinancesDB extends Dexie {
  receipts!: Table<Receipt, number>;
  items!: Table<Item, number>;
  budgets!: Table<Budget, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('family-finances');
    this.version(1).stores({
      receipts: '++id, status, date, merchant, createdAt, imageHash',
      items: '++id, receiptId, date, category, normalizedName, merchant',
      budgets: 'category',
      settings: 'key',
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
