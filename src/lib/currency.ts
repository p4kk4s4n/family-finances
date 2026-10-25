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

/**
 * Fetches exchange rate (1 unit of `currency` -> USD) using direct CORS-enabled endpoints
 * (`api.frankfurter.dev` primary, with jsDelivr currency-api and open.er-api.com fallbacks).
 */
export async function fetchRateToUSD(
  currency: string,
  date: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<number | null> {
  if (currency === 'USD') return 1;
  const today = new Date().toISOString().slice(0, 10);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= today ? date : 'latest';
  const curUpper = currency.toUpperCase();
  const curLower = currency.toLowerCase();

  // 1. Primary: Frankfurter v1 on .dev (direct 200 OK with CORS; .app 301-redirects without CORS headers)
  try {
    const r = await fetchFn(`https://api.frankfurter.dev/v1/${d}?from=${curUpper}&to=USD`);
    if (r.ok) {
      const j = await r.json();
      const rate = j?.rates?.USD;
      if (typeof rate === 'number' && rate > 0) return rate;
    }
  } catch {
    // try backup provider
  }

  // 2. Backup 1: jsDelivr daily currency-api CDN (supports historical date or @latest)
  try {
    const tag = d === 'latest' ? 'latest' : d;
    const r = await fetchFn(`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${tag}/v1/currencies/${curLower}.json`);
    if (r.ok) {
      const j = await r.json();
      const rate = j?.[curLower]?.usd;
      if (typeof rate === 'number' && rate > 0) return rate;
    }
  } catch {
    // try backup provider
  }

  // 3. Backup 2: ExchangeRate-API open endpoint
  try {
    const r = await fetchFn(`https://open.er-api.com/v6/latest/${curUpper}`);
    if (r.ok) {
      const j = await r.json();
      const rate = j?.rates?.USD;
      if (typeof rate === 'number' && rate > 0) return rate;
    }
  } catch {
    // all online providers failed
  }

  return null;
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
