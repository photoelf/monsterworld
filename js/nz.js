'use strict';

// ===== Nuzlocke-режим («☠️ Nuzlocke») =====
// Хардкорный режим в отдельном слоте сейва. Правила: пермасмерть, до NZ_ZONE_CATCHES
// поимок на «область» (Вороной-ячейка города), обязательные клички, левел-кап,
// запрет предметов в бою, скорость ×0.5, спавн диких ×0.3, летопись рана.
// Спека: docs/superpowers/specs/2026-07-20-nuzlocke-design.md

function NZ() { return !!(typeof G !== 'undefined' && G && G.nuzlocke); }

// Сколько диких братишек можно поймать в одной области, прежде чем она
// исчерпается (стандартный Nuzlocke-ран даёт игроку 3-5 поимок, включая
// стартера, до первого джима — у нас арена в шаговой доступности от старта,
// поэтому 4 поимки на область компенсируют разницу и не душат старт рана).
const NZ_ZONE_CATCHES = 4;

function nzFreshState() {
  return {
    cap: 15,        // левел-кап; растёт победами над лидерами (nzRecalcCap)
    zones: {},      // zoneId -> число уже потраченных поимок области (0..NZ_ZONE_CATCHES)
    lineages: [],   // speciesSeed пойманных эво-линий (Dupes Clause)
    graveyard: [],  // павшие: {mon, caughtLvl, diedLvl, battles, killer, place, ts}
    log: [],        // события летописи {t, k, ...} — текст генерится при рендере
    cities: {},     // открытые города: id -> {x, y} (для пересчёта капа)
    stats: { catches: 0, deaths: 0, leaders: 0, battles: 0 },
    over: false,    // блэкаут случился — ран мёртв, показываем итоги
  };
}

function nzLoadState(d) { return Object.assign(nzFreshState(), d || {}); }

function nzCap() { return NZ() ? (G.nz.cap | 0) || 15 : LEVEL_CAP; }

// Туз лидера: максимальный уровень его команды (детерминирован сидом мастера)
function nzAceLevel(master) {
  return Math.max(...World.masterTeam(master).map(m => m.level));
}

// Город открыт — запомнить и пересчитать кап
function nzRegisterCity(city) {
  if (!NZ() || !city || G.nz.cities[city.id]) return;
  G.nz.cities[city.id] = { x: city.x, y: city.y };
  nzRecalcCap();
}

// Кап = туз слабейшего НЕпобеждённого лидера среди открытых городов.
// Все открытые побеждены — туз последнего побеждённого + 10. Кап только растёт.
function nzRecalcCap(justBeatenMaster) {
  const unbeaten = [];
  for (const id in G.nz.cities) {
    const c = G.nz.cities[id];
    const master = World.arenaMasterAt(c.x, c.y);
    if (master && !G.badges.includes(master.id)) unbeaten.push(nzAceLevel(master));
  }
  let next = G.nz.cap;
  if (unbeaten.length) next = Math.min(...unbeaten);
  else if (justBeatenMaster) next = nzAceLevel(justBeatenMaster) + 10;
  if (next > G.nz.cap) {
    G.nz.cap = next;
    toast('⛔ Левел-кап поднят до ' + next + '! Братва может расти.');
  }
}

// Событие летописи. Только данные — текст соберёт nzLogText при рендере,
// поэтому сейв не пухнет и старые записи получают новые формулировки.
function nzLog(kind, data) {
  if (!NZ()) return;
  G.nz.log.push(Object.assign({ t: Date.now(), k: kind }, data || {}));
}

// ===== Летопись: процедурный худтекст =====
// Вариант выбирается детерминированно по timestamp события — текст стабилен
// между рендерами, но у разных событий разные формулировки.
function nzPick(e, arr) { return arr[(e.t | 0) % arr.length]; }
function nzSpName(e) { return getSpecies(e.sp >>> 0).stages[e.st | 0] ? getSpecies(e.sp >>> 0).stages[e.st | 0].name : getSpecies(e.sp >>> 0).stages[0].name; }

function nzLogText(e) {
  switch (e.k) {
    case 'start': return nzPick(e, [
      'Ранним утром тренер вышел на улицы. Никаких запасных жизней, никаких сейвскамов — только братва и дорога.',
      'Всё началось с обещания: каждого встречного — по имени, каждого павшего — помнить. Nuzlocke начался.',
    ]);
    case 'name': return e.starter
      ? 'Первым в семью вошёл ' + nzSpName(e) + '. Нарекли: ' + e.nick + '. С него всё и началось.'
      : nzPick(e, [
        nzSpName(e) + ' получает имя — ' + e.nick + '. Теперь это семья.',
        'Братва приняла новичка. Отзывается на кличку ' + e.nick + '.',
      ]);
    case 'meet': {
      const who = nzSpName(e) + ' (ур.' + e.lvl + ')';
      if (e.out === 'c') return 'В ' + e.zn + ' встретился ' + who + '. ' + nzPick(e, ['Сфера легла точно — есть пополнение!', 'Уговорили по-братски: теперь с нами.']);
      if (e.out === 'r') return 'В ' + e.zn + ' встретился ' + who + ', но пришлось уносить ноги. Шанс области сгорел.';
      if (e.out === 'l') return 'В ' + e.zn + ' ' + who + ' оказался сильнее всей братвы. Тяжёлый день.';
      return 'В ' + e.zn + ' встретился ' + who + '. ' + nzPick(e, ['Не далась удача — пал в бою. Область опустела.', 'Бой был честный, но в семью он уже не войдёт.']);
    }
    case 'evo': return e.nick + ' ' + nzPick(e, ['вырос на глазах — эволюция!', 'заматерел: новая форма, старое сердце.']);
    case 'leader': return nzPick(e, [
      e.name + ' повержен! Кап поднят — братва растёт дальше.',
      'Арена наша: ' + e.name + ' жмёт руку. Идём выше.',
    ]);
    case 'death': return '⚰️ ' + nzPick(e, [
      e.nick + ' пал смертью храбрых (' + e.lvl + ' ур.). Убийца: ' + e.killer + '. Место: ' + e.place + '. Помним.',
      'Прощай, ' + e.nick + '. ' + e.killer + ' оказался сильнее — ' + e.place + ', ур.' + e.lvl + '. Братва не забудет.',
    ]);
    case 'blackout': return '☠️ На этом история обрывается: пала вся братва до последнего. Полный блэкаут.';
    default: return '';
  }
}

function nzFullStory() {
  const head = '📜 ЛЕТОПИСЬ БРАТВЫ · Nuzlocke\nСид мира: ' + G.seed + '\n\n';
  return head + G.nz.log.map(nzLogText).filter(Boolean).join('\n\n');
}

function nzOpenLog() {
  if (!NZ()) return;
  G.state = 'nzlog';
  document.getElementById('nzlog-text').textContent = nzFullStory();
  document.getElementById('nzlog-panel').classList.remove('hidden');
  const box = document.getElementById('nzlog-text');
  box.scrollTop = box.scrollHeight;   // свежие главы снизу
}

function nzCloseLog() {
  document.getElementById('nzlog-panel').classList.add('hidden');
  G.state = 'world';
}

// Премиум-автоматизации «липкие» в localStorage — живут вне сейва, привязаны к
// устройству, а не к конкретному слоту. Включённый в обычном режиме автобой
// (Battle._auto) переживает переключение на Nuzlocke: UI-кнопки в бою спрятаны
// (updateAutoBtns проверяет NZ()), но сам флаг остаётся true и боевой цикл
// (battle.js) продолжает жать «Атаку» за игрока — при пермасмерти это критично.
// Автокач и сейвскам сами себя не заводят в NZ (setGrind проверяет NZ(), кнопки
// сейвскама скрыты и других входов у него нет), но на всякий случай гасим и их.
function nzForcePremiumOff() {
  if (!NZ()) return;
  if (typeof Battle !== 'undefined' && Battle._auto) Battle.setAuto(false);
  if (typeof GRIND_ON !== 'undefined' && GRIND_ON && typeof setGrind === 'function') setGrind(false, true);
  if (typeof SCUM_ON !== 'undefined' && SCUM_ON && typeof setScum === 'function') setScum(false);
}

// Туч-меню в NZ: 🏆 Достижения → 📜 Летопись, 🤝 Обмен/PvP скрыт.
// Зовётся из loadGame/newWorld при входе в мир.
function nzApplyMenuMode() {
  nzForcePremiumOff();
  const ach = document.querySelector('#touch-menu .tbtn[data-panel="ach"], #touch-menu .tbtn[data-panel="nzlog"]');
  const friend = document.querySelector('#touch-menu .tbtn[data-panel="friend"]');
  const legend = document.getElementById('hint');
  if (ach && friend) {
    if (NZ()) {
      ach.dataset.panel = 'nzlog';
      ach.textContent = '📜';
      friend.classList.add('hidden');
    } else {
      ach.dataset.panel = 'ach';
      ach.textContent = '🏆';
      friend.classList.remove('hidden');
    }
  }
  // десктопная легенда клавиш: в NZ нет обмена/PvP, «O» открывает Летопись
  if (legend) {
    legend.textContent = NZ()
      ? 'WASD · Shift — бег · Tab — братва · I — инвентарь · B — карман · M — карта · P — педия · O — летопись'
      : 'WASD · Shift — бег · Tab — братва · I — инвентарь · B — карман · M — карта · P — педия · O — награды · T — обмен/PvP';
  }
}

// Блэкаут: вся братва и карман мертвы. Ран завершён навсегда.
function nzGameOver() {
  G.nz.over = true;
  if (!G.nz.log.some(e => e.k === 'blackout')) nzLog('blackout', {});
  const story = nzFullStory();
  try { localStorage.setItem('mw-nz-lastrun', story); } catch (e) {}
  G.state = 'nzover';
  const s = G.nz.stats;
  document.getElementById('nzover-stats').textContent =
    'Поимок: ' + s.catches + ' · Смертей: ' + s.deaths + ' · Лидеров бито: ' + s.leaders + ' · Боёв: ' + s.battles;
  document.getElementById('nzover-text').textContent = story;
  document.getElementById('nzover-panel').classList.remove('hidden');
  _nzChapterTs = 0;   // блэкаут пробивает троттлинг — предыдущая смерть могла быть <30с назад
  nzChapter('Полный блэкаут — ран окончен');
  saveGame();
}

// Стереть NZ-слот (локально + облако) и вернуться на титул
async function nzWipeRun() {
  try { localStorage.removeItem(SAVE_KEY_NZ); } catch (e) {}
  if (typeof nzCloudWipe === 'function') { try { await nzCloudWipe(); } catch (e) {} }
  document.getElementById('nzover-panel').classList.add('hidden');
  document.getElementById('btn-continue-nz').classList.add('hidden');
  setSaveSlot('main');
  location.reload();   // чистый старт с титула — надёжнее ручного сброса G
}

// «Область» = Вороной-ячейка ЖИВОГО города: мёртвые ячейки (центр в воде)
// детерминированно прилипают к ближайшему живому центру. Имя и id — как у
// World.nearestCityCenter (те же поля лениво дописываются в кэш-объект).
function nzZoneAt(x, y) {
  const cellX = Math.floor(x / CITY_CELL), cellY = Math.floor(y / CITY_CELL);
  let best = null, bd = Infinity;
  for (let r = 1; r <= 4 && !best; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const c = World.cityCenter(cellX + dx, cellY + dy);
        if (c.dead) continue;
        const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
        if (d < bd) { bd = d; best = c; }
      }
    }
  }
  if (!best) return { id: 'C0', name: 'Глухомань', x: 0, y: 0 };
  if (!best.id) {
    best.id = 'C' + best.x + ',' + best.y;
    best.name = cityName(hash2u(best.x, best.y, World.seed ^ 0xC173));
  }
  return best;
}

// Сколько поимок в области уже потрачено (0..NZ_ZONE_CATCHES)
function nzZoneUsed(zoneId) { return G.nz.zones[zoneId] || 0; }

// Короткая метка статуса области для HUD/карты: «✔» на исчерпанной,
// иначе «🎯 N/M» — сколько поимок ещё доступно
function nzZoneStatusLabel(zoneId) {
  const used = nzZoneUsed(zoneId);
  return used >= NZ_ZONE_CATCHES ? '✔' : '🎯' + used + '/' + NZ_ZONE_CATCHES;
}

// Статус дикого боя по правилам Nuzlocke (вызывается ДО Battle.run)
function nzEncounterInfo(x, y, wild) {
  const zone = nzZoneAt(x, y);
  if (wild.shiny) return { zone, kind: 'shiny', catch: { ok: true } };            // Shiny Clause
  if (nzZoneUsed(zone.id) >= NZ_ZONE_CATCHES)
    return { zone, kind: 'used', catch: { ok: false, why: 'лимит поимок области исчерпан (' + NZ_ZONE_CATCHES + '/' + NZ_ZONE_CATCHES + ')' } };
  if (G.nz.lineages.includes(wild.speciesSeed))
    return { zone, kind: 'dupe', catch: { ok: false, why: 'такой уже есть в семье' } };  // Dupes Clause
  return { zone, kind: 'enc', catch: { ok: true } };
}

// После дикого боя: пометить область, записать летопись, оформить поимку
function nzAfterWild(enc, wild, result) {
  if (!NZ() || !enc) return;
  if (enc.kind === 'enc') {
    G.nz.zones[enc.zone.id] = nzZoneUsed(enc.zone.id) + 1;
    nzLog('meet', { sp: wild.speciesSeed, st: wild.stage, lvl: wild.level, zn: enc.zone.name,
      out: result === 'caught' ? 'c' : result === 'run' ? 'r' : result === 'lose' ? 'l' : 'k' });
  }
  if (result === 'caught') {
    if (!G.nz.lineages.includes(wild.speciesSeed)) G.nz.lineages.push(wild.speciesSeed);
    G.nz.stats.catches++;
    wild.nzCaughtLvl = wild.level;
    nzForceNick(wild);
    nzLog('name', { sp: wild.speciesSeed, nick: wild.nick });
    if (G.nz.stats.catches === 1) nzChapter('Первая поимка рана');
  }
  saveGame();
}

// Показать состав команды тренера/лидера перед боем и спросить подтверждение —
// без этого permadeath-бой начинался бы вслепую (случайный «живой» соперник или
// неизвестная команда, в отличие от классических игр серии, где расстановку
// боец знал заранее). Native confirm() безопасен: зовётся из step() (мир), ДО
// старта Battle.run — тот же паттерн, что и подтверждение входа в башню.
function nzConfirmBattle(name, team) {
  const lines = team.map(m => TYPE_INFO[monType(m)].ru + ' ' + monSpeciesName(m) + ' (' + m.level + ' ур.)').join('\n');
  return confirm('⚔️ ' + name + '\n' + lines + '\n\nВызвать на бой?');
}

// Кличка обязательна (боевой экран уже закрыт — нативный prompt безопасен)
function nzForceNick(m) {
  let nn = '';
  for (let tries = 0; tries < 5 && !nn; tries++) {
    const raw = prompt('☠️ Nuzlocke: дай кличку новому братишке — теперь это семья.', m.nick || '');
    nn = (raw === null ? '' : raw).trim().slice(0, 12);
  }
  m.nick = nn || ('Брат-' + (G.nz.stats.catches + 1));   // упёрся — кличка от братвы
}

// Стартер: первый член семьи (кличка + линия занята + запись в летопись)
function nzOnStarter(m) {
  if (!NZ()) return;
  m.nzCaughtLvl = m.level;
  if (!G.nz.lineages.includes(m.speciesSeed)) G.nz.lineages.push(m.speciesSeed);
  G.nz.stats.catches++;
  nzForceNick(m);
  nzLog('name', { sp: m.speciesSeed, nick: m.nick, starter: 1 });
}

// Запомнить, кто добил бойца (зовётся из battle.js в момент нокаута)
function nzNoteFaint(pm, em, opts) {
  if (!NZ()) return;
  pm.nzKiller = (opts.kind === 'trainer' ? (opts.trainerName || 'тренер') + ': ' : 'дикий ')
    + monSpeciesName(em) + ' (ур.' + em.level + ')';
  pm.nzPlace = opts.foe === 'tower' ? 'башня испытаний'
    : 'обл. ' + nzZoneAt(G.player.x, G.player.y).name;
}

function nzBury(m) {
  // амулет возвращается в сумку — как при обмене (tradeEscrow)
  if (m.charm) { G.charms[m.charm]++; m.charm = null; recalcStats(m); }
  G.nz.graveyard.push({
    mon: dumpOwnedMon(m),
    caughtLvl: m.nzCaughtLvl || 1,
    diedLvl: m.level,
    battles: m.nzBattles | 0,
    killer: m.nzKiller || 'неизвестный злодей',
    place: m.nzPlace || 'дикие места',
    ts: Date.now(),
  });
  G.nz.stats.deaths++;
  nzLog('death', { nick: monName(m), sp: m.speciesSeed, lvl: m.level,
    killer: m.nzKiller || 'неизвестный злодей', place: m.nzPlace || 'дикие места' });
  nzChapter('Потеря: ' + monName(m));
}

// Общий пост-боевой обряд. true = блэкаут (вызывающий afterBattle прерывается).
function nzAfterBattle(result) {
  G.nz.stats.battles++;
  for (const m of G.party) m.nzBattles = (m.nzBattles | 0) + 1;
  const dead = G.party.filter(m => m.hp <= 0);
  for (const m of dead) nzBury(m);
  if (dead.length) {
    G.party = G.party.filter(m => m.hp > 0);
    toast('⚰️ Братва хоронит ' + (dead.length === 1 ? monName(dead[0]) : dead.length + ' своих') + '. Навсегда.');
  }
  if (!G.party.some(m => m.hp > 0) && !G.storage.some(m => m.hp > 0)) {
    nzGameOver();   // блэкаут: вся братва и карман мертвы
    return true;
  }
  if (!G.party.length) {
    while (G.party.length < 6) {
      const i = G.storage.findIndex(m => m.hp > 0);
      if (i === -1) break;
      G.party.push(G.storage.splice(i, 1)[0]);
    }
    toast('Из кармана подтягивается подмога. Держитесь, братья.');
  }
  return false;
}

// «Открытка» главы: тёмный фон, спрайты живой братвы, заголовок, счёт могил
function nzPostcard(title) {
  const W = 480, H = 270;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const c = cv.getContext('2d');
  const grad = c.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, '#141420'); grad.addColorStop(1, '#0d0d14');
  c.fillStyle = grad; c.fillRect(0, 0, W, H);
  c.imageSmoothingEnabled = false;
  const alive = G.party.filter(m => m.hp > 0).slice(0, 6);
  alive.forEach((m, i) => {
    const spr = monSprite(m);
    const size = 56;
    const x = 40 + i * 66, y = H - 118;
    c.drawImage(spr, x, y, size, size);
    c.fillStyle = '#e8e8f0'; c.font = '11px monospace'; c.textAlign = 'center';
    c.fillText((monName(m) || '').slice(0, 9), x + size / 2, y + size + 14);
  });
  c.fillStyle = '#ffd75e'; c.font = 'bold 20px monospace'; c.textAlign = 'left';
  c.fillText('☠️ NUZLOCKE', 16, 34);
  c.fillStyle = '#e8e8f0'; c.font = '15px monospace';
  c.fillText(String(title).slice(0, 44), 16, 62);
  c.fillStyle = '#8888a0'; c.font = '12px monospace';
  c.fillText('могил: ' + G.nz.graveyard.length + ' · поимок: ' + G.nz.stats.catches + ' · кап: ' + nzCap(), 16, H - 16);
  return cv.toDataURL('image/jpeg', 0.7);
}

// Глава-майлстон в чат (только TMA, тумблер mw-nz-chapters, не чаще раза в 30с)
let _nzChapterTs = 0;
function nzChapter(title) {
  if (!NZ() || typeof IS_TMA === 'undefined' || !IS_TMA) return;
  try { if (localStorage.getItem('mw-nz-chapters') === '0') return; } catch (e) {}
  if (Date.now() - _nzChapterTs < 30000) return;
  _nzChapterTs = Date.now();
  let photo = null;
  try { photo = nzPostcard(title); } catch (e) {}
  const tail = G.nz.log.slice(-3).map(nzLogText).join('\n\n');
  netNzChapter('📜 ' + title + '\n\n' + tail, photo);
}

// Кладбище: грейскейл-спрайты и эпитафии; сортировка и кнопки Кармана скрыты
function nzRenderGraveyard() {
  document.getElementById('storage-sort').innerHTML = '';
  document.getElementById('storage-info').textContent = G.nz.graveyard.length
    ? 'Здесь лежат братья, отдавшие всё. ' + G.nz.graveyard.length + ' могил.'
    : 'Пока пусто. Пусть так и останется.';
  const rows = document.getElementById('storage-rows');
  rows.innerHTML = '';
  for (const e of [...G.nz.graveyard].reverse()) {
    const m = reviveOwnedMon(e.mon);
    const row = document.createElement('div');
    row.className = 'srow';
    const cv = monMiniCanvas(m, 28);
    cv.style.filter = 'grayscale(1) brightness(.75)';
    row.appendChild(cv);
    const info = document.createElement('div');
    info.className = 'info';
    const d = new Date(e.ts);
    info.innerHTML = '<span class="nm">🕯 ' + monName(m) + '</span>' +
      '<div style="opacity:.8;font-size:11px;line-height:1.5">Прожил с ' + e.caughtLvl + ' по ' + e.diedLvl +
      ' ур., боёв: ' + e.battles + '.<br>Пал: ' + e.killer + ' — ' + e.place +
      ' · ' + d.getDate() + '.' + (d.getMonth() + 1) + '</div>';
    row.appendChild(info);
    rows.appendChild(row);
  }
}
