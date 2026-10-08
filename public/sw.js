/* Cache public shell assets only. Never cache authenticated pages or API responses. */
const CACHE = 'pulse-shell-v1';
const ASSETS = ['/offline.html', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
function safeNotificationUrl(value) {
  try { const target = new URL(typeof value === 'string' ? value : '/', self.location.origin); return target.origin === self.location.origin && ['http:', 'https:'].includes(target.protocol) ? target.href : self.location.origin; }
  catch { return self.location.origin; }
}
self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || event.request.method !== 'GET' || url.pathname.startsWith('/api/')) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')));
  } else if (ASSETS.includes(url.pathname)) {
    event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
  }
});
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = {body: 'New GitHub activity is waiting.'}; }
  if (!data || typeof data !== 'object') data = {};
  const destination = new URL(safeNotificationUrl(data.url));
  if (typeof data.eventId === 'string') destination.searchParams.set('event', data.eventId);
  const url = destination.href;
  event.waitUntil(self.registration.showNotification(data.title || 'Pulse · GitHub activity', {
    body: data.body || 'New activity is waiting.', icon: '/icon-192.png', badge: '/icon-192.png',
    tag: data.tag || data.id || 'pulse-activity', data: {url},
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = safeNotificationUrl(event.notification.data?.url);
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(async (clients) => {
    for (const client of clients) {
      if (new URL(client.url).origin === self.location.origin && 'focus' in client) {
        await client.navigate(url); return client.focus();
      }
    }
    return self.clients.openWindow(url);
  }));
});
