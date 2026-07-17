'use strict';

// ===== Боевая система =====
// Асинхронный поток: await say(...) ждёт клика/Enter, await menu(...) ждёт выбора.

const Battle = {
  active: false,
  _sayResolve: null,
  _menuResolve: null,

  el(id) { return document.getElementById(id); },

  advance() {
    if (this._sayResolve) {
      const r = this._sayResolve;
      this._sayResolve = null;
      r();
    }
  },

  say(text) {
    this.el('bt-menu').innerHTML = '';
    this.el('bt-log').innerHTML = text + ' <span class="next">▼</span>';
    return new Promise(res => { this._sayResolve = res; });
  },

  note(text) { // сообщение без ожидания (подпись над меню)
    this.el('bt-log').textContent = text;
  },

  // options: [{label, small, disabled}], cancellable -> Esc или кнопка «Назад» возвращает -1
  menu(options, cancellable) {
    const menuEl = this.el('bt-menu');
    menuEl.innerHTML = '';
    return new Promise(res => {
      this._menuResolve = { res, cancellable: !!cancellable };
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
    const sp = custom || speciesSprite(mon.speciesSeed, mon.stage, mon.shiny, back);
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
  },

  // ---------- механика ----------

  calcDamage(att, def, move, isPlayer) {
    const eff = effMult(move.type, monType(def));
    const stab = move.type === monType(att) ? 1.3 : 1;
    const rand = 0.85 + Math.random() * 0.15;
    const crit = Math.random() < 0.06 ? 1.5 : 1;
    const badge = isPlayer ? 1 + (G.badges ? G.badges.length : 0) * 0.03 : 1;
    // погода и время суток усиливают стихии
    let env = 1;
    if (G.weather === 'rain') {
      if (move.type === 'water') env = 1.25;
      if (move.type === 'fire') env = 0.8;
    }
    if (G.phase === 'night' && move.type === 'shadow') env *= 1.2;
    const raw = ((2 + att.level * 0.4) * move.power * (effAtk(att) / Math.max(1, def.def))) / 42 + 2;
    return { dmg: Math.max(1, Math.floor(raw * eff * stab * rand * crit * badge * env)), eff, crit: crit > 1 };
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
    if (Math.random() >= 0.2) return;
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
      await this.say('Но промахивается!');
      return;
    }
    const r = this.calcDamage(att, def, move, attSide === 'player');
    def.hp = Math.max(0, def.hp - r.dmg);
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

  async pickSwitch(party, currentIdx, forced) {
    const opts = party.map((m, i) => ({
      label: monName(m) + ' (Ур.' + m.level + ')',
      small: m.hp + '/' + m.maxHp + ' ОЗ',
      disabled: m.hp <= 0 || i === currentIdx,
    }));
    this.note(forced ? 'Кого отправить в бой?' : 'Кого выбрать?');
    return await this.menu(opts, !forced);
  },

  async grantExpFlow(mon, amount) {
    await this.say(monName(mon) + ' получает ' + amount + ' опыта!');
    const msgs = grantExp(mon, amount);
    for (const msg of msgs) {
      if (msg.kind === 'level') sfx('level');
      if (msg.kind === 'evolve') { sfx('catch'); G.stats.evolutions++; this.refresh(this._pm, this._em); }
      await this.say(msg.text);
    }
  },

  // ---------- главный цикл боя ----------
  // opts: { kind:'wild'|'trainer', foe:'wild'|'trainer'|'master', enemyParty:[...], trainerName? }
  // Возвращает: 'win' | 'lose' | 'run' | 'caught'

  async run(opts) {
    this.active = true;
    this.el('battle').classList.remove('hidden');
    this.setupScene(opts.foe || (opts.kind === 'trainer' ? 'trainer' : 'wild'));
    const party = G.party;
    let pi = this.firstAlive(party);
    let ei = 0;
    const enemyParty = opts.enemyParty;
    let result = null;

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
      const pm = party[pi], em = enemyParty[ei];
      this.note('Что будет делать ' + monName(pm) + '?');
      const actions = [
        { label: 'Атака' },
        opts.kind === 'wild'
          ? { label: 'Поймать', small: 'сфер: ' + G.orbs, disabled: G.orbs < 1 }
          : { label: 'Поймать', small: 'нельзя: чужой', disabled: true },
        { label: 'Предметы' },
        { label: 'Братва' },
        { label: 'Бежать', disabled: opts.kind === 'trainer' },
      ];
      const act = await this.menu(actions);

      let playerMove = null;
      let skipEnemyTurn = false;

      if (act === 0) {
        if (!pm.moves.some(mv => mv.pp > 0)) {
          this.note('Все ПП исчерпаны!');
          const si = await this.menu([{ label: 'Отчаянный удар', small: 'Обычный · сила 35 · бьёт отдачей' }], true);
          if (si === -1) continue;
          playerMove = Object.assign({}, STRUGGLE);
        } else {
          this.note('Какое умение?');
          const mi = await this.menu(pm.moves.map(mv => {
            const eff = effMult(mv.type, monType(em));
            const hint = eff > 1 ? ' · ×2 💥' : eff < 1 ? ' · ×½ 🛡' : '';
            return {
              label: mv.name + ' <span style="opacity:.7">' + mv.pp + '/' + mv.maxPp + '</span>',
              small: TYPE_INFO[mv.type].ru + ' · сила ' + mv.power + ' · точн. ' + mv.acc + hint,
              disabled: mv.pp <= 0,
            };
          }), true);
          if (mi === -1) continue;
          playerMove = pm.moves[mi];
        }
      } else if (act === 1) {
        // попытка поймать
        G.orbs--;
        updateHUD();
        sfx('ball');
        await this.say('Ты бросаешь сферу ловли...');
        const baseCatch = [0.85, 0.55, 0.32][em.stage];
        const p = clamp(baseCatch * (1.15 - em.hp / em.maxHp), 0.06, 0.95);
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
              await this.say(monName(em) + ' отправлен в карман (B).');
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
                await this.say(monName(em) + ' отправлен в карман (B).');
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
        const chance = 0.6 + clamp((effSpd(pm) - effSpd(em)) / 100, -0.25, 0.35);
        if (Math.random() < chance) {
          await this.say('Ты успешно сбегаешь!');
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
        if (party[pi].hp > 0) {
          const mult = party[pi].charm === 'exp' ? 1.25 : 1;
          await this.grantExpFlow(party[pi], Math.floor(exp * mult));
        }
        // общий опыт: живые запасные получают 40%
        const shared = Math.max(1, Math.floor(exp * 0.4));
        for (let k = 0; k < party.length; k++) {
          if (k === pi || party[k].hp <= 0) continue;
          const msgs = grantExp(party[k], shared);
          for (const msg of msgs) {
            if (msg.kind === 'level') sfx('level');
            if (msg.kind === 'evolve') G.stats.evolutions++;
            await this.say(msg.text);
          }
        }
        if (ei < enemyParty.length - 1) {
          ei++;
          setActive();
          dexSee(enemyParty[ei]);
          await this.say(opts.trainerName + ' отправляет в бой ' + monName(enemyParty[ei]) + '!');
        } else {
          result = 'win';
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
        const si = await this.pickSwitch(party, pi, true);
        pi = si >= 0 ? si : alive;
        if (party[pi].hp <= 0) pi = alive;
        setActive();
        await this.say('Вперёд, ' + monName(party[pi]) + '!');
      }
    }

    // ---- завершение ----
    if (result === 'win') {
      if (opts.kind === 'trainer') {
        const reward = opts.reward || 100;
        G.money += reward;
        G.orbs += 2;
        await this.say('Победа над ' + opts.trainerName + '! Награда: ' + reward + '₴ и 2 сферы.');
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
          G.orbs += 1;
          await this.say('Победа! Найдено ' + coins + '₴ и сфера ловли.');
        } else {
          await this.say('Победа! Найдено ' + coins + '₴.');
        }
      }
    } else if (result === 'lose') {
      await this.say('Вся твоя братва без сил! Ты бежишь к точке старта...');
    }

    this.active = false;
    this.el('battle').classList.add('hidden');
    return result;
  },
};
