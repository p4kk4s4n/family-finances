import { describe, expect, it, vi } from 'vitest';
import { formatMoney, fetchRateToUSD, normalizeCurrency, resolveRate, toUSD } from './currency';

describe('currency', () => {
  it('normalizes currency hints', () => {
    expect(normalizeCurrency('R$')).toBe('BRL');
    expect(normalizeCurrency('reais')).toBe('BRL');
    expect(normalizeCurrency('$')).toBe('USD');
    expect(normalizeCurrency(undefined)).toBe('USD');
    expect(normalizeCurrency('eur')).toBe('EUR');
  });

  it('converts BRL to USD', () => {
    expect(toUSD(100, 0.18)).toBe(18);
  });

  it('fetches historical rate', async () => {
    const f = vi.fn(async (_u: string) => new Response(JSON.stringify({ rates: { USD: 0.1834 } })));
    expect(await fetchRateToUSD('BRL', '2026-01-05', f)).toBe(0.1834);
    expect(f.mock.calls[0][0]).toContain('/2026-01-05?from=BRL&to=USD');
    expect(await fetchRateToUSD('USD', '2026-01-05', f)).toBe(1);
  });

  it('falls back to manual BRL rate when offline or disabled', async () => {
    const failing = vi.fn(async () => { throw new Error('offline'); });
    expect(await resolveRate('BRL', '2026-01-05', { autoFxRate: true, brlRateFallback: 0.2 }, failing)).toEqual({ rate: 0.2, source: 'fallback' });
    expect(await resolveRate('BRL', '2026-01-05', { autoFxRate: false, brlRateFallback: 0.2 })).toEqual({ rate: 0.2, source: 'fallback' });
    expect(await resolveRate('USD', '2026-01-05', { autoFxRate: true, brlRateFallback: 0.2 })).toEqual({ rate: 1, source: 'none' });
  });

  it('formats money', () => {
    expect(formatMoney(12.5)).toBe('$12.50');
    expect(formatMoney(12.5, 'BRL')).toMatch(/R\$\s?12,50/);
  });
});
