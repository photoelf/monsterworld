'use strict';

// ===== Интеграция Telegram Mini App =====
// Вызывается из main() после DOMContentLoaded: к этому моменту defer-скрипт
// telegram-web-app.js уже выполнен (или не загрузился — тогда мы не в Telegram).

let TG = null;      // Telegram.WebApp или null
let IS_TMA = false; // запущены ли мы как Mini App

function initTelegram() {
  TG = (window.Telegram && window.Telegram.WebApp) || null;
  IS_TMA = !!(TG && TG.initData);
  if (!IS_TMA) return;

  // внутри Telegram окно телефонных пропорций на любой платформе —
  // всегда мобильный вид (кроме явного форса ?desktop или настройки)
  if (!IS_MOBILE && !/[?&]desktop/.test(location.search) && FORCED_MODE !== 'desktop') IS_MOBILE = true;

  TG.ready();
  TG.expand();
  try { TG.setHeaderColor('#0d0d14'); TG.setBackgroundColor('#0d0d14'); } catch (e) {}

  // вертикальные свайпы сворачивают мини-апп — с джойстиком это недопустимо
  if (TG.disableVerticalSwipes) TG.disableVerticalSwipes();
  // случайное закрытие = потеря несохранённого боя
  if (TG.enableClosingConfirmation) TG.enableClosingConfirmation();

  // фулскрин на телефонах (Bot API 8.0+); на десктопе остаёмся в окне
  const mobilePlatform = TG.platform === 'ios' || TG.platform === 'android';
  if (mobilePlatform && TG.requestFullscreen && !TG.isFullscreen) {
    try { TG.requestFullscreen(); } catch (e) {}
  }

  // отступы: системная safe area + шапка Telegram (крестик/меню) → CSS-переменные
  const applyInsets = () => {
    const s = TG.safeAreaInset || {};
    const c = TG.contentSafeAreaInset || {};
    const st = document.documentElement.style;
    st.setProperty('--tg-top', ((s.top || 0) + (c.top || 0)) + 'px');
    st.setProperty('--tg-bottom', ((s.bottom || 0) + (c.bottom || 0)) + 'px');
    st.setProperty('--tg-left', ((s.left || 0) + (c.left || 0)) + 'px');
    st.setProperty('--tg-right', ((s.right || 0) + (c.right || 0)) + 'px');
    if (typeof resizeCanvas === 'function') resizeCanvas();
  };
  applyInsets();
  TG.onEvent('safeAreaChanged', applyInsets);
  TG.onEvent('contentSafeAreaChanged', applyInsets);
  TG.onEvent('fullscreenChanged', applyInsets);
  TG.onEvent('viewportChanged', applyInsets);

  // облачные сейвы и профиль (CloudStorage появился в Bot API 6.9)
  if (TG.CloudStorage) {
    cloudSyncOnLaunch().then(() => ensureRegistration()).catch(() => {});
    // при сворачивании — успеть дослать несохранённое
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') cloudFlush();
    });
  }
}

// ===== CloudStorage: облачные сейвы =====
// Значение ключа ≤ 4096 символов, поэтому сейв режется на чанки:
// sv_meta = {n, ts, len}; sv_0..sv_{n-1} — base64-куски.

const CLOUD_CHUNK = 3500;
const NICK_KEY = 'monsterworld-nick';
let playerNick = null;
let _cloudTimer = null;
let _cloudBusy = false;

const b64e = s => btoa(unescape(encodeURIComponent(s)));
const b64d = s => decodeURIComponent(escape(atob(s)));

function csGet(key) {
  return new Promise((res, rej) => TG.CloudStorage.getItem(key, (e, v) => e ? rej(e) : res(v)));
}
function csGetMany(keys) {
  return new Promise((res, rej) => TG.CloudStorage.getItems(keys, (e, v) => e ? rej(e) : res(v)));
}
function csSet(key, value) {
  return new Promise((res, rej) => TG.CloudStorage.setItem(key, value, (e, ok) => e ? rej(e) : res(ok)));
}
function csRemove(keys) {
  return new Promise((res, rej) => TG.CloudStorage.removeItems(keys, (e, ok) => e ? rej(e) : res(ok)));
}

// Залить текущий localStorage-сейв в облако
async function cloudUpload() {
  const raw = localStorage.getItem(SAVE_KEY);
  if (!raw) return;
  const enc = b64e(raw);
  const n = Math.ceil(enc.length / CLOUD_CHUNK);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(csSet('sv_' + i, enc.slice(i * CLOUD_CHUNK, (i + 1) * CLOUD_CHUNK)));
  }
  await Promise.all(jobs);
  await csSet('sv_meta', JSON.stringify({ n, ts: Date.now(), len: enc.length }));
  // подчистить хвосты от более длинного старого сейва
  let meta0 = null;
  try { meta0 = JSON.parse(await csGet('sv_meta_prev')); } catch (e) {}
  if (meta0 && meta0.n > n) {
    const stale = [];
    for (let i = n; i < meta0.n; i++) stale.push('sv_' + i);
    csRemove(stale).catch(() => {});
  }
  csSet('sv_meta_prev', JSON.stringify({ n })).catch(() => {});
}

// Скачать облачный сейв: {json, ts} | null
async function cloudDownload() {
  let meta = null;
  try { meta = JSON.parse(await csGet('sv_meta')); } catch (e) { return null; }
  if (!meta || !meta.n) return null;
  const keys = [];
  for (let i = 0; i < meta.n; i++) keys.push('sv_' + i);
  const parts = await csGetMany(keys);
  let enc = '';
  for (let i = 0; i < meta.n; i++) {
    const p = parts['sv_' + i];
    if (!p) return null; // битый сейв — не трогаем локальный
    enc += p;
  }
  if (meta.len && enc.length !== meta.len) return null;
  try { return { json: b64d(enc), ts: meta.ts || 0 }; } catch (e) { return null; }
}

// Отложенная заливка: не чаще раза в 20 секунд
function cloudSaveSoon() {
  if (!IS_TMA || !TG.CloudStorage) return;
  if (_cloudTimer) return;
  _cloudTimer = setTimeout(cloudFlush, 20000);
}

function cloudFlush() {
  if (!IS_TMA || !TG.CloudStorage || _cloudBusy) return;
  clearTimeout(_cloudTimer);
  _cloudTimer = null;
  _cloudBusy = true;
  cloudUpload().catch(() => {}).finally(() => { _cloudBusy = false; });
}

// При запуске: если облачный сейв свежее локального (или локального нет) — берём облачный
async function cloudSyncOnLaunch() {
  const cloud = await cloudDownload();
  if (!cloud) return;
  let localTs = -1;
  try {
    const d = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (d && d.party && d.party.length) localTs = d.ts || 0;
  } catch (e) {}
  if (cloud.ts > localTs) {
    try {
      const cd = JSON.parse(cloud.json);
      if (!cd || !cd.party || !cd.party.length) return;
      localStorage.setItem(SAVE_KEY, cloud.json);
    } catch (e) { return; }
    // игрок ещё на титуле — показать «Продолжить» и сказать про облако
    if (G.state === 'title') {
      document.getElementById('btn-continue').classList.remove('hidden');
      toast('☁️ Сейв загружен из облака Telegram');
    }
  }
}

// ===== Регистрация: ник игрока =====

async function ensureRegistration() {
  try { playerNick = localStorage.getItem(NICK_KEY) || null; } catch (e) {}
  // облачный профиль главнее локального
  try {
    const prof = JSON.parse(await csGet('profile'));
    if (prof && prof.nick) {
      playerNick = prof.nick;
      try { localStorage.setItem(NICK_KEY, playerNick); } catch (e) {}
      updateNickUi();
      return;
    }
  } catch (e) {}
  if (playerNick) {
    csSet('profile', JSON.stringify({ nick: playerNick })).catch(() => {});
    updateNickUi();
    return;
  }
  // первого раза — предлагаем ник из Telegram
  const u = TG.initDataUnsafe && TG.initDataUnsafe.user;
  const def = ((u && (u.username || u.first_name)) || 'Тренер').slice(0, 20);
  const inp = document.getElementById('reg-nick');
  inp.value = def;
  document.getElementById('reg-panel').classList.remove('hidden');
  document.getElementById('btn-reg-ok').onclick = () => {
    const nick = inp.value.trim().slice(0, 20) || def;
    playerNick = nick;
    try { localStorage.setItem(NICK_KEY, nick); } catch (e) {}
    csSet('profile', JSON.stringify({ nick })).catch(() => {});
    document.getElementById('reg-panel').classList.add('hidden');
    toast('Добро пожаловать в Братву, ' + nick + '!');
    updateNickUi();
  };
}

function updateNickUi() {
  const el = document.getElementById('title-nick');
  if (el && playerNick) el.textContent = '👤 ' + playerNick;
}
