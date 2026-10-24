import { describe, expect, it, vi } from 'vitest';
import { CURRENT_VERSION, checkAndUpdate, needsUpdate, type UpdateStatus } from './updater';

describe('updater', () => {
  it('needsUpdate compares build ids', () => {
    const local = { sha: 'abc', builtAt: 1 };
    expect(needsUpdate(local, { sha: 'abc', builtAt: 1 })).toBe(false);
    expect(needsUpdate(local, { sha: 'def', builtAt: 2 })).toBe(true);
    expect(needsUpdate(local, null)).toBe(false);
    expect(needsUpdate(local, { builtAt: 5 })).toBe(false);
  });

  it('reports latest when deployed build matches', async () => {
    const statuses: UpdateStatus[] = [];
    const apply = vi.fn(async () => {});
    await checkAndUpdate({
      onStatus: (s) => statuses.push(s),
      fetchFn: async () => new Response(JSON.stringify(CURRENT_VERSION)),
      apply,
    });
    expect(statuses.map((s) => s.state)).toEqual(['checking', 'latest']);
    expect(apply).not.toHaveBeenCalled();
  });

  it('backs up then applies when a newer build is deployed', async () => {
    const order: string[] = [];
    await checkAndUpdate({
      onStatus: (s) => order.push(s.state),
      fetchFn: async (url) => {
        expect(url).toMatch(/version\.json\?t=\d+/);
        return new Response(JSON.stringify({ sha: 'newer', builtAt: Date.now() }));
      },
      beforeUpdate: async () => { order.push('backup'); },
      apply: async () => { order.push('apply'); },
    });
    expect(order).toEqual(['checking', 'updating', 'backup', 'apply']);
  });

  it('surfaces network errors', async () => {
    const statuses: UpdateStatus[] = [];
    await checkAndUpdate({ onStatus: (s) => statuses.push(s), fetchFn: async () => new Response('nope', { status: 404 }), apply: async () => {} });
    expect(statuses.at(-1)).toEqual({ state: 'error', message: expect.stringContaining('404') });
  });
});
