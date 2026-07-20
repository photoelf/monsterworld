'use strict';

// Офлайн-кэш, атомарные обновления: страница всегда живёт из кэша своей версии;
// новая версия приезжает ТОЛЬКО целиком — установкой нового SW (бамп CACHE),
// который качает все ассеты мимо HTTP-кэша (cache:'reload'). Иначе ловим микс
// старых и новых файлов (GH Pages кэширует по 10 мин) — уже наступали (v19).
const CACHE = 'monsterworld-v57';
const ASSETS = [
  './', './index.html',
  './js/tg.js', './js/net.js', './js/util.js', './js/music.js', './js/data.js', './js/world.js', './js/battle.js', './js/nz.js', './js/main.js', './js/pvp.js',
  './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png',
];
// Музыка (audio/*.mp3, ~35МБ) НЕ в ASSETS намеренно: install перекачивает ассеты
// мимо HTTP-кэша при каждом бампе версии — гонять столько трафика нельзя.
// Отдельный долгоживущий кэш, наполняется лениво при первом проигрывании;
// при смене треков поднять его версию (старый удалится в activate).
const MUSIC_CACHE = 'monsterworld-music-v2'; // v2: треки ужаты ~втрое (lame q9)

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE)
    .then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE && k !== MUSIC_CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;
  // музыка: cache-first с ленивой дозаписью. Запрос от <audio> может быть
  // Range-запросом — в кэш кладём только полный 200-ответ отдельного fetch
  if (url.pathname.includes('/audio/')) {
    e.respondWith(
      caches.open(MUSIC_CACHE).then(c => c.match(url.pathname).then(hit => hit ||
        fetch(url.pathname).then(resp => {
          if (resp.status === 200) c.put(url.pathname, resp.clone());
          return resp;
        })
      ))
    );
    return;
  }
  // код: cache-first без фоновой дозаписи — никакого поштучного обновления файлов
  e.respondWith(
    caches.match(e.request).then(cached => cached || fetch(e.request))
  );
});
