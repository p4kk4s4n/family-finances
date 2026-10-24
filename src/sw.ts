/// <reference lib="webworker" />
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: any };

cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
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
