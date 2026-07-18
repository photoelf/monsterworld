'use strict';

// ===== Сетевая часть: снапшоты команд для встреч с реальными тренерами =====
// Бэкенд — Cloudflare Worker (backend/worker.js). Пустой API_BASE = фича выключена.
// Для локальных тестов: localStorage.setItem('mw-api', 'http://localhost:8787')

const API_BASE = localStorage.getItem('mw-api') || 'https://monsterworld-api.photoelf.workers.dev';

const CLIENT_ID_KEY = 'monsterworld-client-id';

function netClientId() {
  let id = null;
  try { id = localStorage.getItem(CLIENT_ID_KEY); } catch (e) {}
  if (!id) {
    id = 'c' + ((Math.random() * 4294967296) >>> 0).toString(36) + Date.now().toString(36);
    try { localStorage.setItem(CLIENT_ID_KEY, id); } catch (e) {}
  }
  return id;
}

let _lastUpload = 0;

// Залить свою команду (не чаще раза в 90 секунд, молча при ошибках)
function netUploadTeam() {
  if (!API_BASE || !G.party.length) return;
  const now = Date.now();
  if (now - _lastUpload < 90000) return;
  _lastUpload = now;
  const nick = (typeof playerNick === 'string' && playerNick) || 'Тренер';
  fetch(API_BASE + '/team', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), nick, team: G.party.map(tradeMonDump) }),
  }).catch(() => {});
}

// Кэш одного «живого соперника»; пополняется в фоне
let _rival = null;
let _rivalFetching = false;

function netFetchRival() {
  if (!API_BASE || _rival || _rivalFetching) return;
  _rivalFetching = true;
  fetch(API_BASE + '/team/random?not=' + netClientId())
    .then(r => r.json())
    .then(d => {
      if (!d || !d.snap || !Array.isArray(d.snap.team) || !d.snap.team.length) return;
      // не деремся сами с собой: clientId у каждого устройства свой,
      // а сейв общий через облако — фильтруем ещё и по нику
      if (typeof playerNick === 'string' && playerNick && d.snap.nick === playerNick) return;
      _rival = d.snap;
    })
    .catch(() => {})
    .finally(() => { _rivalFetching = false; });
}

// Забрать соперника (однократно): {nick, team} | null
function netTakeRival() {
  const r = _rival;
  _rival = null;
  netFetchRival(); // сразу тянем следующего
  return r;
}

// Подписанный initData текущего запуска (в TMA); null в браузере.
// Все запросы покупок шлют его — воркер привязывает покупку к tg-id, а не к
// clientId/сейву (кэш-флаги ниже переименованы в *2, чтобы после перехода на
// tg-привязку клиент перепроверил сервер, а не доверял старой авто-VIP-выдаче).
function tgInitData() { return (typeof TG !== 'undefined' && TG && TG.initData) || null; }

// ===== PvP через Telegram (вызов по deep-link, без копирования кодов) =====

function _pvpNick() { return (typeof playerNick === 'string' && playerNick) || 'Тренер'; }

// Создать вызов: cb(id) при успехе, cb(null) при ошибке
function netPvpCreate(team, nonce, cb) {
  if (!API_BASE) { cb(null); return; }
  fetch(API_BASE + '/pvp/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), initData: tgInitData(), nick: _pvpNick(), team, nonce }),
  })
    .then(r => r.json())
    .then(d => cb(d && d.id ? d.id : null))
    .catch(() => cb(null));
}

// Прочитать вызов (status, mySide, команды): cb(challenge|null)
function netPvpGet(id, cb) {
  if (!API_BASE) { cb(null); return; }
  fetch(API_BASE + '/pvp/get', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), ch: id, initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => cb(d && !d.err ? d : null))
    .catch(() => cb(null));
}

// Принять вызов (B): cb(true|false)
function netPvpAccept(id, team, nonce, result, cb) {
  if (!API_BASE) { cb(false); return; }
  fetch(API_BASE + '/pvp/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), ch: id, initData: tgInitData(), nick: _pvpNick(), team, nonce, result }),
  })
    .then(r => r.json())
    .then(d => cb(!!(d && d.ok)))
    .catch(() => cb(false));
}

// ===== Покупка загрузки кастомных спрайтов (Telegram Stars) =====

const SPRITE_PRICE = 10;   // держать в синхроне с воркером (SPRITE_PRICE_STARS)
let sprUnlocked = false;
try { sprUnlocked = localStorage.getItem('mw-spr-unlocked2') === '1'; } catch (e) {}

const SCUM_PRICE = 10;     // режим сейвскамера (SCUM_PRICE_STARS)
let scumUnlocked = false;
try { scumUnlocked = localStorage.getItem('mw-scum-unlocked') === '1'; } catch (e) {}

// Объединённая проверка разовых покупок за ОДИН запрос (spr/scoot/scum) —
// раньше было по запросу на каждый товар, теперь один /status. Экономит KV.
function netCheckStatus(cb) {
  if ((sprUnlocked && scootUnlocked && scumUnlocked) || !API_BASE) { if (cb) cb(); return; }
  fetch(API_BASE + '/status', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d) {
        if (d.spr) { sprUnlocked = true; try { localStorage.setItem('mw-spr-unlocked2', '1'); } catch (e) {} }
        if (d.scoot) { scootUnlocked = true; try { localStorage.setItem('mw-scoot-unlocked2', '1'); } catch (e) {} }
        if (d.scum) { scumUnlocked = true; try { localStorage.setItem('mw-scum-unlocked', '1'); } catch (e) {} }
      }
      if (cb) cb();
    })
    .catch(() => { if (cb) cb(); });
}

function netCheckScum(cb) {
  if (scumUnlocked || !API_BASE) { if (cb) cb(scumUnlocked); return; }
  netCheckStatus(() => { if (cb) cb(scumUnlocked); });
}
function netBuyScum(onDone) { netBuyProduct('scum', netCheckScum, onDone); }

function netCheckUnlock(cb) {
  if (sprUnlocked || !API_BASE) { if (cb) cb(sprUnlocked); return; }
  fetch(API_BASE + '/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d && d.unlocked) {
        sprUnlocked = true;
        try { localStorage.setItem('mw-spr-unlocked2', '1'); } catch (e) {}
      }
      if (cb) cb(sprUnlocked);
    })
    .catch(() => { if (cb) cb(sprUnlocked); });
}

// Активация промокода: cb(true) при успехе
function netRedeemCode(code, cb) {
  fetch(API_BASE + '/redeem', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), code, initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d && d.ok) {
        sprUnlocked = true;
        try { localStorage.setItem('mw-spr-unlocked2', '1'); } catch (e) {}
      }
      if (cb) cb(!!(d && d.ok));
    })
    .catch(() => { if (cb) cb(false); });
}

// Открыть счёт в Stars и дождаться оплаты; product: 'spr'|'mon'|'scoot',
// checkFn(cb) — как проверить, что покупка дошла; onDone — после подтверждения.
// granted:true — VIP получил бесплатно по явному нажатию (без счёта).
function netBuyProduct(product, checkFn, onDone) {
  fetch(API_BASE + '/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), product, initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d && (d.err === 'already unlocked' || d.granted)) { checkFn(ok => { if (ok && onDone) onDone(); }); return; }
      if (!d || !d.link) { toast('Не удалось создать счёт — попробуй позже.'); return; }
      if (IS_TMA && TG && TG.openInvoice) {
        TG.openInvoice(d.link, status => {
          if (status !== 'paid') return;
          toast('⭐ Спасибо! Подтверждаем оплату...');
          let tries = 0;
          const poll = () => checkFn(ok => {
            if (ok) { if (onDone) onDone(); }
            else if (++tries < 12) setTimeout(poll, 1500);
            else toast('Оплата прошла, но подтверждение задерживается — перезайди в игру.');
          });
          setTimeout(poll, 1200);
        });
      } else {
        window.open(d.link, '_blank');
      }
    })
    .catch(() => toast('Сеть недоступна — попробуй позже.'));
}

function netBuySpriteUnlock(onDone) { netBuyProduct('spr', netCheckUnlock, onDone); }

// ===== Электросамокат (премиум-маунт, Telegram Stars) =====

const SCOOT_PRICE = 50;   // держать в синхроне с воркером (SCOOT_PRICE_STARS)
let scootUnlocked = false;
try { scootUnlocked = localStorage.getItem('mw-scoot-unlocked2') === '1'; } catch (e) {}

function netCheckScoot(cb) {
  if (scootUnlocked || !API_BASE) { if (cb) cb(scootUnlocked); return; }
  fetch(API_BASE + '/unlock', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), product: 'scoot', initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d && d.unlocked) {
        scootUnlocked = true;
        try { localStorage.setItem('mw-scoot-unlocked2', '1'); } catch (e) {}
      }
      if (cb) cb(scootUnlocked);
    })
    .catch(() => { if (cb) cb(scootUnlocked); });
}

function netBuyScoot(onDone) { netBuyProduct('scoot', netCheckScoot, onDone); }

// ===== Аксессуары гардероба (поштучно, 1–5 Stars) =====
// Перекраски бесплатны; цены синхронно с воркером (ACC_PRICES там же)

const ACC_PRICES = { cap: 1, glasses: 2, crown: 5 };

// Кэш купленных аксессуаров (ключ *2 — миграция на tg-привязку; сервер — истина)
let accsOwned = new Set();
try { accsOwned = new Set(JSON.parse(localStorage.getItem('mw-accs2') || '[]')); } catch (e) {}

function _accsCache() {
  try { localStorage.setItem('mw-accs2', JSON.stringify([...accsOwned])); } catch (e) {}
}

// Обновить список купленных с сервера; cb(accsOwned). Сервер — источник истины:
// список ЗАМЕНЯЕТСЯ (иначе невыкупленное из старого кэша не убралось бы).
function netAccsStatus(cb) {
  if (!API_BASE) { if (cb) cb(accsOwned); return; }
  fetch(API_BASE + '/accs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d && Array.isArray(d.owned)) {
        accsOwned = new Set(d.owned.filter(a => ACC_PRICES[a]));
        _accsCache();
      }
      if (cb) cb(accsOwned);
    })
    .catch(() => { if (cb) cb(accsOwned); });
}

// Купить аксессуар за Stars; onDone — когда покупка подтверждена.
// granted:true — VIP получил бесплатно по явному нажатию.
function netBuyAcc(accId, onDone) {
  fetch(API_BASE + '/invoice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), product: 'acc', item: accId, initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => {
      if (d && (d.err === 'already unlocked' || d.granted)) { accsOwned.add(accId); _accsCache(); if (onDone) onDone(); return; }
      if (!d || !d.link) { toast('Не удалось создать счёт — попробуй позже.'); return; }
      if (IS_TMA && TG && TG.openInvoice) {
        TG.openInvoice(d.link, status => {
          if (status !== 'paid') return;
          toast('⭐ Спасибо! Подтверждаем оплату...');
          let tries = 0;
          const poll = () => netAccsStatus(owned => {
            if (owned.has(accId)) { if (onDone) onDone(); }
            else if (++tries < 12) setTimeout(poll, 1500);
            else toast('Оплата прошла, но подтверждение задерживается — перезайди в игру.');
          });
          setTimeout(poll, 1200);
        });
      } else {
        window.open(d.link, '_blank');
      }
    })
    .catch(() => toast('Сеть недоступна — попробуй позже.'));
}

// ===== Генератор заказных братишек (Telegram Stars, кредиты) =====

const MONGEN_PRICE = 25;   // держать в синхроне с воркером (MONGEN_PRICE_STARS)

// cb({credits, vip}) — сколько оплаченных генераций доступно
function netMongenStatus(cb) {
  if (!API_BASE) { cb({ credits: 0, vip: false }); return; }
  fetch(API_BASE + '/mongen', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => cb({ credits: (d && d.credits) | 0, vip: !!(d && d.vip) }))
    .catch(() => cb({ credits: 0, vip: false }));
}

// Списать один кредит; cb(true) при успехе
function netMongenClaim(cb) {
  fetch(API_BASE + '/mongen/claim', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: netClientId(), initData: tgInitData() }),
  })
    .then(r => r.json())
    .then(d => cb(!!(d && d.ok)))
    .catch(() => cb(false));
}

function netBuyMongen(onDone) {
  netBuyProduct('mon', cb => netMongenStatus(s => cb(s.credits > 0 || s.vip)), onDone);
}
