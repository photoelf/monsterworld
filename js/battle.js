'use strict';

// ===== Боевая система =====
// Асинхронный поток: await say(...) ждёт клика/Enter, await menu(...) ждёт выбора.

// Маркер отката боя: им реджектится текущий await, цикл ловит и перезапускает ход
const BATTLE_RELOAD = { reload: true };

const Battle = {
  active: false,
  _sayResolve: null,
  _sayReject: null,
  _menuResolve: null,
  _battleSave: null,   // снапшот боя (сейвскам внутри боя)

  // Автобой (премиум autoUnlocked): тренер сам атакует и меняет бойцов.
  // Настройки липкие между боями (localStorage, не сейв).
  _auto: localStorage.getItem('mw-auto-on') === '1',
  _speed: [1, 2, 3].includes(+localStorage.getItem('mw-auto-speed')) ? +localStorage.getItem('mw-auto-speed') : 1,

  el(id) { return document.getElementById(id); },

  advance() {
    if (this._sayResolve) {
      const r = this._sayResolve;
      this._sayResolve = null; this._sayReject = null;
      r();
    }
  },

  say(text) {
    this.el('bt-menu').innerHTML = '';
    this.el('bt-log').innerHTML = text + ' <span class="next">▼</span>';
    return new Promise((res, rej) => {
      this._sayResolve = res; this._sayReject = rej;
      // автобой сам листает реплики; клик/Enter по-прежнему работают
      if (this._auto && this.active) setTimeout(() => this.advance(), 650 / this._speed);
    });
  },

  // Сейвскам в бою: снапшот ОЗ/ПП/статусов обеих команд + сфер + активных бойцов
  battleSave() {
    if (!this.active) return;
    this._battleSave = {
      party: G.party.map(m => ({ hp: m.hp, status: m.status, pp: m.moves.map(mv => mv.pp) })),
      enemy: (this._enemyRef || []).map(m => ({ hp: m.hp, status: m.status, pp: m.moves.map(mv => mv.pp) })),
      balls: Object.assign({}, G.balls), pi: this._curPi, ei: this._curEi,
    };
    toast('💾 Бой сохранён.');
  },

  // Откат к боевому сейву: мутируем существующие объекты (ссылки те же) и
  // прерываем текущий await — цикл ловит BATTLE_RELOAD и перезапускает ход
  battleReload() {
    if (!this.active) return;
    if (!this._battleSave) { toast('Нет боевого сейва — сперва 💾.'); return; }
    const s = this._battleSave;
    const restore = (arr, snaps) => snaps.forEach((snap, i) => {
      const m = arr[i]; if (!m) return;
      m.hp = snap.hp; m.status = snap.status;
      m.moves.forEach((mv, j) => { if (snap.pp[j] !== undefined) mv.pp = snap.pp[j]; });
    });
    restore(G.party, s.party);
    restore(this._enemyRef || [], s.enemy);
    G.balls = Object.assign({}, s.balls); updateHUD();
    this._reloadPi = s.pi; this._reloadEi = s.ei;
    if (this._menuResolve) {
      const r = this._menuResolve; this._menuResolve = null; this.el('bt-menu').innerHTML = '';
      r.rej(BATTLE_RELOAD);
    } else if (this._sayReject) {
      const rj = this._sayReject; this._sayResolve = null; this._sayReject = null;
      rj(BATTLE_RELOAD);
    }
  },

  note(text) { // сообщение без ожидания (подпись над меню)
    this.el('bt-log').textContent = text;
  },

  // options: [{label, small, disabled}], cancellable -> Esc или кнопка «Назад» возвращает -1
  menu(options, cancellable) {
    const menuEl = this.el('bt-menu');
    menuEl.innerHTML = '';
    return new Promise((res, rej) => {
      this._menuResolve = { res, rej, cancellable: !!cancellable };
      options.forEach((op, i) => {
        const b = document.createElement('button');
        b.innerHTML = (i + 1) + '. ' + op.label + (op.small ? '<small>' + op.small + '</small>' : '');
        b.disabled = !!op.disabled;
        b.onclick = () => this._pickMenu(i, options);
        menuEl.appendChild(b);
      });
      if (cancellable) {
        const back = document.createElement('button');
        back.innerHTML = '‹ Назад';
        back.onclick = () => {
          if (!this._menuResolve) return;
          const r = this._menuResolve;
          this._menuResolve = null;
          menuEl.innerHTML = '';
          r.res(-1);
        };
        menuEl.appendChild(back);
      }
      this._menuOptions = options;
    });
  },

  _pickMenu(i, options) {
    if (!this._menuResolve) return;
    if (options[i] && options[i].disabled) return;
    const r = this._menuResolve;
    this._menuResolve = null;
    this.el('bt-menu').innerHTML = '';
    r.res(i);
  },

  onKey(e) {
    if (!this.active) return false;
    if (this._sayResolve && (e.key === 'Enter' || e.key === ' ' || e.key === 'z')) {
      this.advance(); return true;
    }
    if (this._menuResolve) {
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= (this._menuOptions || []).length) { this._pickMenu(n - 1, this._menuOptions); return true; }
      if (e.key === 'Escape' && this._menuResolve.cancellable) {
        const r = this._menuResolve;
        this._menuResolve = null;
        this.el('bt-menu').innerHTML = '';
        r.res(-1); return true;
      }
    }
    return this.active; // гасим прочие клавиши во время боя
  },

  // ---------- отрисовка карточек ----------

  drawSprite(canvasId, mon, flip, back) {
    const cv = this.el(canvasId);
    // кастомный PNG: рисуем в размере процедурного спрайта той же стадии
    const custom = mon.customSprite && typeof customSpriteImg === 'function' ? customSpriteImg(mon.customSprite) : null;
    const sp = custom || speciesSprite(mon.speciesSeed, mon.stage, mon.shiny, back, mon.palette, mon.mega);
    const d = typeof monSpriteDims === 'function' ? monSpriteDims(mon, sp) : { w: sp.width, h: sp.height };
    cv.width = 32; cv.height = 32;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 32, 32);
    const off = Math.floor((32 - d.w) / 2);
    if (flip) {
      ctx.save(); ctx.scale(-1, 1);
      ctx.drawImage(sp, -off - d.w, 32 - d.h - 2, d.w, d.h);
      ctx.restore();
    } else {
      ctx.drawImage(sp, off, 32 - d.h - 2, d.w, d.h);
    }
  },

  refresh(pm, em) {
    this.card('bt-pcard', pm);
    this.card('bt-ecard', em);
    // матчап стихий прямым текстом: тип на карточке игроки не связывали с эффективностью
    const foeEff = effMult(monType(em), monType(pm));
    const myEff = effMult(monType(pm), monType(em));
    const matchup = foeEff > 1 ? '<div style="font-size:11px;color:var(--ui-hp-low)">⚠ стихия врага сильнее твоей</div>'
                  : myEff > 1 ? '<div style="font-size:11px;color:var(--ui-hp)">💥 твоя стихия сильнее</div>' : '';
    if (matchup) this.el('bt-pcard').innerHTML += matchup;
    // свой: процедурный — со спины; кастомный смотрит влево — флипаем вправо, на врага
    if (pm.customSprite) this.drawSprite('bt-pcanvas', pm, true, false);
    else this.drawSprite('bt-pcanvas', pm, false, true);
    this.drawSprite('bt-ecanvas', em, false);
  },

  card(elId, mon) {
    const t = TYPE_INFO[monType(mon)];
    const pct = Math.max(0, mon.hp / mon.maxHp * 100);
    this.el(elId).innerHTML =
      '<span class="nm">' + (mon.shiny ? '✨' : '') + monName(mon) + '</span> <span style="opacity:.8">Ур.' + mon.level + '</span>' + statusTag(mon) +
      '<div style="font-size:12px;color:' + t.color + '">' + t.ru + '</div>' +
      '<div class="bar"><i class="' + (pct < 30 ? 'low' : '') + '" style="width:' + pct + '%"></i></div>' +
      '<div class="hpnum">' + Math.max(0, mon.hp) + ' / ' + mon.maxHp + ' ОЗ</div>';
  },


  // Фигура соперника на сцене: тренер, лидер арены или никого (дикие/PvP)
  setupScene(foe) {
    const cv = this.el('bt-tcanvas');
    const sheet = foe === 'master' ? (typeof masterSprite !== 'undefined' && masterSprite)
               : foe === 'tower' ? (typeof towerSprite !== 'undefined' && towerSprite)
               : foe === 'trainer' ? (typeof trainerSprite !== 'undefined' && trainerSprite)
               : null;
    if (!sheet) { cv.classList.add('hidden'); return; }
    cv.width = 16; cv.height = 16;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 16, 16);
    ctx.drawImage(sheet, 0, 0, 16, 16, 0, 0, 16, 16); // стоит лицом к игроку
    cv.classList.remove('hidden');
  },

  hitFx(side) {
    const cv = this.el(side === 'enemy' ? 'bt-ecanvas' : 'bt-pcanvas');
    cv.classList.remove('shake', 'flash');
    void cv.offsetWidth;
    cv.classList.add('shake');
    cv.classList.add('flash');
    // снять классы, чтобы вернулось «дыхание» стойки
    setTimeout(() => cv.classList.remove('shake', 'flash'), 400);
  },

  // Выпад атакующего к противнику (свой — вправо-вверх, вражеский — влево-вниз)
  lungeFx(side) {
    const cv = this.el(side === 'enemy' ? 'bt-ecanvas' : 'bt-pcanvas');
    const cls = side === 'enemy' ? 'lunge-l' : 'lunge-r';
    cv.classList.remove(cls);
    void cv.offsetWidth;
    cv.classList.add(cls);
    setTimeout(() => cv.classList.remove(cls), 400);
  },

  // ---------- механика ----------

  // Детерминированная часть урона (всё, кроме разброса и крита) — общая для
  // реального удара и предпросмотра «урон N–M» в меню умений/замены
  dmgBase(att, def, move, isPlayer) {
    const eff = effMult(move.type, monType(def));
    const stab = move.type === monType(att) ? 1.3 : 1;
    const badge = isPlayer ? 1 + (G.badges ? G.badges.length : 0) * 0.03 : 1;
    // погода и время суток усиливают стихии
    let env = 1;
    if (G.weather === 'rain') {
      if (move.type === 'water') env = 1.25;
      if (move.type === 'fire') env = 0.8;
    }
    if (G.phase === 'night' && move.type === 'shadow') env *= 1.2;
    const raw = ((2 + att.level * 0.4) * move.power * (effAtk(att) / Math.max(1, def.def))) / 42 + 2;
    return { base: raw * eff * stab * badge * env, eff };
  },

  calcDamage(att, def, move, isPlayer) {
    const { base, eff } = this.dmgBase(att, def, move, isPlayer);
    const rand = 0.85 + Math.random() * 0.15;
    const crit = Math.random() < 0.06 ? 1.5 : 1;
    return { dmg: Math.max(1, Math.floor(base * rand * crit)), eff, crit: crit > 1 };
  },

  // Разброс урона без крита: min = ×0.85, max = ×1.0
  dmgRange(att, def, move, isPlayer) {
    const { base, eff } = this.dmgBase(att, def, move, isPlayer);
    return { min: Math.max(1, Math.floor(base * 0.85)), max: Math.max(1, Math.floor(base)), eff };
  },

  // Может ли монстр действовать в этот ход (сон/заморозка/паралич)
  async canAct(mon) {
    if (mon.status === 'sleep') {
      mon._sleep = (mon._sleep || 1) - 1;
      if (mon._sleep <= 0) {
        mon.status = null;
        this.refresh(this._pm, this._em);
        await this.say(monName(mon) + ' просыпается!');
        return true;
      }
      await this.say(monName(mon) + ' крепко спит...');
      return false;
    }
    if (mon.status === 'freeze') {
      if (Math.random() < 0.3) {
        mon.status = null;
        this.refresh(this._pm, this._em);
        await this.say(monName(mon) + ' оттаивает!');
        return true;
      }
      await this.say(monName(mon) + ' заморожен и не может двигаться!');
      return false;
    }
    if (mon.status === 'para' && Math.random() < 0.25) {
      await this.say(monName(mon) + ' парализован и не может двигаться!');
      return false;
    }
    return true;
  },

  // Попытка наложить статус после удара
  async tryInflict(att, def, move) {
    const st = STATUS_BY_TYPE[move.type];
    if (!st || def.status || def.hp <= 0) return;
    if (Math.random() >= STATUS_CHANCE) return;
    def.status = st;
    if (st === 'sleep') def._sleep = 1 + Math.floor(Math.random() * 3);
    this.refresh(this._pm, this._em);
    await this.say(monName(def) + ' ' + STATUS_INFO[st].verb + '!');
  },

  // Урон от яда/ожога в конце хода
  async applyEndTurn(mon) {
    if (mon.hp <= 0) return;
    if (mon.status === 'poison' || mon.status === 'burn') {
      const dmg = Math.max(1, Math.floor(mon.maxHp / 12));
      mon.hp = Math.max(0, mon.hp - dmg);
      this.refresh(this._pm, this._em);
      await this.say(monName(mon) + ' страдает от ' + (mon.status === 'poison' ? 'яда' : 'ожога') + ' (-' + dmg + ' ОЗ).');
    }
  },

  async useMove(att, def, move, attSide) {
    if (!await this.canAct(att)) return;
    if (move.struggle) {
      await this.say('У ' + monName(att) + ' кончились силы — «Отчаянный удар»!');
    } else {
      if (move.pp !== undefined) move.pp = Math.max(0, move.pp - 1);
      await this.say(monName(att) + ' использует «' + move.name + '»!');
    }
    if (Math.random() * 100 > move.acc) {
      sfx('miss');
      this.lungeFx(attSide);   // выпад в пустоту
      await this.say('Но промахивается!');
      return;
    }
    const r = this.calcDamage(att, def, move, attSide === 'player');
    def.hp = Math.max(0, def.hp - r.dmg);
    this.lungeFx(attSide);
    // удар прилетает в пике выпада (в автобое пауза сжимается ускорением)
    await new Promise(res => setTimeout(res, this._auto ? 150 / this._speed : 150));
    sfx('hit');
    this.hitFx(attSide === 'player' ? 'enemy' : 'player');
    this.refresh(this._pm, this._em);
    let txt = 'Наносит ' + r.dmg + ' урона.';
    if (r.crit) txt += ' Критический удар!';
    if (r.eff > 1) txt += ' Это сверхэффективно!';
    if (r.eff < 1) txt += ' Не очень эффективно...';
    await this.say(txt);
    if (move.struggle) {
      const recoil = Math.max(1, Math.ceil(r.dmg / 4));
      att.hp = Math.max(0, att.hp - recoil);
      this.refresh(this._pm, this._em);
      await this.say(monName(att) + ' получает ' + recoil + ' урона отдачей.');
    }
    await this.tryInflict(att, def, move);
  },

  aiMove(att, def) {
    // ИИ: чаще выбирает самое выгодное умение из тех, где остались ПП
    const avail = att.moves.filter(mv => mv.pp === undefined || mv.pp > 0);
    if (!avail.length) return Object.assign({}, STRUGGLE);
    let best = avail[0], bestScore = -1;
    for (const mv of avail) {
      const score = mv.power * effMult(mv.type, monType(def)) * (mv.type === monType(att) ? 1.3 : 1);
      if (score > bestScore) { bestScore = score; best = mv; }
    }
    return Math.random() < 0.7 ? best : avail[Math.floor(Math.random() * avail.length)];
  },

  firstAlive(party) {
    for (let i = 0; i < party.length; i++) if (party[i].hp > 0) return i;
    return -1;
  },

  // ---------- автобой ----------

  // Умение для автобоя: приоритет эффективности типа (×2 > ×1 > ×½),
  // внутри одной эффективности — ожидаемый урон (сила × STAB × точность)
  autoPickMove(pm, em) {
    const avail = pm.moves.filter(mv => mv.pp > 0);
    if (!avail.length) return Object.assign({}, STRUGGLE);
    let best = avail[0], bestKey = -1;
    for (const mv of avail) {
      const eff = effMult(mv.type, monType(em));
      const key = eff * 10000 + mv.power * (mv.type === monType(pm) ? 1.3 : 1) * (mv.acc / 100);
      if (key > bestKey) { bestKey = key; best = mv; }
    }
    return best;
  },

  // Замена после нокаута: самый выгодный по типу против текущего врага,
  // при равной эффективности — самый прокачанный
  autoPickSwitch(party, curIdx, em) {
    let best = -1, bestKey = -1;
    for (let i = 0; i < party.length; i++) {
      const m = party[i];
      if (m.hp <= 0 || i === curIdx) continue;
      const avail = m.moves.filter(mv => mv.pp > 0);
      const eff = avail.length ? Math.max(...avail.map(mv => effMult(mv.type, monType(em)))) : 1;
      const key = eff * 10000 + m.level;
      if (key > bestKey) { bestKey = key; best = i; }
    }
    return best;
  },

  setAuto(v) {
    this._auto = !!v;
    try { localStorage.setItem('mw-auto-on', this._auto ? '1' : '0'); } catch (e) {}
    this.updateAutoBtns();
    // включили посреди реплики — сразу листаем; если открыто меню действий —
    // жмём «Атака» за игрока; прочие меню игрок довыбирает сам, дальше ведёт авто
    if (this._auto && this._sayResolve) this.advance();
    if (this._auto && this._menuResolve && this._menuKind === 'actions') this._pickMenu(0, this._menuOptions);
  },

  cycleSpeed() {
    this._speed = this._speed >= 3 ? 1 : this._speed + 1;
    try { localStorage.setItem('mw-auto-speed', String(this._speed)); } catch (e) {}
    this.updateAutoBtns();
  },

  updateAutoBtns() {
    const box = this.el('bt-autobox');
    if (!box) return;
    const on = this.active && typeof autoUnlocked !== 'undefined' && autoUnlocked;
    box.style.display = on ? 'flex' : 'none';
    if (!on) return;
    const bAuto = this.el('bt-auto'), bSpeed = this.el('bt-speed');
    bAuto.textContent = this._auto ? '⏸ Авто' : '▶ Авто';
    bAuto.style.borderColor = this._auto ? 'var(--ui-accent)' : '';
    bAuto.style.color = this._auto ? 'var(--ui-accent)' : '';
    bSpeed.textContent = '×' + this._speed;
    bSpeed.style.display = this._auto ? '' : 'none';
  },

  async pickSwitch(party, currentIdx, forced) {
    const em = this._em; // текущий враг — чтобы показать, кто против него хорош
    const opts = party.map((m, i) => {
      const t = TYPE_INFO[monType(m)];
      let small = m.hp + '/' + m.maxHp + ' ОЗ';
      if (em) {
        // лучшее умение против текущего врага (по потолку урона); без ПП — «Отчаянный удар»
        const usable = m.moves.filter(mv => mv.pp > 0);
        const best = (usable.length ? usable : [STRUGGLE])
          .map(mv => this.dmgRange(m, em, mv, true))
          .reduce((a, b) => (b.max > a.max ? b : a));
        const hint = best.eff > 1 ? ' ×2 💥' : best.eff < 1 ? ' ×½ 🛡' : '';
        small += ' · урон ~' + best.min + '–' + best.max + hint;
      }
      return {
        label: monName(m) + ' (Ур.' + m.level + ') <span style="color:' + t.color + '">' + t.ru + '</span>',
        small,
        disabled: m.hp <= 0 || i === currentIdx,
      };
    });
    this.note(forced ? 'Кого отправить в бой?' : 'Кого выбрать?');
    return await this.menu(opts, !forced);
  },

  async grantExpFlow(mon, amount) {
    await this.say(monName(mon) + ' получает ' + amount + ' опыта!');
    // grantExp теперь отдаёт только левелапы: эволюция и умения показываются
    // отдельной церемонией после боя (maybeStartGrowth в main.js)
    const msgs = grantExp(mon, amount);
    for (const msg of msgs) {
      sfx('level');
      await this.say(msg.text);
    }
  },

  // ---------- главный цикл боя ----------
  // opts: { kind:'wild'|'trainer', foe:'wild'|'trainer'|'master', enemyParty:[...], trainerName? }
  // Возвращает: 'win' | 'lose' | 'run' | 'caught'

  async run(opts) {
    // Страховка: с полностью павшей братвой бой не начинаем. Иначе firstAlive
    // вернёт -1, party[-1] уронит refresh() и промис отвалится с TypeError —
    // экран боя зависал видимым, afterBattle не вызывался (наступали).
    // Возвращаем 'lose', чтобы вызывающий штатно отправил игрока к фонтану.
    if (this.firstAlive(G.party) === -1) return 'lose';
    this.active = true;
    this.el('battle').classList.remove('hidden');
    this.setupScene(opts.foe || (opts.kind === 'trainer' ? 'trainer' : 'wild'));
    const party = G.party;
    let pi = this.firstAlive(party);
    let ei = 0;
    const enemyParty = opts.enemyParty;
    let result = null;
    this._enemyRef = enemyParty;
    this._battleSave = null;
    this.updateScumBtns();
    this.updateAutoBtns();

    const setActive = () => { this._pm = party[pi]; this._em = enemyParty[ei]; this.refresh(this._pm, this._em); };
    setActive();

    sfx('enc');
    dexSee(enemyParty[ei]);
    if (opts.envText) await this.say(opts.envText);
    if (opts.kind === 'trainer') {
      await this.say(opts.trainerName + ' хочет сразиться!');
      await this.say(opts.trainerName + ' отправляет в бой ' + monName(enemyParty[ei]) + '!');
    } else if (enemyParty[ei].shiny) {
      sfx('catch');
      await this.say('✨ СИЯЮЩИЙ ' + stageWord(enemyParty[ei].stage) + ' ' + monName(enemyParty[ei]) + ' (Ур.' + enemyParty[ei].level + ') появляется! Невероятная редкость!');
    } else {
      await this.say('Дикий ' + stageWord(enemyParty[ei].stage) + ' ' + monName(enemyParty[ei]) + ' (Ур.' + enemyParty[ei].level + ') появляется!');
    }

    battleLoop:
    while (result === null) {
      this._curPi = pi; this._curEi = ei;
      try {
      const pm = party[pi], em = enemyParty[ei];
      this.note('Что будет делать ' + monName(pm) + '?');
      let act;
      if (this._auto) {
        // автобой v1: только атака — без зелий, сфер и побегов
        act = 0;
      } else {
        const actions = [
          { label: 'Атака' },
          opts.kind === 'wild'
            ? { label: 'Поймать', small: 'сфер: ' + ballsTotal(G.balls), disabled: ballsTotal(G.balls) < 1 }
            : { label: 'Поймать', small: 'нельзя: чужой', disabled: true },
          { label: 'Предметы' },
          { label: 'Братва' },
          { label: 'Бежать' },
        ];
        this._menuKind = 'actions';
        act = await this.menu(actions);
        this._menuKind = null;
      }

      let playerMove = null;
      let skipEnemyTurn = false;

      if (act === 0) {
        if (this._auto) {
          playerMove = this.autoPickMove(pm, em);
        } else if (!pm.moves.some(mv => mv.pp > 0)) {
          this.note('Все ПП исчерпаны!');
          const si = await this.menu([{ label: 'Отчаянный удар', small: 'Обычный · сила 35 · бьёт отдачей' }], true);
          if (si === -1) continue;
          playerMove = Object.assign({}, STRUGGLE);
        } else {
          this.note('Какое умение?');
          const mi = await this.menu(pm.moves.map(mv => {
            // вместо абстрактной «силы» — реальный разброс урона по текущему врагу
            const r = this.dmgRange(pm, em, mv, true);
            const hint = r.eff > 1 ? ' · ×2 💥' : r.eff < 1 ? ' · ×½ 🛡' : '';
            return {
              label: mv.name + ' <span style="opacity:.7">' + mv.pp + '/' + mv.maxPp + '</span>',
              small: TYPE_INFO[mv.type].ru + ' · урон ' + r.min + '–' + r.max + ' · точн. ' + mv.acc +
                moveEffectLabel(mv) + hint,
              disabled: mv.pp <= 0,
            };
          }), true);
          if (mi === -1) continue;
          playerMove = pm.moves[mi];
        }
      } else if (act === 1) {
        // выбор сферы: показываем реальный шанс каждой по текущему состоянию цели
        this.note('Какую сферу бросить в ' + monName(em) + '?');
        const balls = BALL_TYPES.map(b => ({
          id: b.id,
          label: b.ic + ' ' + b.name + ' <span style="opacity:.7">×' + G.balls[b.id] + '</span>',
          small: 'шанс ' + Math.round(ballCatchChance(b.id, em) * 100) + '%',
          disabled: G.balls[b.id] < 1,
        }));
        const bi = await this.menu(balls, true);
        if (bi === -1) continue;
        const ball = balls[bi];
        G.balls[ball.id]--;
        updateHUD();
        sfx('ball');
        await this.say('Летит ' + BALL_BY_ID[ball.id].ic + ' ' + BALL_BY_ID[ball.id].name.toLowerCase() + '...');
        const p = ballCatchChance(ball.id, em);
        if (Math.random() < p) {
          sfx('catch');
          await this.say('Поймал! ' + monName(em) + ' теперь с тобой!');
          em.hp = Math.max(1, em.hp);
          dexCaught(em);
          questProgress('catch', monType(em));
          if (party.length < 6) {
            party.push(em);
          } else {
            this.note('Братва в полном составе! Куда отправить ' + monName(em) + '?');
            const choice = await this.menu([
              { label: '📦 В карман', small: 'хранится: ' + G.storage.length },
              { label: 'Взять в братву', small: 'заменяемый уйдёт в карман' },
            ]);
            if (choice === 0) {
              G.storage.push(em);
              await this.say(monName(em) + ' отправлен в карман' + keyHint('B') + '.');
            } else {
              this.note('Кто уступит место? (Назад — нового в карман)');
              const ri = await this.menu(party.map(m => ({
                label: monName(m) + ' (Ур.' + m.level + ')',
                small: m.hp + '/' + m.maxHp + ' ОЗ',
              })), true);
              if (ri >= 0) {
                G.storage.push(party[ri]);
                await this.say(monName(party[ri]) + ' отправляется в карман, ' + monName(em) + ' — в братву!');
                party[ri] = em;
              } else {
                G.storage.push(em);
                await this.say(monName(em) + ' отправлен в карман' + keyHint('B') + '.');
              }
            }
          }
          result = 'caught';
          break battleLoop;
        } else {
          await this.say('Ох! ' + monName(em) + ' вырывается из сферы!');
        }
      } else if (act === 2) {
        // предметы из сумки
        const usable = [
          { id: 'potion', label: 'Зелье', small: 'x' + G.bag.potion + ' · +50% ОЗ', disabled: G.bag.potion < 1 },
          { id: 'superpotion', label: 'Суперзелье', small: 'x' + G.bag.superpotion + ' · полное ОЗ', disabled: G.bag.superpotion < 1 },
          { id: 'tonic', label: 'Тоник', small: 'x' + G.bag.tonic + ' · снимает статус', disabled: G.bag.tonic < 1 },
          { id: 'ether', label: 'Эфир', small: 'x' + G.bag.ether + ' · все ПП', disabled: G.bag.ether < 1 },
        ];
        if (usable.every(u => u.disabled)) {
          await this.say('Сумка пуста! Загляни в лавку в городе.');
          continue;
        }
        this.note('Какой предмет?');
        const ii = await this.menu(usable, true);
        if (ii === -1) continue;
        const item = usable[ii];
        if (item.id === 'potion') {
          G.bag.potion--;
          pm.hp = Math.min(pm.maxHp, pm.hp + Math.ceil(pm.maxHp / 2));
          sfx('heal');
          this.refresh(this._pm, this._em);
          await this.say(monName(pm) + ' восстанавливает здоровье!');
        } else if (item.id === 'superpotion') {
          G.bag.superpotion--;
          pm.hp = pm.maxHp;
          sfx('heal');
          this.refresh(this._pm, this._em);
          await this.say(monName(pm) + ' полностью здоров!');
        } else if (item.id === 'tonic') {
          G.bag.tonic--;
          pm.status = null;
          sfx('heal');
          this.refresh(this._pm, this._em);
          await this.say('Тоник снимает недуг с ' + monName(pm) + '!');
        } else {
          G.bag.ether--;
          pm.moves.forEach(mv => { mv.pp = mv.maxPp; });
          sfx('heal');
          await this.say('Эфир восполняет все умения ' + monName(pm) + '!');
        }
        updateHUD();
      } else if (act === 3) {
        const si = await this.pickSwitch(party, pi, false);
        if (si === -1) continue;
        pi = si;
        setActive();
        await this.say('Вперёд, ' + monName(party[pi]) + '!');
      } else if (act === 4) {
        // подтверждение: мисклик по «Бежать» выбрасывал из боя без шанса отыграть.
        // Спрашиваем меню боя, а НЕ нативным confirm(): диалог заблокировал бы
        // async-поток боя и сломал бы откат сейвскама (say/menu реджектятся).
        // «Да, бежать» намеренно НЕ первым пунктом — иначе быстрый повторный тап
        // в ту же точку подтверждал бы побег сам (как было с лавкой).
        this.note('Точно бежать из боя?');
        const sure = await this.menu([
          { label: 'Остаться и драться' },
          { label: '🏃 Да, бежать', small: 'бой закончится' },
        ], true);
        if (sure !== 1) continue;
        const chance = 0.6 + clamp((effSpd(pm) - effSpd(em)) / 100, -0.25, 0.35);
        if (Math.random() < chance) {
          await this.say(opts.kind === 'trainer'
            ? 'Ты сбегаешь! ' + (opts.trainerName || 'Соперник') + ' кричит вслед что-то обидное.'
            : 'Ты успешно сбегаешь!');
          result = 'run';
          break battleLoop;
        }
        await this.say('Сбежать не вышло!');
      }

      // ---- фаза ударов ----
      const cur = party[pi];
      if (playerMove !== null) {
        const playerFirst = effSpd(cur) >= effSpd(em);
        const seq = playerFirst
          ? [['player', cur, em, playerMove], ['enemy', em, cur, null]]
          : [['enemy', em, cur, null], ['player', cur, em, playerMove]];
        for (const [side, a, d, mv] of seq) {
          if (a.hp <= 0 || d.hp <= 0) continue;
          await this.useMove(a, d, mv || this.aiMove(a, d), side);
        }
        skipEnemyTurn = true;
      }
      if (!skipEnemyTurn && em.hp > 0 && cur.hp > 0) {
        await this.useMove(em, cur, this.aiMove(em, cur), 'enemy');
      }
      // ---- яд и ожог в конце хода ----
      await this.applyEndTurn(cur);
      await this.applyEndTurn(em);

      // ---- проверка нокаутов ----
      if (enemyParty[ei].hp <= 0) {
        sfx('faint');
        await this.say(monName(enemyParty[ei]) + ' теряет сознание!');
        const e = enemyParty[ei];
        const exp = e.level * (8 + 4 * e.stage) + 10;
        // опыт режется, если боец сильно перерос противника (см. expGapMult)
        if (party[pi].hp > 0) {
          const mult = party[pi].charm === 'exp' ? 1.25 : 1;
          await this.grantExpFlow(party[pi], Math.max(1, Math.floor(exp * mult * expGapMult(party[pi].level, e.level))));
        }
        // общий опыт: живые запасные получают 40%
        for (let k = 0; k < party.length; k++) {
          if (k === pi || party[k].hp <= 0) continue;
          const shared = Math.max(1, Math.floor(exp * 0.4 * expGapMult(party[k].level, e.level)));
          const msgs = grantExp(party[k], shared);
          for (const msg of msgs) {
            sfx('level');
            await this.say(msg.text);
          }
        }
        if (ei < enemyParty.length - 1) {
          ei++;
          setActive();
          dexSee(enemyParty[ei]);
          await this.say(opts.trainerName + ' отправляет в бой ' + monName(enemyParty[ei]) + '!');
        } else {
          // Взаимный нокаут: враг пал, но и вся братва легла — отдача «Отчаянного
          // удара» или яд/ожог в конце хода. Проверка врага идёт первой, поэтому
          // без этой ветки бой возвращал 'win' с мёртвой командой: afterBattle не
          // лечил и не телепортировал, автокач бежал дальше, а следующий бой падал
          // с TypeError (firstAlive = -1). Отключка сильнее победы.
          result = this.firstAlive(party) === -1 ? 'lose' : 'win';
          break battleLoop;
        }
      }
      if (party[pi].hp <= 0) {
        sfx('faint');
        await this.say(monName(party[pi]) + ' теряет сознание!');
        const alive = this.firstAlive(party);
        if (alive === -1) {
          result = 'lose';
          break battleLoop;
        }
        const si = this._auto
          ? this.autoPickSwitch(party, pi, enemyParty[ei])
          : await this.pickSwitch(party, pi, true);
        pi = si >= 0 ? si : alive;
        if (party[pi].hp <= 0) pi = alive;
        setActive();
        await this.say('Вперёд, ' + monName(party[pi]) + '!');
      }
      } catch (e) {
        // откат к боевому сейву: возвращаем активных бойцов и переигрываем ход
        if (e === BATTLE_RELOAD) {
          pi = this._reloadPi; ei = this._reloadEi;
          setActive(); updateHUD();
          continue battleLoop;
        }
        throw e;
      }
    }

    // ---- завершение ----
    if (result === 'win') {
      if (opts.kind === 'trainer') {
        const reward = opts.reward || 100;
        G.money += reward;
        // сильные тренеры отсыпают крепкие сферы, рядовые — обычные
        const tough = (opts.enemyParty[0] || {}).level >= 40;
        if (tough) G.balls.strong += 2; else G.balls.basic += 2;
        await this.say('Победа над ' + opts.trainerName + '! Награда: ' + reward + '₴ и 2 ' +
          (tough ? '🔷 крепких сферы' : 'сферы') + '.');
        if (opts.badgeId) {
          sfx('catch');
          await this.say('Ты получаешь ЗНАЧОК АРЕНЫ! Твоя братва бьёт на 3% сильнее за каждый значок.');
        }
      } else {
        questProgress('wild');
        const coins = enemyParty[0].level * 3;
        G.money += coins;
        if (Math.random() < 0.10) {
          const mv = makeMove(mulberry32((Math.random() * 4294967296) >>> 0));
          G.scrolls.push(mv);
          await this.say('Победа! Найдено ' + coins + '₴ и 📜 свиток «' + mv.name + '»!');
        } else if (Math.random() < 0.35) {
          // на хайлевеле с дикарей падают сферы посерьёзнее
          const lvl = enemyParty[0].level;
          const kind = lvl >= 55 && Math.random() < 0.3 ? 'bro' : lvl >= 30 ? 'strong' : 'basic';
          G.balls[kind]++;
          await this.say('Победа! Найдено ' + coins + '₴ и ' + BALL_BY_ID[kind].ic + ' ' +
            BALL_BY_ID[kind].name.toLowerCase() + '.');
        } else {
          await this.say('Победа! Найдено ' + coins + '₴.');
        }
      }
    } else if (result === 'lose') {
      await this.say('Вся твоя братва без сил! Ты бежишь к фонтану, теряя половину денег...');
    }

    this.active = false;
    this._battleSave = null;
    this.updateScumBtns();
    this.updateAutoBtns();
    this.el('battle').classList.add('hidden');
    return result;
  },

  // Показ боевых кнопок сейв/лоад — только в бою и при включённом сейвскаме
  updateScumBtns() {
    const box = this.el('bt-scum');
    if (!box) return;
    const on = this.active && typeof SCUM_ON !== 'undefined' && SCUM_ON &&
               typeof scumUnlocked !== 'undefined' && scumUnlocked;
    box.style.display = on ? 'flex' : 'none';
  },
};
