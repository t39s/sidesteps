/* sidesteps cache scoped to this PWA path; does not erase legacy Interval Lab caches. */
const SCOPE_ID = new URL(self.registration.scope).pathname.replace(/[^A-Za-z0-9]/g, '_');
const PREFIX = 'sidesteps-shell-' + SCOPE_ID + '-';
const CACHE = PREFIX + 'v0_2_2_rc6';
const SHELL = ['./','./index.html','./model.js?v=022rc6','./app.js?v=022rc6','./styles.css?v=022rc6','./config.json','./icon.svg','./manifest.webmanifest'];
self.addEventListener('install', e => e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(Promise.all([
  caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith(PREFIX) && k !== CACHE).map(k => caches.delete(k)))),
  self.clients.claim()
])));
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET' || new URL(e.request.url).origin !== self.location.origin) return;
  if (!new URL(e.request.url).pathname.startsWith(new URL(self.registration.scope).pathname)) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(e.request);
      if (response.ok) cache.put(e.request, response.clone());
      return response;
    } catch (error) {
      const saved = await cache.match(e.request, {ignoreSearch:true});
      if (saved) return saved;
      if (e.request.mode === 'navigate') return cache.match('./index.html');
      throw error;
    }
  })());
});
