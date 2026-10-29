import { describe, expect, it } from 'vitest';
import { parseOcrText } from './ocrParse';

describe('parseOcrText heuristics', () => {
  it('parses a US grocery receipt with USD amounts, MM/DD/YYYY date, quantities, subtotal, and tax', () => {
    const raw = `
      TARGET #0412
      123 MAIN ST
      10/18/2026 14:22
      Good & Gather Eggs 12ct      3.50
      Tide Pods 42ct              15.00
      Starbucks Frappuccino 2 x 3.00  6.00
      Reeses Peanut Butter Cups    6.00
      SUBTOTAL                    30.50
      SALES TAX                    1.50
      TOTAL                       32.00
      VISA 1234                   32.00
    `;
    const r = parseOcrText(raw);
    expect(r.merchant).toBe('TARGET');
    expect(r.date).toBe('2026-10-18');
    expect(r.currency).toBe('USD');
    expect(r.subtotal).toBe(30.5);
    expect(r.tax).toBe(1.5);
    expect(r.total).toBe(32);
    expect(r.paymentMethod).toBe('VISA');
    expect(r.items).toHaveLength(4);
    expect(r.items[0]).toMatchObject({
      name: 'Good & Gather Eggs 12ct',
      category: 'Dairy & Eggs',
      quantity: 1,
      unitPrice: 3.5,
      total: 3.5,
      brandTier: 'store',
    });
    expect(r.items[2]).toMatchObject({
      name: 'Starbucks Frappuccino',
      category: 'Coffee',
      quantity: 2,
      unitPrice: 3,
      total: 6,
    });
  });

  it('parses a Brazilian cupom fiscal with BRL, DD/MM/YYYY date, and comma decimals', () => {
    const raw = `
      CUPOM FISCAL
      PAO DE ACUCAR
      CNPJ 47.508.411/0001-56
      25/10/2026 18:05
      001 78912345 CAFE PILAO 500G
      2 x 25,00                   50,00
      002 78999999 PAO FRANCES KG  12,50
      003 78911111 LEITE INTEGRAL   6,40
      VALOR TOTAL R$              68,90
      PIX                         68,90
    `;
    const r = parseOcrText(raw);
    expect(r.merchant).toBe('PAO DE ACUCAR');
    expect(r.date).toBe('2026-10-25');
    expect(r.currency).toBe('BRL');
    expect(r.total).toBe(68.9);
    expect(r.paymentMethod).toBe('PIX');
    expect(r.items).toHaveLength(3);
    expect(r.items[0]).toMatchObject({
      name: 'CAFE PILAO 500G',
      category: 'Pantry Staples',
      quantity: 2,
      unitPrice: 25,
      total: 50,
    });
    expect(r.items[1]).toMatchObject({
      name: 'PAO FRANCES KG',
      category: 'Bakery',
      total: 12.5,
    });
    expect(r.items[2]).toMatchObject({
      name: 'LEITE INTEGRAL',
      category: 'Dairy & Eggs',
      total: 6.4,
    });
  });
});
