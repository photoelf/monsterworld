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
    .then(d => { if (d && d.snap && Array.isArray(d.snap.team) && d.snap.team.length) _rival = d.snap; })
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
