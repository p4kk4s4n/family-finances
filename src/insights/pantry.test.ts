import { describe, expect, it } from 'vitest';
import type { Item } from '../types';
import { pantryReorderPredictions, priceJumpAlerts, productPriceHistory, storePriceComparison } from './pantry';

let seq = 1;
function mkItem(p: Partial<Item>): Item {
  const unitPriceUSD = p.unitPriceUSD ?? 4;
  const quantity = p.quantity ?? 1;
  return {
    id: seq++,
    receiptId: 1,
    date: '2026-10-01',
    merchant: 'Target',
    rawName: p.normalizedName ?? 'item',
    normalizedName: 'eggs large dozen',
    category: 'Dairy & Eggs',
    quantity,
    unitPrice: unitPriceUSD,
    total: unitPriceUSD * quantity,
    currency: 'USD',
    fxRate: 1,
    unitPriceUSD,
    totalUSD: unitPriceUSD * quantity,
    isDiscretionary: false,
    brandTier: 'unknown',
    ...p,
  };
}

describe('Price Pulse & Pantry', () => {
  it('compares unit prices across stores and identifies cheapest vs most expensive', () => {
    const items = [
      mkItem({ normalizedName: 'eggs large dozen', merchant: 'Target #120', unitPriceUSD: 4.5, date: '2026-10-01' }),
      mkItem({ normalizedName: 'eggs large dozen', merchant: 'Aldi', unitPriceUSD: 3.15, date: '2026-10-08' }),
      mkItem({ normalizedName: 'eggs large dozen', merchant: 'Costco', unitPriceUSD: 3.5, date: '2026-10-12' }),
      mkItem({ normalizedName: 'whole milk gallon', merchant: 'Aldi', unitPriceUSD: 3.2, date: '2026-10-08' }),
    ];

    const comp = storePriceComparison(items);
    expect(comp).toHaveLength(1); // only eggs was bought at >= 2 stores
    expect(comp[0].name).toBe('eggs large dozen');
    expect(comp[0].cheapest.merchant).toBe('Aldi');
    expect(comp[0].cheapest.medianPrice).toBe(3.15);
    expect(comp[0].mostExpensive.merchant).toBe('Target');
    expect(comp[0].mostExpensive.medianPrice).toBe(4.5);
    expect(comp[0].savingsPerUnit).toBe(1.35);
    expect(comp[0].spreadPct).toBe(30);
  });

  it('flags price jump alerts when latest purchase exceeds historical median by threshold', () => {
    const items = [
      mkItem({ normalizedName: 'coffee beans', unitPriceUSD: 8, date: '2026-08-01' }),
      mkItem({ normalizedName: 'coffee beans', unitPriceUSD: 8.2, date: '2026-09-01' }),
      mkItem({ normalizedName: 'coffee beans', unitPriceUSD: 10.5, date: '2026-10-01', quantity: 2 }),
      mkItem({ normalizedName: 'bananas', unitPriceUSD: 0.59, date: '2026-09-01' }),
      mkItem({ normalizedName: 'bananas', unitPriceUSD: 0.61, date: '2026-10-01' }),
    ];

    const alerts = priceJumpAlerts(items, 15);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].name).toBe('coffee beans');
    expect(alerts[0].historicalMedian).toBe(8.1);
    expect(alerts[0].latestPrice).toBe(10.5);
    expect(alerts[0].jumpPct).toBeCloseTo(29.63, 1);
    expect(alerts[0].dollarImpact).toBe(4.8);
  });

  it('predicts pantry reorder timing from historical purchase intervals', () => {
    const items = [
      mkItem({ normalizedName: 'whole milk gallon', date: '2026-10-01', isDiscretionary: false }),
      mkItem({ normalizedName: 'whole milk gallon', date: '2026-10-08', isDiscretionary: false }),
      mkItem({ normalizedName: 'whole milk gallon', date: '2026-10-15', isDiscretionary: false }),
      mkItem({ normalizedName: 'olive oil', date: '2026-09-01', isDiscretionary: false }),
      mkItem({ normalizedName: 'olive oil', date: '2026-10-01', isDiscretionary: false }),
      mkItem({ normalizedName: 'potato chips', date: '2026-10-01', isDiscretionary: true }),
      mkItem({ normalizedName: 'potato chips', date: '2026-10-05', isDiscretionary: true }),
    ];

    // On 2026-10-23: milk has 7-day cadence, last bought Oct 15 (8 days ago -> overdue by 1 day)
    // olive oil has 30-day cadence, last bought Oct 1 (22 days ago -> 8 days remaining -> stocked)
    const preds = pantryReorderPredictions(items, '2026-10-23');
    expect(preds).toHaveLength(2);
    expect(preds[0].name).toBe('whole milk gallon');
    expect(preds[0].cadenceDays).toBe(7);
    expect(preds[0].daysSinceLast).toBe(8);
    expect(preds[0].daysRemaining).toBe(-1);
    expect(preds[0].status).toBe('overdue');

    expect(preds[1].name).toBe('olive oil');
    expect(preds[1].cadenceDays).toBe(30);
    expect(preds[1].status).toBe('stocked');
  });

  it('returns reverse-chronological price history for a product', () => {
    const items = [
      mkItem({ normalizedName: 'butter', date: '2026-09-10', merchant: 'Aldi', unitPriceUSD: 3.49 }),
      mkItem({ normalizedName: 'butter', date: '2026-10-10', merchant: 'Target', unitPriceUSD: 4.19 }),
    ];
    const hist = productPriceHistory(items, 'butter');
    expect(hist.map((h) => h.merchant)).toEqual(['Target', 'Aldi']);
  });
});
