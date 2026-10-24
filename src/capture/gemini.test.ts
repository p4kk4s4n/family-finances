import { describe, expect, it, vi } from 'vitest';
import { parseReceipt } from './gemini';

const okResponse = (payload: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });

describe('parseReceipt', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

  it('sends image + schema and returns a sanitized receipt', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse({ merchant: 'Costco', date: '2026-10-10', currency: 'USD', total: 5, items: [{ name: 'Bananas', normalizedName: 'bananas', category: 'Produce', quantity: 1, unitPrice: 5, total: 5, isDiscretionary: false, brandTier: 'unknown' }] }),
    );
    const r = await parseReceipt(blob, 'image/jpeg', 'KEY', 'gemini-flash-latest', fetchFn);
    expect(r.merchant).toBe('Costco');
    expect(r.items).toHaveLength(1);
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toContain('models/gemini-flash-latest:generateContent');
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe('KEY');
    const body = JSON.parse(init!.body as string);
    expect(body.contents[0].parts[1].inline_data).toEqual({ mime_type: 'image/jpeg', data: 'AQID' });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('does not retry on 4xx (bad key)', async () => {
    const fetchFn = vi.fn(async () => new Response('bad key', { status: 403 }));
    await expect(parseReceipt(blob, 'image/jpeg', 'BAD', 'm', fetchFn)).rejects.toThrow(/403/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
