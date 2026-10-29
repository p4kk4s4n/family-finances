/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { getSettings } from './db/schema';
import { runWorkerQueue } from './capture/worker-queue';
import type { Receipt } from './types';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// Cache on-device OCR assets (/ocr/*) on first use so they work offline without bloating install precache.
registerRoute(
  ({ url }) => url.pathname.includes('/ocr/'),
  new CacheFirst({
    cacheName: 'ff-ocr-assets-v1',
  }),
);

async function notifyClientsAndUser(finished?: Receipt): Promise<void> {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const c of clients) {
    c.postMessage({ type: 'QUEUE_CHANGED', receiptId: finished?.id });
  }
  if (!finished) return;
  const anyVisible = clients.some((c) => (c as WindowClient).visibilityState === 'visible');
  if (anyVisible) return;
  try {
    const settings = await getSettings();
    if (!settings.notifyWhenReady) return;
    if ('Notification' in self && Notification.permission === 'granted') {
      const merchant = finished.draft?.merchant || 'Receipt';
      await self.registration.showNotification('Receipt ready to review', {
        body: `${merchant} was read in the background. Tap to review.`,
        icon: 'icon-192.png',
        tag: `ff-receipt-${finished.id ?? Date.now()}`,
        data: { receiptId: finished.id },
      });
    }
  } catch {
    // ignore notification errors
  }
}

async function processQueueInWorker(): Promise<void> {
  await runWorkerQueue({
    hidden: () => false, // Service Worker runs independently of tab visibility
    onReceiptFinished: async (receipt) => {
      await notifyClientsAndUser(receipt);
    },
  });
  await notifyClientsAndUser();
}

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data?.type === 'PROCESS_QUEUE') {
    e.waitUntil(processQueueInWorker());
  }
});

self.addEventListener('sync', (e: any) => {
  if (e.tag === 'ff-process-queue') {
    e.waitUntil(processQueueInWorker());
  }
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const receiptId = e.notification.data?.receiptId;
  const targetHash = receiptId ? `#/receipt/${receiptId}` : '#/capture';
  e.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      if (clients.length > 0) {
        const win = clients[0] as WindowClient;
        await win.focus().catch(() => undefined);
        win.postMessage({ type: 'NAVIGATE', path: receiptId ? `receipt/${receiptId}` : 'capture' });
        return;
      }
      await self.clients.openWindow(`${self.registration.scope}${targetHash}`);
    })(),
  );
});

// OS share sheet -> Family Finances: stash shared photos/PDFs, then open the capture screen.
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith(
    (async () => {
      const form = await event.request.formData();
      const files = form.getAll('receipts').filter((f): f is File => f instanceof File);
      const cache = await caches.open('share-inbox');
      await Promise.all(
        files.map((f, i) =>
          cache.put(`share-inbox/${Date.now()}-${i}`, new Response(f, { headers: { 'content-type': f.type || 'application/octet-stream' } })),
        ),
      );
      return Response.redirect(`${self.registration.scope}?shared=1#/capture`, 303);
    })(),
  );
});
