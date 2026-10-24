import type { Settings } from '../types';

export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** Map loose currency hints (symbols, words) to an ISO code. Defaults to USD. */
export function normalizeCurrency(c?: string | null): string {
  const s = (c ?? '').toUpperCase().trim();
  if (!s) return 'USD';
  if (['BRL', 'R$', 'REAL', 'REAIS', 'R'].includes(s)) return 'BRL';
  if (['USD', '$', 'US$', 'US DOLLAR', 'DOLLAR'].includes(s)) return 'USD';
  return /^[A-Z]{3}$/.test(s) ? s : 'USD';
}

export function toUSD(amount: number, rate: number): number {
  return round2(amount * rate);
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** Historical rate (1 unit of `currency` -> USD) from the free Frankfurter (ECB) API. */
export async function fetchRateToUSD(
  currency: string,
  date: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<number | null> {
  if (currency === 'USD') return 1;
  const today = new Date().toISOString().slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : 'latest';
  try {
    const r = await fetchFn(`https://api.frankfurter.app/${d}?from=${currency}&to=USD`);
    if (!r.ok) return null;
    const j = await r.json();
    const rate = j?.rates?.USD;
    return typeof rate === 'number' && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

export interface ResolvedRate {
  rate: number;
  source: 'auto' | 'fallback' | 'none';
}

/** Resolve a conversion rate to USD: auto (online) first if enabled, then the manual BRL fallback. */
export async function resolveRate(
  currency: string,
  date: string,
  settings: Pick<Settings, 'autoFxRate' | 'brlRateFallback'>,
  fetchFn?: FetchFn,
): Promise<ResolvedRate> {
  if (currency === 'USD') return { rate: 1, source: 'none' };
  if (settings.autoFxRate) {
    const r = await fetchRateToUSD(currency, date, fetchFn);
    if (r) return { rate: r, source: 'auto' };
  }
  if (currency === 'BRL') return { rate: settings.brlRateFallback, source: 'fallback' };
  return { rate: 1, source: 'none' };
}

export function formatMoney(n: number | null | undefined, currency = 'USD'): string {
  const v = typeof n === 'number' && isFinite(n) ? n : 0;
  try {
    return new Intl.NumberFormat(currency === 'BRL' ? 'pt-BR' : 'en-US', {
      style: 'currency',
      currency,
    }).format(v);
  } catch {
    return `${currency} ${v.toFixed(2)}`;
  }
}
