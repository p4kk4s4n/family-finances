import type { Budget, Item } from '../types';
import { categoryDef } from '../lib/categories';
import { round2 } from '../lib/currency';

const DAY = 86_400_000;

export function toTime(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function itemsInMonth(items: Item[], ym: string): Item[] {
  return items.filter((i) => i.date.startsWith(ym));
}

export function itemsBetween(items: Item[], fromExclusive: number, toInclusive: number): Item[] {
  return items.filter((i) => {
    const t = toTime(i.date);
    return t > fromExclusive && t <= toInclusive;
  });
}

export function sumUSD(items: Item[]): number {
  return round2(items.reduce((s, i) => s + i.totalUSD, 0));
}

export function spendByCategory(items: Item[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const i of items) out[i.category] = round2((out[i.category] ?? 0) + i.totalUSD);
  return out;
}

export interface BudgetLine {
  category: string;
  limit: number;
  spent: number;
  pct: number;
  projected: number;
  status: 'ok' | 'warn' | 'over';
}

/** Spend vs budget per category, with a straight-line month-end projection. */
export function budgetStatus(budgets: Budget[], spend: Record<string, number>, dayOfMonth: number, monthDays: number): BudgetLine[] {
  const cats = new Set([...budgets.map((b) => b.category), ...Object.keys(spend)]);
  return [...cats]
    .map((category) => {
      const limit = budgets.find((b) => b.category === category)?.monthlyLimit ?? 0;
      const spent = spend[category] ?? 0;
      const projected = round2(dayOfMonth > 0 ? (spent / dayOfMonth) * monthDays : spent);
      const pct = limit > 0 ? spent / limit : spent > 0 ? Infinity : 0;
      const status: BudgetLine['status'] = spent > limit ? 'over' : projected > limit ? 'warn' : 'ok';
      return { category, limit, spent, pct, projected, status };
    })
    .filter((l) => l.limit > 0 || l.spent > 0)
    .sort((a, b) => b.spent - a.spent);
}

export interface LeakageResult {
  total: number;
  count: number;
  top: { name: string; total: number; count: number }[];
}

/** "Receipt leakage": small discretionary add-ons that quietly drain the budget. */
export function leakage(items: Item[], threshold: number): LeakageResult {
  const small = items.filter((i) => i.isDiscretionary && i.totalUSD > 0 && i.totalUSD <= threshold);
  const byName = new Map<string, { name: string; total: number; count: number }>();
  for (const i of small) {
    const e = byName.get(i.normalizedName) ?? { name: i.normalizedName, total: 0, count: 0 };
    e.total = round2(e.total + i.totalUSD);
    e.count += 1;
    byName.set(i.normalizedName, e);
  }
  return {
    total: sumUSD(small),
    count: small.length,
    top: [...byName.values()].sort((a, b) => b.total - a.total).slice(0, 5),
  };
}

export function median(nums: number[]): number | null {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface BrandOpportunity {
  name: string;
  storeAvg: number;
  nameAvg: number;
  nameQty: number;
  savings: number;
}

/** Where you bought name brands for products you've also bought as store brand: potential savings. */
export function brandSavings(items: Item[]): { total: number; opportunities: BrandOpportunity[] } {
  const groups = new Map<string, Item[]>();
  for (const i of items) {
    if (i.brandTier === 'unknown') continue;
    groups.set(i.normalizedName, [...(groups.get(i.normalizedName) ?? []), i]);
  }
  const opportunities: BrandOpportunity[] = [];
  for (const [name, list] of groups) {
    const store = list.filter((i) => i.brandTier === 'store');
    const named = list.filter((i) => i.brandTier === 'name');
    if (!store.length || !named.length) continue;
    const storeAvg = median(store.map((i) => i.unitPriceUSD))!;
    const nameAvg = median(named.map((i) => i.unitPriceUSD))!;
    const nameQty = named.reduce((s, i) => s + i.quantity, 0);
    const savings = round2(Math.max(0, nameAvg - storeAvg) * nameQty);
    if (savings > 0) opportunities.push({ name, storeAvg: round2(storeAvg), nameAvg: round2(nameAvg), nameQty, savings });
  }
  opportunities.sort((a, b) => b.savings - a.savings);
  return { total: round2(opportunities.reduce((s, o) => s + o.savings, 0)), opportunities };
}

export interface PriceChange {
  name: string;
  recent: number;
  baseline: number;
  pct: number;
  recentSpend: number;
}

/**
 * Per-item inflation: median unit price in the last 30 days vs the 30 days ending `windowDays` ago.
 * Example: windowDays=90 compares [ref-30d, ref] against [ref-120d, ref-90d].
 */
export function priceChanges(items: Item[], refDate: string, windowDays: number): PriceChange[] {
  const ref = toTime(refDate);
  const recent = itemsBetween(items, ref - 30 * DAY, ref);
  const baseline = itemsBetween(items, ref - (windowDays + 30) * DAY, ref - windowDays * DAY);
  const names = new Set(recent.map((i) => i.normalizedName));
  const out: PriceChange[] = [];
  for (const name of names) {
    const r = recent.filter((i) => i.normalizedName === name);
    const b = baseline.filter((i) => i.normalizedName === name);
    if (!b.length) continue;
    const rm = median(r.map((i) => i.unitPriceUSD))!;
    const bm = median(b.map((i) => i.unitPriceUSD))!;
    if (bm <= 0) continue;
    out.push({ name, recent: round2(rm), baseline: round2(bm), pct: round2(((rm - bm) / bm) * 100), recentSpend: sumUSD(r) });
  }
  return out.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
}

/** Your personal basket inflation: spend-weighted average price change of items you actually buy. */
export function basketInflation(items: Item[], refDate: string, windowDays: number): { pct: number | null; tracked: PriceChange[] } {
  const tracked = priceChanges(items, refDate, windowDays);
  const weight = tracked.reduce((s, t) => s + t.recentSpend, 0);
  if (!tracked.length || weight <= 0) return { pct: null, tracked };
  return { pct: round2(tracked.reduce((s, t) => s + t.pct * t.recentSpend, 0) / weight), tracked };
}

export interface FlexResult {
  budgetTotal: number;
  essentialsSpent: number;
  essentialsProjected: number;
  discretionarySpent: number;
  flex: number;
  dailyFlex: number;
  remainingDays: number;
}

/**
 * Discretionary flexibility: how much you can still spend on wants this month after
 * projecting essentials to month-end (inflation-adjusted for the remaining days).
 */
export function discretionaryFlex(args: {
  budgetTotal: number;
  monthItems: Item[];
  dayOfMonth: number;
  monthDays: number;
  inflationPct: number | null;
}): FlexResult {
  const { budgetTotal, monthItems, dayOfMonth, monthDays, inflationPct } = args;
  const essentialsSpent = sumUSD(monthItems.filter((i) => !i.isDiscretionary));
  const discretionarySpent = sumUSD(monthItems.filter((i) => i.isDiscretionary));
  const runRate = dayOfMonth > 0 ? essentialsSpent / dayOfMonth : 0;
  const remainingDays = Math.max(0, monthDays - dayOfMonth);
  const inflationFactor = 1 + Math.max(0, inflationPct ?? 0) / 100;
  const essentialsProjected = round2(essentialsSpent + runRate * remainingDays * inflationFactor);
  const flex = round2(budgetTotal - essentialsProjected - discretionarySpent);
  return {
    budgetTotal,
    essentialsSpent,
    essentialsProjected,
    discretionarySpent,
    flex,
    dailyFlex: round2(flex / Math.max(1, remainingDays)),
    remainingDays,
  };
}

export function topItems(items: Item[], n = 5): { name: string; total: number; count: number }[] {
  const m = new Map<string, { name: string; total: number; count: number }>();
  for (const i of items) {
    const e = m.get(i.normalizedName) ?? { name: i.normalizedName, total: 0, count: 0 };
    e.total = round2(e.total + i.totalUSD);
    e.count += 1;
    m.set(i.normalizedName, e);
  }
  return [...m.values()].sort((a, b) => b.total - a.total).slice(0, n);
}

export function isDiscretionaryCategory(c: string): boolean {
  return categoryDef(c).discretionary;
}
