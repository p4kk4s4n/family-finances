import { describe, expect, it } from 'vitest';
import { coerceParsed, validateParsed } from './validate';

describe('coerceParsed', () => {
  it('sanitizes model output and fills defaults', () => {
    const p = coerceParsed({
      merchant: ' Target ',
      date: '2026-10-20',
      currency: '$',
      tax: '1.20',
      total: '21.20',
      items: [
        { name: 'Great Value Eggs', normalizedName: 'Eggs, Large Dozen', category: 'dairy & eggs', quantity: 1, unitPrice: 4, total: 4, isDiscretionary: false, brandTier: 'store' },
        { name: 'Candy', category: 'Nope', quantity: 2, unitPrice: '8', brandTier: 'weird' },
      ],
    });
    expect(p.merchant).toBe('Target');
    expect(p.currency).toBe('USD');
    expect(p.tax).toBe(1.2);
    expect(p.items[0].category).toBe('Dairy & Eggs');
    expect(p.items[0].normalizedName).toBe('eggs large dozen');
    expect(p.items[1].category).toBe('Other');
    expect(p.items[1].total).toBe(16);
    expect(p.items[1].brandTier).toBe('unknown');
    expect(p.items[1].isDiscretionary).toBe(true);
  });

  it('parses pt-BR formatted amounts and R$ currency', () => {
    const p = coerceParsed({ merchant: 'Pão de Açúcar', date: '2026-10-01', currency: 'R$', total: '1.234,56', items: [] });
    expect(p.currency).toBe('BRL');
    expect(p.total).toBe(1234.56);
  });

  it('defaults invalid dates to today', () => {
    expect(coerceParsed({ date: 'yesterday' }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('validateParsed', () => {
  const base = coerceParsed({
    merchant: 'Aldi', date: '2026-10-20', currency: 'USD', subtotal: 10, tax: 0.5, total: 10.5,
    items: [
      { name: 'Milk', quantity: 1, unitPrice: 4, total: 4 },
      { name: 'Bread', quantity: 2, unitPrice: 3, total: 6 },
    ],
  });

  it('passes a consistent receipt', () => {
    expect(validateParsed(base)).toEqual({ ok: true, warnings: [], itemsSum: 10 });
  });

  it('flags items that do not sum to subtotal', () => {
    const v = validateParsed({ ...base, subtotal: 15 });
    expect(v.ok).toBe(false);
    expect(v.warnings[0]).toMatch(/add up to 10.00/);
  });

  it('flags bad line math and missing merchant', () => {
    const v = validateParsed({ ...base, merchant: '', items: [{ ...base.items[0], total: 9 }, base.items[1]] });
    expect(v.warnings.some((w) => w.includes('Merchant'))).toBe(true);
    expect(v.warnings.some((w) => w.includes('qty × unit price'))).toBe(true);
  });
});
