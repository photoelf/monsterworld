'use strict';

// Офлайн-кэш, атомарные обновления: страница всегда живёт из кэша своей версии;
// новая версия приезжает ТОЛЬКО целиком — установкой нового SW (бамп CACHE),
// который качает все ассеты мимо HTTP-кэша (cache:'reload'). Иначе ловим микс
// старых и новых файлов (GH Pages кэширует по 10 мин) — уже наступали (v19).
const CACHE = 'monsterworld-v29';
const ASSETS = [
  './', './index.html',
  './js/tg.js', './js/net.js', './js/util.js', './js/data.js', './js/world.js', './js/battle.js', './js/main.js', './js/pvp.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (new URL(e.request.url).origin !== location.origin) return;
  // cache-first без фоновой дозаписи: никакого поштучного обновления файлов
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
