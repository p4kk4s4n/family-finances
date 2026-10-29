import { describe, expect, it, vi } from 'vitest';
import { buildModelChain, describeGeminiError, GeminiError, parseReceipt, testApiKey } from './gemini';

const okResponse = (payload: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), { status: 200 });

describe('parseReceipt & Gemini resilience', () => {
  const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/jpeg' });

  it('sends image + schema and returns a sanitized receipt', async () => {
    const fetchFn = vi.fn(async (_url: string, _init?: RequestInit) =>
      okResponse({
        merchant: 'Costco',
        date: '2026-10-10',
        currency: 'USD',
        total: 5,
        items: [
          {
            name: 'Bananas',
            normalizedName: 'bananas',
            category: 'Produce',
            quantity: 1,
            unitPrice: 5,
            total: 5,
            isDiscretionary: false,
            brandTier: 'unknown',
          },
        ],
      }),
    );
    const r = await parseReceipt(blob, 'image/jpeg', 'KEY', 'gemini-flash-latest', fetchFn, { baseDelayMs: 0 });
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
    await expect(parseReceipt(blob, 'image/jpeg', 'BAD', 'm', fetchFn, { baseDelayMs: 0 })).rejects.toThrow(/403/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('builds a deduplicated model fallback chain', () => {
    expect(buildModelChain('gemini-flash-latest')).toEqual([
      'gemini-flash-latest',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
    ]);
    expect(buildModelChain('gemini-2.5-flash')).toEqual([
      'gemini-2.5-flash',
      'gemini-flash-latest',
      'gemini-2.5-flash-lite',
    ]);
  });

  it('falls back to the next model in the chain when the primary returns 503', async () => {
    const calls: string[] = [];
    const fetchFn = vi.fn(async (url: string) => {
      calls.push(url);
      if (url.includes('gemini-flash-latest')) {
        return new Response('busy', { status: 503 });
      }
      return okResponse({
        merchant: 'Aldi',
        date: '2026-10-12',
        currency: 'USD',
        total: 3.5,
        items: [],
      });
    });

    const r = await parseReceipt(blob, 'image/jpeg', 'KEY', 'gemini-flash-latest', fetchFn, { baseDelayMs: 0 });
    expect(r.merchant).toBe('Aldi');
    // 2 attempts on gemini-flash-latest, then 1st attempt on gemini-2.5-flash succeeds
    expect(calls).toHaveLength(3);
    expect(calls[0]).toContain('gemini-flash-latest');
    expect(calls[1]).toContain('gemini-flash-latest');
    expect(calls[2]).toContain('gemini-2.5-flash:');
  });

  it('downscales image once on network TypeError (Failed to fetch) and retries', async () => {
    let count = 0;
    const downscaleSpy = vi.fn(async () => new Blob([new Uint8Array([9])], { type: 'image/jpeg' }));
    const fetchFn = vi.fn(async (_url: string, init?: RequestInit) => {
      count++;
      if (count === 1) throw new TypeError('Failed to fetch');
      const body = JSON.parse(init!.body as string);
      expect(body.contents[0].parts[1].inline_data.data).toBe('CQ=='); // base64 of [9]
      return okResponse({ merchant: 'Target', date: '2026-10-12', currency: 'USD', total: 10, items: [] });
    });

    const r = await parseReceipt(blob, 'image/jpeg', 'KEY', 'gemini-flash-latest', fetchFn, {
      baseDelayMs: 0,
      downscaleRetry: downscaleSpy,
    });
    expect(r.merchant).toBe('Target');
    expect(downscaleSpy).toHaveBeenCalledTimes(1);
  });

  it('aborts stalled requests after timeoutMs', async () => {
    const fetchFn = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }),
    );

    await expect(
      parseReceipt(blob, 'image/jpeg', 'KEY', 'gemini-flash-latest', fetchFn, {
        timeoutMs: 15,
        baseDelayMs: 0,
        models: ['gemini-flash-latest'],
      }),
    ).rejects.toThrow(/timed out/i);
  });

  it('maps technical errors to friendly messages', () => {
    expect(describeGeminiError(new TypeError('Failed to fetch'))).toMatch(/Couldn't reach Google AI/i);
    expect(describeGeminiError(new GeminiError('503', 503))).toMatch(/temporarily busy/i);
    expect(describeGeminiError(new GeminiError('429', 429))).toMatch(/rate limit/i);
    expect(describeGeminiError(new GeminiError('403', 403))).toMatch(/rejected or restricted/i);
    expect(describeGeminiError(new GeminiError('timeout', undefined, true, true))).toMatch(/Timed out/i);
  });

  it('testApiKey performs a real generateContent check', async () => {
    const fetchFn = vi.fn(async () => okResponse('OK'));
    const res = await testApiKey('KEY', 'gemini-flash-latest', fetchFn);
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/Connected and verified/);
  });
});
