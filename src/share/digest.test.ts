import { describe, expect, it } from 'vitest';
import type { Item } from '../types';
import { buildWeeklyDigest, digestToText } from './digest';

const it_ = (p: Partial<Item>): Item => ({
  receiptId: 1, date: '2026-10-20', merchant: 'S', rawName: 'x', normalizedName: 'x', category: 'Produce', quantity: 1,
  unitPrice: 10, total: 10, currency: 'USD', fxRate: 1, unitPriceUSD: 10, totalUSD: 10, isDiscretionary: false, brandTier: 'unknown', ...p,
});

describe('weekly digest', () => {
  it('summarizes the last 7 days against a pro-rated weekly budget', () => {
    const items = [
      it_({ totalUSD: 40, category: 'Produce' }),
      it_({ totalUSD: 5, category: 'Snacks & Treats', isDiscretionary: true, normalizedName: 'chips', receiptId: 2 }),
      it_({ totalUSD: 999, date: '2026-09-01' }),
    ];
    const d = buildWeeklyDigest(items, [{ category: 'Produce', monthlyLimit: 310 }], '2026-10-24');
    expect(d.spent).toBe(45);
    expect(d.weeklyBudget).toBe(70);
    expect(d.receiptsCount).toBe(2);
    expect(d.leakageCount).toBe(1);
    const text = digestToText(d);
    expect(text).toContain('Spent $45.00 of $70.00');
    expect(text).toContain('under budget');
  });
});
