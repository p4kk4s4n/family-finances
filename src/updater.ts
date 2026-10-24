declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: number;

export interface VersionInfo {
  sha: string;
  builtAt: number;
}

export const CURRENT_VERSION: VersionInfo = {
  sha: typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev',
  builtAt: typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : 0,
};

/** The deployed build is "the latest available version"; any different build id means update. */
export function needsUpdate(local: VersionInfo, remote: Partial<VersionInfo> | null | undefined): boolean {
  if (!remote || typeof remote.sha !== 'string' || !remote.sha) return false;
  return remote.sha !== local.sha;
}

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchDeployedVersion(
  base: string = import.meta.env.BASE_URL,
  fetchFn: FetchFn = (i, init) => fetch(i, init),
): Promise<VersionInfo> {
  const res = await fetchFn(`${base}version.json?t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Could not reach the deployed site (HTTP ${res.status}).`);
  return (await res.json()) as VersionInfo;
}

/**
 * Install the latest deployed build: refresh the service worker, clear app-shell caches
 * (IndexedDB data is never touched), and reload into the new version.
 */
export async function applyUpdate(): Promise<void> {
  const regs = (await navigator.serviceWorker?.getRegistrations?.()) ?? [];
  await Promise.all(regs.map((r) => r.update().catch(() => undefined)));
  regs.forEach((r) => r.waiting?.postMessage({ type: 'SKIP_WAITING' }));
  if ('caches' in window) {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== 'share-inbox').map((k) => caches.delete(k)));
  }
  await Promise.all(regs.map((r) => r.unregister().catch(() => false)));
  const url = new URL(window.location.href);
  url.searchParams.set('updated', String(Date.now()));
  window.location.replace(url.toString());
}

export type UpdateStatus =
  | { state: 'checking' }
  | { state: 'latest'; remote: VersionInfo }
  | { state: 'updating'; remote: VersionInfo }
  | { state: 'error'; message: string };

/** One-tap flow behind Settings → "Check for updates & install latest". */
export async function checkAndUpdate(opts: {
  onStatus: (s: UpdateStatus) => void;
  beforeUpdate?: () => Promise<void>;
  fetchFn?: FetchFn;
  apply?: () => Promise<void>;
}): Promise<void> {
  opts.onStatus({ state: 'checking' });
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error('You are offline. Connect and try again.');
    const remote = await fetchDeployedVersion(undefined, opts.fetchFn);
    if (!needsUpdate(CURRENT_VERSION, remote)) {
      opts.onStatus({ state: 'latest', remote });
      return;
    }
    opts.onStatus({ state: 'updating', remote });
    if (opts.beforeUpdate) await opts.beforeUpdate();
    await (opts.apply ?? applyUpdate)();
  } catch (e) {
    opts.onStatus({ state: 'error', message: (e as Error).message });
  }
}
