import type { BrandTier, Item } from '../types';
import { round2 } from '../lib/currency';
import { median, toTime } from './metrics';

const DAY = 86_400_000;

export interface StorePricePoint {
  merchant: string;
  medianPrice: number;
  latestPrice: number;
  latestDate: string;
  count: number;
}

export interface StoreComparison {
  name: string;
  category: string;
  cheapest: StorePricePoint;
  mostExpensive: StorePricePoint;
  savingsPerUnit: number;
  spreadPct: number;
  stores: StorePricePoint[];
}

function cleanMerchantDisplay(m: string): string {
  return (m || 'Unknown').trim().replace(/\s+#\d+.*$/, '');
}

/**
 * Compares unit prices of identical normalized items across different stores.
 * By default returns products purchased at 2+ stores, or all products if `minStores = 1`.
 */
export function storePriceComparison(items: Item[], minStores = 2): StoreComparison[] {
  const byProduct = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.normalizedName || !(it.unitPriceUSD > 0)) continue;
    byProduct.set(it.normalizedName, [...(byProduct.get(it.normalizedName) ?? []), it]);
  }

  const results: StoreComparison[] = [];

  for (const [name, list] of byProduct) {
    const byStore = new Map<string, { display: string; rows: Item[] }>();
    for (const row of list) {
      const display = cleanMerchantDisplay(row.merchant);
      const key = display.toLowerCase();
      const entry = byStore.get(key) ?? { display, rows: [] };
      entry.rows.push(row);
      byStore.set(key, entry);
    }

    if (byStore.size < minStores) continue;

    const stores: StorePricePoint[] = [];
    for (const { display, rows } of byStore.values()) {
      const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
      const latest = sorted[sorted.length - 1];
      const med = median(rows.map((r) => r.unitPriceUSD)) ?? latest.unitPriceUSD;
      stores.push({
        merchant: display,
        medianPrice: round2(med),
        latestPrice: round2(latest.unitPriceUSD),
        latestDate: latest.date,
        count: rows.length,
      });
    }

    stores.sort((a, b) => a.medianPrice - b.medianPrice);
    const cheapest = stores[0];
    const mostExpensive = stores[stores.length - 1];
    const savingsPerUnit = round2(Math.max(0, mostExpensive.medianPrice - cheapest.medianPrice));
    const spreadPct =
      mostExpensive.medianPrice > 0
        ? round2(((mostExpensive.medianPrice - cheapest.medianPrice) / mostExpensive.medianPrice) * 100)
        : 0;

    results.push({
      name,
      category: list[list.length - 1].category,
      cheapest,
      mostExpensive,
      savingsPerUnit,
      spreadPct,
      stores,
    });
  }

  return results.sort((a, b) => b.savingsPerUnit - a.savingsPerUnit || b.spreadPct - a.spreadPct);
}

export interface PriceJumpAlert {
  name: string;
  category: string;
  merchant: string;
  date: string;
  historicalMedian: number;
  latestPrice: number;
  jumpPct: number;
  dollarImpact: number;
}

/**
 * Flags products where the most recent unit price jumped by >= thresholdPct%
 * compared to the median of prior purchases.
 */
export function priceJumpAlerts(items: Item[], thresholdPct = 15): PriceJumpAlert[] {
  const byProduct = new Map<string, Item[]>();
  for (const it of items) {
    if (!it.normalizedName || !(it.unitPriceUSD > 0)) continue;
    byProduct.set(it.normalizedName, [...(byProduct.get(it.normalizedName) ?? []), it]);
  }

  const alerts: PriceJumpAlert[] = [];
  for (const [name, list] of byProduct) {
    if (list.length < 2) continue;
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
    const latest = sorted[sorted.length - 1];
    const prior = sorted.slice(0, -1);
    const histMed = median(prior.map((p) => p.unitPriceUSD));
    if (!histMed || histMed <= 0) continue;

    const jumpPct = round2(((latest.unitPriceUSD - histMed) / histMed) * 100);
    if (jumpPct >= thresholdPct) {
      alerts.push({
        name,
        category: latest.category,
        merchant: cleanMerchantDisplay(latest.merchant),
        date: latest.date,
        historicalMedian: round2(histMed),
        latestPrice: round2(latest.unitPriceUSD),
        jumpPct,
        dollarImpact: round2((latest.unitPriceUSD - histMed) * latest.quantity),
      });
    }
  }

  return alerts.sort((a, b) => b.jumpPct - a.jumpPct);
}

export type ReorderStatus = 'overdue' | 'due_soon' | 'stocked';

export interface PantryPrediction {
  name: string;
  category: string;
  cadenceDays: number;
  lastDate: string;
  lastMerchant: string;
  lastPriceUSD: number;
  daysSinceLast: number;
  daysRemaining: number;
  status: ReorderStatus;
  purchasesCount: number;
}

/**
 * Estimates when staple (non-discretionary) items will need reordering based on
 * the median number of days between distinct purchase dates.
 */
export function pantryReorderPredictions(items: Item[], refDate: string): PantryPrediction[] {
  const staples = items.filter((i) => !i.isDiscretionary && i.normalizedName);
  const byProduct = new Map<string, Item[]>();
  for (const it of staples) {
    byProduct.set(it.normalizedName, [...(byProduct.get(it.normalizedName) ?? []), it]);
  }

  const refTime = toTime(refDate);
  const out: PantryPrediction[] = [];

  for (const [name, list] of byProduct) {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date) || (a.id ?? 0) - (b.id ?? 0));
    const distinctDates = [...new Set(sorted.map((r) => r.date))].sort();
    if (distinctDates.length < 2) continue;

    const intervals: number[] = [];
    for (let i = 1; i < distinctDates.length; i++) {
      const diff = Math.round((toTime(distinctDates[i]) - toTime(distinctDates[i - 1])) / DAY);
      if (diff > 0) intervals.push(diff);
    }
    if (!intervals.length) continue;

    const cadenceDays = Math.max(1, Math.round(median(intervals)!));
    const latest = sorted[sorted.length - 1];
    const daysSinceLast = Math.max(0, Math.round((refTime - toTime(latest.date)) / DAY));
    const daysRemaining = cadenceDays - daysSinceLast;
    const status: ReorderStatus = daysRemaining <= 0 ? 'overdue' : daysRemaining <= 3 ? 'due_soon' : 'stocked';

    out.push({
      name,
      category: latest.category,
      cadenceDays,
      lastDate: latest.date,
      lastMerchant: cleanMerchantDisplay(latest.merchant),
      lastPriceUSD: round2(latest.unitPriceUSD),
      daysSinceLast,
      daysRemaining,
      status,
      purchasesCount: distinctDates.length,
    });
  }

  return out.sort((a, b) => a.daysRemaining - b.daysRemaining);
}

export interface ProductHistoryEntry {
  date: string;
  merchant: string;
  unitPriceUSD: number;
  quantity: number;
  totalUSD: number;
  brandTier: BrandTier;
}

export function productPriceHistory(items: Item[], normalizedName: string): ProductHistoryEntry[] {
  return items
    .filter((i) => i.normalizedName === normalizedName)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.id ?? 0) - (a.id ?? 0))
    .map((i) => ({
      date: i.date,
      merchant: cleanMerchantDisplay(i.merchant),
      unitPriceUSD: round2(i.unitPriceUSD),
      quantity: i.quantity,
      totalUSD: round2(i.totalUSD),
      brandTier: i.brandTier,
    }));
}
