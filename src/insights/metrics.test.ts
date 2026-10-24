import { describe, expect, it } from 'vitest';
import type { Item } from '../types';
import { basketInflation, brandSavings, budgetStatus, discretionaryFlex, leakage, median, priceChanges, spendByCategory } from './metrics';

let nextId = 1;
function item(p: Partial<Item>): Item {
  const totalUSD = p.totalUSD ?? (p.unitPriceUSD ?? 1) * (p.quantity ?? 1);
  return {
    id: nextId++, receiptId: 1, date: '2026-10-10', merchant: 'Store', rawName: p.normalizedName ?? 'x', normalizedName: 'x',
    category: 'Other', quantity: 1, unitPrice: totalUSD, total: totalUSD, currency: 'USD', fxRate: 1,
    unitPriceUSD: p.unitPriceUSD ?? totalUSD, totalUSD, isDiscretionary: false, brandTier: 'unknown', ...p,
  };
}

describe('metrics', () => {
  it('median', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('spendByCategory + budgetStatus', () => {
    const items = [item({ category: 'Produce', totalUSD: 50 }), item({ category: 'Produce', totalUSD: 30 }), item({ category: 'Coffee', totalUSD: 40 })];
    const spend = spendByCategory(items);
    expect(spend).toEqual({ Produce: 80, Coffee: 40 });
    const lines = budgetStatus([{ category: 'Produce', monthlyLimit: 120 }, { category: 'Coffee', monthlyLimit: 30 }, { category: 'Pets', monthlyLimit: 10 }], spend, 10, 30);
    expect(lines.find((l) => l.category === 'Coffee')!.status).toBe('over');
    expect(lines.find((l) => l.category === 'Produce')!.status).toBe('warn'); // projected 240 > 120
    expect(lines.find((l) => l.category === 'Pets')!.status).toBe('ok');
  });

  it('leakage counts small discretionary items only', () => {
    const items = [
      item({ normalizedName: 'candy', isDiscretionary: true, totalUSD: 2 }),
      item({ normalizedName: 'candy', isDiscretionary: true, totalUSD: 3 }),
      item({ normalizedName: 'latte', isDiscretionary: true, totalUSD: 6 }),
      item({ normalizedName: 'tv', isDiscretionary: true, totalUSD: 300 }),
      item({ normalizedName: 'milk', isDiscretionary: false, totalUSD: 4 }),
    ];
    const l = leakage(items, 10);
    expect(l.count).toBe(3);
    expect(l.total).toBe(11);
    expect(l.top[0]).toEqual({ name: 'latte', total: 6, count: 1 });
  });

  it('brandSavings compares store vs name brand of the same product', () => {
    const items = [
      item({ normalizedName: 'peanut butter', brandTier: 'store', unitPriceUSD: 2 }),
      item({ normalizedName: 'peanut butter', brandTier: 'name', unitPriceUSD: 4, quantity: 3, totalUSD: 12 }),
      item({ normalizedName: 'cereal', brandTier: 'name', unitPriceUSD: 5 }),
    ];
    const b = brandSavings(items);
    expect(b.total).toBe(6);
    expect(b.opportunities).toHaveLength(1);
  });

  it('priceChanges + basketInflation', () => {
    const items = [
      item({ normalizedName: 'eggs', date: '2026-07-01', unitPriceUSD: 3 }),
      item({ normalizedName: 'eggs', date: '2026-10-15', unitPriceUSD: 3.6 }),
      item({ normalizedName: 'milk', date: '2026-07-05', unitPriceUSD: 4 }),
      item({ normalizedName: 'milk', date: '2026-10-16', unitPriceUSD: 4 }),
      item({ normalizedName: 'new-thing', date: '2026-10-16', unitPriceUSD: 9 }),
    ];
    const pc = priceChanges(items, '2026-10-20', 90);
    expect(pc.find((p) => p.name === 'eggs')!.pct).toBe(20);
    expect(pc.find((p) => p.name === 'milk')!.pct).toBe(0);
    expect(pc.find((p) => p.name === 'new-thing')).toBeUndefined();
    const bi = basketInflation(items, '2026-10-20', 90);
    // weighted: (20*3.6 + 0*4) / 7.6
    expect(bi.pct).toBeCloseTo(9.47, 1);
    expect(basketInflation([], '2026-10-20', 90).pct).toBeNull();
  });

  it('discretionaryFlex projects essentials and subtracts wants', () => {
    const items = [item({ totalUSD: 100, isDiscretionary: false }), item({ totalUSD: 50, isDiscretionary: true })];
    const f = discretionaryFlex({ budgetTotal: 1000, monthItems: items, dayOfMonth: 10, monthDays: 30, inflationPct: 10 });
    // essentials 100 + 10/day * 20 days * 1.1 = 320; flex = 1000 - 320 - 50 = 630
    expect(f.essentialsProjected).toBe(320);
    expect(f.flex).toBe(630);
    expect(f.dailyFlex).toBe(31.5);
  });
});
