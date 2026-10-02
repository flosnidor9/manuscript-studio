const CACHE = 'manuscript-studio-v41';
const ASSETS = ['./', './index.html', './styles.css', './app.js', './model.js', './punctuation.js', './storage.js', './export.js', './print_export.js', './preview.js', './editor.js'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('manuscript-studio-') && key !== CACHE).map(key => caches.delete(key))
  )));
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(fetch(request).then(response => {
    if (response.ok && response.type === 'basic') {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {}));
    }
    return response;
  }).catch(async () => (await caches.match(request)) || (request.mode === 'navigate' ? await caches.match('./index.html') : null) || Response.error()));
});
