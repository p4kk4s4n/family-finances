import { describe, expect, it } from 'vitest';
import { findDuplicate, hamming, normalizeMerchant } from './dedupe';
import type { Receipt } from '../types';

describe('dedupe', () => {
  it('hamming distance on hex hashes', () => {
    expect(hamming('ffff', 'ffff')).toBe(0);
    expect(hamming('ffff', 'fffe')).toBe(1);
    expect(hamming('0000', 'ffff')).toBe(16);
    expect(hamming('00', '000')).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('normalizes merchant names', () => {
    expect(normalizeMerchant('WALMART SUPERCENTER #1234')).toBe('walmart');
    expect(normalizeMerchant("Trader Joe's")).toBe('traderjoes');
  });

  const existing: Receipt[] = [
    { id: 1, createdAt: 0, status: 'saved', source: 'photo', merchant: 'Walmart Supercenter #55', date: '2026-10-01', total: 42.1, imageHash: '0f0f0f0f0f0f0f0f' },
  ];

  it('matches merchant + date + total', () => {
    expect(findDuplicate({ merchant: 'WALMART', date: '2026-10-01', total: 42.1 }, existing)?.id).toBe(1);
    expect(findDuplicate({ merchant: 'WALMART', date: '2026-10-02', total: 42.1 }, existing)).toBeUndefined();
    expect(findDuplicate({ merchant: 'Target', date: '2026-10-01', total: 42.1 }, existing)).toBeUndefined();
  });

  it('matches near-identical photos', () => {
    expect(findDuplicate({ imageHash: '0f0f0f0f0f0f0f0e' }, existing)?.id).toBe(1);
    expect(findDuplicate({ imageHash: 'f0f0f0f0f0f0f0f0' }, existing)).toBeUndefined();
  });

  it('ignores itself', () => {
    expect(findDuplicate({ id: 1, merchant: 'Walmart', date: '2026-10-01', total: 42.1 }, existing)).toBeUndefined();
  });
});
