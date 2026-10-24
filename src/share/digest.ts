import type { Budget, Item } from '../types';
import { formatMoney, round2 } from '../lib/currency';
import { categoryDef } from '../lib/categories';
import { basketInflation, daysInMonth, itemsBetween, leakage, spendByCategory, sumUSD, toTime } from '../insights/metrics';

const DAY = 86_400_000;

export interface WeeklyDigest {
  from: string;
  to: string;
  spent: number;
  weeklyBudget: number;
  pctOfBudget: number;
  topCategories: { category: string; total: number }[];
  leakageTotal: number;
  leakageCount: number;
  biggestMover: { name: string; pct: number } | null;
  receiptsCount: number;
}

export function buildWeeklyDigest(items: Item[], budgets: Budget[], refDate: string, leakageThreshold = 10): WeeklyDigest {
  const ref = toTime(refDate);
  const week = itemsBetween(items, ref - 7 * DAY, ref);
  const monthly = budgets.reduce((s, b) => s + b.monthlyLimit, 0);
  const weeklyBudget = round2((monthly * 7) / daysInMonth(refDate.slice(0, 7)));
  const spent = sumUSD(week);
  const byCat = spendByCategory(week);
  const leak = leakage(week, leakageThreshold);
  const infl = basketInflation(items, refDate, 90);
  const mover = infl.tracked[0];
  return {
    from: new Date(ref - 6 * DAY).toISOString().slice(0, 10),
    to: refDate,
    spent,
    weeklyBudget,
    pctOfBudget: weeklyBudget > 0 ? round2((spent / weeklyBudget) * 100) : 0,
    topCategories: Object.entries(byCat)
      .map(([category, total]) => ({ category, total }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 3),
    leakageTotal: leak.total,
    leakageCount: leak.count,
    biggestMover: mover ? { name: mover.name, pct: mover.pct } : null,
    receiptsCount: new Set(week.map((i) => i.receiptId)).size,
  };
}

/** Plain-text update for messaging a partner (SMS, WhatsApp, etc.). */
export function digestToText(d: WeeklyDigest): string {
  const diff = round2(d.weeklyBudget - d.spent);
  const lines = [
    `🧾 Family Finances: week of ${d.from} → ${d.to}`,
    `Spent ${formatMoney(d.spent)} of ${formatMoney(d.weeklyBudget)} weekly budget (${Math.round(d.pctOfBudget)}%).`,
    diff >= 0 ? `✅ ${formatMoney(diff)} under budget.` : `⚠️ ${formatMoney(-diff)} over budget.`,
  ];
  if (d.topCategories.length) {
    lines.push('Top categories: ' + d.topCategories.map((c) => `${categoryDef(c.category).emoji} ${c.category} ${formatMoney(c.total)}`).join(', '));
  }
  if (d.leakageCount) lines.push(`💧 Small treats/impulse: ${d.leakageCount} items, ${formatMoney(d.leakageTotal)}.`);
  if (d.biggestMover) lines.push(`📈 Biggest price change: ${d.biggestMover.name} ${d.biggestMover.pct > 0 ? '+' : ''}${d.biggestMover.pct}% vs 3 months ago.`);
  lines.push(`(${d.receiptsCount} receipts this week)`);
  return lines.join('\n');
}
