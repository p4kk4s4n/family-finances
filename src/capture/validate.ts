import type { BrandTier, ParsedItem, ParsedReceipt } from '../types';
import { categoryDef, normalizeCategory } from '../lib/categories';
import { normalizeCurrency, round2 } from '../lib/currency';

function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string') {
    // Accept "1.234,56" (pt-BR) and "1,234.56" (en-US)
    const s = v.replace(/[^\d,.-]/g, '');
    const normalized = /,\d{1,2}$/.test(s) ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    const n = parseFloat(normalized);
    return isFinite(n) ? n : fallback;
  }
  return fallback;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = num(v, NaN);
  return isFinite(n) ? n : null;
}

export function normalizeItemName(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9à-ú\s]/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function isDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s));
}

/** Sanitize an untrusted (model or imported) receipt payload into a well-formed ParsedReceipt. */
export function coerceParsed(raw: any): ParsedReceipt {
  const r = raw && typeof raw === 'object' ? raw : {};
  const items: ParsedItem[] = Array.isArray(r.items)
    ? r.items.map((it: any): ParsedItem => {
        const quantity = num(it?.quantity, 1) || 1;
        const total = round2(num(it?.total, num(it?.unitPrice) * quantity));
        const unitPrice = round2(num(it?.unitPrice, quantity ? total / quantity : total));
        const name = String(it?.name ?? '').trim() || 'Item';
        const category = normalizeCategory(it?.category);
        const tier: BrandTier = ['store', 'name'].includes(it?.brandTier) ? it.brandTier : 'unknown';
        return {
          name,
          normalizedName: normalizeItemName(String(it?.normalizedName || name)),
          category,
          quantity,
          unitPrice,
          total,
          isDiscretionary: typeof it?.isDiscretionary === 'boolean' ? it.isDiscretionary : categoryDef(category).discretionary,
          brandTier: tier,
        };
      })
    : [];
  const itemsSum = round2(items.reduce((s, i) => s + i.total, 0));
  const tax = numOrNull(r.tax);
  const total = round2(num(r.total, itemsSum + (tax ?? 0)));
  return {
    merchant: String(r.merchant ?? '').trim(),
    date: isDate(r.date) ? r.date : new Date().toISOString().slice(0, 10),
    currency: normalizeCurrency(r.currency),
    subtotal: numOrNull(r.subtotal),
    tax,
    total,
    paymentMethod: r.paymentMethod ? String(r.paymentMethod) : null,
    items,
  };
}

export interface ValidationResult {
  ok: boolean;
  warnings: string[];
  itemsSum: number;
}

/** Sanity checks shown on the review screen (items ≈ subtotal, per-line math, required fields). */
export function validateParsed(p: ParsedReceipt): ValidationResult {
  const warnings: string[] = [];
  const itemsSum = round2(p.items.reduce((s, i) => s + i.total, 0));
  if (!p.merchant) warnings.push('Merchant is missing.');
  if (!isDate(p.date)) warnings.push('Date is missing or invalid.');
  if (!(p.total > 0)) warnings.push('Total should be greater than zero.');
  if (p.items.length === 0) warnings.push('No line items found.');

  const expected = p.subtotal ?? (p.tax != null ? round2(p.total - p.tax) : p.total);
  const tolerance = Math.max(0.05, Math.abs(expected) * 0.02);
  if (p.items.length && Math.abs(itemsSum - expected) > tolerance) {
    warnings.push(
      `Line items add up to ${itemsSum.toFixed(2)} but the ${p.subtotal != null ? 'subtotal' : 'total before tax'} is ${expected.toFixed(2)}.`,
    );
  }
  p.items.forEach((it, idx) => {
    if (Math.abs(round2(it.quantity * it.unitPrice) - it.total) > 0.02 && it.total > 0) {
      warnings.push(`Line ${idx + 1} (${it.name}): qty × unit price ≠ line total.`);
    }
  });
  return { ok: warnings.length === 0, warnings, itemsSum };
}

export function emptyDraft(): ParsedReceipt {
  return {
    merchant: '',
    date: new Date().toISOString().slice(0, 10),
    currency: 'USD',
    subtotal: null,
    tax: null,
    total: 0,
    paymentMethod: null,
    items: [],
  };
}
