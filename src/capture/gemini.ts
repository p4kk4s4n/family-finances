import type { ParsedReceipt } from '../types';
import { CATEGORY_NAMES } from '../lib/categories';
import { coerceParsed } from './validate';
import { downscaleImage } from './image';

export const RECEIPT_SCHEMA = {
  type: 'OBJECT',
  properties: {
    merchant: { type: 'STRING' },
    date: { type: 'STRING', description: 'Purchase date as YYYY-MM-DD' },
    currency: { type: 'STRING', description: 'ISO 4217 code. Use BRL for Brazilian reais (R$), USD for US dollars.' },
    subtotal: { type: 'NUMBER', nullable: true },
    tax: { type: 'NUMBER', nullable: true },
    total: { type: 'NUMBER' },
    paymentMethod: { type: 'STRING', nullable: true },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Line text as printed, expanded if abbreviated' },
          normalizedName: {
            type: 'STRING',
            description: 'Generic product name for price tracking across stores, lowercase, no brand or size, e.g. "eggs large dozen", "whole milk gallon"',
          },
          category: { type: 'STRING', enum: CATEGORY_NAMES },
          quantity: { type: 'NUMBER' },
          unitPrice: { type: 'NUMBER' },
          total: { type: 'NUMBER', description: 'Line total after line-level discounts' },
          isDiscretionary: { type: 'BOOLEAN', description: 'true for wants/treats/impulse, false for needs/staples' },
          brandTier: { type: 'STRING', enum: ['store', 'name', 'unknown'] },
        },
        required: ['name', 'normalizedName', 'category', 'quantity', 'unitPrice', 'total', 'isDiscretionary', 'brandTier'],
      },
    },
  },
  required: ['merchant', 'date', 'currency', 'total', 'items'],
};

export const RECEIPT_PROMPT = `You are a meticulous receipt parser for a frugal personal budgeting app.
Extract every purchased line item from this receipt image or PDF.
Rules:
- Use amounts exactly as printed in the receipt's own currency. Do not convert currencies.
- Detect currency: "R$" or Portuguese text => BRL; "$" in the US => USD.
- Apply line-level discounts/coupons to the affected item's total; ignore loyalty-points lines.
- Do not include subtotal, tax, total, change, or payment lines as items.
- If the receipt is creased, faded or spans multiple photos, do your best and keep numbers consistent so items sum to the subtotal.
- brandTier: "store" for store/private-label brands (Great Value, Kirkland, Market Pantry, 365, etc.), "name" for national brands, else "unknown".
- Choose the closest category from the allowed list.`;

export const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'] as const;

/** Build the ordered unique list of models to try, starting with the user's preferred model. */
export function buildModelChain(preferred: string): string[] {
  const first = (preferred || 'gemini-flash-latest').trim();
  const out = [first];
  for (const m of FALLBACK_MODELS) {
    if (!out.includes(m)) out.push(m);
  }
  return out;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public status?: number,
    public isNetwork?: boolean,
    public isTimeout?: boolean,
  ) {
    super(message);
  }
}

/** Translate technical fetch/HTTP errors into plain, actionable messages. */
export function describeGeminiError(err: unknown): string {
  if (!err) return 'Unknown error.';
  if (err instanceof GeminiError) {
    if (err.isTimeout) return 'Timed out waiting for Google AI (slow connection).';
    if (err.status === 503) return 'Google AI is temporarily busy (503 high demand).';
    if (err.status === 429) return 'Gemini rate limit or quota reached (429).';
    if (err.status === 400 || err.status === 403) {
      return `API key rejected or restricted (${err.status}). Check your key at aistudio.google.com/apikey.`;
    }
    if (err.status && err.status >= 500) return `Google AI server error (${err.status}).`;
    if (err.isNetwork) {
      return "Couldn't reach Google AI (offline, VPN/ad-blocker, or connection dropped while the screen was off).";
    }
    return err.message;
  }
  const msg = (err as Error)?.message || String(err);
  if (/aborted|timeout/i.test(msg)) return 'Timed out waiting for Google AI (slow connection).';
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "Couldn't reach Google AI (offline, VPN/ad-blocker, or connection dropped while the screen was off).";
  }
  return msg;
}

export interface ParseReceiptOptions {
  timeoutMs?: number;
  baseDelayMs?: number;
  models?: string[];
  downscaleRetry?: (blob: Blob) => Promise<Blob>;
}

/**
 * Calls Gemini directly from the device with the user's own API key and returns a sanitized receipt.
 * Cycles through the model fallback chain (2 attempts per model) and downscales once on network failure.
 */
export async function parseReceipt(
  file: Blob,
  mimeType: string,
  apiKey: string,
  model: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
  opts: ParseReceiptOptions = {},
): Promise<ParsedReceipt> {
  const timeoutMs = opts.timeoutMs ?? 45_000;
  const baseDelayMs = opts.baseDelayMs ?? 1200;
  const models = opts.models ?? buildModelChain(model);
  const downscaleFn = opts.downscaleRetry ?? ((b: Blob) => downscaleImage(b, 1200, 0.7));

  let currentBlob = file;
  let downscaled = false;
  let data = await blobToBase64(currentBlob);

  const makeBody = (b64: string) => ({
    contents: [{ role: 'user', parts: [{ text: RECEIPT_PROMPT }, { inline_data: { mime_type: mimeType, data: b64 } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RECEIPT_SCHEMA, temperature: 0 },
  });

  let lastErr: unknown;

  for (let mIdx = 0; mIdx < models.length; mIdx++) {
    const curModel = models[mIdx];
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(curModel)}:generateContent`;

    for (let attempt = 0; attempt < 2; attempt++) {
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
      const timer =
        ctrl && timeoutMs > 0
          ? setTimeout(() => ctrl.abort(new Error('Request timed out')), timeoutMs)
          : undefined;
      try {
        const res = await fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
          body: JSON.stringify(makeBody(data)),
          signal: ctrl?.signal,
        });
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          const err = new GeminiError(`Gemini error ${res.status}: ${text.slice(0, 200)}`, res.status);
          // Non-retryable client error (e.g. 400/401/403 bad key): fail immediately
          if (res.status < 500 && res.status !== 429 && res.status !== 408 && res.status !== 404) {
            throw err;
          }
          lastErr = err;
          // 404 on a specific model: move to the next model in the chain immediately
          if (res.status === 404) break;
          if (attempt === 0 && baseDelayMs > 0) {
            const jitter = 0.85 + Math.random() * 0.3;
            await new Promise((r) => setTimeout(r, Math.round(baseDelayMs * jitter)));
          }
          continue;
        }
        const json = await res.json();
        const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
        if (!text) throw new GeminiError('Gemini returned an empty response.');
        return coerceParsed(JSON.parse(text));
      } catch (e) {
        if (e instanceof GeminiError && e.status && e.status < 500 && e.status !== 429 && e.status !== 408 && e.status !== 404) {
          throw e;
        }
        const isAbort = (e as Error)?.name === 'AbortError' || /timed out|aborted/i.test((e as Error)?.message || '');
        const isNet = e instanceof TypeError || /failed to fetch|networkerror|load failed/i.test((e as Error)?.message || '');
        if (isAbort) {
          lastErr = new GeminiError('Request timed out', undefined, true, true);
        } else if (isNet) {
          lastErr = new GeminiError((e as Error)?.message || 'Failed to fetch', undefined, true, false);
          // On first network error with an image, downscale to a smaller payload and retry
          if (!downscaled && mimeType.startsWith('image/')) {
            downscaled = true;
            try {
              currentBlob = await downscaleFn(file);
              data = await blobToBase64(currentBlob);
            } catch {
              // keep original data
            }
          }
        } else {
          lastErr = e;
        }
        if (attempt === 0 && baseDelayMs > 0) {
          const jitter = 0.85 + Math.random() * 0.3;
          await new Promise((r) => setTimeout(r, Math.round(baseDelayMs * jitter)));
        }
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new GeminiError('Failed to parse receipt.');
}

/** Real end-to-end key & generation check used by Settings → "Test key". */
export async function testApiKey(
  apiKey: string,
  model: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<{ ok: boolean; message: string }> {
  const models = buildModelChain(model);
  let lastMsg = '';
  for (const m of models) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: 'Reply with OK' }] }],
          generationConfig: { maxOutputTokens: 4, temperature: 0 },
        }),
      });
      if (res.ok) {
        return {
          ok: true,
          message: m === model ? `✓ Connected and verified with ${m}.` : `✓ Verified via fallback model ${m} (${model} was busy).`,
        };
      }
      const text = await res.text().catch(() => '');
      const err = new GeminiError(`HTTP ${res.status}: ${text.slice(0, 120)}`, res.status);
      if (res.status === 400 || res.status === 401 || res.status === 403) {
        return { ok: false, message: `⚠️ ${describeGeminiError(err)}` };
      }
      lastMsg = describeGeminiError(err);
    } catch (e) {
      return { ok: false, message: `⚠️ ${describeGeminiError(e)}` };
    }
  }
  return { ok: false, message: `⚠️ ${lastMsg || 'Key check failed.'}` };
}
