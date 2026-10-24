import type { ParsedReceipt } from '../types';
import { CATEGORY_NAMES } from '../lib/categories';
import { coerceParsed } from './validate';

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

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
  return btoa(bin);
}

export class GeminiError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
  }
}

/** Calls Gemini directly from the device with the user's own API key and returns a sanitized receipt. */
export async function parseReceipt(
  file: Blob,
  mimeType: string,
  apiKey: string,
  model: string,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<ParsedReceipt> {
  const data = await blobToBase64(file);
  const body = {
    contents: [{ role: 'user', parts: [{ text: RECEIPT_PROMPT }, { inline_data: { mime_type: mimeType, data } }] }],
    generationConfig: { responseMimeType: 'application/json', responseSchema: RECEIPT_SCHEMA, temperature: 0 },
  };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        const err = new GeminiError(`Gemini error ${res.status}: ${text.slice(0, 200)}`, res.status);
        if (res.status === 429 || res.status >= 500) {
          lastErr = err;
          await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
          continue;
        }
        throw err;
      }
      const json = await res.json();
      const text: string = json?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('') ?? '';
      if (!text) throw new GeminiError('Gemini returned an empty response.');
      return coerceParsed(JSON.parse(text));
    } catch (e) {
      if (e instanceof GeminiError && e.status && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new GeminiError('Failed to parse receipt.');
}

/** Lightweight key check used by Settings → "Test key". */
export async function testApiKey(apiKey: string, model: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
      { headers: { 'x-goog-api-key': apiKey } },
    );
    if (res.ok) return { ok: true, message: `Key works with ${model}.` };
    return { ok: false, message: `Key check failed (${res.status}).` };
  } catch (e) {
    return { ok: false, message: `Network error: ${(e as Error).message}` };
  }
}
