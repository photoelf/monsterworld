'use strict';

// ===== Музыка и эмбиент =====
// Музыка — mp3-треки в audio/ (по 2 на день/ночь/битву, играется случайный,
// по окончании — снова случайный из группы). Переключение группы по G.phase и
// Battle.active с фейдом через тики. Громкость MUSIC_VOL (0–100, слайдер в
// настройках, дефолт 20). SW кэширует треки лениво в отдельный MUSIC_CACHE.
// Эмбиент — процедурный WebAudio: шум дождя (weather 'rain' в тёплых краях)
// и вьюга в снежном климате (в снегопад громче). Генеративные мелодии были и
// убраны намеренно (владельцу не зашли). Всё подчиняется SOUND_ON и MUSIC_ON.

let MUSIC_ON = true;
try { MUSIC_ON = localStorage.getItem('mw-music') !== '0'; } catch (e) {}
function setMusicOn(v) {
  MUSIC_ON = !!v;
  try { localStorage.setItem('mw-music', v ? '1' : '0'); } catch (e) {}
  if (MUSIC_ON) Music.start(); else Music.mute();
}

let MUSIC_VOL = 20;
try {
  const v = parseInt(localStorage.getItem('mw-music-vol'), 10);
  if (!isNaN(v)) MUSIC_VOL = Math.max(0, Math.min(100, v));
} catch (e) {}
function setMusicVol(v) {
  MUSIC_VOL = Math.max(0, Math.min(100, v | 0));
  try { localStorage.setItem('mw-music-vol', String(MUSIC_VOL)); } catch (e) {}
  // мгновенный отклик слайдера; дальше громкость ведут тики
  if (Music._track && Music._group) Music._track.volume = MUSIC_VOL / 100;
}

const MUSIC_TRACKS = {
  day: ['audio/day1.mp3', 'audio/day2.mp3'],
  night: ['audio/night1.mp3', 'audio/night2.mp3'],
  battle: ['audio/battle1.mp3', 'audio/battle2.mp3'],
};

const Music = {
  ctx: null,
  master: null,
  rainGain: null,
  windGain: null,
  _timer: null,
  _track: null,      // HTMLAudio с текущим треком
  _group: null,      // 'day' | 'night' | 'battle' | null (тишина)
  _src: null,

  _ensure() {
    if (this.ctx) return true;
    try {
      // делим AudioContext со звуками из util.js (_ac) — мобильный Safari не любит второй
      _ac = _ac || new (window.AudioContext || window.webkitAudioContext)();
      this.ctx = _ac;
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);

      // общий буфер белого шума для дождя и вьюги
      const len = this.ctx.sampleRate * 2;
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      const mkLoop = (type, freq, q) => {
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        src.loop = true;
        const flt = this.ctx.createBiquadFilter();
        flt.type = type;
        flt.frequency.value = freq;
        if (q) flt.Q.value = q;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        src.connect(flt); flt.connect(g); g.connect(this.master);
        src.start();
        return { g, flt };
      };
      this.rainGain = mkLoop('lowpass', 900).g;              // ровный шелест дождя
      const wind = mkLoop('bandpass', 420, 1.1);             // вьюга — гуляющий свист
      this.windGain = wind.g;
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      lfo.frequency.value = 0.06;
      lg.gain.value = 170;
      lfo.connect(lg); lg.connect(wind.flt.frequency);
      lfo.start();
      return true;
    } catch (e) { return false; }
  },

  // Запуск по жесту пользователя (иначе браузер держит контекст suspended)
  start() {
    if (!SOUND_ON || !MUSIC_ON) return;
    if (!this._ensure()) return;
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    if (!this._timer) this._timer = setInterval(() => this._tick(), 300);
  },

  mute() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    if (this.ctx) {
      const now = this.ctx.currentTime;
      this.rainGain.gain.setTargetAtTime(0, now, 0.3);
      this.windGain.gain.setTargetAtTime(0, now, 0.3);
    }
    if (this._track) { this._track.pause(); this._group = null; }
  },

  // Что вокруг: фаза, осадки, климат — читаем игровые глобалы бережно
  _state() {
    const st = { night: false, rain: false, cold: false, ready: false };
    try {
      if (typeof G === 'undefined' || !G.player || G.state === 'title' || G.state === 'starter') return st;
      st.ready = true;
      st.night = G.phase === 'night';
      st.rain = G.weather === 'rain';
      st.cold = World.climateAt(Math.floor(G.player.x), Math.floor(G.player.y)) === 'cold';
    } catch (e) {}
    return st;
  },

  _wantGroup(st) {
    if (!st.ready) return null;
    if (typeof Battle !== 'undefined' && Battle.active) return 'battle';
    return st.night ? 'night' : 'day';
  },

  // Случайный трек группы; при 2+ вариантах не повторяем только что игравший
  _pickSrc(group) {
    const list = MUSIC_TRACKS[group];
    let src = list[Math.floor(Math.random() * list.length)];
    if (list.length > 1 && src === this._src) src = list.find(s => s !== this._src);
    return src;
  },

  // instant — включить сразу на целевой громкости (бой), иначе фейд-ин тиками
  _playGroup(group, instant) {
    this._group = group;
    this._src = this._pickSrc(group);
    if (!this._track) {
      this._track = new Audio();
      this._track.preload = 'auto';
      // трек дозвучал — следующий случайный из текущей группы
      this._track.onended = () => { if (this._group) this._playGroup(this._group, true); };
    }
    this._track.src = this._src;
    this._track.volume = instant ? MUSIC_VOL / 100 : 0;
    this._track.play().catch(() => {});
  },

  _tick() {
    if (!this.ctx) return;
    if (!SOUND_ON || !MUSIC_ON) { this.mute(); return; }
    const st = this._state();
    const now = this.ctx.currentTime;
    // эмбиент: дождь в тёплых краях; в снегах — вьюга (в снегопад сильнее)
    const rainV = st.ready && st.rain && !st.cold ? 0.05 : 0;
    const windV = st.ready && st.cold ? (st.rain ? 0.05 : 0.022) : 0;
    this.rainGain.gain.setTargetAtTime(rainV, now, 1.5);
    this.windGain.gain.setTargetAtTime(windV, now, 2);
    // музыка: фейд к целевой группе и громкости
    const want = this._wantGroup(st);
    const target = MUSIC_VOL / 100;
    const tr = this._track;
    if (want !== this._group) {
      if (want === 'battle') {
        this._playGroup('battle', true); // в бой — сразу ТУЦ, без фейдов
      } else if (tr && !tr.paused && tr.volume > 0.02) {
        tr.volume = Math.max(0, tr.volume - 0.08); // из боя/при смене суток — мягко
      } else if (want) this._playGroup(want);
      else if (tr) { tr.pause(); this._group = null; }
    } else if (tr && this._group) {
      const dv = target - tr.volume;
      tr.volume = Math.abs(dv) < 0.03 ? target : tr.volume + Math.sign(dv) * 0.05;
      if (tr.paused && target > 0) tr.play().catch(() => {});
    }
  },
};

// первый же жест пользователя будит звук (требование автоплей-политик)
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => Music.start(), { passive: true }));
