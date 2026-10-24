import type { Receipt } from '../types';

/** Hamming distance between two equal-length hex hashes. */
export function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

export function normalizeMerchant(s: string | undefined | null): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/#\s*\d+/g, '')
    .replace(/\b(inc|llc|ltd|store|stores|supercenter|market|co)\b/g, '')
    .replace(/[^a-z0-9]/g, '');
}

export interface DupCandidate {
  id?: number;
  merchant?: string;
  date?: string;
  total?: number;
  imageHash?: string;
}

export function sameMerchant(a?: string, b?: string): boolean {
  const x = normalizeMerchant(a);
  const y = normalizeMerchant(b);
  if (!x || !y) return false;
  return x === y || x.includes(y) || y.includes(x);
}

/**
 * Fuzzy duplicate detection: same merchant + same date + same total (±1¢),
 * or a near-identical photo (perceptual hash distance ≤ 4 of 64 bits).
 */
export function findDuplicate(c: DupCandidate, existing: Receipt[]): Receipt | undefined {
  return existing.find((r) => {
    if (c.id != null && r.id === c.id) return false;
    if (c.imageHash && r.imageHash && hamming(c.imageHash, r.imageHash) <= 4) return true;
    const rMerchant = r.merchant ?? r.draft?.merchant;
    const rDate = r.date ?? r.draft?.date;
    const rTotal = r.total ?? r.draft?.total;
    return (
      !!c.date &&
      c.date === rDate &&
      typeof c.total === 'number' &&
      typeof rTotal === 'number' &&
      Math.abs(c.total - rTotal) < 0.011 &&
      sameMerchant(c.merchant, rMerchant)
    );
  });
}
