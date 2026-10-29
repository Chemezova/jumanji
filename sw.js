// Офлайн-режим: держим файлы приложения в кэше.
// При изменении файлов увеличить номер версии.
const CACHE = 'jumanji-v84';
const FILES = ['./', 'index.html', 'style.css', 'deck.js', 'app.js', 'manifest.json', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];
const NET_WAIT = 4000;   // столько ждём сеть, потом отдаём кэш — чтобы при плохом интернете не висеть

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

// Из кэша; для страницы, которой там нет, — главная (а не белый экран)
function fromCache(req) {
  return caches.match(req, { ignoreSearch: true })
    .then(r => r || (req.mode === 'navigate' ? caches.match('index.html') : undefined))
    .then(r => r || Response.error());
}

// Сначала сеть (чтобы обновления приезжали сразу), без сети или если сеть тормозит — кэш
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(new Promise(resolve => {
    let done = false;
    const finish = r => { if (!done) { done = true; resolve(r); } };
    const slow = setTimeout(() => caches.match(req, { ignoreSearch: true }).then(r => r && finish(r)), NET_WAIT);
    fetch(req, { cache: 'no-cache' }).then(r => {
      clearTimeout(slow);
      // в кэш — только нормальный ответ: страница ошибки во время выкладки не должна затереть рабочий файл
      if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); finish(r); }
      else fromCache(req).then(c => finish(c.type === 'error' ? r : c));
    }).catch(() => { clearTimeout(slow); fromCache(req).then(finish); });
  }));
});
