'use strict';

// ===== PvP по кодам: обмен командами и детерминированная симуляция =====
// Обе стороны получают одни и те же данные (команды + нонсы) -> один и тот же сид
// -> побитово одинаковый бой. Подделать результат нельзя: каждый считает его сам.

// Общий сид боя: порядок строго фиксирован (вызвавший = сторона A)
function pvpSeed(pvpId, nonceA, nonceB, teamA, teamB) {
  return strSeed(pvpId + '|' + nonceA + '|' + nonceB + '|' + JSON.stringify(teamA) + '|' + JSON.stringify(teamB));
}

// Симуляция: teamA/teamB — массивы дампов (tradeMonDump), seed — uint32.
// Возвращает { log: [{text}], result: 'A'|'B'|'draw' }
function pvpSimulate(teamAd, teamBd, seed) {
  const rng = mulberry32(seed >>> 0);
  const mk = d => { const m = tradeMonRevive(d); m.status = null; return m; };
  const A = teamAd.map(mk), B = teamBd.map(mk);
  const log = [];
  const tag = side => side === 'A' ? '🔵' : '🔴';
  const nm = (m, side) => tag(side) + ' ' + monName(m);
  let ai = 0, bi = 0;

  const pickMove = (att, def) => {
    const avail = att.moves.filter(mv => mv.pp > 0);
    if (!avail.length) return Object.assign({}, STRUGGLE);
    let best = avail[0], bs = -1;
    for (const mv of avail) {
      const sc = mv.power * effMult(mv.type, monType(def)) * (mv.type === monType(att) ? 1.3 : 1);
      if (sc > bs) { bs = sc; best = mv; }
    }
    return rng() < 0.75 ? best : avail[Math.floor(rng() * avail.length)];
  };

  const canAct = (m, side) => {
    if (m.status === 'sleep') {
      m._sleep = (m._sleep || 1) - 1;
      if (m._sleep <= 0) { m.status = null; log.push({ text: nm(m, side) + ' просыпается!' }); return true; }
      log.push({ text: nm(m, side) + ' крепко спит...' });
      return false;
    }
    if (m.status === 'freeze') {
      if (rng() < 0.3) { m.status = null; log.push({ text: nm(m, side) + ' оттаивает!' }); return true; }
      log.push({ text: nm(m, side) + ' заморожен!' });
      return false;
    }
    if (m.status === 'para' && rng() < 0.25) {
      log.push({ text: nm(m, side) + ' парализован и пропускает ход!' });
      return false;
    }
    return true;
  };

  const strike = (att, def, as, ds) => {
    if (!canAct(att, as)) return;
    const mv = pickMove(att, def);
    if (!mv.struggle && mv.pp !== undefined) mv.pp--;
    if (rng() * 100 > mv.acc) {
      log.push({ text: nm(att, as) + ' — «' + mv.name + '»... промах!' });
      return;
    }
    const eff = effMult(mv.type, monType(def));
    const stab = mv.type === monType(att) ? 1.3 : 1;
    const rand = 0.85 + rng() * 0.15;
    const crit = rng() < 0.06 ? 1.5 : 1;
    const raw = ((2 + att.level * 0.4) * mv.power * (effAtk(att) / Math.max(1, def.def))) / 42 + 2;
    const dmg = Math.max(1, Math.floor(raw * eff * stab * rand * crit));
    def.hp = Math.max(0, def.hp - dmg);
    let line = nm(att, as) + ' — «' + mv.name + '»: ' + dmg + ' урона (' + def.hp + '/' + def.maxHp + ' ОЗ у ' + monName(def) + ')';
    if (crit > 1) line += ' Крит!';
    if (eff > 1) line += ' Сверхэффективно!';
    if (eff < 1) line += ' Слабовато.';
    log.push({ text: line });
    if (mv.struggle) {
      const rec = Math.max(1, Math.ceil(dmg / 4));
      att.hp = Math.max(0, att.hp - rec);
      log.push({ text: nm(att, as) + ' получает ' + rec + ' урона отдачей.' });
    }
    const st = STATUS_BY_TYPE[mv.type];
    if (st && !def.status && def.hp > 0 && rng() < STATUS_CHANCE) {
      def.status = st;
      if (st === 'sleep') def._sleep = 1 + Math.floor(rng() * 3);
      log.push({ text: nm(def, ds) + ' ' + STATUS_INFO[st].verb + '!' });
    }
  };

  log.push({ text: '⚔️ Бой начинается: ' + nm(A[ai], 'A') + ' против ' + nm(B[bi], 'B') + '!' });

  for (let round = 0; round < 300 && ai < A.length && bi < B.length; round++) {
    const a = A[ai], b = B[bi];
    const aFirst = effSpd(a) === effSpd(b) ? rng() < 0.5 : effSpd(a) > effSpd(b);
    const seq = aFirst ? [[a, b, 'A', 'B'], [b, a, 'B', 'A']] : [[b, a, 'B', 'A'], [a, b, 'A', 'B']];
    for (const [att, def, as, ds] of seq) {
      if (att.hp <= 0 || def.hp <= 0) continue;
      strike(att, def, as, ds);
    }
    for (const [m, side] of [[a, 'A'], [b, 'B']]) {
      if (m.hp > 0 && (m.status === 'poison' || m.status === 'burn')) {
        const d = Math.max(1, Math.floor(m.maxHp / 12));
        m.hp = Math.max(0, m.hp - d);
        log.push({ text: nm(m, side) + ' страдает от ' + (m.status === 'poison' ? 'яда' : 'ожога') + ' (-' + d + ').' });
      }
    }
    if (a.hp <= 0) {
      log.push({ text: nm(a, 'A') + ' теряет сознание!' });
      ai++;
      if (ai < A.length) log.push({ text: '🔵 В бой выходит ' + monName(A[ai]) + '!' });
    }
    if (b.hp <= 0) {
      log.push({ text: nm(b, 'B') + ' теряет сознание!' });
      bi++;
      if (bi < B.length) log.push({ text: '🔴 В бой выходит ' + monName(B[bi]) + '!' });
    }
  }

  const result = ai < A.length && bi >= B.length ? 'A' : bi < B.length && ai >= A.length ? 'B' : 'draw';
  return { log, result };
}

// ---------- логика кодов ----------

function pvpCreateChallenge() {
  if (G.pvpOut) return { err: 'У тебя уже есть неотвеченный вызов — дождись ответа или отмени его.' };
  if (!G.party.length) return { err: 'Нужна братва!' };
  const team = G.party.map(tradeMonDump);
  const pvpId = (hash2u((Math.random() * 1e9) | 0, (Math.random() * 1e9) | 0, Date.now() & 0xffffffff) >>> 0).toString(16);
  const nonce = ((Math.random() * 4294967296) >>> 0).toString(16);
  G.pvpOut = { pvpId, nonce, team };
  saveGame();
  return { code: tradeEncode({ v: 1, kind: 'pvpc', pvpId, nonce, team }) };
}

// Б принимает вызов своей текущей командой
function pvpAnswer(payload) {
  if (G.pvpOut && G.pvpOut.pvpId === payload.pvpId) return { err: 'Это твой собственный вызов!' };
  if (G.usedTrades.has('pvp:' + payload.pvpId)) return { err: 'Этот бой уже был сыгран.' };
  if (!G.party.length) return { err: 'Нужна братва!' };
  const myTeam = G.party.map(tradeMonDump);
  const nonce = ((Math.random() * 4294967296) >>> 0).toString(16);
  const seed = pvpSeed(payload.pvpId, payload.nonce, nonce, payload.team, myTeam);
  const sim = pvpSimulate(payload.team, myTeam, seed);
  G.usedTrades.add('pvp:' + payload.pvpId);
  G.stats.pvpBattles++;
  if (sim.result === 'B') G.stats.pvpWins++;
  updateHUD();
  saveGame();
  return {
    sim,
    mySide: 'B',
    code: tradeEncode({ v: 1, kind: 'pvpr', pvpId: payload.pvpId, nonce, team: myTeam }),
  };
}

// А смотрит результат по ответному коду
function pvpFinish(payload) {
  if (!G.pvpOut || G.pvpOut.pvpId !== payload.pvpId) return { err: 'Этот ответ не подходит к твоему активному вызову.' };
  const seed = pvpSeed(payload.pvpId, G.pvpOut.nonce, payload.nonce, G.pvpOut.team, payload.team);
  const sim = pvpSimulate(G.pvpOut.team, payload.team, seed);
  G.usedTrades.add('pvp:' + payload.pvpId);
  G.pvpOut = null;
  G.stats.pvpBattles++;
  if (sim.result === 'A') G.stats.pvpWins++;
  updateHUD();
  saveGame();
  return { sim, mySide: 'A' };
}

// ---------- UI ----------

function pvpChallengeFlow() {
  if (typeof NZ === 'function' && NZ()) { toast('☠️ Nuzlocke: PvP недоступен.'); return; }
  friendError('');
  const main = document.getElementById('friend-main');
  main.innerHTML = '';
  if (G.pvpOut) {
    const b = document.createElement('button');
    b.textContent = 'Отменить текущий вызов';
    b.onclick = () => { G.pvpOut = null; saveGame(); main.innerHTML = ''; friendError('Вызов отменён.'); };
    main.appendChild(b);
    friendError('У тебя уже есть неотвеченный вызов.');
    return;
  }
  const r = pvpCreateChallenge();
  if (r.err) { friendError(r.err); return; }
  const info = document.createElement('div');
  info.innerHTML = '<b style="color:var(--ui-accent)">⚔️ Вызов создан!</b> Твоя братва (' + G.party.length +
    ') зафиксирована в коде.<br><span style="opacity:.8;font-size:12px">Друг вставит код и сразу увидит бой; тебе он пришлёт ответный код.</span>';
  main.appendChild(info);
  friendShowCode('Код вызова — отправь другу:', r.code);
}

function pvpAnswerFlow(payload) {
  const main = document.getElementById('friend-main');
  main.innerHTML = '';
  const title = document.createElement('b');
  title.style.color = 'var(--ui-accent)';
  title.textContent = '⚔️ Тебя вызывают на бой! Братва соперника (' + payload.team.length + '):';
  main.appendChild(title);
  payload.team.forEach(md => main.appendChild(friendMonRow(md)));
  const btn = document.createElement('button');
  btn.textContent = '⚔️ Принять бой текущей братвой (' + G.party.length + ')';
  btn.onclick = () => {
    const r = pvpAnswer(payload);
    if (r.err) { friendError(r.err); return; }
    pvpShowReplay(r.sim, r.mySide, r.code);
  };
  main.appendChild(btn);
}

function pvpFinishFlow(payload) {
  const r = pvpFinish(payload);
  if (r.err) { friendError(r.err); return; }
  pvpShowReplay(r.sim, r.mySide, null);
}

// ---------- PvP через Telegram (deep-link, без кодов) ----------

// Награда победителю (проигравший — без потерь). Начисляется КЛИЕНТОМ по
// вердикту симуляции, один раз на вызов (флаг pvpgot:<id> в usedTrades).
function pvpAward(id, sim, mySide, foeTeam) {
  if (G.usedTrades.has('pvpgot:' + id)) return;
  G.usedTrades.add('pvpgot:' + id);
  if (sim.result === mySide) {
    const avg = Math.round(foeTeam.reduce((s, m) => s + (m.level | 0), 0) / foeTeam.length) || 5;
    const money = 50 + avg * 8;
    G.money += money;
    const expEach = avg * 12;
    for (const m of G.party) if (m.hp > 0) grantExp(m, expEach);
    sfx('level');
    toast('🥇 Победа в PvP! +' + money + '₴ и опыт братве.');
  }
  updateHUD();
  saveGame();
}

// Кнопка «Вызвать через Telegram»: создаём вызов на сервере и открываем share
function pvpTgChallengeFlow() {
  if (typeof NZ === 'function' && NZ()) { toast('☠️ Nuzlocke: PvP недоступен.'); return; }
  friendError('');
  const main = document.getElementById('friend-main');
  main.innerHTML = '';
  if (!IS_TMA) { friendError('Вызов через Telegram работает только в мини-аппе.'); return; }
  if (!G.party.length) { friendError('Нужна братва!'); return; }
  const info = document.createElement('div');
  info.textContent = 'Создаём вызов…';
  main.appendChild(info);
  const team = G.party.map(tradeMonDump);
  const nonce = ((Math.random() * 4294967296) >>> 0).toString(16);
  netPvpCreate(team, nonce, id => {
    if (G.state !== 'friend') return;
    if (!id) { main.innerHTML = ''; friendError('Не удалось создать вызов — попробуй позже.'); return; }
    main.innerHTML = '';
    const b = document.createElement('button');
    b.textContent = '📤 Отправить вызов контакту / в чат';
    b.onclick = () => tgSharePvp(id);
    main.appendChild(b);
    const hint = document.createElement('div');
    hint.style.cssText = 'opacity:.85;font-size:12px;margin-top:8px;line-height:1.5;';
    hint.innerHTML = 'Кто первым откроет ссылку и примет — тот и соперник.<br>' +
      'Когда примут, тебе придёт пуш «Смотреть бой». Проигравший ничего не теряет.';
    main.appendChild(hint);
  });
}

// Открыть вызов по deep-link (start_param = pvp<id>): панель друзей + flow
function openPvpFromLink(id) {
  if (G.state !== 'world') return;
  toggleFriendPanel();
  const main = document.getElementById('friend-main');
  main.innerHTML = '<div>Загружаем вызов…</div>';
  friendError('');
  netPvpGet(id, ch => {
    if (G.state !== 'friend') return;
    if (!ch) { main.innerHTML = ''; friendError('Вызов не найден или истёк.'); return; }
    pvpTgHandle(id, ch);
  });
}

// Обработать состояние вызова: моя сторона A (смотрю результат) / B (принять) / чужой
function pvpTgHandle(id, ch) {
  const main = document.getElementById('friend-main');
  main.innerHTML = '';

  // Я — отправитель: показать результат, когда соперник принял
  if (ch.mySide === 'A') {
    if (ch.status !== 'done' || !ch.teamB) { friendError('Соперник ещё не принял вызов. Загляни позже.'); return; }
    const seed = pvpSeed(id, ch.nonceA, ch.nonceB, ch.teamA, ch.teamB);
    const sim = pvpSimulate(ch.teamA, ch.teamB, seed);
    if (!G.usedTrades.has('pvpgot:' + id)) { G.stats.pvpBattles++; if (sim.result === 'A') G.stats.pvpWins++; }
    pvpAward(id, sim, 'A', ch.teamB);
    pvpShowReplay(sim, 'A', null);
    return;
  }

  // Я уже принял этот вызов (сторона B) — просто показать бой снова
  if (ch.mySide === 'B' && ch.teamB) {
    const seed = pvpSeed(id, ch.nonceA, ch.nonceB, ch.teamA, ch.teamB);
    pvpShowReplay(pvpSimulate(ch.teamA, ch.teamB, seed), 'B', null);
    return;
  }

  // Чужой вызов
  if (ch.status !== 'open') { friendError('Этот вызов уже принял другой игрок.'); return; }
  if (!G.party.length) { friendError('Нужна братва, чтобы принять вызов!'); return; }
  const title = document.createElement('b');
  title.style.color = 'var(--ui-accent)';
  title.textContent = '⚔️ ' + ch.fromNick + ' вызывает на бой! Его братва (' + ch.teamA.length + '):';
  main.appendChild(title);
  ch.teamA.forEach(md => main.appendChild(friendMonRow(md)));
  const btn = document.createElement('button');
  btn.textContent = '⚔️ Принять текущей братвой (' + G.party.length + ')';
  btn.onclick = () => {
    btn.disabled = true;
    const myTeam = G.party.map(tradeMonDump);
    const nonce = ((Math.random() * 4294967296) >>> 0).toString(16);
    const seed = pvpSeed(id, ch.nonceA, nonce, ch.teamA, myTeam);
    const sim = pvpSimulate(ch.teamA, myTeam, seed);
    netPvpAccept(id, myTeam, nonce, sim.result, ok => {
      if (!ok) { friendError('Не вышло — вызов уже приняли раньше тебя.'); return; }
      G.stats.pvpBattles++; if (sim.result === 'B') G.stats.pvpWins++;
      pvpAward(id, sim, 'B', ch.teamA);
      pvpShowReplay(sim, 'B', null);
    });
  };
  main.appendChild(btn);
}

let _pvpTimer = null;

function pvpShowReplay(sim, mySide, responseCode) {
  const main = document.getElementById('friend-main');
  main.innerHTML = '';
  const youTag = mySide === 'A' ? '🔵' : '🔴';
  const foeTag = mySide === 'A' ? '🔴' : '🔵';
  const head = document.createElement('div');
  head.innerHTML = '<b style="color:var(--ui-accent)">' + youTag + ' Ты · против · ' + foeTag + ' Друг</b>';
  main.appendChild(head);
  const list = document.createElement('div');
  list.style.cssText = 'width:96%;max-height:170px;overflow-y:auto;background:var(--ui-panel);border:2px solid var(--ui-border);border-radius:6px;padding:8px 12px;font-size:12px;text-align:left;line-height:1.6;';
  main.appendChild(list);
  const resultLine = document.createElement('div');
  resultLine.style.cssText = 'font-size:16px;font-weight:bold;';
  main.appendChild(resultLine);
  // кнопка «Скип» — сразу показать итог, не досматривая лог
  const skipBtn = document.createElement('button');
  skipBtn.textContent = '⏭ Скип';
  main.appendChild(skipBtn);

  clearInterval(_pvpTimer);
  let i = 0;
  const finish = () => {
    clearInterval(_pvpTimer);
    while (i < sim.log.length) {   // вывалить оставшиеся строки разом
      const line = document.createElement('div');
      line.textContent = sim.log[i].text;
      list.appendChild(line);
      i++;
    }
    list.scrollTop = list.scrollHeight;
    const won = sim.result === mySide;
    resultLine.style.color = sim.result === 'draw' ? '#e8c832' : won ? '#58d858' : '#e05050';
    resultLine.textContent = sim.result === 'draw' ? '🤝 Ничья!' : won ? '🥇 ПОБЕДА!' : '💀 Поражение...';
    sfx(won ? 'level' : 'faint');
    skipBtn.remove();
    if (responseCode) friendShowCode('Ответный код — отправь другу, он увидит тот же бой:', responseCode);
  };
  skipBtn.onclick = finish;
  const step = () => {
    if (G.state !== 'friend') { clearInterval(_pvpTimer); return; }
    if (i >= sim.log.length) { finish(); return; }
    const line = document.createElement('div');
    line.textContent = sim.log[i].text;
    list.appendChild(line);
    list.scrollTop = list.scrollHeight;
    if (sim.log[i].text.includes('урона')) sfx('hit');
    i++;
  };
  step();
  _pvpTimer = setInterval(step, 340);
}