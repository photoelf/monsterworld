'use strict';

// ===== Музыка и эмбиент =====
// Музыкальные треки будут файлами (day.mp3 / night.mp3 / battle.mp3 — ждём от
// владельца): подключать в Music как источники, переключать по G.phase и
// Battle.active, громкость через master. Генеративные мелодии убраны намеренно.
// Пока играет только эмбиент: шум дождя (weather 'rain' в тёплых краях) и
// вьюга в снежном климате (в снегопад громче). Подчиняется SOUND_ON и MUSIC_ON.

let MUSIC_ON = true;
try { MUSIC_ON = localStorage.getItem('mw-music') !== '0'; } catch (e) {}
function setMusicOn(v) {
  MUSIC_ON = !!v;
  try { localStorage.setItem('mw-music', v ? '1' : '0'); } catch (e) {}
  if (MUSIC_ON) Music.start(); else Music.mute();
}

const Music = {
  ctx: null,
  master: null,
  rainGain: null,
  windGain: null,
  _timer: null,

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
  },

  // Что вокруг: осадки и климат — читаем игровые глобалы бережно
  _state() {
    const st = { rain: false, cold: false, ready: false };
    try {
      if (typeof G === 'undefined' || !G.player || G.state === 'title' || G.state === 'starter') return st;
      st.ready = true;
      st.rain = G.weather === 'rain';
      st.cold = World.climateAt(Math.floor(G.player.x), Math.floor(G.player.y)) === 'cold';
    } catch (e) {}
    return st;
  },

  _tick() {
    if (!this.ctx) return;
    if (!SOUND_ON || !MUSIC_ON) { this.mute(); return; }
    const st = this._state();
    const now = this.ctx.currentTime;
    // дождь в тёплых краях; в снегах — вьюга (в снегопад сильнее)
    const rainV = st.ready && st.rain && !st.cold ? 0.05 : 0;
    const windV = st.ready && st.cold ? (st.rain ? 0.05 : 0.022) : 0;
    this.rainGain.gain.setTargetAtTime(rainV, now, 1.5);
    this.windGain.gain.setTargetAtTime(windV, now, 2);
  },
};

// первый же жест пользователя будит звук (требование автоплей-политик)
['pointerdown', 'keydown', 'touchstart'].forEach(ev =>
  window.addEventListener(ev, () => Music.start(), { passive: true }));
