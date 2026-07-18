'use strict';

// ===== Детерминированная случайность =====

// Целочисленный хэш координат -> uint32
function hash2u(x, y, seed) {
  let h = (seed >>> 0) ^ Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}
// Хэш координат -> [0,1)
function hash2(x, y, seed) {
  return hash2u(x, y, seed) / 4294967296;
}

// Быстрый сидированный ГПСЧ
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Строка -> uint32 (FNV-1a), чтобы вводить текстовые сиды
function strSeed(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// ===== Шум =====

// Value noise со сглаживанием
function vnoise(x, y, scale, seed) {
  const fx = x / scale, fy = y / scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
  const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// Несколько октав, нормировано в [0,1]
function fbm(x, y, scale, seed, octaves) {
  let sum = 0, amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    sum += vnoise(x, y, scale / (1 << o), seed + o * 1013) * amp;
    total += amp;
    amp *= 0.5;
  }
  return sum / total;
}

// ===== Мелкие помощники =====

function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
function irange(rng, a, b) { return a + Math.floor(rng() * (b - a + 1)); }
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

// Подсказка клавиши для текстов: на мобиле клавиатуры нет — пустая строка
function keyHint(k) { return IS_MOBILE ? '' : ' (' + k + ')'; }

// ===== Простые звуковые эффекты (WebAudio) =====

// Глобальный выключатель звука (страница настроек), живёт в localStorage
let SOUND_ON = true;
try { SOUND_ON = localStorage.getItem('mw-sound') !== '0'; } catch (e) {}
function setSoundOn(v) {
  SOUND_ON = !!v;
  try { localStorage.setItem('mw-sound', v ? '1' : '0'); } catch (e) {}
}

let _ac = null;
function _tone(freq, when, dur, type, vol) {
  const o = _ac.createOscillator(), g = _ac.createGain();
  o.type = type; o.frequency.value = freq;
  g.gain.setValueAtTime(vol, _ac.currentTime + when);
  g.gain.exponentialRampToValueAtTime(0.001, _ac.currentTime + when + dur);
  o.connect(g); g.connect(_ac.destination);
  o.start(_ac.currentTime + when);
  o.stop(_ac.currentTime + when + dur + 0.02);
}
function sfx(kind) {
  if (!SOUND_ON) return;
  try {
    _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
    switch (kind) {
      case 'hit':    _tone(160, 0, 0.09, 'square', 0.12); break;
      case 'miss':   _tone(320, 0, 0.06, 'sine', 0.08); _tone(250, 0.07, 0.06, 'sine', 0.08); break;
      case 'faint':  _tone(300, 0, 0.12, 'sawtooth', 0.1); _tone(180, 0.12, 0.15, 'sawtooth', 0.1); _tone(90, 0.26, 0.25, 'sawtooth', 0.1); break;
      case 'catch':  _tone(440, 0, 0.08, 'square', 0.1); _tone(550, 0.1, 0.08, 'square', 0.1); _tone(660, 0.2, 0.16, 'square', 0.1); break;
      case 'heal':   _tone(523, 0, 0.1, 'sine', 0.12); _tone(659, 0.1, 0.1, 'sine', 0.12); _tone(784, 0.2, 0.18, 'sine', 0.12); break;
      case 'level':  _tone(392, 0, 0.07, 'square', 0.1); _tone(523, 0.08, 0.07, 'square', 0.1); _tone(659, 0.16, 0.07, 'square', 0.1); _tone(784, 0.24, 0.14, 'square', 0.1); break;
      case 'enc':    _tone(220, 0, 0.1, 'sawtooth', 0.1); _tone(220, 0.14, 0.1, 'sawtooth', 0.1); break;
      case 'pickup': _tone(660, 0, 0.06, 'square', 0.1); _tone(880, 0.07, 0.09, 'square', 0.1); break;
      case 'ball':   _tone(500, 0, 0.05, 'triangle', 0.12); break;
    }
  } catch (e) { /* звук не критичен */ }
}
