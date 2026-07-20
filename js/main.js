'use strict';

// ===== Глобальное состояние =====

const G = {
  state: 'title',        // title | starter | world | battle | party | shop | dex | map
  seed: 0,
  player: { x: 0.5, y: 0.5, dir: 'down', frame: 0, animT: 0, moving: false },
  spawn: { x: 0.5, y: 0.5 },
  party: [],
  balls: { basic: 15, strong: 0, bro: 0, master: 0 },  // сферы ловли по типам (BALL_TYPES)
  money: 300,
  bag: { potion: 1, superpotion: 0, tonic: 0, ether: 0, repel: 0, bigrepel: 0, rod: 0, stone: 0, megastone: 0 },
  scrolls: [],           // свитки умений (объекты умений)
  charms: { atk: 0, def: 0, spd: 0, hp: 0, exp: 0 },  // амулеты в сумке
  egg: null,             // яйцо из питомника: {speciesSeed, shiny, steps, inherit, from}
  quest: null,           // активное задание с доски
  lastQuestKind: null,   // вид последнего сданного задания — повтор платит половину
  tradeOut: null,        // моё предложение другу: {offerId, mon} (монстрик в эскроу)
  tradeIn: null,         // мой ответ на чужое предложение: {offerId, mon, expectHash, expectMon}
  usedTrades: new Set(), // завершённые сделки и PvP-бои (id)
  storage: [],           // Монстрохранилище — монстрики вне команды
  pvpOut: null,          // мой PvP-вызов: {pvpId, nonce, team}
  badges: [],            // id побеждённых арен
  dex: { seen: new Set(), caught: new Set(), shiny: new Set() },  // сиды видов
  fountains: [],         // посещённые фонтаны: {id, x, y} — точки телепорта
  defeated: new Set(),   // побеждённые тренеры "x,y"
  picked: new Set(),     // подобранные предметы "x,y"
  usedNests: new Set(),  // разорённые гнёзда "x,y"
  usedShrines: new Set(),// пробуждённые святилища "x,y"
  traded: new Set(),     // использованные обменники
  achievements: new Set(),
  stats: { trainersBeaten: 0, evolutions: 0, nests: 0, trades: 0, maxDist: 0,
           surfed: 0, fished: 0, towerBest: 0, legends: 0, taught: 0,
           eggsHatched: 0, quests: 0, sawSnow: 0, sawDesert: 0, friendTrades: 0, pvpBattles: 0, pvpWins: 0, megas: 0 },
  clock: 0,              // игровое время, сек
  phase: 'day',          // day | evening | night | morning
  weather: 'clear',      // clear | rain
  follower: null,        // спутник: {x, y, moving, bounceT}
  lastTileKey: '',
  lastCityId: null,      // город, в котором стоим (для приветствия при входе)
  graceSteps: 0,         // шаги без встреч после боя
  repelSteps: 0,         // действие репеллента: шагов без случайных диких
  bumpCooldown: 0,
};

// Цикл суток: 8 минут реального времени
const DAY_LEN = 480;
function calcPhase() {
  const t = (G.clock % DAY_LEN) / DAY_LEN;
  return t < 0.45 ? 'day' : t < 0.55 ? 'evening' : t < 0.92 ? 'night' : 'morning';
}
const PHASE_ICON = { day: '🌞', evening: '🌆', night: '🌙', morning: '🌅' };

function resetFollower() {
  G.follower = { x: G.player.x, y: G.player.y + 0.4, moving: false, bounceT: 0 };
}

// ===== Достижения =====

const ACHIEVEMENTS = [
  { id: 'catch1',   ic: '🐾', name: 'Первый друг',      desc: 'Поймай первого братишку',                   test: () => G.dex.caught.size >= 1 },
  { id: 'catch10',  ic: '📗', name: 'Коллекционер',     desc: 'Поймай 10 видов',                    test: () => G.dex.caught.size >= 10 },
  { id: 'catch25',  ic: '📚', name: 'Архивариус',       desc: 'Поймай 25 видов',                    test: () => G.dex.caught.size >= 25 },
  { id: 'shiny1',   ic: '✨', name: 'Золотая лихорадка', desc: 'Поймай сияющего братишку',          test: () => G.dex.shiny.size >= 1 },
  { id: 'evolve1',  ic: '🦋', name: 'Метаморфоза',      desc: 'Прокачай братишку в брата',            test: () => G.stats.evolutions >= 1 },
  { id: 'party6',   ic: '👥', name: 'Полный состав',    desc: 'Собери братву из 6',                test: () => G.party.length >= 6 },
  { id: 'badge1',   ic: '🏅', name: 'Претендент',       desc: 'Выиграй значок арены',               test: () => G.badges.length >= 1 },
  { id: 'badge3',   ic: '👑', name: 'Чемпион',          desc: 'Собери 3 значка арены',              test: () => G.badges.length >= 3 },
  { id: 'train10',  ic: '⚔️', name: 'Гроза тренеров',   desc: 'Победи 10 тренеров',                 test: () => G.stats.trainersBeaten >= 10 },
  { id: 'rich',     ic: '💰', name: 'Богач',            desc: 'Накопи 5000₴',                        test: () => G.money >= 5000 },
  { id: 'far',      ic: '🧭', name: 'Первопроходец',    desc: 'Уйди на 300 тайлов от старта',        test: () => G.stats.maxDist >= 300 },
  { id: 'nest1',    ic: '🥚', name: 'Разоритель гнёзд', desc: 'Найди гнездо редкого братишки',        test: () => G.stats.nests >= 1 },
  { id: 'trade1',   ic: '🔄', name: 'Сделка века',      desc: 'Обменяйся братишками с NPC',         test: () => G.stats.trades >= 1 },
  { id: 'surf1',    ic: '🌊', name: 'Мореплаватель',    desc: 'Проплыви по воде на братишке',       test: () => G.stats.surfed >= 1 },
  { id: 'fish1',    ic: '🎣', name: 'Рыбак',            desc: 'Выуди братишку удочкой',             test: () => G.stats.fished >= 1 },
  { id: 'tower5',   ic: '🗼', name: 'Покоритель башни', desc: 'Пройди 5 этажей башни испытаний',     test: () => G.stats.towerBest >= 5 },
  { id: 'legend1',  ic: '⚡', name: 'Легенда',          desc: 'Поймай легендарного братана',         test: () => G.stats.legends >= 1 },
  { id: 'teach1',   ic: '📜', name: 'Наставник',        desc: 'Научи братишку умению со свитка',    test: () => G.stats.taught >= 1 },
  { id: 'egg1',     ic: '🐣', name: 'Родитель',         desc: 'Выведи братишку из яйца',            test: () => G.stats.eggsHatched >= 1 },
  { id: 'quest3',   ic: '📋', name: 'Подрядчик',        desc: 'Выполни 3 задания с доски',           test: () => G.stats.quests >= 3 },
  { id: 'charm1',   ic: '🧿', name: 'Талисман',         desc: 'Надень амулет на братишку',          test: () => G.party.some(m => m.charm) },
  { id: 'climate',  ic: '🌍', name: 'Климатолог',       desc: 'Побывай в снегах и в пустыне',        test: () => G.stats.sawSnow >= 1 && G.stats.sawDesert >= 1 },
  { id: 'ptrade1',  ic: '🤝', name: 'Настоящий друг',   desc: 'Обменяйся братишкой с другим игроком', test: () => G.stats.friendTrades >= 1 },
  { id: 'pvp1',     ic: '⚔️', name: 'Дуэлянт',          desc: 'Сыграй PvP-бой с другом',              test: () => G.stats.pvpBattles >= 1 },
  { id: 'pvpwin',   ic: '🥇', name: 'Гладиатор',        desc: 'Выиграй PvP-бой',                      test: () => G.stats.pvpWins >= 1 },
  { id: 'mega1',    ic: '💠', name: 'Мегабратан',       desc: 'Проведи мегаэволюцию',                 test: () => (G.stats.megas || 0) >= 1 },
  { id: 'cap100',   ic: '💯', name: 'Потолок',          desc: 'Доведи братана до ' + LEVEL_CAP + ' уровня',
    test: () => G.party.some(m => m.level >= LEVEL_CAP) || G.storage.some(m => m.level >= LEVEL_CAP) },
];

// Прогресс активного задания с доски
function questProgress(kind, param) {
  const q = G.quest;
  if (!q) return;
  // «поймай любых» засчитывает любое событие ловли
  if (q.kind !== kind && !(q.kind === 'catchany' && kind === 'catch')) return;
  if (q.kind === 'catch' && q.param !== param) return;
  q.progress++;
  if (q.progress >= q.need) {
    G.money += q.reward;
    if (q.bonus === 'scroll') G.scrolls.push(makeMove(mulberry32((Math.random() * 4294967296) >>> 0)));
    else G.bag.ether++;
    G.stats.quests++;
    G.lastQuestKind = q.kind; // повтор того же вида на доске платит половину
    G.quest = null;
    sfx('level');
    toast('📋 Задание выполнено! +' + q.reward + '₴ и ' + (q.bonus === 'scroll' ? 'свиток' : 'эфир') + '!');
  } else {
    toast('📋 Задание: ' + q.progress + '/' + q.need);
  }
  updateHUD();
  saveGame();
}

function checkAchievements() {
  for (const a of ACHIEVEMENTS) {
    if (G.achievements.has(a.id) || !a.test()) continue;
    G.achievements.add(a.id);
    sfx('level');
    toast('🏆 Достижение: ' + a.name + '!');
  }
}

// ===== Братопедия =====

function dexSee(m) { G.dex.seen.add(m.speciesSeed); }
function dexCaught(m) {
  G.dex.seen.add(m.speciesSeed);
  G.dex.caught.add(m.speciesSeed);
  if (m.shiny) G.dex.shiny.add(m.speciesSeed);
}

// Два слота сейва: основной и Nuzlocke. Активный выбирается на титуле,
// mw-slot запоминает выбор; tg.js льёт в облако чанки со своим префиксом.
const SAVE_KEY_MAIN = 'monsterworld-save-v1';
const SAVE_KEY_NZ = 'monsterworld-save-nz1';
let SAVE_SLOT = (() => {
  try { return localStorage.getItem('mw-slot') === 'nz' ? 'nz' : 'main'; } catch (e) { return 'main'; }
})();
let SAVE_KEY = SAVE_SLOT === 'nz' ? SAVE_KEY_NZ : SAVE_KEY_MAIN;
function setSaveSlot(slot) {
  SAVE_SLOT = slot === 'nz' ? 'nz' : 'main';
  SAVE_KEY = SAVE_SLOT === 'nz' ? SAVE_KEY_NZ : SAVE_KEY_MAIN;
  try { localStorage.setItem('mw-slot', SAVE_SLOT); } catch (e) {}
}
const keys = new Set();
let canvas, ctx;

// ===== Спрайты людей (рисуются кодом) =====

// Аксессуары гардероба поверх головы 16×16 (все 4 направления).
// draw(r, d, shirt): r(цвет, x, y, w=1, h=1) рисует прямоугольник в кадре, d — 'down'|'up'|'left'|'right'.
// Голова x4..11 y1..6, волосы y1..2, глаза y4, свободная строка y0 — над головой.
const OUTFIT_ACCS = {
  cap: { name: '🧢 Кепка', draw(r, d, shirt) {
    r(shirt, 4, 1, 8, 2);
    if (d === 'down') r(shirt, 3, 3, 10, 1);
    else if (d === 'left') r(shirt, 2, 3, 5, 1);
    else if (d === 'right') r(shirt, 9, 3, 5, 1);
  } },
  fightband: { name: '🥋 Повязка бойца', draw(r, d) {
    const W = '#f0f0f0';
    r(W, 4, 3, 8, 1);
    if (d === 'up') { r(W, 6, 4, 1, 2); r(W, 9, 4, 1, 2); }
    else if (d === 'left') { r(W, 12, 3, 2, 1); r(W, 13, 4); }
    else if (d === 'right') { r(W, 2, 3, 2, 1); r(W, 2, 4); }
  } },
  pirate: { name: '🏴 Бандана пирата', draw(r, d) {
    const R = '#c03030', W = '#f0f0f0';
    r(R, 4, 1, 8, 2); r(W, 6, 1); r(W, 9, 2);
    if (d === 'up') { r(R, 7, 3, 2, 1); r(R, 6, 4, 1, 2); r(R, 9, 4); }
    else if (d === 'left') { r(R, 12, 1, 2, 1); r(R, 13, 2); }
    else if (d === 'right') { r(R, 2, 1, 2, 1); r(R, 2, 2); }
  } },
  glasses: { name: '🕶 Очки', draw(r, d) {
    if (d === 'down') r('#101018', 5, 4, 6, 1);
    else if (d === 'left') r('#101018', 4, 4, 3, 1);
    else if (d === 'right') r('#101018', 9, 4, 3, 1);
  } },
  anaglyph: { name: '🎬 3D-очки', draw(r, d) {
    const W = '#f0f0f0';
    if (d === 'down') { r(W, 4, 4, 8, 1); r('#e04040', 5, 4, 2, 1); r('#30c8d8', 9, 4, 2, 1); }
    else if (d === 'left') { r(W, 3, 4, 4, 1); r('#e04040', 4, 4, 2, 1); }
    else if (d === 'right') { r(W, 9, 4, 4, 1); r('#30c8d8', 10, 4, 2, 1); }
  } },
  merc: { name: '🐍 Бандана наёмника', draw(r, d) {
    const B = '#5a6a7a';
    r(B, 4, 1, 8, 2);
    if (d === 'up') { r('#3a4a5a', 7, 3, 2, 1); r(B, 6, 4, 1, 2); r(B, 9, 4, 1, 2); }
    else if (d === 'left') { r(B, 12, 2, 2, 1); r(B, 13, 3); }
    else if (d === 'right') { r(B, 2, 2, 2, 1); r(B, 2, 3); }
  } },
  invader: { name: '👾 Антенны пришельца', draw(r, d) {
    const G = '#40d840';
    if (d === 'left') { r(G, 5, 1); r(G, 9, 1); r(G, 4, 0, 2, 1); r(G, 8, 0, 2, 1); }
    else if (d === 'right') { r(G, 6, 1); r(G, 10, 1); r(G, 6, 0, 2, 1); r(G, 10, 0, 2, 1); }
    else { r(G, 5, 1); r(G, 10, 1); r(G, 4, 0, 2, 1); r(G, 10, 0, 2, 1); }
  } },
  plumber: { name: '🔧 Кепка сантехника', draw(r, d) {
    const R = '#d82818', W = '#f0f0f0';
    r(R, 4, 1, 8, 2);
    if (d === 'down') { r(R, 3, 3, 10, 1); r(W, 7, 1, 2, 2); }
    else if (d === 'left') { r(R, 2, 3, 5, 1); r(W, 4, 1, 1, 2); }
    else if (d === 'right') { r(R, 9, 3, 5, 1); r(W, 11, 1, 1, 2); }
  } },
  elfcap: { name: '🧝 Колпак героя в зелёном', draw(r, d) {
    const G = '#2e9a40';
    r(G, 4, 1, 8, 2);
    if (d === 'left') { r(G, 10, 0, 3, 1); r(G, 12, 1, 2, 1); }
    else if (d === 'right') { r(G, 3, 0, 3, 1); r(G, 2, 1, 2, 1); }
    else if (d === 'up') { r(G, 6, 0, 4, 1); r(G, 7, 3, 2, 2); }
    else r(G, 6, 0, 4, 1);
  } },
  hedgehog: { name: '🦔 Иглы синего ежа', draw(r, d) {
    const B = '#2858d8';
    r(B, 4, 1, 8, 2);
    r(B, 4, 0); r(B, 6, 0); r(B, 8, 0); r(B, 10, 0);
    if (d === 'up') r(B, 4, 1, 8, 5);
    else if (d === 'left') { r(B, 9, 1, 3, 4); r(B, 12, 2); }
    else if (d === 'right') { r(B, 4, 1, 3, 4); r(B, 3, 2); }
  } },
  champcap: { name: '🎒 Кепка юного чемпиона', draw(r, d) {
    const R = '#d82818', W = '#f0f0f0';
    r(R, 4, 1, 8, 2);
    if (d === 'down') { r(R, 3, 3, 10, 1); r(W, 6, 2, 4, 1); r('#2e9a40', 7, 2, 2, 1); }
    else if (d === 'left') { r(R, 2, 3, 5, 1); r(W, 4, 2, 2, 1); }
    else if (d === 'right') { r(R, 9, 3, 5, 1); r(W, 10, 2, 2, 1); }
  } },
  redvisor: { name: '📟 Красный визор', draw(r, d) {
    const R = '#d82818', D = '#600808';
    if (d === 'up') r('#3a3a44', 4, 2, 8, 1);
    else if (d === 'down') { r(R, 4, 3, 8, 2); r(D, 5, 4, 6, 1); }
    else if (d === 'left') { r(R, 3, 3, 5, 2); r(D, 3, 4, 4, 1); }
    else { r(R, 8, 3, 5, 2); r(D, 9, 4, 4, 1); }
  } },
  frogcap: { name: '🐸 Лягушачий капюшон', draw(r, d) {
    const G = '#3a9a50', W = '#f0f0f0', K = '#101018';
    r(G, 4, 1, 8, 2);
    if (d === 'up') { r(G, 4, 1, 8, 4); r(G, 4, 0, 2, 1); r(G, 10, 0, 2, 1); }
    else if (d === 'down') { r(W, 4, 0, 2, 1); r(K, 5, 0); r(W, 10, 0, 2, 1); r(K, 10, 0); }
    else if (d === 'left') { r(W, 4, 0, 2, 1); r(K, 4, 0); r(W, 8, 0, 2, 1); r(K, 8, 0); }
    else { r(W, 6, 0, 2, 1); r(K, 7, 0); r(W, 10, 0, 2, 1); r(K, 11, 0); }
  } },
  ghostpal: { name: '👻 Призрачный кореш', draw(r, d) {
    const E = '#3a6ab0';
    r('#f0f0f5', 6, 0, 5, 2);
    if (d === 'down') { r(E, 7, 1); r(E, 9, 1); }
    else if (d === 'left') { r(E, 6, 1); r(E, 8, 1); }
    else if (d === 'right') { r(E, 8, 1); r(E, 10, 1); }
  } },
  shroom: { name: '🍄 Грибная шляпа', draw(r) {
    const R = '#d82818', W = '#f0f0f0';
    r(R, 4, 1, 8, 2); r(R, 5, 0, 6, 1);
    r(W, 5, 1, 2, 1); r(W, 9, 1, 2, 1); r(W, 7, 0, 2, 1);
  } },
  robohelm: { name: '🤖 Шлем робобойца', draw(r, d) {
    const B = '#2858d8', L = '#68b8f8';
    if (d === 'up') { r(B, 4, 1, 8, 5); r(L, 7, 2, 2, 1); return; }
    r(B, 4, 1, 8, 2); r(L, 7, 1, 2, 1);
    if (d === 'left') { r(B, 9, 1, 3, 4); r(B, 3, 3, 1, 2); r(L, 3, 3); }
    else if (d === 'right') { r(B, 4, 1, 3, 4); r(B, 12, 3, 1, 2); r(L, 12, 3); }
    else { r(B, 3, 3, 1, 2); r(B, 12, 3, 1, 2); r(L, 3, 3); r(L, 12, 3); }
  } },
  crown: { name: '👑 Корона', draw(r) {
    const Y = '#e8c95a';
    r(Y, 4, 1, 8, 1);
    r(Y, 4, 0); r(Y, 7, 0, 2, 1); r(Y, 11, 0);
  } },
  spartan: { name: '🪖 Шлем спартанца', draw(r, d) {
    const G = '#4a6a3a', V = '#e8c95a';
    if (d === 'up') { r(G, 4, 1, 8, 5); return; }
    r(G, 4, 1, 8, 3); r(G, 4, 5, 8, 1);
    if (d === 'down') { r(G, 4, 4); r(G, 11, 4); r(V, 5, 4, 6, 1); }
    else if (d === 'left') { r(G, 7, 4, 5, 1); r(V, 4, 4, 3, 1); }
    else { r(G, 4, 4, 5, 1); r(V, 9, 4, 3, 1); }
  } },
  // ----- Костюмы (слот costume): тело x4..11 y7..11 + руки x3/x12 y8..10 -----
  kimono: { name: '🥋 Кимоно бойца', draw(r, d) {
    const W = '#f0f0f5';
    r(W, 4, 7, 8, 5); r(W, 3, 8, 1, 3); r(W, 12, 8, 1, 3);
    r('#101018', 4, 10, 8, 1);
    if (d === 'down') { r('#c8c8d4', 6, 7); r('#c8c8d4', 9, 7); }
  } },
  tracksuit: { name: '🏃 Спортивка братана', draw(r, d) {
    const B = '#2848a0';
    r(B, 4, 7, 8, 5); r(B, 3, 8, 1, 3); r(B, 12, 8, 1, 3);
    if (d === 'down') r('#16244f', 7, 7, 1, 5);
    r('#f0f0f0', 4, 8, 8, 1);
  } },
  labcoat: { name: '🥼 Халат профессора', draw(r, d) {
    const W = '#f0f0f5';
    r(W, 4, 7, 8, 5); r(W, 3, 8, 1, 3); r(W, 12, 8, 1, 3);
    if (d === 'down') { r('#a8a8b8', 7, 7, 1, 5); r('#5a5a6a', 6, 8); r('#5a5a6a', 6, 10); }
  } },
  vault: { name: '🔵 Комбез убежища', draw(r, d) {
    const B = '#2860c8', Y = '#e8c95a';
    r(B, 4, 7, 8, 5); r(B, 3, 8, 1, 3); r(B, 12, 8, 1, 3);
    r(Y, 4, 10, 8, 1);
    if (d === 'down') { r(Y, 4, 7); r(Y, 11, 7); }
  } },
  tux: { name: '🤵 Смокинг агента', draw(r, d) {
    const K = '#16161e';
    r(K, 4, 7, 8, 5); r(K, 3, 8, 1, 3); r(K, 12, 8, 1, 3);
    if (d === 'down') { r('#f0f0f0', 7, 8, 2, 3); r('#c02838', 7, 7, 2, 1); }
  } },
  armor: { name: '🦾 Силовая броня', draw(r, d) {
    const G = '#5a705a', L = '#8aa88a';
    r(G, 3, 7, 10, 5);
    r(L, 3, 7, 2, 1); r(L, 11, 7, 2, 1);
    if (d === 'down') { r(L, 6, 8, 4, 1); r('#e8c95a', 7, 9, 2, 1); }
    else if (d === 'up') r(L, 6, 8, 4, 1);
  } },
  // балахон смотрителя башни: роба + глухой чёрный капюшон (одна вещь, слот костюма)
  balahon: { name: '🥷 Чёрный балахон', draw(r, d) {
    const K = '#16161e';
    // роба поверх тела с рукавами (ноги не перекрывать — там анимация ходьбы)
    r(K, 4, 7, 8, 5); r(K, 3, 8, 1, 3); r(K, 12, 8, 1, 3);
    // капюшон: глухая макушка, лицо остаётся в проёме
    r(K, 4, 0, 8, 3);
    if (d === 'up') r(K, 4, 3, 8, 4);                          // со спины — сплошной
    else if (d === 'left') { r(K, 4, 3, 1, 3); r(K, 9, 3, 3, 4); }
    else if (d === 'right') { r(K, 4, 3, 3, 4); r(K, 11, 3, 1, 3); }
    else { r(K, 4, 3, 1, 4); r(K, 11, 3, 1, 4); }              // анфас — боковины
  } },
  // ----- Принты на футболке (слот print): видны спереди, костюм рисуется поверх -----
  printheart: { name: '💗 Принт «сердце»', draw(r, d) {
    if (d !== 'down') return;
    const P = '#f06890';
    r(P, 6, 8); r(P, 8, 8); r(P, 6, 9, 3, 1); r(P, 7, 10);
  } },
  printinvader: { name: '👾 Принт «пришелец»', draw(r, d) {
    if (d !== 'down') return;
    const G = '#40d840';
    r(G, 7, 8); r(G, 9, 8); r(G, 6, 9, 5, 1); r(G, 6, 10); r(G, 8, 10); r(G, 10, 10);
  } },
};

// Слоты: одна вещь на слот, шапка+очки+костюм+принт носятся одновременно
const ACC_SLOTS = {
  glasses: 'glasses', anaglyph: 'glasses', redvisor: 'glasses',
  kimono: 'costume', tracksuit: 'costume', labcoat: 'costume', vault: 'costume', tux: 'costume', armor: 'costume', balahon: 'costume',
  printheart: 'print', printinvader: 'print',
};
const accSlot = k => ACC_SLOTS[k] || 'head';
const SLOT_FIELD = { head: 'acc', glasses: 'glasses', costume: 'costume', print: 'print' }; // acc — легаси-имя слота шапок в сейве
const ACC_CATS = [['head', '🧢 Шапки'], ['glasses', '🕶 Очки'], ['costume', '🧥 Костюмы'], ['print', '👕 Футболки']];

function makePersonSprite(shirt, hair, acc, skin, extra) {
  skin = skin || '#e8b088';
  // 4 направления x 2 кадра, каждый 16x16
  const cv = document.createElement('canvas');
  cv.width = 16 * 4; cv.height = 16 * 2;
  const c = cv.getContext('2d');
  const dirs = ['down', 'up', 'left', 'right'];
  for (let d = 0; d < 4; d++) {
    for (let f = 0; f < 2; f++) {
      const ox = d * 16, oy = f * 16;
      const legOff = f === 0 ? 0 : 1;
      // ноги
      c.fillStyle = '#2a2a38';
      c.fillRect(ox + 5, oy + 12 + legOff, 2, 3 - legOff);
      c.fillRect(ox + 9, oy + 12 + (1 - legOff), 2, 2 + legOff);
      // тело
      c.fillStyle = shirt;
      c.fillRect(ox + 4, oy + 7, 8, 5);
      // руки
      c.fillStyle = skin;
      c.fillRect(ox + 3, oy + 8, 1, 3);
      c.fillRect(ox + 12, oy + 8, 1, 3);
      // голова
      c.fillRect(ox + 4, oy + 1, 8, 6);
      // волосы
      c.fillStyle = hair;
      c.fillRect(ox + 4, oy + 1, 8, 2);
      if (dirs[d] === 'up') c.fillRect(ox + 4, oy + 1, 8, 5);
      // глаза
      if (dirs[d] === 'down') {
        c.fillStyle = '#101018';
        c.fillRect(ox + 6, oy + 4, 1, 1); c.fillRect(ox + 9, oy + 4, 1, 1);
      } else if (dirs[d] === 'left') {
        c.fillStyle = '#101018'; c.fillRect(ox + 5, oy + 4, 1, 1);
        c.fillStyle = hair; c.fillRect(ox + 9, oy + 1, 3, 4);
      } else if (dirs[d] === 'right') {
        c.fillStyle = '#101018'; c.fillRect(ox + 10, oy + 4, 1, 1);
        c.fillStyle = hair; c.fillRect(ox + 4, oy + 1, 3, 4);
      }
      // аксессуары — поверх базы: принт → костюм (закрывает принт) → шапка → очки
      const r = (col, x, y, w, h) => { c.fillStyle = col; c.fillRect(ox + x, oy + y, w || 1, h || 1); };
      const put = k => { if (k && OUTFIT_ACCS[k]) OUTFIT_ACCS[k].draw(r, dirs[d], shirt, skin); };
      const ex = extra || {};
      put(ex.print); put(ex.costume); put(acc); put(ex.glasses);
    }
  }
  return cv;
}

// Наряд игрока: дефолт как у классического героя
const DEFAULT_OUTFIT = { shirt: '#d84848', hair: '#6b3a1e', acc: null, glasses: null, costume: null, print: null, skin: '#e8b088' };

function applyOutfit() {
  const o = (G && G.outfit) || DEFAULT_OUTFIT;
  // миграция старого сейва: очки жили в общем слоте acc
  if (o.acc && OUTFIT_ACCS[o.acc] && accSlot(o.acc) !== 'head') { o[SLOT_FIELD[accSlot(o.acc)]] = o.acc; o.acc = null; }
  const val = (f, slot) => (OUTFIT_ACCS[o[f]] && accSlot(o[f]) === slot) ? o[f] : null;
  playerSprite = makePersonSprite(o.shirt, o.hair, val('acc', 'head'), o.skin,
    { glasses: val('glasses', 'glasses'), costume: val('costume', 'costume'), print: val('print', 'print') });
}

let playerSprite = null, trainerSprite = null, masterSprite = null, traderSprite = null, towerSprite = null;
const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };

// ===== HUD и всплывашки =====

function updateHUD() {
  checkAchievements();
  // кнопка рыбалки — только с удочкой И когда рядом вода
  document.getElementById('t-fish').classList.toggle('hidden', !(G.bag.rod && waterNearby()));
  // кнопка бега отражает доступный маунт: 🛴 самокат / 🐎 братан / 🏃 просто бег
  const runBtn = document.getElementById('t-run');
  if (runBtn) {
    const lm = landMountKind();
    runBtn.textContent = lm === 'scooter' ? '🛴' : lm === 'brother' ? '🐎' : '🏃';
  }
  const s = document.getElementById('hud-stats');
  const px = Math.floor(G.player.x), py = Math.floor(G.player.y);
  // кнопка автокача — у купивших, в дикой зоне (или пока он включён)
  const grindBtn = document.getElementById('t-grind');
  if (grindBtn) {
    grindBtn.classList.toggle('hidden',
      NZ() || !(typeof grindUnlocked !== 'undefined' && grindUnlocked && (GRIND_ON || grindZoneAt(px, py))));
  }
  s.innerHTML = '🔮 <b>' + ballsTotal(G.balls) + '</b> · 💰 <b>' + G.money + '₴</b> · 🏅 <b>' + G.badges.length +
    '</b> · 🏆 <b>' + G.achievements.size + '</b> · ' + PHASE_ICON[G.phase] +
    (G.weather === 'rain' ? (World.climateAt(px, py) === 'cold' ? '❄️' : '☔') : '') + '<br>' +
    '<span style="opacity:.7">📕 ' + G.dex.caught.size + '/' + G.dex.seen.size +
    (G.egg ? ' · 🥚 ' + G.egg.steps : '') +
    (G.repelSteps > 0 ? ' · 🚫 ' + G.repelSteps : '') +
    (G.quest ? ' · 📋 ' + G.quest.progress + '/' + G.quest.need : '') +
    ' · x:' + px + ' y:' + py + ' · ур. диких ~' + World.levelAt(px, py) +
    (() => { const c = World.cityInfoAt(px, py); return c ? ' · 🏙️ ' + c.name : ''; })() +
    (NZ() ? (() => { const z = nzZoneAt(px, py);
      return ' · 📍' + z.name + (G.nz.zones[z.id] ? ' ✔' : ' 🎯'); })() : '') +
    (NZ() ? ' · ⛔' + nzCap() : '') + '</span>';
  const p = document.getElementById('hud-party');
  p.innerHTML = G.party.map(m => {
    const pct = Math.max(0, m.hp / m.maxHp * 100);
    return '<div class="chip"><div class="nm">' + (m.shiny ? '✨' : '') + monName(m) + statusTag(m) + '</div>' +
      '<div class="lv">Ур.' + m.level + '</div>' +
      '<div class="bar"><i class="' + (pct < 30 ? 'low' : '') + '" style="width:' + pct + '%"></i></div></div>';
  }).join('');
}

let toastTimer = null;
function toast(text) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.style.opacity = 0; }, 2200);
}

// Дозированный обучающий хинт: показывается не более maxShow раз за игру,
// потом молчит (игрок уже усвоил). Счётчик показов живёт в сейве (G.hints).
function hint(id, text, maxShow) {
  maxShow = maxShow || 3;
  if (!G.hints) G.hints = {};
  const n = G.hints[id] || 0;
  if (n >= maxShow) return;
  G.hints[id] = n + 1;
  toast(text);
  saveGame();
}

// ===== Сохранение =====

// Кастомный спрайт валиден, если это небольшой PNG data-URL
function validCustomSprite(s) {
  return typeof s === 'string' && s.startsWith('data:image/png;base64,') && s.length <= 12000 ? s : null;
}

// Санитайзеры недоверенного текста (клички/имена умений из чужих кодов обмена
// и импортированных сейвов): рендерятся через innerHTML — режем HTML-опасное.
// Зеркалят фильтры воркера, т.к. коды обмена/сейва идут мимо API.
function safeNick(s) {
  return s ? (String(s).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 12) || null) : null;
}
function safeMoveName(s) {
  return String(s || 'Удар').replace(/[<>&"'`]/g, '').slice(0, 40) || 'Удар';
}

function dumpOwnedMon(m) {
  return {
    speciesSeed: m.speciesSeed, stage: m.stage, level: m.level,
    exp: m.exp, hp: m.hp, moves: m.moves, status: m.status || null,
    shiny: !!m.shiny, mega: !!m.mega, nick: m.nick || null, charm: m.charm || null,
    customSprite: m.customSprite || null, palette: m.palette || null,
    nzCaughtLvl: m.nzCaughtLvl || undefined, nzBattles: m.nzBattles || undefined,
  };
}

function reviveOwnedMon(md) {
  // moves/nick могут прийти из импортированного кода сейва (недоверенный ввод) —
  // чистим имена, т.к. они уходят в innerHTML (см. safeNick/safeMoveName)
  const moves = (Array.isArray(md.moves) ? md.moves : []).map(mv =>
    Object.assign({}, mv, { name: safeMoveName(mv && mv.name) }));
  const m = {
    speciesSeed: md.speciesSeed >>> 0, stage: md.stage, level: md.level,
    exp: md.exp, hp: md.hp, moves, status: md.status || null,
    shiny: !!md.shiny, nick: safeNick(md.nick), charm: md.charm || null,
    customSprite: validCustomSprite(md.customSprite), palette: validPalette(md.palette),
    nzCaughtLvl: md.nzCaughtLvl | 0 || undefined, nzBattles: md.nzBattles | 0 || undefined,
  };
  // мега только у финальной стадии с MEGA_LEVEL — импортированный код не подделает
  m.mega = !!md.mega && m.stage === getSpecies(m.speciesSeed).chainLen - 1 && m.level >= MEGA_LEVEL;
  for (const mv of m.moves) {
    if (mv.maxPp === undefined) { mv.maxPp = ppForPower(mv.power); mv.pp = mv.maxPp; }
    if (mv.pp === undefined) mv.pp = mv.maxPp;
  }
  recalcStats(m);
  m.hp = Math.min(md.hp, m.maxHp);
  return m;
}

function buildSaveData() {
  return {
    ts: Date.now(),   // для выбора свежего между локальным и облачным сейвом
    seed: G.seed,
    x: G.player.x, y: G.player.y,
    spawn: G.spawn,
    balls: G.balls,
    money: G.money,
    bag: G.bag,
    badges: G.badges,
    dexSeen: [...G.dex.seen],
    dexCaught: [...G.dex.caught],
    dexShiny: [...G.dex.shiny],
    fountains: G.fountains,
    usedNests: [...G.usedNests],
    usedShrines: [...G.usedShrines],
    traded: [...G.traded],
    achievements: [...G.achievements],
    scrolls: G.scrolls,
    charms: G.charms,
    egg: G.egg,
    quest: G.quest,
    lastQuestKind: G.lastQuestKind,
    repelSteps: G.repelSteps,
    tradeOut: G.tradeOut,
    tradeIn: G.tradeIn,
    usedTrades: [...G.usedTrades],
    storage: G.storage.map(dumpOwnedMon),
    pvpOut: G.pvpOut,
    stats: G.stats,
    clock: Math.floor(G.clock),
    party: G.party.map(dumpOwnedMon),
    defeated: [...G.defeated],
    picked: [...G.picked],
    outfit: G.outfit,
    scootOn: G.scootOn,
    hints: G.hints,
    nuzlocke: !!G.nuzlocke,
    nz: G.nuzlocke ? G.nz : undefined,
  };
}

function saveGame() {
  if (G.state === 'title' || G.state === 'starter') return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveData())); } catch (e) {}
  cloudSaveSoon(); // в Telegram — отложенная заливка в CloudStorage
}

// Сейвскам работает только ВНУТРИ боя (Battle.battleSave/battleReload) —
// эмуляторный сейв-стейт перед ударом; вне боя откат намеренно не даём.

// Код сейва: JSON -> base64 (безопасно для юникода)
function exportSaveCode() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(buildSaveData()))));
}

function importSaveCode(code) {
  // сейв с большим карманом кастомных спрайтов легитимно крупный, но не
  // безграничный — режем явно вредоносные мегабайтные вставки до декода
  if (typeof code !== 'string' || code.length > 4000000) {
    return 'Код слишком длинный — похоже, это не код сейва.';
  }
  let data;
  try {
    data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  } catch (e) { return 'Не удалось прочитать код — проверь, что скопирован целиком.'; }
  if (!data || data.seed === undefined || !Array.isArray(data.party) || !data.party.length) {
    return 'Код прочитан, но данные повреждены.';
  }
  try { localStorage.setItem(data.nuzlocke ? SAVE_KEY_NZ : SAVE_KEY_MAIN, JSON.stringify(data)); } catch (e) {}
  return { nz: !!data.nuzlocke }; // успех
}

function loadGame() {
  let data;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!data || !data.party || !data.party.length) return false;
  G.seed = data.seed >>> 0;
  World.init(G.seed);
  G.player.x = data.x; G.player.y = data.y;
  G.spawn = data.spawn || { x: 0.5, y: 0.5 };
  // сферы: старые сейвы хранили одно число orbs — переносим в обычные сферы
  G.balls = Object.assign(emptyBalls(), data.balls || {});
  if (!data.balls && data.orbs !== undefined) G.balls.basic = data.orbs | 0;
  G.money = data.money !== undefined ? data.money : 300;
  G.bag = Object.assign({ potion: 1, superpotion: 0, tonic: 0, ether: 0, repel: 0, bigrepel: 0, rod: 0, stone: 0, megastone: 0 }, data.bag || {});
  G.scrolls = (data.scrolls || []).map(mv => Object.assign({ maxPp: ppForPower(mv.power) }, mv));
  G.charms = Object.assign({ atk: 0, def: 0, spd: 0, hp: 0, exp: 0 }, data.charms || {});
  G.egg = data.egg || null;
  G.quest = data.quest || null;
  G.lastQuestKind = data.lastQuestKind || null;
  G.repelSteps = data.repelSteps || 0;
  G.tradeOut = data.tradeOut || null;
  G.tradeIn = data.tradeIn || null;
  G.usedTrades = new Set(data.usedTrades || []);
  G.storage = (data.storage || []).map(reviveOwnedMon);
  G.pvpOut = data.pvpOut || null;
  G.badges = data.badges || [];
  G.dex = {
    seen: new Set((data.dexSeen || []).map(s => s >>> 0)),
    caught: new Set((data.dexCaught || []).map(s => s >>> 0)),
    shiny: new Set((data.dexShiny || []).map(s => s >>> 0)),
  };
  G.fountains = data.fountains || [];
  G.usedNests = new Set(data.usedNests || []);
  G.usedShrines = new Set(data.usedShrines || []);
  G.traded = new Set(data.traded || []);
  G.achievements = new Set(data.achievements || []);
  G.stats = Object.assign({ trainersBeaten: 0, evolutions: 0, nests: 0, trades: 0, maxDist: 0,
                            surfed: 0, fished: 0, towerBest: 0, legends: 0, taught: 0,
                            eggsHatched: 0, quests: 0, sawSnow: 0, sawDesert: 0, friendTrades: 0, pvpBattles: 0, pvpWins: 0, megas: 0 }, data.stats || {});
  G.clock = data.clock || 0;
  G.party = data.party.map(reviveOwnedMon);
  // Инвариант братопедии: всё, чем игрок владеет, числится пойманным —
  // чинит сейвы, где запись о поимке когда-то потерялась
  for (const m of G.party) dexCaught(m);
  for (const m of G.storage) dexCaught(m);
  G.defeated = new Set(data.defeated || []);
  G.picked = new Set(data.picked || []);
  G.outfit = Object.assign({}, DEFAULT_OUTFIT, data.outfit || {});
  applyOutfit();
  G.scootOn = data.scootOn !== false;   // включён по умолчанию (если куплен)
  G.hints = data.hints || {};
  G.nuzlocke = !!data.nuzlocke;
  G.nz = G.nuzlocke ? nzLoadState(data.nz) : null;
  GROWTH_QUEUE.length = 0;   // очередь умений держит ссылки на старые объекты братвы
  resetFollower();
  nzApplyMenuMode();
  return true;
}

// ===== Старт нового мира =====

function findSpawn() {
  // ближайший проходимый не-водный тайл по спирали от (0,0)
  for (let r = 0; r < 300; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (const dy of (r === 0 ? [0] : [-r, r])) {
        for (const [x, y] of [[dx, dy], [dy, dx]]) {
          if (!World.isSolid(x, y) && !World.trainerAt(x, y) && !World.arenaMasterAt(x, y)) return { x: x + 0.5, y: y + 0.5 };
        }
      }
    }
  }
  return { x: 0.5, y: 0.5 };
}

function newWorld(seedText, nz) {
  G.seed = seedText ? strSeed(seedText) : (Math.random() * 4294967296) >>> 0;
  World.init(G.seed);
  G.party = [];
  G.balls = Object.assign(emptyBalls(), { basic: 15 });
  G.money = 300;
  G.bag = { potion: 1, superpotion: 0, tonic: 0, ether: 0, repel: 0, bigrepel: 0, rod: 0, stone: 0, megastone: 0 };
  G.scrolls = [];
  G.charms = { atk: 0, def: 0, spd: 0, hp: 0, exp: 0 };
  G.egg = null;
  G.quest = null;
  G.lastQuestKind = null;
  G.repelSteps = 0;
  G.tradeOut = null;
  G.tradeIn = null;
  G.usedTrades = new Set();
  G.storage = [];
  G.pvpOut = null;
  G.badges = [];
  G.dex = { seen: new Set(), caught: new Set(), shiny: new Set() };
  G.fountains = [];
  G.usedNests = new Set();
  G.usedShrines = new Set();
  G.traded = new Set();
  G.achievements = new Set();
  G.stats = { trainersBeaten: 0, evolutions: 0, nests: 0, trades: 0, maxDist: 0,
              surfed: 0, fished: 0, towerBest: 0, legends: 0, taught: 0,
              eggsHatched: 0, quests: 0, sawSnow: 0, sawDesert: 0, friendTrades: 0, pvpBattles: 0, pvpWins: 0, megas: 0 };
  G.clock = 0;
  G.defeated = new Set();
  G.picked = new Set();
  G.outfit = Object.assign({}, DEFAULT_OUTFIT);
  applyOutfit();
  G.scootOn = true;
  G.hints = {};
  GROWTH_QUEUE.length = 0;
  G.nuzlocke = !!nz;
  G.nz = nz ? nzFreshState() : null;
  if (nz) nzLog('start', { seed: G.seed });
  G.spawn = findSpawn();
  G.player.x = G.spawn.x; G.player.y = G.spawn.y;
  resetFollower();
  nzApplyMenuMode();
  showStarterPick();
}

function showStarterPick() {
  G.state = 'starter';
  document.getElementById('title').classList.add('hidden');
  const panel = document.getElementById('starter-pick');
  panel.classList.remove('hidden');
  // карта окрестностей спавна — чтобы выбрать стартера под местность
  const mtw = IS_MOBILE && window.innerHeight > window.innerWidth ? 110 : 160;
  drawMiniMap(document.getElementById('starter-map'), mtw, Math.round(mtw * 0.66), G.spawn.x, G.spawn.y);
  const cl = World.climateAt(Math.floor(G.spawn.x), Math.floor(G.spawn.y));
  document.getElementById('starter-climate').textContent =
    '✚ — место старта. Климат: ' + (cl === 'cold' ? '❄️ снега' : cl === 'hot' ? '🏜️ пустыня' : '🌿 умеренный') + '.';
  const box = document.getElementById('starters');
  box.innerHTML = '';
  const forced = ['fire', 'water', 'grass'];
  forced.forEach((wantType, i) => {
    // подбираем сид, дающий нужный тип и цепочку из 3 стадий
    let seed = hash2u(i + 1, 777, G.seed ^ 0xCAFE);
    for (let tries = 0; tries < 4000; tries++) {
      const sp = getSpecies(seed);
      if (sp.stages[0].type === wantType && sp.chainLen === 3) break;
      seed = (seed + 0x9E3779B9) >>> 0;
    }
    const sp = getSpecies(seed);
    const div = document.createElement('div');
    div.className = 'starter';
    const cv = document.createElement('canvas');
    cv.width = 32; cv.height = 32;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const spr = speciesSprite(seed, 0);
    c.drawImage(spr, Math.floor((32 - spr.width) / 2), Math.floor((32 - spr.height) / 2));
    div.appendChild(cv);
    const t = TYPE_INFO[sp.stages[0].type];
    const info = document.createElement('div');
    info.innerHTML = '<div class="nm">' + sp.stages[0].name + '</div>' +
      '<div class="tp" style="color:' + t.color + '">' + t.ru + '</div>' +
      '<div class="tp" style="opacity:.7">' + sp.chainLen + ' стадии эволюции</div>';
    div.appendChild(info);
    div.onclick = () => {
      G.party = [makeMonster(seed, 0, 5)];
      nzOnStarter(G.party[0]);
      dexCaught(G.party[0]);
      resetFollower();
      panel.classList.add('hidden');
      G.state = 'world';
      toast(sp.stages[0].name + ' присоединяется к тебе!');
      sfx('catch');
      updateHUD();
      saveGame();
    };
    box.appendChild(div);
  });
}

// ===== Столкновения и события мира =====

// Можно ли плавать: живой водный монстрик 15+ уровня
function canSurf() {
  return G.party.some(m => m.hp > 0 && monType(m) === 'water' && m.level >= 15);
}

// Есть ли вода в соседнем тайле (для кнопки рыбалки)
function waterNearby() {
  const px = Math.floor(G.player.x), py = Math.floor(G.player.y);
  return [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]]
    .some(([x, y]) => World.tileAt(x, y) === T.WATER);
}

// Какой наземный маунт доступен ПОТЕНЦИАЛЬНО (для иконки кнопки бега),
// без учёта того, нажато ли ускорение: 'scooter' | 'brother' | null
function landMountKind() {
  if (World.tileAt(Math.floor(G.player.x), Math.floor(G.player.y)) === T.WATER) return null;
  if (!NZ() && scootUnlocked && G.scootOn) return 'scooter';
  const lead = G.party.find(m => m.hp > 0);
  if (lead && lead.stage >= 2) return 'brother';
  return null;
}

// Активный маунт под игроком (или null). Определяет и скорость, и что рисуем:
//  water   — плывём на водном братишке (пассивно, по факту нахождения на воде)
//  scooter — премиум-самокат на суше ×1.8; нужен куплен, включён И нажато ускорение
//  brother — верхом на лидере-братане (3-я стадия) на суше ×1.5, при ускорении
// Наземный маунт активируется только вместе с бегом (клавиша Shift / кнопка бега):
// пешком идёшь сам, нажал ускорение — едешь на маунте (если есть).
function activeMount() {
  const p = G.player;
  if (World.tileAt(Math.floor(p.x), Math.floor(p.y)) === T.WATER) {
    const w = G.party.find(m => m.hp > 0 && monType(m) === 'water' && m.level >= 15);
    return w ? { kind: 'water', mon: w, mult: 1 } : null;
  }
  if (!keys.has('Shift')) return null;  // на суше маунт только при включённом ускорении
  if (!NZ() && scootUnlocked && G.scootOn) return { kind: 'scooter', mult: 1.8 };
  const lead = G.party.find(m => m.hp > 0);
  if (lead && lead.stage >= 2) return { kind: 'brother', mon: lead, mult: 1.5 };
  return null;
}

// Спрайт электросамоката 16×16, смотрит вправо (флип по направлению)
let _scooterSprite = null;
function scooterSprite() {
  if (_scooterSprite) return _scooterSprite;
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const c = cv.getContext('2d');
  // колёса
  c.fillStyle = '#101014';
  c.fillRect(3, 12, 3, 3); c.fillRect(11, 12, 3, 3);
  c.fillStyle = '#3a3a44';
  c.fillRect(4, 13, 1, 1); c.fillRect(12, 13, 1, 1);
  // дека
  c.fillStyle = '#c8cdd6';
  c.fillRect(4, 12, 9, 1);
  // стойка руля + руль (акцентный, «электрический»)
  c.fillStyle = '#3fc8e8';
  c.fillRect(11, 5, 2, 7);
  c.fillRect(9, 5, 5, 1);
  c.fillStyle = '#ffd75e';
  c.fillRect(13, 4, 1, 1); // фара
  _scooterSprite = cv;
  return cv;
}

function collides(x, y) {
  // хитбокс: квадрат 0.6 вокруг точки чуть ниже центра
  const pts = [
    [x - 0.3, y - 0.1], [x + 0.3, y - 0.1],
    [x - 0.3, y + 0.35], [x + 0.3, y + 0.35],
  ];
  const surf = canSurf();
  for (const [px, py] of pts) {
    const tx = Math.floor(px), ty = Math.floor(py);
    if (World.tileAt(tx, ty) === T.WATER && surf) continue; // сёрфинг!
    if (World.isSolid(tx, ty)) return { tx, ty, kind: 'tile' };
    const tr = World.trainerAt(tx, ty);
    if (tr && !G.defeated.has(tr.id)) return { tx, ty, kind: 'trainer', trainer: tr };
    const master = World.arenaMasterAt(tx, ty);
    if (master) return { tx, ty, kind: 'master', master };
    const trader = World.traderAt(tx, ty);
    if (trader) return { tx, ty, kind: 'trader', trader };
  }
  return null;
}

async function startTrainerBattle(tr) {
  if (G.state !== 'world') return;
  G.state = 'battle';
  let team = World.trainerTeam(tr);
  let name = tr.name;
  // «живой» соперник: реальная команда другого игрока (уровни подогнаны под местность)
  let rival = Math.random() < 0.4 ? netTakeRival() : null;
  // свой же снапшот с другого устройства (clientId разные, ник один) — пропускаем
  if (rival && typeof playerNick === 'string' && playerNick && rival.nick === playerNick) rival = null;
  if (rival) {
    const safeNick = String(rival.nick || '').replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 20) || 'Тренер';
    name = 'Тренер Братвы ' + safeNick;
    const revived = rival.team.slice(0, 6).map(md => {
      const m = tradeMonRevive(md);
      const lvl = clamp(m.level, Math.max(2, tr.level - 2), tr.level + 3);
      if (lvl !== m.level) { m.level = lvl; recalcStats(m); m.hp = m.maxHp; }
      m.moves.forEach(mv => { mv.pp = mv.maxPp; });
      return m;
    }).filter(Boolean);
    if (revived.length) team = revived;
  }
  const result = await Battle.run({
    kind: 'trainer', enemyParty: team, trainerName: name,
    reward: 30 + tr.level * 12,
  });
  if (result === 'win') { G.defeated.add(tr.id); G.stats.trainersBeaten++; questProgress('trainer'); }
  afterBattle(result);
}

async function startArenaBattle(master) {
  if (G.state !== 'world') return;
  G.state = 'battle';
  const team = World.masterTeam(master);
  const result = await Battle.run({
    kind: 'trainer', foe: 'master', enemyParty: team, trainerName: master.name,
    reward: 200 + master.level * 20,
    badgeId: master.id,
  });
  if (result === 'win') {
    G.stats.trainersBeaten++;
    questProgress('trainer');
    if (!G.badges.includes(master.id)) G.badges.push(master.id);
    if (NZ()) {
      G.nz.stats.leaders++;
      nzLog('leader', { name: master.name, ace: nzAceLevel(master) });
      nzRecalcCap(master);
    }
  }
  afterBattle(result);
}

// mode: undefined | 'nest' | 'fish' | 'shrine'
async function startWildBattle(x, y, mode) {
  G.state = 'battle';
  const rng = mulberry32((Math.random() * 4294967296) >>> 0);
  const env = {
    night: G.phase === 'night',
    rain: G.weather === 'rain',
    water: World.tileAt(x, y) === T.WATER || mode === 'fish',
    climate: World.climateAt(x, y),
    lvlBonus: mode === 'fish' ? 3 : 0,
  };
  let wild, envText = null;
  if (mode === 'nest') {
    wild = World.makeNestMonster(x, y, rng);
    envText = '🥚 Из гнезда вылезает редкий братишка!';
  } else if (mode === 'shrine') {
    wild = World.makeLegendMonster(x, y, rng);
    envText = '⚡ Древнее святилище пробуждается! Легендарный страж атакует!';
  } else {
    wild = World.makeWildMonster(x, y, rng, env);
    if (mode === 'fish') envText = '🎣 Клюёт! Из глубины выныривает добыча!';
    else if (env.water) envText = '🌊 Из-под волн кто-то поднимается...';
    else if (env.rain) envText = '☔ Барабанит дождь...';
    else if (env.night) envText = '🌙 Стоит глубокая ночь...';
  }
  const nzEnc = NZ() ? nzEncounterInfo(x, y, wild) : null;
  const result = await Battle.run({ kind: 'wild', enemyParty: [wild], envText,
    nzCatch: nzEnc ? nzEnc.catch : null });
  if (nzEnc) nzAfterWild(nzEnc, wild, result);
  if (mode === 'fish' && result === 'caught') questProgress('fish');
  if (mode === 'shrine' && result === 'caught') {
    G.stats.legends++;
    toast('⚡ Легендарный братан пойман!');
  }
  afterBattle(result);
}

// Башня испытаний: серия боёв без лечения, растущие этажи
async function startTowerRun(tw) {
  if (G.state !== 'world') return;
  G.state = 'battle';
  let floor = 1, result;
  while (true) {
    const team = World.towerTeam(tw, floor);
    result = await Battle.run({
      kind: 'trainer', enemyParty: team, foe: 'tower',
      trainerName: 'Смотритель этажа ' + floor,
      reward: 40 + floor * 35,
    });
    if (result !== 'win') break;
    G.stats.trainersBeaten++;
    questProgress('trainer');
    questProgress('tower');
    G.stats.towerBest = Math.max(G.stats.towerBest, floor);
    if (floor % 3 === 0) {
      const mv = makeMove(mulberry32((Math.random() * 4294967296) >>> 0), null, 10);
      G.scrolls.push(mv);
      toast('📜 Награда башни: свиток «' + mv.name + '»!');
    }
    floor++;
    // в автобое лезем вверх без вопросов — до проигрыша или ручного стопа
    if (!Battle._auto && !confirm('Этаж ' + (floor - 1) + ' пройден! Подняться выше? Этаж ' + floor +
      ' будет сильнее, а братва НЕ лечится.')) break;
  }
  afterBattle(result);
}

// Ближайший посещённый фонтан (или точка старта)
function nearestFountain() {
  let best = null, bestD = Infinity;
  for (const f of G.fountains) {
    const d = Math.hypot(f.x - G.player.x, f.y - G.player.y);
    if (d < bestD) { bestD = d; best = f; }
  }
  return best;
}

function afterBattle(result) {
  if (NZ() && nzAfterBattle(result)) return;   // блэкаут показал свой экран
  if (result === 'lose') {
    if (GRIND_ON) setGrind(false, true); // братва откисла — автокач стоп
    if (Battle._auto) Battle.setAuto(false); // и автобой тоже: не жечь братву заново
    // цена поражения — половина всех наличных (округляем потерю вниз)
    const lost = Math.floor(G.money / 2);
    G.money -= lost;
    const f = nearestFountain();
    G.player.x = f ? f.x : G.spawn.x;
    G.player.y = f ? f.y : G.spawn.y;
    resetFollower();
    for (const m of G.party) {
      m.hp = m.maxHp;
      m.status = null;
      m.moves.forEach(mv => { mv.pp = mv.maxPp; });
    }
    G.lastTileKey = '';
    toast((f ? 'Ты приходишь в себя у знакомого фонтана.' : 'Братва отдохнула у точки старта.') +
      (lost > 0 ? ' 💸 Потеряно ' + lost + '₴.' : ''));
  }
  G.graceSteps = 3;
  G.bumpCooldown = 0.8;
  G.state = 'world';
  updateHUD();
  saveGame();
  netUploadTeam();   // актуальный состав — в общий пул соперников
  netFetchRival();   // и заранее тянем следующего «живого» тренера
}

// ===== Церемония роста: эволюция и изучение умений =====
// Больше не происходят молча внутри grantExp. Готовность к эволюции выводится
// из уровня (growthEvolveReady в data.js), изучение умений ждёт в GROWTH_QUEUE.
// frame() дёргает maybeStartGrowth каждый кадр в мире — так церемония догоняет
// игрока после боя, после PvP-опыта и даже после перезахода со старым сейвом.

function maybeStartGrowth() {
  if (G.state !== 'world' || Battle.active) return;
  const evoMon = G.party.find(growthEvolveReady);
  if (evoMon) { openGrowthEvolve(evoMon); return; }
  while (GROWTH_QUEUE.length) {
    const ev = GROWTH_QUEUE[0];
    // братишку могли отпустить, а умение — уже изучить свитком; такие пропускаем
    if ((!G.party.includes(ev.mon) && !G.storage.includes(ev.mon)) ||
        ev.mon.moves.some(mv => mv.name === ev.mv.name)) { GROWTH_QUEUE.shift(); continue; }
    GROWTH_QUEUE.shift();
    openGrowthMove(ev.mon, ev.mv);
    return;
  }
}

function closeGrowth() {
  document.getElementById('growth-panel').classList.add('hidden');
  G.state = 'world';   // следующий кандидат из очереди откроется со следующего кадра
  updateHUD();
  saveGame();
}

function growthPanelShow(title) {
  G.state = 'growth';
  document.getElementById('growth-title').textContent = title;
  document.getElementById('growth-stage').innerHTML = '';
  document.getElementById('growth-text').innerHTML = '';
  document.getElementById('growth-rows').innerHTML = '';
  document.getElementById('growth-actions').innerHTML = '';
  document.getElementById('growth-panel').classList.remove('hidden');
}

function growthCloseBtn() {
  const b = document.createElement('button');
  b.textContent = 'Закрыть';
  b.onclick = closeGrowth;
  return b;
}

function openGrowthEvolve(m) {
  growthPanelShow('✨ Эволюция!');
  const sp = getSpecies(m.speciesSeed);
  const next = sp.stages[m.stage + 1];
  const stage = document.getElementById('growth-stage');
  const oldCv = monMiniCanvas(m, 26);   // 26px-канвас растянут CSS до 120 — спрайт крупный
  // предпросмотр новой формы: monSprite читает поля экземпляра, клона хватает
  const newCv = monMiniCanvas(Object.assign({}, m, { stage: m.stage + 1 }), 26);
  newCv.style.opacity = '0';
  stage.appendChild(oldCv);
  stage.appendChild(newCv);
  const txt = document.getElementById('growth-text');
  txt.innerHTML = cap(stageWord(m.stage)) + ' <b style="color:var(--ui-accent)">' + monName(m) +
    '</b> набрался опыта и готов эволюционировать в ' + stageWordAcc(m.stage + 1) + ' <b>' + next.name + '</b>!';
  const act = document.getElementById('growth-actions');
  const b = document.createElement('button');
  b.textContent = '✨ Эволюционировать';
  b.onclick = () => {
    b.disabled = true;
    sfx('catch');
    oldCv.classList.add('grow-out');
    newCv.style.opacity = '';
    newCv.classList.add('grow-in');
    // применяем сразу, анимация — только картинка: закрытие игры эволюцию не съест
    const hadNick = !!m.nick;
    const ratio = m.maxHp ? m.hp / m.maxHp : 1;
    m.stage++;
    recalcStats(m);
    m.hp = m.hp <= 0 ? 0 : Math.max(1, Math.round(m.maxHp * ratio));
    G.stats.evolutions++;
    if (NZ()) nzLog('evo', { nick: monName(m), sp: m.speciesSeed, st: m.stage });
    saveGame();
    setTimeout(() => {
      txt.innerHTML = 'Невероятно! Теперь это ' + stageWord(m.stage) +
        ' <b style="color:var(--ui-accent)">' + (hadNick ? monName(m) : monSpeciesName(m)) + '</b>!';
      act.innerHTML = '';
      act.appendChild(growthCloseBtn());
    }, 1500);
  };
  act.appendChild(b);
}

function openGrowthMove(m, mv) {
  growthPanelShow('📜 Новое умение!');
  document.getElementById('growth-stage').appendChild(monMiniCanvas(m, 26));
  const t = TYPE_INFO[mv.type];
  const mvDesc = '«<b>' + mv.name + '</b>» <span style="color:' + t.color + '">' + t.ru +
    '</span> · сила ' + mv.power + ' · точн. ' + mv.acc + moveEffectLabel(mv);
  const txt = document.getElementById('growth-text');
  const act = document.getElementById('growth-actions');
  const whoLow = stageWord(m.stage) + ' <b style="color:var(--ui-accent)">' + monName(m) + '</b>';
  const who = cap(whoLow);

  if (m.moves.length < 4) {
    m.moves.push(moveInstance(mv));
    sfx('level');
    saveGame();
    txt.innerHTML = who + ' набрался опыта и изучает умение ' + mvDesc + '!';
    act.appendChild(growthCloseBtn());
    return;
  }

  // все 4 слота заняты — спрашиваем, чем пожертвовать
  txt.innerHTML = who + ' пытался изучить умение ' + mvDesc + ', но он уже и так ферзь — ' +
    'все 4 слота заняты. Что делаем?';
  const bSwap = document.createElement('button');
  bSwap.textContent = 'Заменить одно из умений';
  bSwap.onclick = () => {
    const rows = document.getElementById('growth-rows');
    rows.innerHTML = '';
    act.innerHTML = '';
    txt.innerHTML = 'Какое умение ' + whoLow + ' забудет ради ' + mvDesc + '?';
    m.moves.forEach((old, oi) => {
      const row = document.createElement('div');
      row.className = 'srow';
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<span class="nm">' + old.name + '</span> — ' + TYPE_INFO[old.type].ru +
        ' · сила ' + old.power + ' · точн. ' + old.acc + moveEffectLabel(old);
      row.appendChild(info);
      const btn = document.createElement('button');
      btn.textContent = 'Забыть';
      btn.onclick = () => {
        const oldName = old.name;
        m.moves[oi] = moveInstance(mv);
        sfx('level');
        saveGame();
        rows.innerHTML = '';
        txt.innerHTML = who + ' забывает «' + oldName + '» и изучает «<b>' + mv.name + '</b>»!';
        act.innerHTML = '';
        act.appendChild(growthCloseBtn());
      };
      row.appendChild(btn);
      rows.appendChild(row);
    });
    const back = document.createElement('button');
    back.textContent = '‹ Назад';
    back.onclick = () => openGrowthMove(m, mv);
    act.appendChild(back);
  };
  const bSkip = document.createElement('button');
  bSkip.textContent = 'Отменить изучение';
  bSkip.onclick = closeGrowth;
  act.appendChild(bSwap);
  act.appendChild(bSkip);
}

function healAtFountain(tx, ty) {
  // регистрируем фонтан как точку быстрого перемещения
  const fid = 'F' + Math.floor(tx / 12) + ',' + Math.floor(ty / 12);
  if (!G.fountains.some(f => f.id === fid)) {
    G.fountains.push({ id: fid, x: G.player.x, y: G.player.y });
    toast('⛲ Фонтан отмечен на карте — теперь сюда можно телепортироваться!');
  }
  const needed = G.party.some(m => m.hp < m.maxHp || m.status || m.moves.some(mv => mv.pp < mv.maxPp)) || G.balls.basic < 10;
  if (needed) {
    for (const m of G.party) {
      m.hp = m.maxHp;
      m.status = null;
      m.moves.forEach(mv => { mv.pp = mv.maxPp; });
    }
    if (G.balls.basic < 10) G.balls.basic = 10;
    sfx('heal');
    toast('Фонтан лечит братву, снимает недуги и восполняет ПП!');
  }
  updateHUD();
  saveGame();
}

function onTileEnter(tx, ty) {
  G.stats.maxDist = Math.max(G.stats.maxDist, Math.max(Math.abs(tx), Math.abs(ty)));
  // вход в город — приветствие
  const city = World.cityInfoAt(tx, ty);
  const cityId = city ? city.id : null;
  if (cityId !== G.lastCityId) {
    G.lastCityId = cityId;
    if (city) toast('🏙️ Добро пожаловать: ' + city.name + '!');
    if (city) nzRegisterCity(city);
  }
  // климат для ачивки
  const tile0 = World.tileAt(tx, ty);
  if ((tile0 === T.SNOW || tile0 === T.SNOWTALL) && !G.stats.sawSnow) {
    G.stats.sawSnow = 1;
    toast('❄ Ты забрёл в снежные земли — тут водится ледяная братва!');
  }
  if ((tile0 === T.DESERT || tile0 === T.DESERTTALL) && !G.stats.sawDesert) {
    G.stats.sawDesert = 1;
    toast('🏜 Пустыня! Здесь кишит огненная и электрическая братва.');
  }
  // подсказка про автокач — купившим, при входе в дикую зону
  if (typeof grindUnlocked !== 'undefined' && grindUnlocked && !GRIND_ON && grindZoneAt(tx, ty)) {
    hint('grind', '🤖 Автокач: жми ' + (IS_MOBILE ? 'кнопку 🤖' : 'клавишу G') + ' — тренер качает братву сам.');
  }
  // репеллент выветривается от шагов
  if (G.repelSteps > 0) {
    G.repelSteps--;
    if (G.repelSteps === 0) toast('🚫 Репеллент выветрился — дикие снова наседают!');
  }
  // яйцо зреет от шагов
  if (G.egg) {
    if (G.egg.steps > 0) {
      G.egg.steps--;
      if (G.egg.steps === 0) toast('🥚 Яйцо вот-вот вылупится!');
    }
    if (G.egg.steps <= 0) hatchEgg();
  }
  // предмет
  const ik = tx + ',' + ty;
  if (World.itemAt(tx, ty) && !G.picked.has(ik)) {
    G.picked.add(ik);
    // чем дальше от старта, тем ценнее находка
    const lootLvl = World.levelAt(tx, ty);
    if (lootLvl >= 55 && Math.random() < 0.35) {
      G.balls.bro++;
      toast('Найдена 🟣 братская сфера!');
    } else if (lootLvl >= 30 && Math.random() < 0.4) {
      G.balls.strong += 2;
      toast('Найдено 2 🔷 крепких сферы!');
    } else {
      G.balls.basic += 3;
      toast('Найдено 3 сферы ловли!');
    }
    sfx('pickup');
    updateHUD();
    saveGame();
  }
  // сёрфинг: первый заплыв
  if (World.tileAt(tx, ty) === T.WATER && !G.stats.surfed) {
    G.stats.surfed = 1;
    toast('🌊 Ты плывёшь на братишке! На воде водится своя живность.');
  }
  // легендарное святилище
  if (World.shrineAt(tx, ty) && !G.usedShrines.has(ik) && G.party.some(m => m.hp > 0)) {
    G.usedShrines.add(ik);
    startWildBattle(tx, ty, 'shrine');
    return;
  }
  // гнездо редкого монстра — гарантированная встреча
  if (World.nestAt(tx, ty) && !G.usedNests.has(ik) && G.party.some(m => m.hp > 0)) {
    G.usedNests.add(ik);
    G.stats.nests++;
    startWildBattle(tx, ty, 'nest');
    return;
  }
  // дикая встреча (ночью чаще)
  if (G.graceSteps > 0) { G.graceSteps--; return; }
  if (G.repelSteps > 0) return; // репеллент: случайные дикие не лезут (святилища/гнёзда выше — их не глушит)
  let chance = ENCOUNTER_CHANCE[World.tileAt(tx, ty)];
  if (chance && G.phase === 'night') chance *= 1.3;
  if (chance && NZ()) chance *= 0.3;   // Nuzlocke: реже случайные бои
  if (chance && Math.random() < chance && G.party.some(m => m.hp > 0)) {
    startWildBattle(tx, ty);
  }
}

// ===== Обмен с другом (асинхронный трейд по кодам, 3 шага) =====
// 1) А создаёт оферту (свой монстрик уходит в эскроу) -> код другу
// 2) Б отвечает своим монстриком (тоже эскроу, ничего пока не получает) -> код обратно
// 3) А подтверждает: получает монстрика Б, эскроу списан -> финальный код
// 4) Б вводит финальный код: игра сверяет, что внутри обещанный монстрик, и выдаёт его

const TRADE_SALT = 'MW-TRADE-v1-7f3a9c';

function tradeChecksum(s) {
  const h = (strSeed(s + TRADE_SALT) ^ strSeed(TRADE_SALT + s + s.length)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

function tradeEncode(payload) {
  const json = JSON.stringify(payload);
  return 'MWT1.' + btoa(unescape(encodeURIComponent(json))) + '.' + tradeChecksum(json);
}

function tradeDecode(code) {
  // лимит длины до дорогого atob/JSON.parse: честный код обмена/PvP с 6
  // кастомными спрайтами (~12КБ каждый) не превышает ~200КБ; всё крупнее —
  // вставка-DoS, отбрасываем сразу
  if (typeof code !== 'string' || code.length > 300000) return null;
  const parts = code.trim().split('.');
  if (parts.length !== 3 || parts[0] !== 'MWT1') return null;
  let json;
  try { json = decodeURIComponent(escape(atob(parts[1]))); } catch (e) { return null; }
  if (tradeChecksum(json) !== parts[2]) return null;
  try {
    const p = JSON.parse(json);
    if (!p || !p.kind) return null;
    if (['offer', 'accept', 'final'].includes(p.kind)) return (p.offerId && p.mon) ? p : null;
    if (['pvpc', 'pvpr'].includes(p.kind)) {
      return (p.pvpId && p.nonce && Array.isArray(p.team) && p.team.length >= 1 && p.team.length <= 6) ? p : null;
    }
    return null;
  } catch (e) { return null; }
}

function tradeMonDump(m) {
  return {
    speciesSeed: m.speciesSeed, stage: m.stage, level: m.level, exp: m.exp,
    shiny: !!m.shiny, mega: !!m.mega, nick: m.nick || null,
    customSprite: m.customSprite || null,   // едет к другу; в публичный пул не попадает (воркер отбрасывает)
    palette: m.palette || null,             // окрас заказного братишки
    moves: m.moves.map(mv => ({ name: mv.name, type: mv.type, power: mv.power, acc: mv.acc, maxPp: mv.maxPp })),
  };
}

// Восстановление чужого монстрика с жёсткой валидацией: статы всегда
// пересчитываются из вида, так что «нарисовать» себе имбу в коде нельзя
function tradeMonRevive(md) {
  const seed = md.speciesSeed >>> 0;
  const sp = getSpecies(seed);
  const stage = clamp(md.stage | 0, 0, sp.chainLen - 1);
  const level = clamp(md.level | 0, 1, LEVEL_CAP);
  const m = makeMonster(seed, stage, level);
  m.shiny = !!md.shiny;
  // мега засчитывается только тому, кто её реально мог получить
  m.mega = !!md.mega && stage === sp.chainLen - 1 && level >= MEGA_LEVEL;
  m.nick = safeNick(md.nick);
  m.customSprite = validCustomSprite(md.customSprite);
  m.palette = validPalette(md.palette);
  m.exp = clamp(md.exp | 0, 0, expToNext(level) - 1);
  if (Array.isArray(md.moves) && md.moves.length) {
    m.moves = md.moves.slice(0, 4).map(mv => {
      const power = clamp(mv.power | 0, 20, 115);
      const maxPp = clamp((mv.maxPp | 0) || ppForPower(power), 4, 20);
      return {
        name: safeMoveName(mv.name),
        type: TYPE_LIST.includes(mv.type) ? mv.type : 'normal',
        power,
        acc: clamp(mv.acc | 0, 60, 100),
        pp: maxPp, maxPp,
      };
    });
  }
  recalcStats(m);
  m.hp = m.maxHp;
  return m;
}

function tradeMonHash(md) { return tradeChecksum(JSON.stringify(md)); }

// Эскроу: изъять монстрика из команды или хранилища (амулет возвращается в сумку)
function tradeEscrow(src, idx) {
  const arr = src === 'store' ? G.storage : G.party;
  const m = arr[idx];
  if (m.charm) { G.charms[m.charm]++; m.charm = null; recalcStats(m); }
  arr.splice(idx, 1);
  return m;
}

// Полученный монстрик идёт в команду, при полной — в хранилище.
// Здесь же гарантия братопедии: всё полученное сразу «поймано»
function tradeReceive(received) {
  dexCaught(received);
  if (G.party.length < 6) { G.party.push(received); return 'party'; }
  G.storage.push(received);
  return 'store';
}

function tradeMakeOffer(src, idx) {
  if (G.tradeOut) return { err: 'У тебя уже есть активное предложение — отмени его или заверши обмен.' };
  if (src === 'party' && G.party.length < 2) return { err: 'Нельзя предложить последнего братишку из братвы.' };
  const arr = src === 'store' ? G.storage : G.party;
  if (!arr[idx]) return { err: 'Нет такого братишки.' };
  const m = tradeEscrow(src, idx);
  const offerId = (hash2u((Math.random() * 1e9) | 0, (Math.random() * 1e9) | 0, Date.now() & 0xffffffff) >>> 0).toString(16);
  const dump = tradeMonDump(m);
  G.tradeOut = { offerId, mon: dump };
  saveGame();
  return { code: tradeEncode({ v: 1, kind: 'offer', offerId, mon: dump }) };
}

function tradeAcceptOffer(payload, src, giveIdx) {
  if (G.tradeIn) return { err: 'Ты уже отвечаешь на другое предложение — сначала заверши или отмени его.' };
  if (G.usedTrades.has(payload.offerId)) return { err: 'Эта сделка уже была завершена.' };
  if (G.tradeOut && G.tradeOut.offerId === payload.offerId) return { err: 'Это твоё же предложение!' };
  if (src === 'party' && G.party.length < 2) return { err: 'Нельзя отдать последнего братишку из братвы.' };
  const arr = src === 'store' ? G.storage : G.party;
  if (!arr[giveIdx]) return { err: 'Нет такого братишки.' };
  const m = tradeEscrow(src, giveIdx);
  const dump = tradeMonDump(m);
  G.tradeIn = {
    offerId: payload.offerId,
    mon: dump,
    expectHash: tradeMonHash(payload.mon),
    expectMon: payload.mon,
  };
  saveGame();
  return { code: tradeEncode({ v: 1, kind: 'accept', offerId: payload.offerId, mon: dump }) };
}

function tradeCompleteOffer(payload) {
  if (!G.tradeOut || G.tradeOut.offerId !== payload.offerId) return { err: 'Этот код-ответ не подходит к твоему активному предложению.' };
  const received = tradeMonRevive(payload.mon);
  const dest = tradeReceive(received);
  dexCaught(received);
  const finalCode = tradeEncode({ v: 1, kind: 'final', offerId: payload.offerId, mon: G.tradeOut.mon });
  G.usedTrades.add(payload.offerId);
  G.tradeOut = null;
  G.stats.friendTrades++;
  updateHUD();
  saveGame();
  return { code: finalCode, received, dest };
}

function tradeFinalize(payload) {
  if (!G.tradeIn || G.tradeIn.offerId !== payload.offerId) return { err: 'Этот финальный код не подходит к твоему текущему обмену.' };
  if (tradeMonHash(payload.mon) !== G.tradeIn.expectHash) return { err: 'Обман! В коде не тот братишка, что был обещан в предложении.' };
  const received = tradeMonRevive(payload.mon);
  const dest = tradeReceive(received);
  dexCaught(received);
  G.usedTrades.add(payload.offerId);
  G.tradeIn = null;
  G.stats.friendTrades++;
  updateHUD();
  saveGame();
  return { received, dest };
}

// ---------- UI обмена ----------

function toggleFriendPanel() {
  if (NZ()) { toast('☠️ Nuzlocke: обмены и PvP закрыты.'); return; }
  const panel = document.getElementById('friend-panel');
  if (G.state === 'friend') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'friend';
  renderFriendPanel();
  panel.classList.remove('hidden');
}

function friendError(msg) {
  document.getElementById('friend-error').textContent = msg || '';
}

// Компактная строка монстрика для обмена: спрайт, имя, уровень, тип
function friendMonRow(md, extraHtml) {
  const temp = tradeMonRevive(md);
  const row = document.createElement('div');
  row.className = 'prow';
  row.appendChild(monMiniCanvas(temp, 28));
  const t = TYPE_INFO[monType(temp)];
  const info = document.createElement('div');
  info.className = 'info';
  info.innerHTML = '<span class="nm">' + (temp.shiny ? '✨' : '') + monName(temp) + '</span> Ур.' + temp.level +
    ' <span style="color:' + t.color + '">' + t.ru + '</span>' +
    (extraHtml || '');
  row.appendChild(info);
  return row;
}

function friendShowCode(title, code) {
  const main = document.getElementById('friend-main');
  const box = document.createElement('div');
  box.style.cssText = 'display:flex;flex-direction:column;gap:6px;align-items:center;';
  box.innerHTML = '<b style="color:var(--ui-accent)">' + title + '</b>';
  const ta = document.createElement('textarea');
  ta.readOnly = true;
  ta.value = code;
  ta.style.cssText = 'width:580px;height:70px;background:#111;color:#8f8;border:2px solid var(--ui-accent);border-radius:4px;padding:6px;font-family:inherit;font-size:11px;';
  box.appendChild(ta);
  const btn = document.createElement('button');
  btn.textContent = '📋 Скопировать';
  btn.onclick = () => {
    ta.select();
    try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand('copy'); }
    toast('Код скопирован — отправь его другу!');
  };
  box.appendChild(btn);
  main.appendChild(box);
}

function renderFriendPanel() {
  friendError('');
  const status = document.getElementById('friend-status');
  const main = document.getElementById('friend-main');
  status.innerHTML = '';
  main.innerHTML = '';
  document.getElementById('friend-code-in').value = '';

  if (!G.tradeOut && !G.tradeIn) {
    status.innerHTML = '<span style="opacity:.75;font-size:13px;max-width:600px;">Обменивайся братишками с другом на другой машине: создай предложение и отправь код,<br>или вставь код друга ниже. Сделка идёт в 3 шага — никто не рискует остаться ни с чем.</span>';
  }
  if (G.tradeOut) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<b style="color:var(--ui-accent)">📤 Ты предлагаешь:</b>';
    const row = friendMonRow(G.tradeOut.mon);
    const cancel = document.createElement('button');
    cancel.textContent = 'Отменить';
    cancel.onclick = () => {
      if (!confirm('Отменить предложение и вернуть братишку? Делай это только если друг ещё НЕ ответил на него.')) return;
      tradeReceive(tradeMonRevive(G.tradeOut.mon));
      G.tradeOut = null;
      renderFriendPanel();
      updateHUD(); saveGame();
    };
    row.appendChild(cancel);
    wrap.appendChild(row);
    status.appendChild(wrap);
  }
  if (G.tradeIn) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<b style="color:var(--ui-accent)">📥 Ты отдаёшь (ждёшь финальный код):</b>';
    const row = friendMonRow(G.tradeIn.mon);
    const cancel = document.createElement('button');
    cancel.textContent = 'Отменить';
    cancel.onclick = () => {
      if (!confirm('ВНИМАНИЕ: отменяй только если сделка сорвалась и друг НЕ вводил твой код-ответ.\nЕсли он его ввёл — честно доведи обмен до конца. Отменить?')) return;
      tradeReceive(tradeMonRevive(G.tradeIn.mon));
      G.tradeIn = null;
      renderFriendPanel();
      updateHUD(); saveGame();
    };
    row.appendChild(cancel);
    wrap.appendChild(row);
    const expect = document.createElement('div');
    expect.innerHTML = '<b style="opacity:.8">Взамен обещан:</b>';
    expect.appendChild(friendMonRow(G.tradeIn.expectMon));
    wrap.appendChild(expect);
    status.appendChild(wrap);
  }
}

// Все монстрики игрока: команда + хранилище
function allMons() {
  const out = [];
  G.party.forEach((m, idx) => out.push({ m, src: 'party', idx, label: '' }));
  G.storage.forEach((m, idx) => out.push({ m, src: 'store', idx, label: ' <span style="opacity:.6">📦</span>' }));
  return out;
}

function friendMonList(main, btnText, onPick) {
  allMons().forEach(entry => {
    const row = friendMonRow(tradeMonDump(entry.m), entry.label);
    const btn = document.createElement('button');
    btn.textContent = btnText;
    btn.onclick = () => onPick(entry);
    row.appendChild(btn);
    main.appendChild(row);
  });
}

function friendOfferFlow() {
  friendError('');
  const main = document.getElementById('friend-main');
  main.innerHTML = '';
  if (G.tradeOut) { friendError('У тебя уже есть активное предложение.'); return; }
  const title = document.createElement('b');
  title.style.color = 'var(--ui-accent)';
  title.textContent = 'Кого предложить другу? (📦 — из кармана)';
  main.appendChild(title);
  friendMonList(main, 'Предложить', entry => {
    const r = tradeMakeOffer(entry.src, entry.idx);
    if (r.err) { friendError(r.err); return; }
    renderFriendPanel();
    friendShowCode('Код-предложение — отправь другу:', r.code);
    updateHUD();
  });
}

function friendProcessCode() {
  friendError('');
  const main = document.getElementById('friend-main');
  const payload = tradeDecode(document.getElementById('friend-code-in').value);
  if (!payload) { friendError('Код не распознан: проверь, что скопирован целиком и без изменений.'); return; }
  main.innerHTML = '';

  if (payload.kind === 'pvpc') { pvpAnswerFlow(payload); return; }
  if (payload.kind === 'pvpr') { pvpFinishFlow(payload); return; }

  if (payload.kind === 'offer') {
    if (G.usedTrades.has(payload.offerId)) { friendError('Эта сделка уже была завершена.'); return; }
    if (G.tradeOut && G.tradeOut.offerId === payload.offerId) { friendError('Это твоё же предложение!'); return; }
    if (G.tradeIn) { friendError('Сначала заверши текущий обмен (жди финальный код) или отмени его.'); return; }
    const title = document.createElement('b');
    title.style.color = 'var(--ui-accent)';
    title.textContent = 'Друг предлагает:';
    main.appendChild(title);
    main.appendChild(friendMonRow(payload.mon));
    const pick = document.createElement('b');
    pick.textContent = 'Кого отдать взамен? (📦 — из кармана)';
    main.appendChild(pick);
    friendMonList(main, 'Отдать', entry => {
      const r = tradeAcceptOffer(payload, entry.src, entry.idx);
      if (r.err) { friendError(r.err); return; }
      renderFriendPanel();
      friendShowCode('Код-ответ — отправь другу (взамен он пришлёт финальный код):', r.code);
      updateHUD();
    });
    return;
  }

  if (payload.kind === 'accept') {
    if (!G.tradeOut || G.tradeOut.offerId !== payload.offerId) { friendError('Этот код-ответ не подходит к твоему активному предложению.'); return; }
    const title = document.createElement('b');
    title.style.color = 'var(--ui-accent)';
    title.textContent = 'Друг отдаёт взамен:';
    main.appendChild(title);
    main.appendChild(friendMonRow(payload.mon));
    const btn = document.createElement('button');
    btn.textContent = '✅ Подтвердить обмен';
    btn.onclick = () => {
      const r = tradeCompleteOffer(payload);
      if (r.err) { friendError(r.err); return; }
      sfx('catch');
      toast('🤝 Обмен! ' + monName(r.received) + (r.dest === 'store' ? ' ждёт в кармане' + keyHint('B') + '.' : ' теперь с тобой.'));
      renderFriendPanel();
      friendShowCode('Финальный код — ОБЯЗАТЕЛЬНО отправь другу, иначе он не получит братишку:', r.code);
    };
    main.appendChild(btn);
    return;
  }

  // final
  const r = tradeFinalize(payload);
  if (r.err) { friendError(r.err); return; }
  sfx('catch');
  toast('🤝 Обмен завершён! ' + monName(r.received) + (r.dest === 'store' ? ' ждёт в кармане' + keyHint('B') + '.' : ' теперь с тобой.'));
  renderFriendPanel();
  const done = document.createElement('b');
  done.style.color = 'var(--ui-accent)';
  done.textContent = '🎉 Сделка закрыта — ты получил:';
  main.appendChild(done);
  main.appendChild(friendMonRow(tradeMonDump(r.received)));
}

// ===== Общак =====

function toggleStorage() {
  const panel = document.getElementById('storage-panel');
  if (G.state === 'storage') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state === 'party') {
    document.getElementById('party-panel').classList.add('hidden');
    G.state = 'world';
  }
  if (G.state !== 'world') return;
  G.state = 'storage';
  renderStorage();
  panel.classList.remove('hidden');
}

function storageWithdraw(i) {
  if (G.party.length >= 6) { toast('Братва в полном составе!'); return false; }
  const m = G.storage.splice(i, 1)[0];
  if (m) G.party.push(m);
  updateHUD(); saveGame();
  return true;
}

function storageDeposit(partyIdx) {
  if (G.party.length < 2) { toast('Нельзя убрать последнего братишку!'); return false; }
  const m = G.party.splice(partyIdx, 1)[0];
  if (m) {
    if (m.charm) { G.charms[m.charm]++; m.charm = null; recalcStats(m); }
    G.storage.push(m);
  }
  updateHUD(); saveGame();
  return true;
}

function storageRelease(i) {
  const m = G.storage[i];
  if (!m) return false;
  if (!confirm('Отпустить ' + monName(m) + ' насовсем?')) return false;
  G.storage.splice(i, 1);
  updateHUD(); saveGame();
  return true;
}

// Сортировка кармана: отображение сортируется, сам G.storage не трогаем
// (индексы в нём используют питомник/обмены). Выбор живёт в localStorage.
const BOX_SORTS = [
  { id: 'date', label: 'Дата', val: null },
  { id: 'level', label: 'Ур.', val: m => m.level },
  { id: 'hp', label: 'ОЗ', val: m => m.maxHp },
  { id: 'atk', label: 'АТК', val: m => m.atk },
  { id: 'def', label: 'ЗАЩ', val: m => m.def },
  { id: 'spd', label: 'СКР', val: m => m.spd },
  { id: 'pow', label: '💪 Мощь', val: m => monPotential(m) },
];
let boxSort = localStorage.getItem('mw-box-sort') || 'date';
let boxSortAsc = (localStorage.getItem('mw-box-sort-asc') ?? '1') === '1';
let _nzStorageTab = 'box';

function renderStorage() {
  const tabs = document.getElementById('storage-tabs');
  tabs.innerHTML = '';
  if (NZ()) {
    for (const [id, label] of [['box', '📦 Карман'], ['grave', '⚰️ Кладбище (' + G.nz.graveyard.length + ')']]) {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.opacity = _nzStorageTab === id ? '1' : '.55';
      b.onclick = () => { _nzStorageTab = id; renderStorage(); };
      tabs.appendChild(b);
    }
    if (_nzStorageTab === 'grave') { nzRenderGraveyard(); return; }
  } else { _nzStorageTab = 'box'; }
  document.getElementById('storage-info').textContent =
    G.storage.length ? 'В кармане: ' + G.storage.length + '. Отсюда можно брать в братву, для яиц и обменов.' :
    'Пусто. Сюда попадают пойманные при полной братве — и кого сам уберёшь из братвы.';

  const sortBar = document.getElementById('storage-sort');
  sortBar.innerHTML = '';
  if (G.storage.length > 1) {
    for (const s of BOX_SORTS) {
      const b = document.createElement('button');
      b.textContent = s.label + (s.id === boxSort ? (boxSortAsc ? ' ▲' : ' ▼') : '');
      b.style.cssText = 'font-size:12px;padding:6px 10px;';
      if (s.id === boxSort) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
      b.onclick = () => {
        if (boxSort === s.id) boxSortAsc = !boxSortAsc;
        else { boxSort = s.id; boxSortAsc = s.id === 'date'; } // дата — по умолчанию старые сверху, статы — сильные сверху
        localStorage.setItem('mw-box-sort', boxSort);
        localStorage.setItem('mw-box-sort-asc', boxSortAsc ? '1' : '0');
        renderStorage();
      };
      sortBar.appendChild(b);
    }
  }

  const entries = G.storage.map((m, i) => ({ m, i }));
  const sd = BOX_SORTS.find(s => s.id === boxSort) || BOX_SORTS[0];
  const dir = boxSortAsc ? 1 : -1;
  entries.sort((a, b) => (sd.val ? (sd.val(a.m) - sd.val(b.m)) * dir : (a.i - b.i) * dir) || a.i - b.i);

  const rows = document.getElementById('storage-rows');
  rows.innerHTML = '';
  entries.forEach(({ m, i }) => {
    const st = getSpecies(m.speciesSeed).stages[m.stage];
    const t = TYPE_INFO[st.type];
    const row = document.createElement('div');
    row.className = 'prow';
    row.appendChild(monMiniCanvas(m, 28));
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">' + (m.shiny ? '✨' : '') + monName(m) + '</span> Ур.' + m.level +
      ' <span style="color:' + t.color + '">' + t.ru + '</span>' +
      '<div style="opacity:.75;font-size:11px">ОЗ ' + m.maxHp + ' · АТК ' + m.atk + ' · ЗАЩ ' + m.def + ' · СКР ' + m.spd +
      ' · 💪 ' + monPotential(m) + '</div>';
    row.appendChild(info);
    const bTake = document.createElement('button');
    bTake.textContent = 'В братву';
    bTake.disabled = G.party.length >= 6;
    bTake.onclick = () => { storageWithdraw(i); renderStorage(); };
    row.appendChild(bTake);
    const bRel = document.createElement('button');
    bRel.textContent = 'Отпустить';
    bRel.onclick = () => { if (storageRelease(i)) renderStorage(); };
    row.appendChild(bRel);
    rows.appendChild(row);
  });
}

// ===== Питомник =====

function hatchEgg() {
  const egg = G.egg;
  const baby = makeMonster(egg.speciesSeed, 0, 3);
  if (egg.shiny) {
    baby.shiny = true;
    recalcStats(baby);
    baby.hp = baby.maxHp;
  }
  // наследование атаки родителя
  if (egg.inherit && !baby.moves.some(mv => mv.name === egg.inherit.name)) {
    if (baby.moves.length >= 4) baby.moves.pop();
    baby.moves.push(moveInstance(egg.inherit));
  }
  const dest = tradeReceive(baby);
  dexCaught(baby);
  G.egg = null;
  G.stats.eggsHatched++;
  sfx('catch');
  toast('🐣 Из яйца вылупился ' + (baby.shiny ? '✨' : '') + monName(baby) +
    (dest === 'store' ? '! Он ждёт в кармане' + keyHint('B') + '.' : '!'));
  updateHUD();
  saveGame();
}

function openNursery() {
  if (G.state !== 'world') return;
  if (G.egg) { toast('🥚 Питомник: «Сначала выноси текущее яйцо! Осталось шагов: ' + G.egg.steps + '»'); return; }
  if (G.party.length + G.storage.length < 2) { toast('🥚 Питомник: «Приходи с двумя братишками!»'); return; }
  G.state = 'nursery';
  renderNursery([]);
  document.getElementById('nursery-panel').classList.remove('hidden');
}

function renderNursery(picked) {
  const mons = allMons();
  const info = document.getElementById('nursery-info');
  info.innerHTML = picked.length === 0
    ? '<div style="font-size:12px;opacity:.85;max-width:520px;line-height:1.5;margin-bottom:6px">' +
      'Два родителя → яйцо за 500₴. Вид яйца — случайного родителя (50/50), ' +
      'малыш наследует одно случайное умение одного из родителей. ' +
      'Шанс ✨сияющего: 1/32, с сияющим родителем — 1/8. Вылупится через 300 шагов.</div>' +
      'Выбери <b>первого</b> родителя (📦 — из кармана):'
    : 'Выбери <b>второго</b> родителя. Первый: <b style="color:var(--ui-accent)">' + monName(mons[picked[0]].m) + '</b>';
  const rows = document.getElementById('nursery-rows');
  rows.innerHTML = '';
  mons.forEach((entry, i) => {
    if (picked.includes(i)) return;
    const m = entry.m;
    const row = document.createElement('div');
    row.className = 'srow';
    const inf = document.createElement('div');
    inf.className = 'info';
    const t = TYPE_INFO[monType(m)];
    inf.innerHTML = '<span class="nm">' + (m.shiny ? '✨' : '') + monName(m) + '</span> Ур.' + m.level +
      ' <span style="color:' + t.color + '">' + t.ru + '</span>' + entry.label;
    row.appendChild(inf);
    const btn = document.createElement('button');
    btn.textContent = 'Выбрать';
    btn.onclick = () => {
      if (picked.length === 0) { renderNursery([i]); return; }
      if (G.money < 500) { toast('Не хватает денег (нужно 500₴).'); return; }
      G.money -= 500;
      const pa = mons[picked[0]].m, pb = m;
      const donor = Math.random() < 0.5 ? pa : pb;
      const other = donor === pa ? pb : pa;
      const inheritFrom = Math.random() < 0.5 ? pa : pb;
      G.egg = {
        speciesSeed: donor.speciesSeed,
        shiny: Math.random() < ((pa.shiny || pb.shiny) ? 1 / 8 : 1 / 32),
        steps: 300,
        inherit: inheritFrom.moves.length ? moveInstance(inheritFrom.moves[Math.floor(Math.random() * inheritFrom.moves.length)]) : null,
        from: [monName(pa), monName(pb)],
      };
      closeNursery();
      sfx('heal');
      toast('🥚 Питомник выдал яйцо (' + monSpeciesName(donor) + ')! Гуляй — вылупится через 300 шагов.');
      updateHUD();
      saveGame();
    };
    row.appendChild(btn);
    rows.appendChild(row);
  });
}

function closeNursery() {
  document.getElementById('nursery-panel').classList.add('hidden');
  G.state = 'world';
}

// ===== Доска заданий =====

function makeBoardOffer(boardId) {
  const tb = Math.floor(G.clock / 300); // предложение меняется каждые 5 минут
  // сид включает число сданных заданий: после каждой сдачи доска предлагает НОВОЕ
  // (раньше одно и то же «победи 2 тренеров» висело вечно и фармилось на 8к)
  const rng = mulberry32(hash2u(strSeed(boardId), tb + G.stats.quests * 7919, G.seed ^ 0xB0A2D));
  const lvl = World.levelAt(Math.floor(G.player.x), Math.floor(G.player.y));
  const kinds = ['catch', 'trainer', 'wild', 'catchany', 'tower'];
  if (G.bag.rod) kinds.push('fish'); // рыбалка — только владельцам удочки
  const kind = pick(rng, kinds);
  // база ×0.6 (анти-фарм), повтор того же вида подряд — ещё ×0.5
  let reward = Math.round((300 + lvl * 25) * 0.6);
  const repeat = kind === G.lastQuestKind;
  if (repeat) reward = Math.round(reward * 0.5);
  const q = { kind, progress: 0, reward, repeat, bonus: rng() < 0.5 ? 'scroll' : 'ether' };
  if (kind === 'catch') {
    q.param = pick(rng, TYPE_LIST);
    q.need = 1;
    q.text = 'Поймай братишку типа «' + TYPE_INFO[q.param].ru + '»';
  } else if (kind === 'trainer') {
    q.need = irange(rng, 2, 3);
    q.text = 'Победи ' + q.need + ' тренеров';
  } else if (kind === 'catchany') {
    q.need = irange(rng, 2, 3);
    q.text = 'Поймай ' + q.need + ' любых братишек';
  } else if (kind === 'tower') {
    q.need = irange(rng, 3, 5);
    q.text = 'Пройди ' + q.need + (q.need >= 5 ? ' этажей' : ' этажа') + ' башни испытаний';
  } else if (kind === 'fish') {
    q.need = 1;
    q.text = 'Выуди братишку рыбалкой';
  } else {
    q.need = irange(rng, 3, 5);
    q.text = 'Выиграй ' + q.need + ' боёв с дикими';
  }
  return q;
}

function openBoard(tx, ty) {
  if (G.state !== 'world') return;
  G.state = 'board';
  const panel = document.getElementById('board-panel');
  const info = document.getElementById('board-info');
  const actions = document.getElementById('board-actions');
  actions.innerHTML = '';
  if (G.quest) {
    info.innerHTML = '📋 Текущее задание:<br><b>' + G.quest.text + '</b><br>Прогресс: ' +
      G.quest.progress + '/' + G.quest.need + '<br>Награда: ' + G.quest.reward + '₴ + ' +
      (G.quest.bonus === 'scroll' ? 'свиток' : 'эфир');
    const drop = document.createElement('button');
    drop.textContent = 'Бросить задание';
    drop.onclick = () => { G.quest = null; closeBoard(); toast('Задание брошено.'); saveGame(); };
    actions.appendChild(drop);
  } else {
    const offer = makeBoardOffer('B' + Math.floor(tx / 12) + ',' + Math.floor(ty / 12));
    info.innerHTML = '📋 Объявление:<br><b>' + offer.text + '</b><br>Награда: ' + offer.reward + '₴ + ' +
      (offer.bonus === 'scroll' ? 'свиток умения' : 'эфир') +
      (offer.repeat ? '<br><span style="opacity:.65;font-size:12px">🔁 повтор прошлого вида — награда вдвое меньше</span>' : '');
    const acc = document.createElement('button');
    acc.textContent = 'Принять';
    acc.onclick = () => {
      G.quest = offer;
      closeBoard();
      toast('📋 Задание принято: ' + offer.text);
      updateHUD();
      saveGame();
    };
    actions.appendChild(acc);
  }
  panel.classList.remove('hidden');
}

function closeBoard() {
  document.getElementById('board-panel').classList.add('hidden');
  G.state = 'world';
}

// ===== Рыбалка =====

function tryFishing() {
  if (G.state !== 'world') return;
  if (!G.bag.rod) { hint('rod', '🎣 Нужна удочка — продаётся в лавке.'); return; }
  const px = Math.floor(G.player.x), py = Math.floor(G.player.y);
  const spots = [[px + 1, py], [px - 1, py], [px, py + 1], [px, py - 1]];
  const water = spots.find(([x, y]) => World.tileAt(x, y) === T.WATER);
  if (!water) { toast('🎣 Здесь не порыбачишь — нужна вода рядом.'); return; }
  G.state = 'fishing';
  toast('🎣 Поплавок дрожит...');
  setTimeout(() => {
    if (G.state !== 'fishing') return;
    if (Math.random() < 0.7) {
      G.stats.fished++;
      G.state = 'world';
      startWildBattle(water[0], water[1], 'fish');
    } else {
      G.balls.basic++;
      sfx('pickup');
      toast('Сорвалось! Но на крючке блеснула сфера (+1).');
      G.state = 'world';
      updateHUD();
    }
  }, 1100);
}

// ===== Автокач (премиум grindUnlocked): тренер сам бегает по дикой зоне =====
// Бои идут автобоем (setAuto(true) при старте), ловли нет — только кач.
// Стоп: игрок тронул управление, вышли из зоны (телепорт), братва откисла.

// Группы «своей» зоны: бегаем только по тайлам стартовой группы, в города не заходим
const GRIND_ZONES = [
  new Set([T.WATER]),
  new Set([T.GRASS, T.TALL, T.FLOWER]),
  new Set([T.SNOW, T.SNOWTALL]),
  new Set([T.DESERT, T.DESERTTALL]),
];

let GRIND_ON = false;
let _grindZone = null;
let _grindDir = { x: 0, y: 0 };
let _grindDirT = 0;
let _grindLastPos = { x: 0, y: 0, t: 0 };

function grindZoneAt(tx, ty) {
  if (World.cityInfoAt(tx, ty)) return null;
  const t = World.tileAt(tx, ty);
  return GRIND_ZONES.find(z => z.has(t)) || null;
}

function setGrind(v, silent) {
  if (v && NZ()) { toast('☠️ Nuzlocke: качаться придётся руками.'); return; }
  if (v && !GRIND_ON) {
    if (typeof grindUnlocked === 'undefined' || !grindUnlocked) return;
    const zone = grindZoneAt(Math.floor(G.player.x), Math.floor(G.player.y));
    if (!zone) { toast('🤖 Автокач работает в дикой зоне: высокая трава, вода, снег, пустыня.'); return; }
    _grindZone = zone;
    _grindDirT = 0;
    _grindLastPos = { x: G.player.x, y: G.player.y, t: 0 };
    GRIND_ON = true;
    Battle.setAuto(true); // кач — только автобоем
    toast('🤖 Автокач включён! Тронь управление — остановится.');
  } else if (!v && GRIND_ON) {
    GRIND_ON = false;
    if (!silent) toast('🤖 Автокач выключен.');
  }
  const b = document.getElementById('t-grind');
  if (b) b.classList.toggle('on', GRIND_ON);
}

// Куда бежать: держимся стартовой зоны, у препятствий и на границе меняем курс
function grindVector(dt) {
  const p = G.player;
  // выпали из зоны (телепорт, панель, край) — стоп
  if (grindZoneAt(Math.floor(p.x), Math.floor(p.y)) !== _grindZone) {
    setGrind(false);
    return { x: 0, y: 0 };
  }
  _grindDirT -= dt;
  // застряли на месте — перевыбрать курс
  _grindLastPos.t += dt;
  if (_grindLastPos.t > 0.5) {
    if (Math.hypot(p.x - _grindLastPos.x, p.y - _grindLastPos.y) < 0.15) _grindDirT = 0;
    _grindLastPos.x = p.x; _grindLastPos.y = p.y; _grindLastPos.t = 0;
  }
  const ahead = (d, dist) => grindZoneAt(Math.floor(p.x + d.x * dist), Math.floor(p.y + d.y * dist));
  if (_grindDirT > 0 && ahead(_grindDir, 1.2) === _grindZone) return _grindDir;
  // перевыбор: случайное направление, которое держит в зоне и не упирается в стену
  const dirs = [];
  for (let i = 0; i < 8; i++) { const a = Math.PI * 2 * i / 8; dirs.push({ x: Math.cos(a), y: Math.sin(a) }); }
  for (let i = dirs.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = dirs[i]; dirs[i] = dirs[j]; dirs[j] = t; }
  for (const d of dirs) {
    if (ahead(d, 1.4) === _grindZone && ahead(d, 0.8) === _grindZone) {
      _grindDir = d;
      _grindDirT = 0.8 + Math.random() * 1.2;
      return d;
    }
  }
  _grindDirT = 0.4; // некуда идти — постоим и попробуем снова
  return { x: 0, y: 0 };
}

// ===== Движение и цикл =====

function step(dt) {
  if (G.state !== 'world') return;
  if (G.bumpCooldown > 0) G.bumpCooldown -= dt;

  // ход времени и погода
  G.clock += dt;
  const newPhase = calcPhase();
  const newWeather = World.weatherAt(Math.floor(G.player.x), Math.floor(G.player.y), G.clock);
  if (newPhase !== G.phase || newWeather !== G.weather) {
    // в холодном климате те же осадки рисуются снегом — текст не должен врать про дождь
    if (newWeather === 'rain' && G.weather !== 'rain') {
      const coldHere = World.climateAt(Math.floor(G.player.x), Math.floor(G.player.y)) === 'cold';
      toast(coldHere ? '❄️ Начинается снегопад — братва ёжится от холода!' : '☔ Начинается дождь — водная братва оживилась!');
    }
    if (newPhase === 'night' && G.phase !== 'night') toast('🌙 Наступает ночь — в траве шуршат тёмные твари...');
    G.phase = newPhase;
    G.weather = newWeather;
    updateHUD();
  }

  let vx = 0, vy = 0;
  if (typeof joy !== 'undefined' && (joy.x || joy.y)) {
    vx = joy.x; vy = joy.y;
  } else {
    if (keys.has('ArrowLeft') || keys.has('KeyA')) vx -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) vx += 1;
    if (keys.has('ArrowUp') || keys.has('KeyW')) vy -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) vy += 1;
  }
  if (GRIND_ON) {
    if (vx || vy) setGrind(false); // игрок взял управление — автокач гаснет
    else { const gv = grindVector(dt); vx = gv.x; vy = gv.y; }
  }

  const p = G.player;
  const mount = activeMount();
  const speed = (keys.has('Shift') ? 8.6 : 5.2) * (mount ? mount.mult : 1) * (NZ() ? 0.5 : 1);  // Shift — бег, маунт — множитель, NZ — половинная скорость
  p.moving = !!(vx || vy);
  if (p.moving) {
    // спрайт смотрит вдоль доминирующей оси (важно для плавного джойстика)
    if (Math.abs(vx) > Math.abs(vy)) p.dir = vx > 0 ? 'right' : 'left';
    else p.dir = vy > 0 ? 'down' : 'up';
    const len = Math.hypot(vx, vy);
    const dx = vx / len * speed * dt, dy = vy / len * speed * dt;

    // оси по отдельности — скольжение вдоль стен
    let hit = null;
    if (dx) {
      const h = collides(p.x + dx, p.y);
      if (!h) p.x += dx; else hit = h;
    }
    if (dy) {
      const h = collides(p.x, p.y + dy);
      if (!h) p.y += dy; else hit = hit || h;
    }
    // реакция на "бамп"
    if (hit && G.bumpCooldown <= 0) {
      if (hit.kind === 'trainer') {
        G.bumpCooldown = 1;
        startTrainerBattle(hit.trainer);
        return;
      }
      if (hit.kind === 'trader') {
        G.bumpCooldown = 1.2;
        if (NZ()) { toast('☠️ Nuzlocke: обмены запрещены — своя ноша ближе.'); return; }
        openTrade(hit.trader);
        return;
      }
      if (hit.kind === 'master') {
        G.bumpCooldown = 1.2;
        if (G.badges.includes(hit.master.id)) {
          toast(hit.master.name + ': «Ты уже чемпион этой арены!»');
        } else {
          startArenaBattle(hit.master);
        }
        return;
      }
      const bumpTile = World.tileAt(hit.tx, hit.ty);
      if (bumpTile === T.FOUNTAIN) {
        G.bumpCooldown = 1.2;
        healAtFountain(hit.tx, hit.ty);
      } else if (bumpTile === T.SHOP) {
        G.bumpCooldown = 1.2;
        openShop();
      } else if (bumpTile === T.TOWER) {
        G.bumpCooldown = 1.2;
        const tw = World.towerAt(hit.tx, hit.ty);
        if (tw && confirm('🗼 Башня испытаний! Серия боёв без лечения, каждый этаж сильнее. Войти?')) {
          startTowerRun(tw);
          return;
        }
      } else if (bumpTile === T.NURSERY) {
        G.bumpCooldown = 1.2;
        if (NZ()) { toast('☠️ Nuzlocke: питомник закрыт — братва не разводится.'); return; }
        openNursery();
      } else if (bumpTile === T.BOARD) {
        G.bumpCooldown = 1.2;
        openBoard(hit.tx, hit.ty);
      } else if (bumpTile === T.WATER && !canSurf()) {
        G.bumpCooldown = 2.5;
        hint('surf', '🌊 Нужен водный братишка 15+ уровня, чтобы плыть.');
      }
    }

    p.animT += dt;
    if (p.animT > 0.18 / (speed / 5.2)) { p.animT = 0; p.frame = 1 - p.frame; }

    const tk = Math.floor(p.x) + ',' + Math.floor(p.y);
    if (tk !== G.lastTileKey) {
      G.lastTileKey = tk;
      onTileEnter(Math.floor(p.x), Math.floor(p.y));
      updateHUD();
    }
  } else {
    p.frame = 0;
  }

  // ---- спутник: плавно догоняет и держит дистанцию, без дёрганья ----
  const f = G.follower;
  if (f) {
    const fdx = p.x - f.x, fdy = p.y - f.y;
    const dist = Math.hypot(fdx, fdy);
    if (dist > 7) {
      // слишком далеко (телепорт) — мгновенно к игроку
      f.x = p.x; f.y = p.y + 0.4;
      f.moving = false;
    } else if (dist > 1.0) {
      // догоняет тем быстрее, чем дальше отстал; останавливается на дистанции ~1 тайл
      const fs = Math.min(speed * 1.25, speed * (dist - 0.85));
      f.x += fdx / dist * fs * dt;
      f.y += fdy / dist * fs * dt;
      f.moving = true;
      f.bounceT += dt;
    } else {
      f.moving = false;
    }
  }
}

// ===== Рендер =====

let VIEW_W = 30, VIEW_H = 20;

// На мобильном канвас занимает весь экран; логическое разрешение подбирается так,
// чтобы по короткой стороне влезало ~11 тайлов (целочисленный масштаб — чёткие пиксели).
function resizeCanvas() {
  if (!IS_MOBILE) return;
  const vw = window.innerWidth, vh = window.innerHeight;
  const z = Math.max(2, Math.round(Math.min(vw, vh) / 180)); // CSS-пикселей на игровой пиксель
  canvas.width = Math.ceil(vw / z);
  canvas.height = Math.ceil(vh / z);
  canvas.style.width = vw + 'px';
  canvas.style.height = vh + 'px';
  VIEW_W = canvas.width / TILE;
  VIEW_H = canvas.height / TILE;
  if (G.state === 'world' || G.state === 'party') render();
}

// Десктоп: масштабируем игру под окно (960px → до 3x), пиксели остаются чёткими
function applyDesktopZoom() {
  if (IS_MOBILE) return;
  const k = clamp(Math.min(window.innerWidth / 980, window.innerHeight / 660), 1, 3);
  const w = Math.round(960 * k) + 'px';
  document.getElementById('wrap').style.width = w;
  canvas.style.width = w;
}

function initDesktopZoom() {
  if (IS_MOBILE) return;
  applyDesktopZoom();
  window.addEventListener('resize', applyDesktopZoom);
  document.addEventListener('fullscreenchange', applyDesktopZoom);
}

function render() {
  if (!tileAtlas) return;
  ctx.imageSmoothingEnabled = false;
  const p = G.player;
  const camX = p.x - VIEW_W / 2;
  const camY = p.y - VIEW_H / 2;
  const x0 = Math.floor(camX), y0 = Math.floor(camY);
  const x1 = Math.floor(camX + VIEW_W), y1 = Math.floor(camY + VIEW_H);

  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const dx = Math.round((tx - camX) * TILE);
      const dy = Math.round((ty - camY) * TILE);
      drawTile(ctx, World.tileAt(tx, ty), tx, ty, dx, dy, TILE);
      // предмет-сфера
      if (World.itemAt(tx, ty) && !G.picked.has(tx + ',' + ty)) {
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(dx + 6, dy + 5, 4, 4);
        ctx.fillStyle = '#fff6c8';
        ctx.fillRect(dx + 7, dy + 4, 2, 1);
        ctx.fillRect(dx + 7, dy + 9, 2, 1);
        ctx.fillRect(dx + 5, dy + 6, 1, 2);
        ctx.fillRect(dx + 10, dy + 6, 1, 2);
      }
      // тренер
      const tr = World.trainerAt(tx, ty);
      if (tr && !G.defeated.has(tr.id)) {
        const d = hash2u(tx, ty, 0x77) % 4;
        ctx.drawImage(trainerSprite, d * 16, 0, 16, 16, dx, dy - 2, 16, 16);
        // восклицательный знак, если рядом игрок
        if (Math.abs(tx + 0.5 - p.x) < 3 && Math.abs(ty + 0.5 - p.y) < 3) {
          ctx.fillStyle = '#ffd75e';
          ctx.fillRect(dx + 7, dy - 8, 2, 4);
          ctx.fillRect(dx + 7, dy - 3, 2, 1);
        }
      }
      // легендарное святилище — обелиск
      if (World.shrineAt(tx, ty) && !G.usedShrines.has(tx + ',' + ty)) {
        ctx.fillStyle = '#8a8a9a';
        ctx.fillRect(dx + 6, dy - 6, 4, 18);
        ctx.fillStyle = '#b8b8cc';
        ctx.fillRect(dx + 6, dy - 6, 2, 18);
        ctx.fillStyle = '#5a5a6e';
        ctx.fillRect(dx + 4, dy + 10, 8, 3);
        const glow = Math.abs(Math.sin(G.clock * 3));
        ctx.fillStyle = 'rgba(120, 220, 255, ' + (0.5 + glow * 0.5) + ')';
        ctx.fillRect(dx + 7, dy - 2, 2, 2);
      }
      // гнездо редкого монстра
      if (World.nestAt(tx, ty) && !G.usedNests.has(tx + ',' + ty)) {
        ctx.fillStyle = '#e8dcc0';
        ctx.fillRect(dx + 4, dy + 8, 4, 5);
        ctx.fillRect(dx + 9, dy + 9, 3, 4);
        ctx.fillStyle = '#c9b896';
        ctx.fillRect(dx + 5, dy + 9, 1, 1);
        ctx.fillRect(dx + 10, dy + 10, 1, 1);
        ctx.fillStyle = '#6b4a2a';
        ctx.fillRect(dx + 3, dy + 12, 10, 2);
      }
      // обменник (зелёный, с монеткой)
      const trader = World.traderAt(tx, ty);
      if (trader) {
        ctx.drawImage(traderSprite, 0, 0, 16, 16, dx, dy - 2, 16, 16);
        ctx.fillStyle = '#ffd75e';
        ctx.fillRect(dx + 6, dy - 7, 4, 4);
        ctx.fillStyle = '#8f7222';
        ctx.fillRect(dx + 7, dy - 6, 2, 2);
      }
      // мастер арены (золотой, с короной)
      const master = World.arenaMasterAt(tx, ty);
      if (master) {
        ctx.drawImage(masterSprite, 0, 0, 16, 16, dx, dy - 2, 16, 16);
        ctx.fillStyle = G.badges.includes(master.id) ? '#a8a8b0' : '#ffd75e';
        ctx.fillRect(dx + 5, dy - 5, 6, 2);
        ctx.fillRect(dx + 5, dy - 7, 1, 2);
        ctx.fillRect(dx + 8, dy - 7, 1, 2);
        ctx.fillRect(dx + 10, dy - 7, 1, 2);
      }
    }
  }

  // маунт под игроком (водный братишка / братан-лидер / самокат);
  // при таком маунте спутник-мон не бежит рядом — он и есть маунт
  const mount = activeMount();
  const mountMon = mount && mount.mon;  // water/brother используют мона под игроком

  // спутник — первый живой братишка, с подпрыгиванием при ходьбе
  // (прячем, если этот же братишка сейчас служит маунтом под игроком)
  const leader = G.party.find(m => m.hp > 0);
  if (leader && G.follower && !mountMon) {
    const f = G.follower;
    const spr = monSprite(leader);
    // кастомный спрайт смотрит влево; игрок правее — флипаем, чтобы смотрел на него
    const flipF = !!leader.customSprite && spr instanceof Image && p.x > f.x;
    const dims = monSpriteDims(leader, spr);
    const sw = dims.w, sh = dims.h;
    const bounce = f.moving ? Math.round(Math.abs(Math.sin(f.bounceT * 9)) * 3) : 0;
    const fx = Math.round((f.x - camX) * TILE) - Math.floor(sw / 2);
    const fy = Math.round((f.y - camY) * TILE) - sh + 4 - bounce;
    // тень под спутником
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round((f.x - camX) * TILE) - 4, Math.round((f.y - camY) * TILE) + 2, 8, 2);
    if (flipF) {
      ctx.save();
      ctx.scale(-1, 1);
      ctx.drawImage(spr, -fx - sw, fy, sw, sh);
      ctx.restore();
    } else {
      ctx.drawImage(spr, fx, fy, sw, sh);
    }
  }

  // игрок в центре; на маунте приподнят (сидит верхом)
  const onWater = World.tileAt(Math.floor(p.x), Math.floor(p.y)) === T.WATER;
  const ride = mount ? 4 : 0;          // насколько приподнять игрока над маунтом
  const psx = Math.round((p.x - camX) * TILE) - 8;
  const psy = Math.round((p.y - camY) * TILE) - 12 - ride;
  const cx = Math.round((p.x - camX) * TILE);   // центр игрока по x
  const groundY = Math.round((p.y - camY) * TILE);

  let riderWave = 0; // на волнах тренер качается вместе с маунтом
  if (mount) {
    if (mount.kind === 'water') {
      // покачивание на волнах + расходящиеся круги
      const wave = Math.round(Math.sin(G.clock * 3) * 1.5);
      riderWave = wave;
      const spr = monSprite(mount.mon);
      const dims = monSpriteDims(mount.mon, spr);
      const sw = dims.w, sh = dims.h;
      const rippleW = 13 + Math.round(Math.abs(Math.sin(G.clock * 4)) * 4);
      ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
      ctx.fillRect(cx - rippleW / 2, groundY + 3, rippleW, 2);
      const mx = cx - Math.floor(sw / 2);
      const my = groundY - sh + 7 + wave;
      drawMountSprite(ctx, spr, mx, my, sw, sh, p.dir === 'right');
    } else if (mount.kind === 'brother') {
      const wave = p.moving ? Math.round(Math.abs(Math.sin(G.clock * 9)) * 2) : 0;
      riderWave = -wave; // подпрыгивает вместе с братаном
      const spr = monSprite(mount.mon);
      const dims = monSpriteDims(mount.mon, spr);
      const sw = dims.w, sh = dims.h;
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(cx - 5, groundY + 2, 10, 2);
      drawMountSprite(ctx, spr, cx - Math.floor(sw / 2), groundY - sh + 6 - wave, sw, sh, p.dir === 'right');
    } else if (mount.kind === 'scooter') {
      const spr = scooterSprite();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.fillRect(cx - 6, groundY + 2, 12, 2);
      const my = groundY - 12;
      if (p.dir === 'left') {
        ctx.save(); ctx.scale(-1, 1); ctx.drawImage(spr, -(cx - 8) - 16, my, 16, 16); ctx.restore();
      } else {
        ctx.drawImage(spr, cx - 8, my, 16, 16);
      }
    }
  } else if (onWater) {
    // на воде без водного маунта (сюда обычно не попадаем — плавать нельзя)
    const rippleW = 12 + Math.round(Math.abs(Math.sin(G.clock * 4)) * 3);
    ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
    ctx.fillRect(psx + 8 - rippleW / 2, psy + 13 + ride, rippleW, 2);
  }
  // на маунте тренер сидит смирно (кадр стойки) — ехать должен маунт, а не ноги
  ctx.drawImage(playerSprite, DIR_INDEX[p.dir] * 16, (p.moving && !mount ? p.frame : 0) * 16, 16, 16, psx, psy + riderWave, 16, 16);

  // ---- время суток и погода ----
  if (G.phase === 'night') {
    ctx.fillStyle = 'rgba(10, 15, 55, 0.42)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (G.phase === 'evening') {
    ctx.fillStyle = 'rgba(80, 40, 10, 0.18)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else if (G.phase === 'morning') {
    ctx.fillStyle = 'rgba(90, 70, 120, 0.15)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  if (G.weather === 'rain') {
    const cold = World.climateAt(Math.floor(p.x), Math.floor(p.y)) === 'cold';
    if (cold) {
      // снегопад
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      const t = G.clock * 40;
      for (let i = 0; i < 40; i++) {
        const rx = (i * 127 + Math.floor(t / 6) * (i % 7) + Math.round(Math.sin(G.clock * 2 + i) * 6)) % canvas.width;
        const ry = (i * 61 + t) % canvas.height;
        ctx.fillRect(rx, ry, 2, 2);
      }
    } else {
      ctx.strokeStyle = 'rgba(160, 200, 255, 0.45)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      const t = G.clock * 260;
      for (let i = 0; i < 46; i++) {
        const rx = (i * 127 + Math.floor(t / 3) * (i % 5)) % canvas.width;
        const ry = (i * 61 + t) % canvas.height;
        ctx.moveTo(rx, ry);
        ctx.lineTo(rx - 2, ry + 7);
      }
      ctx.stroke();
    }
  }
}

// ===== Лавка =====

function openShop() {
  if (G.state !== 'world') return;
  G.state = 'shop';
  renderShop();
  document.getElementById('shop-panel').classList.remove('hidden');
}

function closeShop() {
  document.getElementById('shop-panel').classList.add('hidden');
  G.state = 'world';
  saveGame();
}

let _shopCat = 'potions'; // активная вкладка лавки (живёт между открытиями)

// Строка-витрина в категории «Особое»: name/desc/price + действие
function shopSpecialRow(rows, name, desc, priceHtml, btnText, onClick) {
  const row = document.createElement('div');
  row.className = 'srow';
  const info = document.createElement('div');
  info.className = 'info';
  info.innerHTML = '<span class="nm" style="color:var(--ui-accent)">' + name + '</span> — ' + priceHtml +
    '<br><span style="opacity:.8">' + desc + '</span>';
  row.appendChild(info);
  const btn = document.createElement('button');
  btn.textContent = btnText;
  btn.onclick = onClick;
  row.appendChild(btn);
  rows.appendChild(row);
}

function renderShop() {
  document.getElementById('shop-money').textContent = 'У тебя: ' + G.money + '₴';
  if (NZ() && _shopCat === 'donate') _shopCat = 'potions'; // премиум-витрина закрыта в NZ
  // вкладки категорий
  const tabs = document.getElementById('shop-tabs');
  tabs.innerHTML = '';
  for (const [cat, label] of SHOP_CATS) {
    if (NZ() && cat === 'donate') continue; // ☠️ Nuzlocke: премиум-витрины скрыты
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-size:12px;padding:6px 10px;';
    if (cat === _shopCat) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
    b.onclick = () => { _shopCat = cat; renderShop(); };
    tabs.appendChild(b);
  }
  const rows = document.getElementById('shop-rows');
  rows.innerHTML = '';

  // «Особое»: витрины за Stars
  if (_shopCat === 'donate') {
    shopSpecialRow(rows, '✨ Заказной братишка', 'Уникальный шайни-братишка: твой тип, окрас и имя. 3 стадии.',
      MONGEN_PRICE + '⭐', 'Открыть', () => openMongen());
    shopSpecialRow(rows, '👕 Гардероб', 'Перекраски — бесплатно. Шапки, очки, костюмы и принты — поштучно, навсегда.',
      'аксессуары 1–5⭐', 'Открыть', () => openWardrobe());
    shopSpecialRow(rows, '🖼 Свои спрайты', 'Загружай собственные PNG-облики братишек — кнопка на экране братишки.',
      sprUnlocked ? '<span style="opacity:.7">куплено</span>' : SPRITE_PRICE + '⭐', 'К братве', () => { closeShop(); togglePartyPanel(); });
    shopSpecialRow(rows, '🛴 Электросамокат', 'Премиум-маунт: гоняй по суше в 1.8× быстрее. Тумблер в настройках.',
      scootUnlocked ? '<span style="opacity:.7">куплено</span>' : SCOOT_PRICE + '⭐',
      scootUnlocked ? 'Куплено' : (IS_TMA ? 'Купить' : 'В Telegram'),
      () => {
        if (scootUnlocked) { toast('🛴 Самокат уже твой — включи в настройках.'); return; }
        if (IS_TMA) netBuyScoot(() => { toast('🛴 Электросамокат твой! Включи в настройках.'); renderShop(); });
        else toast('Покупка за Stars — в Telegram: @poketmons_bot');
      });
    shopSpecialRow(rows, '💾 Режим сейвскамера', 'Сохраняйся и откатывайся прямо в бою — переигрывай любой удар. Навсегда.',
      scumUnlocked ? '<span style="opacity:.7">куплено</span>' : SCUM_PRICE + '⭐',
      scumUnlocked ? 'Куплено' : (IS_TMA ? 'Купить' : 'В Telegram'),
      () => {
        if (scumUnlocked) { toast('💾 Уже куплено — вкл/выкл в настройках.'); return; }
        if (IS_TMA) netBuyScum(() => { setScum(true); toast('💾 Сейвскамер твой и включён! Кнопки 💾/⏪ — в бою.'); renderShop(); });
        else toast('Покупка за Stars — в Telegram: @poketmons_bot');
      });
    shopSpecialRow(rows, '⚔️ Автобой', 'Тренер сам ведёт бой: атаки по эффективности, умные подмены, ускорение ×2/×3. Навсегда.',
      autoUnlocked ? '<span style="opacity:.7">куплено</span>' : AUTO_PRICE + '⭐',
      autoUnlocked ? 'Куплено' : (IS_TMA ? 'Купить' : 'В Telegram'),
      () => {
        if (autoUnlocked) { toast('⚔️ Уже куплено — кнопки Авто и ×2 ждут в бою.'); return; }
        if (IS_TMA) netBuyAuto(() => { toast('⚔️ Автобой твой! Кнопки Авто и ×2 — в бою.'); renderShop(); });
        else toast('Покупка за Stars — в Telegram: @poketmons_bot');
      });
    shopSpecialRow(rows, '🏃 Автокач', 'Тренер сам бегает по дикой зоне и качает братву автобоями. Нужен Автобой. Навсегда.',
      grindUnlocked ? '<span style="opacity:.7">куплено</span>' : GRIND_PRICE + '⭐' + (autoUnlocked ? '' : ' <span style="opacity:.6">(нужен Автобой)</span>'),
      grindUnlocked ? 'Куплено' : !autoUnlocked ? 'Нужен Автобой' : (IS_TMA ? 'Купить' : 'В Telegram'),
      () => {
        if (grindUnlocked) { toast('🏃 Уже куплено — кнопка Автокач ждёт в дикой зоне.'); return; }
        if (!autoUnlocked) { toast('🏃 Автокач идёт бандлом к Автобою — сначала купи ⚔️ Автобой.'); return; }
        if (IS_TMA) netBuyGrind(() => { toast('🏃 Автокач твой! Кнопка появится в дикой траве и на воде.'); renderShop(); });
        else toast('Покупка за Stars — в Telegram: @poketmons_bot');
      });
    return;
  }

  for (const item of SHOP_ITEMS) {
    if (item.cat !== _shopCat) continue;
    const isCharm = item.id.startsWith('charm_');
    const charmKind = isCharm ? item.id.slice(6) : null;
    const ballKind = item.id.startsWith('ball_') ? item.id.slice(5) : null;
    const have = ballKind ? G.balls[ballKind]
      : item.id === 'scroll' ? G.scrolls.length
      : isCharm ? G.charms[charmKind]
      : G.bag[item.id];
    const rodOwned = item.id === 'rod' && G.bag.rod > 0;
    const row = document.createElement('div');
    row.className = 'srow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">' + item.name + '</span> — ' + item.price + '₴' +
      ' <span style="opacity:.6">(есть: ' + (rodOwned ? 'да' : have) + ')</span><br><span style="opacity:.8">' + item.desc + '</span>';
    row.appendChild(info);
    // кнопки-иконки, чтобы «Купить»+«Продать» не распирали ряд
    const btn = document.createElement('button');
    btn.textContent = rodOwned ? '✔' : '🛒';
    btn.title = rodOwned ? 'Куплено' : 'Купить за ' + item.price + '₴';
    btn.style.minWidth = '48px';
    btn.disabled = G.money < item.price || rodOwned;
    btn.onclick = () => {
      if (G.money < item.price) return;
      G.money -= item.price;
      if (ballKind) G.balls[ballKind]++;
      else if (item.id === 'scroll') {
        const mv = makeMove(mulberry32((Math.random() * 4294967296) >>> 0));
        G.scrolls.push(mv);
        toast('📜 Свиток: «' + mv.name + '» (' + TYPE_INFO[mv.type].ru + ', сила ' + mv.power + ')');
      } else if (isCharm) G.charms[charmKind]++;
      else G.bag[item.id]++;
      sfx('pickup');
      renderShop();
      updateHUD();
    };
    // ПОРЯДОК ВАЖЕН: «продать» добавляется ПЕРЕД «купить», т.к. .info { flex:1 }
    // прижимает кнопки вправо. «Купить» обязана всегда оставаться крайней справа:
    // иначе после первой покупки появившаяся «продать» встаёт ровно под палец, и
    // серия быстрых покупок превращается в купить-продать-купить (наступали).
    const sellPrice = Math.max(1, Math.floor(item.price / 2));
    if (have > 0) {
      const sell = document.createElement('button');
      sell.textContent = '💰';
      sell.title = 'Продать за ' + sellPrice + '₴';
      sell.style.minWidth = '48px';
      sell.onclick = () => {
        if (ballKind) { if (G.balls[ballKind] < 1) return; G.balls[ballKind]--; }
        else if (isCharm) { if (G.charms[charmKind] < 1) return; G.charms[charmKind]--; }
        else if (item.id === 'scroll') {
          // свитки индивидуальны — уходит слабейший (power×acc), чтобы не слить ценный
          if (!G.scrolls.length) return;
          let wi = 0;
          G.scrolls.forEach((s, i) => { if (s.power * s.acc < G.scrolls[wi].power * G.scrolls[wi].acc) wi = i; });
          const gone = G.scrolls.splice(wi, 1)[0];
          G.money += sellPrice;
          sfx('pickup');
          toast('💰 Продан слабейший свиток: «' + gone.name + '» (+' + sellPrice + '₴)');
          renderShop(); updateHUD(); saveGame();
          return;
        }
        else { if (!G.bag[item.id]) return; G.bag[item.id]--; }
        G.money += sellPrice;
        sfx('pickup');
        toast('💰 Продано: ' + item.name + ' (+' + sellPrice + '₴)');
        renderShop();
        updateHUD();
        saveGame();
      };
      row.appendChild(sell);
    }
    row.appendChild(btn);
    rows.appendChild(row);
  }
}

// ===== Карта =====

const MAP_COLORS = {
  [T.WATER]: '#2f63ae', [T.SAND]: '#d8c286', [T.GRASS]: '#5aa348', [T.TALL]: '#4d9040',
  [T.FLOOR]: '#3f7a38', [T.TREE]: '#2e6b28', [T.FLOWER]: '#63ad50', [T.ROAD]: '#5a5a62',
  [T.PAVE]: '#9a9aa2', [T.BUILD]: '#b0523a', [T.FOUNTAIN]: '#4fc3ff', [T.PARK]: '#63ad50',
  [T.ARENA]: '#ffd75e', [T.SHOP]: '#ff5050', [T.TOWER]: '#6a6a85',
  [T.SNOW]: '#e8eef4', [T.SNOWTALL]: '#d0dce8', [T.SNOWTREE]: '#7a99ac',
  [T.DESERT]: '#e0cc8e', [T.DESERTTALL]: '#c9b478', [T.CACTUS]: '#4a8a3a',
  [T.NURSERY]: '#e08ab0', [T.BOARD]: '#8a6a3a',
};
const MAP_TILES_W = 240, MAP_TILES_H = 160, MAP_PX = 3;

function toggleMap() {
  const panel = document.getElementById('map-panel');
  if (G.state === 'map') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'map';
  renderMap();
  panel.classList.remove('hidden');
}

// Общая отрисовка миникарты вокруг точки (cx, cy) на канвас tw×th тайлов
function drawMiniMap(cv, tw, th, centerX, centerY) {
  cv.width = tw * MAP_PX;
  cv.height = th * MAP_PX;
  const c = cv.getContext('2d');
  const x0 = Math.floor(centerX) - tw / 2, y0 = Math.floor(centerY) - th / 2;

  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      c.fillStyle = MAP_COLORS[World.tileAt(x0 + tx, y0 + ty)] || '#000';
      c.fillRect(tx * MAP_PX, ty * MAP_PX, MAP_PX, MAP_PX);
    }
  }
  // посещённые фонтаны — крупные маячки
  for (const f of G.fountains) {
    const mx = (f.x - x0) * MAP_PX, my = (f.y - y0) * MAP_PX;
    if (mx < 0 || my < 0 || mx > cv.width || my > cv.height) continue;
    c.fillStyle = '#ffffff';
    c.fillRect(mx - 4, my - 4, 8, 8);
    c.fillStyle = '#4fc3ff';
    c.fillRect(mx - 3, my - 3, 6, 6);
  }
  // подписи городов, чьи центры попали на карту
  c.font = 'bold 11px "Courier New", monospace';
  c.textAlign = 'center';
  const cell0x = Math.floor(x0 / CITY_CELL), cell0y = Math.floor(y0 / CITY_CELL);
  for (let cy = cell0y - 1; cy <= Math.floor((y0 + th) / CITY_CELL) + 1; cy++) {
    for (let cx = cell0x - 1; cx <= Math.floor((x0 + tw) / CITY_CELL) + 1; cx++) {
      const ct = World.cityCenter(cx, cy);
      const info = World.cityInfoAt(ct.x, ct.y);
      if (!info || info.x !== ct.x || info.y !== ct.y) continue; // центр не в городе — город тут не вырос
      const mx = (ct.x - x0) * MAP_PX, my = (ct.y - y0) * MAP_PX;
      if (mx < 20 || my < 8 || mx > cv.width - 20 || my > cv.height - 4) continue;
      c.fillStyle = 'rgba(0,0,0,0.65)';
      c.fillRect(mx - c.measureText(info.name).width / 2 - 3, my - 14, c.measureText(info.name).width + 6, 13);
      c.fillStyle = '#ffd75e';
      c.fillText(info.name, mx, my - 4);
    }
  }

  // центр — крестик
  const ccx = tw / 2 * MAP_PX, ccy = th / 2 * MAP_PX;
  c.fillStyle = '#ffffff';
  c.fillRect(ccx - 6, ccy - 1, 12, 3); c.fillRect(ccx - 1, ccy - 6, 3, 12);
  c.fillStyle = '#e02020';
  c.fillRect(ccx - 5, ccy, 10, 1); c.fillRect(ccx, ccy - 5, 1, 10);
}

// Размер карты: на мобильном в портрете — портретная, иначе — широкая
function mapDims() {
  if (IS_MOBILE && window.innerHeight > window.innerWidth) {
    const tw = 150;
    const th = Math.min(300, Math.round(tw * (window.innerHeight * 0.55) / Math.max(200, window.innerWidth - 24)));
    return [tw, th];
  }
  return [MAP_TILES_W, MAP_TILES_H];
}

function renderMap() {
  const [tw, th] = mapDims();
  drawMiniMap(document.getElementById('map-canvas'), tw, th, G.player.x, G.player.y);

  // кнопки быстрого перемещения — все посещённые фонтаны, от ближнего к дальнему
  const travel = document.getElementById('map-travel');
  travel.innerHTML = G.fountains.length ? '' : '<span style="opacity:.6;font-size:12px">Коснись фонтана в городе, чтобы открыть телепорт к нему.</span>';
  const sorted = G.fountains
    .map(f => ({ f, dist: Math.hypot(f.x - G.player.x, f.y - G.player.y) }))
    .sort((a, b) => a.dist - b.dist);
  for (const { f, dist } of sorted) {
    const b = document.createElement('button');
    // в каждом городе ровно один фонтан — подписываем именем города, 1 км = 10 тайлов
    const city = World.cityInfoAt(f.x, f.y);
    b.textContent = '⛲ ' + (city ? city.name : 'Дикие места') + ' · ' + (dist / 10).toFixed(1) + ' км';
    b.onclick = () => travelToFountain(f);
    travel.appendChild(b);
  }
  // затухание снизу видно, пока список не долистан до конца;
  // замер в rAF — renderMap зовётся ДО снятия hidden, у скрытой панели размеры нулевые
  const wrap = document.getElementById('map-travel-wrap');
  const fade = () => wrap.classList.toggle('has-more', travel.scrollTop + travel.clientHeight < travel.scrollHeight - 4);
  travel.onscroll = fade;
  travel.scrollTop = 0;
  requestAnimationFrame(fade);
}

function travelToFountain(f) {
  G.player.x = f.x; G.player.y = f.y;
  resetFollower();
  G.lastTileKey = '';
  G.graceSteps = 2;
  document.getElementById('map-panel').classList.add('hidden');
  G.state = 'world';
  sfx('heal');
  toast('Вжух! Ты у фонтана.');
  updateHUD();
  saveGame();
}

// ===== Обменник =====

// ===== Кастомные спрайты (загруженные PNG, смотрят влево) =====

const _customImgs = new Map();

// Image из data-URL с кэшем; null, пока грузится (рисуем процедурный фоллбэк)
function customSpriteImg(dataUrl) {
  let img = _customImgs.get(dataUrl);
  if (!img) {
    img = new Image();
    img.src = dataUrl;
    _customImgs.set(dataUrl, img);
  }
  return img.complete && img.naturalWidth ? img : null;
}

// Спрайт монстрика для отрисовки: кастом или процедурный (с учётом палитры заказных)
function monSprite(m) {
  if (m.customSprite) {
    const img = customSpriteImg(m.customSprite);
    if (img) return img;
  }
  return speciesSprite(m.speciesSeed, m.stage, m.shiny, false, m.palette, m.mega);
}

// Отрисовка маунта с разворотом по ходу движения.
// Кастомный PNG нарисован смотрящим ВЛЕВО — при беге вправо зеркалим его.
// Процедурные спрайты симметричны (speciesSprite строит их зеркальными
// половинами), поэтому флип для них не нужен и проверяется именно Image.
function drawMountSprite(ctx, spr, x, y, w, h, faceRight) {
  if (faceRight && spr instanceof Image) {
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(spr, -x - w, y, w, h);
    ctx.restore();
  } else {
    ctx.drawImage(spr, x, y, w, h);
  }
}

// Габариты отрисовки: кастомный PNG приводится к размеру процедурного
// спрайта той же стадии (12/15/18), чтобы братишка не вымахал больше игрока
function monSpriteDims(m, spr) {
  if (spr instanceof Image) {
    const target = 12 + ((m.stage | 0) * 3) + (m.mega ? 4 : 0);
    const k = target / Math.max(spr.width, spr.height);
    return { w: Math.max(1, Math.round(spr.width * k)), h: Math.max(1, Math.round(spr.height * k)) };
  }
  return { w: spr.width, h: spr.height };
}

// Пикселизация загруженной картинки: автообрезка по прозрачности + даунскейл до 24×24
function pixelateImage(img) {
  const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
  if (!w0 || !h0) return null;
  const c0 = document.createElement('canvas');
  c0.width = w0; c0.height = h0;
  const x0 = c0.getContext('2d');
  x0.drawImage(img, 0, 0);
  const d = x0.getImageData(0, 0, w0, h0).data;
  let minX = w0, minY = h0, maxX = -1, maxY = -1;
  for (let y = 0; y < h0; y++) {
    for (let x = 0; x < w0; x++) {
      if (d[(y * w0 + x) * 4 + 3] > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) { minX = 0; minY = 0; maxX = w0 - 1; maxY = h0 - 1; } // непрозрачных нет — берём всё
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const scale = Math.min(24 / bw, 24 / bh, 1);   // пиксель-арт ≤24 не трогаем
  const tw = Math.max(1, Math.round(bw * scale));
  const th = Math.max(1, Math.round(bh * scale));
  const c1 = document.createElement('canvas');
  c1.width = tw; c1.height = th;
  const x1 = c1.getContext('2d');
  x1.imageSmoothingEnabled = false;
  x1.drawImage(c0, minX, minY, bw, bh, 0, 0, tw, th);
  return c1.toDataURL('image/png');
}

function monMiniCanvas(m, size) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const draw = () => {
    c.clearRect(0, 0, size, size);
    const spr = monSprite(m);
    const d = monSpriteDims(m, spr);
    c.drawImage(spr, Math.floor((size - d.w) / 2), Math.floor((size - d.h) / 2), d.w, d.h);
  };
  draw();
  // кастомный PNG (data-URL) грузится асинхронно: сейчас нарисован процедурный
  // фоллбэк — дорисуем настоящий облик, как только Image догрузится
  if (m.customSprite && !customSpriteImg(m.customSprite)) {
    _customImgs.get(m.customSprite).addEventListener('load', draw, { once: true });
  }
  return cv;
}

function openTrade(td) {
  if (G.state !== 'world') return;
  if (G.traded.has(td.id)) { toast('Обменник: «Сделка была честной, приходи в другой раз!»'); return; }
  G.state = 'trade';
  const { offered, wantsType } = World.traderOffer(td);
  const wt = TYPE_INFO[wantsType];

  const offerEl = document.getElementById('trade-offer');
  offerEl.innerHTML = '';
  offerEl.appendChild(monMiniCanvas(offered, 28));
  const t = TYPE_INFO[monType(offered)];
  const oInfo = document.createElement('div');
  oInfo.className = 'info';
  oInfo.innerHTML = '<span class="nm">' + (offered.shiny ? '✨' : '') + monName(offered) + '</span> Ур.' + offered.level +
    ' <span style="color:' + t.color + '">' + t.ru + '</span>' +
    '<div style="opacity:.75;font-size:11px">ОЗ ' + offered.maxHp + ' · АТК ' + offered.atk + ' · ЗАЩ ' + offered.def + ' · СКР ' + offered.spd + '</div>';
  offerEl.appendChild(oInfo);

  document.getElementById('trade-wants').innerHTML =
    'Хочет взамен братишку типа <b style="color:' + wt.color + '">' + wt.ru + '</b>:';

  const rows = document.getElementById('trade-rows');
  rows.innerHTML = '';
  const candidates = G.party.filter(m => monType(m) === wantsType);
  if (G.party.length < 2) {
    rows.innerHTML = '<span style="opacity:.7">Нельзя отдать последнего братишку.</span>';
  } else if (!candidates.length) {
    rows.innerHTML = '<span style="opacity:.7">У тебя нет братишки типа «' + wt.ru + '».</span>';
  } else {
    for (const m of candidates) {
      const row = document.createElement('div');
      row.className = 'prow';
      row.appendChild(monMiniCanvas(m, 28));
      const info = document.createElement('div');
      info.className = 'info';
      info.innerHTML = '<span class="nm">' + (m.shiny ? '✨' : '') + monName(m) + '</span> Ур.' + m.level;
      row.appendChild(info);
      const btn = document.createElement('button');
      btn.textContent = 'Обменять';
      btn.onclick = () => {
        const idx = G.party.indexOf(m);
        if (idx === -1 || G.party.length < 2) return;
        G.party.splice(idx, 1);
        G.party.push(offered);
        dexCaught(offered);
        G.traded.add(td.id);
        G.stats.trades++;
        sfx('catch');
        closeTrade();
        toast('Обмен! ' + monName(offered) + ' теперь с тобой.');
        updateHUD();
        saveGame();
      };
      row.appendChild(btn);
      rows.appendChild(row);
    }
  }
  document.getElementById('trade-panel').classList.remove('hidden');
}

function closeTrade() {
  document.getElementById('trade-panel').classList.add('hidden');
  G.state = 'world';
}

// ===== Обучение со свитка =====

// Сортировка свитков при обучении; дефолт — свежие сверху. Как в кармане:
// сортируется только отображение, «Изучить» держит оригинальный индекс
const TEACH_SORTS = [
  { id: 'date', label: 'Дата', val: null },
  { id: 'power', label: 'Сила', val: mv => mv.power },
  { id: 'acc', label: 'Точн.', val: mv => mv.acc },
  { id: 'pp', label: 'ПП', val: mv => mv.maxPp || ppForPower(mv.power) },
];
let teachSort = localStorage.getItem('mw-teach-sort') || 'date';
let teachSortAsc = localStorage.getItem('mw-teach-sort-asc') === '1';

function openTeach(mon) {
  document.getElementById('party-panel').classList.add('hidden');
  G.state = 'teach';
  const panel = document.getElementById('teach-panel');
  document.getElementById('teach-info').innerHTML =
    'Выбери свиток для <b style="color:var(--ui-accent)">' + monName(mon) + '</b>:';

  const sortBar = document.getElementById('teach-sort');
  sortBar.innerHTML = '';
  if (G.scrolls.length > 1) {
    for (const s of TEACH_SORTS) {
      const b = document.createElement('button');
      b.textContent = s.label + (s.id === teachSort ? (teachSortAsc ? ' ▲' : ' ▼') : '');
      b.style.cssText = 'font-size:12px;padding:6px 10px;';
      if (s.id === teachSort) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
      b.onclick = () => {
        if (teachSort === s.id) teachSortAsc = !teachSortAsc;
        else { teachSort = s.id; teachSortAsc = false; } // и дата, и статы — по убыванию: свежее/сильнее сверху
        localStorage.setItem('mw-teach-sort', teachSort);
        localStorage.setItem('mw-teach-sort-asc', teachSortAsc ? '1' : '0');
        openTeach(mon);
      };
      sortBar.appendChild(b);
    }
  }

  const entries = G.scrolls.map((mv, si) => ({ mv, si }));
  const sd = TEACH_SORTS.find(s => s.id === teachSort) || TEACH_SORTS[0];
  const dir = teachSortAsc ? 1 : -1;
  entries.sort((a, b) => (sd.val ? (sd.val(a.mv) - sd.val(b.mv)) * dir : (a.si - b.si) * dir) || a.si - b.si);

  const rows = document.getElementById('teach-rows');
  rows.innerHTML = '';
  entries.forEach(({ mv, si }) => {
    const row = document.createElement('div');
    row.className = 'srow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">📜 ' + mv.name + '</span> — <span style="color:' + TYPE_INFO[mv.type].color + '">' +
      TYPE_INFO[mv.type].ru + '</span> · сила ' + mv.power + ' · точн. ' + mv.acc + ' · ПП ' + (mv.maxPp || ppForPower(mv.power)) +
      moveEffectLabel(mv);
    row.appendChild(info);
    const btn = document.createElement('button');
    btn.textContent = 'Изучить';
    btn.onclick = () => pickTeachSlot(mon, si);
    row.appendChild(btn);
    rows.appendChild(row);
  });
  panel.classList.remove('hidden');
}

function pickTeachSlot(mon, scrollIdx) {
  const mv = G.scrolls[scrollIdx];
  if (!mv) return;
  const finish = () => {
    G.scrolls.splice(scrollIdx, 1);
    G.stats.taught++;
    sfx('level');
    toast(monName(mon) + ' изучает «' + mv.name + '»!');
    closeTeach();
    updateHUD(); saveGame();
  };
  if (mon.moves.length < 4) {
    mon.moves.push(moveInstance(mv));
    finish();
    return;
  }
  // все 4 слота заняты — выбираем, что забыть (сортировка тут ни к чему)
  document.getElementById('teach-sort').innerHTML = '';
  document.getElementById('teach-info').innerHTML =
    'Какое умение <b style="color:var(--ui-accent)">' + monName(mon) + '</b> забудет ради «' + mv.name + '»?';
  const rows = document.getElementById('teach-rows');
  rows.innerHTML = '';
  mon.moves.forEach((old, oi) => {
    const row = document.createElement('div');
    row.className = 'srow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">' + old.name + '</span> — ' + TYPE_INFO[old.type].ru + ' · сила ' + old.power +
      moveEffectLabel(old);
    row.appendChild(info);
    const btn = document.createElement('button');
    btn.textContent = 'Забыть';
    btn.onclick = () => {
      mon.moves[oi] = moveInstance(mv);
      finish();
    };
    row.appendChild(btn);
    rows.appendChild(row);
  });
}

function closeTeach() {
  document.getElementById('teach-panel').classList.add('hidden');
  G.state = 'world';
}

// ===== Достижения (панель) =====

let _achTab = 'ach';

function toggleAchievements() {
  if (NZ()) { nzOpenLog(); return; }
  const panel = document.getElementById('ach-panel');
  if (G.state === 'ach') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'ach';
  _achTab = 'ach';
  renderAchPanel();
  panel.classList.remove('hidden');
}

function renderAchPanel() {
  const tabs = document.getElementById('ach-tabs');
  tabs.innerHTML = '';
  for (const [tab, label] of [['ach', '🏆 Достижения'], ['lb', '⚡ Лидерборд']]) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-size:12px;padding:6px 10px;';
    if (tab === _achTab) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
    b.onclick = () => { _achTab = tab; renderAchPanel(); };
    tabs.appendChild(b);
  }
  const count = document.getElementById('ach-count');
  const rows = document.getElementById('ach-rows');
  rows.innerHTML = '';
  if (_achTab === 'ach') {
    checkAchievements();
    count.textContent = 'Открыто: ' + G.achievements.size + ' из ' + ACHIEVEMENTS.length;
    for (const a of ACHIEVEMENTS) {
      const got = G.achievements.has(a.id);
      const row = document.createElement('div');
      row.className = 'arow' + (got ? '' : ' locked');
      row.innerHTML = '<span class="ic">' + (got ? a.ic : '🔒') + '</span>' +
        '<span><span class="nm">' + a.name + '</span><br><span style="opacity:.8;font-size:12px">' + a.desc + '</span></span>';
      rows.appendChild(row);
    }
    return;
  }
  renderLeaderboard(count, rows);
}

function renderLeaderboard(count, rows) {
  count.textContent = 'Топ по силе братвы · в топ попадают игроки из Telegram';
  const note = document.createElement('div');
  note.style.cssText = 'opacity:.7;padding:16px;text-align:center;';
  note.textContent = 'Загружаю топ...';
  rows.appendChild(note);
  netFetchLeaderboard(top => {
    if (G.state !== 'ach' || _achTab !== 'lb') return; // вкладку уже закрыли/переключили
    rows.innerHTML = '';
    if (!top || !top.length) {
      const empty = document.createElement('div');
      empty.style.cssText = 'opacity:.7;padding:16px;text-align:center;';
      empty.textContent = top ? 'Пока пусто. Сыграй бой в Telegram — и попадёшь в топ!' : 'Сеть недоступна — попробуй позже.';
      rows.appendChild(empty);
      return;
    }
    const medals = ['🥇', '🥈', '🥉'];
    top.forEach((e, i) => {
      const mine = typeof playerNick === 'string' && playerNick && e.nick === playerNick;
      const row = document.createElement('div');
      row.className = 'arow' + (mine ? ' lb-me' : '');
      const place = document.createElement('span');
      place.className = 'ic';
      place.textContent = medals[i] || String(i + 1);
      const nm = document.createElement('span');
      nm.className = 'nm';
      // чужой ник — только textContent (санитайзер воркера не единственный барьер)
      nm.textContent = e.nick + (mine ? ' — ты' : '');
      nm.style.cssText = 'flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
      const stats = document.createElement('span');
      stats.style.cssText = 'white-space:nowrap;opacity:.9;';
      stats.textContent = '⚡' + (e.power | 0) + ' 🏅' + (e.badges | 0) + ' 📖' + (e.dex | 0);
      row.append(place, nm, stats);
      rows.appendChild(row);
    });
  });
}

// ===== Настройки =====

function toggleSettings() {
  const panel = document.getElementById('settings-panel');
  if (G.state === 'settings') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'settings';
  renderSettings();
  panel.classList.remove('hidden');
}

// ===== Гайд: разъяснение механик (по фидбеку — игрокам не хватало хелпа) =====

function openGuide() {
  if (G.state === 'settings') { document.getElementById('settings-panel').classList.add('hidden'); G.state = 'world'; }
  if (G.state !== 'world') return;
  G.state = 'guide';
  renderGuide();
  document.getElementById('guide-panel').classList.remove('hidden');
}

function closeGuide() {
  document.getElementById('guide-panel').classList.add('hidden');
  G.state = 'world';
}

function toggleGuide() {
  if (G.state === 'guide') closeGuide(); else openGuide();
}

// Строки «кто кого бьёт» — из реальной таблицы эффективностей, не разойдётся с кодом
function guideTypeRows() {
  return TYPE_LIST.map(t => {
    const strong = TYPE_LIST.filter(d => effMult(t, d) > 1).map(d => TYPE_INFO[d].ru).join(', ');
    const weak = TYPE_LIST.filter(d => effMult(t, d) < 1).map(d => TYPE_INFO[d].ru).join(', ');
    return '<div style="margin:3px 0"><b style="color:' + TYPE_INFO[t].color + '">' + TYPE_INFO[t].ru + '</b>' +
      (strong ? ' · 💥 ×2 по: ' + strong : '') +
      (weak ? ' · 🛡 ×½ по: ' + weak : '') + '</div>';
  }).join('');
}

function renderGuide() {
  const secs = [
    { id: 'battle', ic: '⚔️', title: 'Бой и урон', html:
      '<p>Урон складывается из уровня и АТК бойца, силы умения и ЗАЩ цели, а сверху идут множители:</p>' +
      '<p>• <b>Стихия</b>: удачная — <b>×2 💥</b>, неудачная — <b>×½ 🛡</b>. Эти значки видны в меню атак у каждого умения — они и значат «в два раза больше» или «вполовину меньше».<br>' +
      '• <b>Родная стихия</b>: умение того же типа, что и сам братишка, бьёт на 30% сильнее.<br>' +
      '• <b>Крит</b>: с шансом 6% урон ×1.5.<br>' +
      '• <b>Значки арен</b>: каждый даёт +3% к твоему урону.<br>' +
      '• <b>Погода и время</b>: в дождь вода ×1.25, а огонь ×0.8; ночью тьма ×1.2.</p>' +
      '<p><b>Недуги</b>: стихийные умения с шансом ' + Math.round(STATUS_CHANCE * 100) + '% вешают эффект — ' +
      '🌿 яд, 🔥 ожог, ⚡ паралич, 🔮 сон, ❄ заморозка. Какой именно и с каким шансом — подписано прямо на кнопке умения в бою.</p>' +
      '<p>Считать самому не нужно: в меню атак у каждого умения написан готовый разброс «урон 47–55» именно по текущему врагу. «Точн.» — шанс попасть.</p>' +
      '<p>Если под твоей панелью горит «⚠ стихия врага сильнее твоей» — повод сменить бойца через «Братва»: на кнопках замены видно, кто сколько врежет этому врагу.</p>' },
    { id: 'types', ic: '🌈', title: 'Стихии', html:
      '<p>Кто кого бьёт (работает в обе стороны — и против тебя тоже):</p>' + guideTypeRows() },
    { id: 'stats', ic: '📊', title: 'Характеристики', html:
      '<p>• <b>ОЗ</b> — здоровье; на нуле боец выбывает до лечения.<br>' +
      '• <b>АТК</b> — сила ударов.<br>' +
      '• <b>ЗАЩ</b> — режет входящий урон.<br>' +
      '• <b>СКР</b> — кто ходит первым; ещё помогает сбежать из боя.<br>' +
      '• <b>ПП</b> — запас применений умения. Кончились все — остаётся «Отчаянный удар» с отдачей. 🔷 Эфир восполняет всё.</p>' +
      '<p>Опыт: слабые враги почти не качают — при разрыве больше 5 уровней опыт сильно режется. На высоких уровнях качайся в башне.</p>' },
    { id: 'moves', ic: '📜', title: 'Умения и их порядок', html:
      '<p>У братишки до 4 умений. В его карточке (ℹ️ в «Братве») тап по умению поднимает его выше — это тот порядок, в котором умения лежат в меню боя: любимое держи первым, чтобы не листать. На силу умений порядок не влияет.</p>' +
      '<p>Новые умения учат 📜 свитками (лавка, башня, задания) — там же в карточке.</p>' },
    { id: 'items', ic: '🎒', title: 'Предметы и сферы', html:
      '<p>Весь запас — в 🎒 Инвентаре' + keyHint('I') + '. 🧪 Зелье лечит 50% ОЗ, ✨ Суперзелье — полностью, 💊 Тоник снимает недуг, 🔷 Эфир возвращает все ПП, 🪨 Камень эво мгновенно эволюционирует, 💠 Мега-камень — для мегаэволюции.</p>' +
      '<p>🧿 <b>Амулеты</b> вешаются на братишку и дают прибавку к одному стату — насколько большую, зависит от амулета. 🚫 <b>Репеллент</b> отпугивает случайных диких на 100 или 500 шагов — применяется из Инвентаря, счётчик тикает вверху экрана.</p>' +
      '<p>Сферы ловли: ' + BALL_TYPES.map(b => b.ic + ' ' + b.name.toLowerCase()).join(', ') + '. Шанс выше, когда у цели мало ОЗ, и ниже против высоких уровней; чем дороже сфера, тем надёжнее — 🟡 златая ловит всегда. В бою у каждой сферы показан живой процент.</p>' },
    { id: 'travel', ic: '⛲', title: 'Фонтаны и карта', html:
      '<p>Фонтан в городе бесплатно лечит всю братву, снимает недуги и восполняет ПП. Каждый фонтан, которого ты коснулся, остаётся точкой телепорта: открой карту' + keyHint('M') + ' — список отсортирован от ближнего к дальнему и листается.</p>' +
      '<p>⚠ Если вся братва пала в бою, ты очнёшься у ближайшего фонтана, потеряв <b>половину наличных</b> — не ходи в опасные земли с полным карманом.</p>' },
    { id: 'nursery', ic: '🥚', title: 'Питомник', html:
      '<p>Приноси двух родителей и 500₴ — получишь яйцо. Вид малыша — случайного из родителей (50/50), плюс он унаследует одно случайное умение одного из них. Шанс ✨сияющего — 1/32, а с сияющим родителем — 1/8. Вылупится через 300 шагов прогулки.</p>' },
    { id: 'mounts', ic: '🐎', title: 'Маунты', html:
      '<p>🐎 <b>Как ездить верхом на своём братане:</b><br>' +
      '1. Чтобы замаунтить кого-то из своей братвы, нужен <b>братан 3-й эволюции</b> — докачай вид с полной цепочкой до финальной стадии (виды с 1–2 стадиями до братана не дорастают, цепочку смотри в Братопедии).<br>' +
      '2. Поставь его <b>первым в «Братве»</b> — везёт первый живой боец команды.<br>' +
      '3. Зажми бег' + keyHint('Shift') + ' — и ты в седле, скорость ×1.5. Отпустишь — идёшь пешком.</p>' +
      '<p>💧 <b>Как плавать:</b> возьми в братву водного братишку <b>от 15 уровня</b> — на воде он подхватит тебя сам, жать ничего не нужно (без него в воду не зайти).</p>' +
      '<p>🛴 <b>Самокат</b> (⭐ товар из лавки): ×1.8 по суше, тоже по кнопке бега; тумблер в настройках.</p>' +
      '<p>Кто повезёт прямо сейчас — подсказывает иконка на кнопке бега: 🛴 самокат / 🐎 братан / 🏃 просто бег. Если доступно несколько: вода → самокат → братан.</p>' },
    { id: 'quests', ic: '📋', title: 'Задания', html:
      '<p>Доски 📋 стоят в городах. После сдачи задания доска предложит новое (и само предложение со временем меняется). Повтор того же вида подряд платит вдвое меньше — выгоднее чередовать. Награда растёт с уровнем местности, сверху — свиток или эфир.</p>' },
    { id: 'endgame', ic: '🗼', title: 'Башня и эндгейм', html:
      '<p>🗼 Башня — серия боёв без лечения между этажами; каждый третий этаж даёт свиток. После 90 уровня это главное место кача. Потолок уровня — ' + LEVEL_CAP + '.</p>' +
      '<p>💠 Мегаэволюция: братану финальной стадии с ' + MEGA_LEVEL + ' уровня скорми мега-камень (лавка) — навсегда +35% ко всем статам и новый облик.</p>' },
  ];
  const chips = document.getElementById('guide-chips');
  const body = document.getElementById('guide-body');
  chips.innerHTML = '';
  body.innerHTML = '';
  for (const s of secs) {
    const sec = document.createElement('div');
    sec.innerHTML = '<h2>' + s.ic + ' ' + s.title + '</h2>' + s.html;
    body.appendChild(sec);
    const chip = document.createElement('button');
    chip.textContent = s.ic + ' ' + s.title;
    chip.onclick = () => sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
    chips.appendChild(chip);
  }
}

// На мобиле клавиатуры нет — убираем «(Esc)», «(Tab)» и т.п. со статичных кнопок
function stripKeyHints() {
  if (!IS_MOBILE) return;
  document.querySelectorAll('button').forEach(b => {
    if (b.childElementCount) return;
    b.textContent = b.textContent.replace(/\s*\((?:Esc|Tab|[A-Z]|\d+|,)\)\s*$/, '');
  });
}

function renderSettings() {
  // фулскрин: только десктопный браузер — внутри Telegram и на мобиле
  // Fullscreen API не работает / не нужен
  const fsBtn = document.getElementById('set-fullscreen');
  if (IS_MOBILE || IS_TMA || !document.documentElement.requestFullscreen) {
    fsBtn.style.display = 'none';
  } else {
    fsBtn.style.display = '';
    fsBtn.textContent = document.fullscreenElement ? '⛶ Выйти из фулскрина' : '⛶ На весь экран';
    fsBtn.onclick = () => {
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      else document.documentElement.requestFullscreen().catch(() => toast('Браузер не пустил в фулскрин.'));
      setTimeout(renderSettings, 300);
    };
  }
  const sndBtn = document.getElementById('set-sound');
  sndBtn.textContent = SOUND_ON ? '🔊 Звук: вкл' : '🔇 Звук: выкл';
  sndBtn.onclick = () => {
    setSoundOn(!SOUND_ON);
    sfx('pickup'); // слышно сразу, что звук вернулся (при выкл — тишина)
    if (!SOUND_ON) Music.mute(); else if (MUSIC_ON) Music.start();
    renderSettings();
  };
  // музыка: тап крутит громкость +10% по кругу (…90 → 100 → выкл → 10…), ползунка нет
  const musBtn = document.getElementById('set-music');
  const musCur = MUSIC_ON ? MUSIC_VOL : 0;
  musBtn.textContent = musCur > 0 ? '🎵 Музыка: ' + musCur + '%' : '🎵 Музыка: выкл';
  musBtn.onclick = () => {
    const cur = MUSIC_ON ? MUSIC_VOL : 0;
    const next = cur >= 100 ? 0 : Math.min(100, Math.floor(cur / 10) * 10 + 10);
    if (next > 0) setMusicVol(next); // при «выкл» громкость не трогаем — гасим флагом
    setMusicOn(next > 0);
    renderSettings();
  };
  // раскладка джойстика — только на тач-устройствах
  const joyBtn = document.getElementById('set-joyside');
  if (IS_MOBILE) {
    joyBtn.style.display = '';
    joyBtn.textContent = JOY_SIDE === 'right' ? '🕹 Стик справа, кнопки слева' : '🕹 Стик слева, кнопки справа';
    joyBtn.onclick = () => { setJoySide(JOY_SIDE === 'right' ? 'left' : 'right'); renderSettings(); };
  } else {
    joyBtn.style.display = 'none';
  }
  // режим сейвскамера — тумблер только у купивших (покупка в лавке, «Особое»)
  const scumBtn = document.getElementById('set-scum');
  if (scumUnlocked && !NZ()) {
    scumBtn.style.display = '';
    scumBtn.textContent = SCUM_ON ? '💾 Сейвскам: вкл' : '💾 Сейвскам: выкл';
    scumBtn.onclick = () => { setScum(!SCUM_ON); renderSettings(); };
  } else {
    scumBtn.style.display = 'none';
  }

  // тумблер электросамоката — только у купивших
  const scootBtn = document.getElementById('set-scooter');
  if (scootUnlocked && !NZ()) {
    scootBtn.style.display = '';
    scootBtn.textContent = G.scootOn ? '🛴 Самокат: вкл' : '🛴 Самокат: выкл';
    scootBtn.onclick = () => { G.scootOn = !G.scootOn; saveGame(); updateHUD(); renderSettings(); };
  } else {
    scootBtn.style.display = 'none';
  }
  const urlForce = /[?&](desktop|mobile)/.test(location.search);
  const note = document.getElementById('set-mode-note');
  note.textContent = urlForce
    ? 'Режим зафиксирован параметром в адресе (?desktop/?mobile) — переключение уберёт его.'
    : 'Смена режима перезагрузит игру.';
  // подсветка по живому значению localStorage, не по конcтанте загрузки
  let stored = '';
  try { stored = localStorage.getItem('mw-mode') || ''; } catch (e) {}
  document.querySelectorAll('#set-mode button').forEach(b => {
    const active = stored === b.dataset.mode && !urlForce;
    b.style.borderColor = active ? 'var(--ui-accent)' : '';
    b.style.color = active ? 'var(--ui-accent)' : '';
    b.onclick = () => {
      if (active) return;
      const mode = b.dataset.mode;
      try { mode ? localStorage.setItem('mw-mode', mode) : localStorage.removeItem('mw-mode'); } catch (e) {}
      saveGame();
      note.textContent = '⏳ Перезагружаю…';
      // чистим отладочные форс-параметры, иначе они переспорят настройку;
      // replace того же URL кое-где не перезагружает — тогда явный reload
      const u = new URL(location.href);
      u.searchParams.delete('desktop');
      u.searchParams.delete('mobile');
      if (u.href === location.href) location.reload();
      else location.replace(u.href);
    };
  });
}

// ===== Гардероб игрока (перекраски бесплатны, вещи — только купленные) =====

const OUTFIT_SHIRTS = ['#d84848', '#3a6ab0', '#3a9a50', '#d8a018', '#8a4fd0', '#e87fb0', '#3aa8a0', '#f0f0f0', '#26262e'];
const OUTFIT_HAIRS  = ['#6b3a1e', '#2a2a38', '#e8c95a', '#b0523a', '#f0f0f0', '#8a4fd0', '#3a6ab0', '#3a9a50'];
// белый, 5 телесных от светлого к тёмному, чёрный + фан: зелёный и синий
const OUTFIT_SKINS  = ['#f0f0f5', '#ffe0c8', '#e8b088', '#c98d5e', '#a06a42', '#7a4a2c', '#26262e', '#6ab04c', '#4a7ad8'];

function openWardrobe() {
  if (G.state === 'settings') { document.getElementById('settings-panel').classList.add('hidden'); G.state = 'world'; }
  if (G.state === 'shop') closeShop();
  if (G.state !== 'world') return;
  G.state = 'wardrobe';
  if (!G.outfit) G.outfit = Object.assign({}, DEFAULT_OUTFIT);
  renderWardrobe();
  document.getElementById('wardrobe-panel').classList.remove('hidden');
  netAccsStatus(() => {
    if (G.state === 'wardrobe') renderWardrobe();
    else if (G.state === 'accshop') renderAccShop();
  });
}

function closeWardrobe() {
  document.getElementById('wardrobe-panel').classList.add('hidden');
  G.state = 'world';
}

// нарисовать наряд в превью-канвас (кадр «вниз», увеличенный)
function drawOutfitPreview(cvId, o) {
  const cv = document.getElementById(cvId);
  cv.width = 16; cv.height = 16;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const val = (f, slot) => (OUTFIT_ACCS[o[f]] && accSlot(o[f]) === slot) ? o[f] : null;
  c.drawImage(makePersonSprite(o.shirt, o.hair, val('acc', 'head'), o.skin,
    { glasses: val('glasses', 'glasses'), costume: val('costume', 'costume'), print: val('print', 'print') }),
    0, 0, 16, 16, 0, 0, 16, 16);
}

function renderWardrobe() {
  const o = G.outfit;
  drawOutfitPreview('wrd-preview', o);

  // перекраски — применяются сразу, они бесплатные
  const swatchRow = (elId, colors, key) => {
    const el = document.getElementById(elId);
    el.innerHTML = '';
    for (const col of colors) {
      const b = document.createElement('button');
      b.style.cssText = 'width:34px;height:34px;padding:0;border-radius:8px;background:' + col +
        ';border:3px solid ' + (o[key] === col ? 'var(--ui-accent)' : 'var(--ui-border)') + ';';
      b.onclick = () => { o[key] = col; applyOutfit(); saveGame(); renderWardrobe(); };
      el.appendChild(b);
    }
  };
  swatchRow('wrd-shirts', OUTFIT_SHIRTS, 'shirt');
  swatchRow('wrd-hairs', OUTFIT_HAIRS, 'hair');
  swatchRow('wrd-skins', OUTFIT_SKINS, 'skin');

  // купленные вещи по категориям: клик — надеть/снять сразу
  const ownEl = document.getElementById('wrd-owned');
  ownEl.innerHTML = '';
  let any = false;
  for (const [slot, title] of ACC_CATS) {
    const items = Object.keys(OUTFIT_ACCS).filter(k => accSlot(k) === slot && accsOwned.has(k));
    if (!items.length) continue;
    any = true;
    const h = document.createElement('div');
    h.style.cssText = 'align-self:flex-start;font-size:13px;opacity:.85;';
    h.textContent = title + ':';
    ownEl.appendChild(h);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;';
    const f = SLOT_FIELD[slot];
    for (const k of items) {
      const b = document.createElement('button');
      const worn = o[f] === k;
      b.textContent = (worn ? '✅ ' : '') + OUTFIT_ACCS[k].name;
      if (worn) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
      b.onclick = () => { o[f] = worn ? null : k; applyOutfit(); saveGame(); renderWardrobe(); };
      row.appendChild(b);
    }
    ownEl.appendChild(row);
  }
  if (!any) {
    const d = document.createElement('div');
    d.style.cssText = 'font-size:13px;opacity:.6;max-width:300px;line-height:1.4;';
    d.textContent = 'Купленные вещи появятся здесь. Загляни в магазин — там шапки, очки, костюмы и принты.';
    ownEl.appendChild(d);
  }
}

// ===== Магазин стиля (примерка бесплатна, покупка за Stars) =====

let _shopSel = null; // выбранная в магазине вещь (примеряется на превью)

function openAccShop() {
  if (G.state !== 'wardrobe') return;
  G.state = 'accshop';
  document.getElementById('wardrobe-panel').classList.add('hidden');
  _shopSel = null;
  renderAccShop();
  document.getElementById('accshop-panel').classList.remove('hidden');
}

function closeAccShop() {
  document.getElementById('accshop-panel').classList.add('hidden');
  G.state = 'wardrobe';
  renderWardrobe();
  document.getElementById('wardrobe-panel').classList.remove('hidden');
}

function renderAccShop() {
  // превью: текущий наряд + примерка выбранного
  const tryOn = Object.assign({}, G.outfit);
  if (_shopSel) {
    tryOn[SLOT_FIELD[accSlot(_shopSel)]] = _shopSel;
    if (accSlot(_shopSel) === 'print') tryOn.costume = null; // костюм закрыл бы примеряемый принт
  }
  drawOutfitPreview('shop-preview', tryOn);

  const buyEl = document.getElementById('shop-buy');
  buyEl.innerHTML = '';
  if (_shopSel && !accsOwned.has(_shopSel)) {
    const k = _shopSel, plainName = OUTFIT_ACCS[k].name.replace(/^\S+ /, '');
    const bb = document.createElement('button');
    bb.textContent = '⭐ Купить «' + plainName + '» за ' + ACC_PRICES[k] + '⭐';
    bb.onclick = () => {
      if (IS_TMA) netBuyAcc(k, () => {
        toast('⭐ «' + plainName + '» твоя навсегда!');
        G.outfit[SLOT_FIELD[accSlot(k)]] = k; // купленное надевается сразу
        applyOutfit(); saveGame();
        if (G.state === 'accshop') renderAccShop();
      });
      else toast('Аксессуары покупаются в Telegram: @poketmons_bot');
    };
    buyEl.appendChild(bb);
  } else {
    const d = document.createElement('div');
    d.style.cssText = 'font-size:12px;opacity:.6;';
    d.textContent = _shopSel ? '✅ Уже куплено — надевается в Гардеробе' : 'Тыкни вещь — примерка бесплатна';
    buyEl.appendChild(d);
  }

  const catEl = document.getElementById('shop-cats');
  catEl.innerHTML = '';
  for (const [slot, title] of ACC_CATS) {
    const items = Object.keys(OUTFIT_ACCS).filter(k => accSlot(k) === slot);
    if (!items.length) continue;
    const h = document.createElement('div');
    h.style.cssText = 'align-self:flex-start;font-size:13px;opacity:.85;';
    h.textContent = title + ':';
    catEl.appendChild(h);
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:6px;flex-wrap:wrap;justify-content:center;';
    for (const k of items) {
      const b = document.createElement('button');
      const owned = accsOwned.has(k);
      b.textContent = owned ? '✅ ' + OUTFIT_ACCS[k].name : OUTFIT_ACCS[k].name + ' · ' + ACC_PRICES[k] + '⭐';
      if (owned) b.style.opacity = '.6';
      if (_shopSel === k) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
      b.onclick = () => { _shopSel = (_shopSel === k) ? null : k; renderAccShop(); };
      row.appendChild(b);
    }
    catEl.appendChild(row);
  }
}

// ===== Генератор заказных братишек (за Stars) =====

let _mgDraft = null; // {type, palette, seed, name}

function openMongen() {
  if (G.state === 'shop') closeShop();
  if (G.state !== 'world') return;
  G.state = 'mongen';
  if (!_mgDraft) _mgDraft = { type: 'fire', palette: 'ruby', seed: 0, name: '' };
  mongenReroll();
  document.getElementById('mongen-panel').classList.remove('hidden');
  netMongenStatus(s => { if (G.state === 'mongen') renderMongenBuy(s); });
}

function closeMongen() {
  document.getElementById('mongen-panel').classList.add('hidden');
  G.state = 'world';
}

// подобрать новый вид под выбранный тип
function mongenReroll() {
  _mgDraft.seed = findSpeciesForOrder((Math.random() * 4294967296) >>> 0, _mgDraft.type);
  renderMongen();
}

function renderMongen() {
  const typeEl = document.getElementById('mg-types');
  typeEl.innerHTML = '';
  for (const t of TYPE_LIST) {
    const ti = TYPE_INFO[t];
    const b = document.createElement('button');
    b.textContent = ti.ru;
    b.style.cssText = 'font-size:12px;padding:6px 8px;color:' + ti.color + ';' +
      (_mgDraft.type === t ? 'border-color:' + ti.color + ';' : '');
    b.onclick = () => { _mgDraft.type = t; mongenReroll(); };
    typeEl.appendChild(b);
  }

  const palEl = document.getElementById('mg-pals');
  palEl.innerHTML = '';
  const pals = [[null, '🌿 природный']].concat(Object.entries(MON_PALETTES).map(([k, p]) => [k, p.name]));
  for (const [k, label] of pals) {
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-size:12px;padding:6px 8px;' + (k ? 'color:' + MON_PALETTES[k].color + ';' : '');
    if (_mgDraft.palette === k) b.style.borderColor = k ? MON_PALETTES[k].color : 'var(--ui-accent)';
    b.onclick = () => { _mgDraft.palette = k; renderMongen(); };
    palEl.appendChild(b);
  }

  // предпросмотр всей цепочки эволюций
  const prev = document.getElementById('mg-preview');
  prev.innerHTML = '';
  const sp = getSpecies(_mgDraft.seed);
  for (let st = 0; st < sp.chainLen; st++) {
    const cv = document.createElement('canvas');
    cv.width = 20; cv.height = 20;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const spr = speciesSprite(_mgDraft.seed, st, true, false, _mgDraft.palette);
    c.drawImage(spr, Math.floor((20 - spr.width) / 2), Math.floor((20 - spr.height) / 2));
    cv.style.cssText = 'width:' + (40 + st * 14) + 'px;image-rendering:pixelated;align-self:flex-end;';
    prev.appendChild(cv);
  }
  const b0 = sp.stages[0].base;
  document.getElementById('mg-info').innerHTML =
    '<b>' + sp.stages.map(s => s.name).join(' → ') + '</b><br>' +
    '<span style="opacity:.8">✨ шайни (+18% статов) · сумма базы: ' + (b0.hp + b0.atk + b0.def + b0.spd) +
    ' · 3 стадии · старт с Ур.5</span>';
}

function renderMongenBuy(status) {
  const box = document.getElementById('mg-buy');
  box.innerHTML = '';
  const nameInp = document.getElementById('mg-name');
  const makeBtn = document.createElement('button');
  if (status.vip || status.credits > 0) {
    makeBtn.textContent = '✨ Собрать братишку' + (status.vip ? ' (VIP)' : ' (оплачено: ' + status.credits + ')');
    makeBtn.onclick = () => {
      makeBtn.disabled = true;
      netMongenClaim(ok => {
        if (!ok) { makeBtn.disabled = false; toast('Не вышло списать оплату — попробуй ещё раз.'); return; }
        const m = makeMonster(_mgDraft.seed, 0, 5);
        m.nick = nameInp.value.trim().slice(0, 12) || null;
        m.palette = _mgDraft.palette;
        m.shiny = true;           // заказные всегда шайни (+18% статов, ✨)
        recalcStats(m);
        m.hp = m.maxHp;
        if (G.party.length < 6) { G.party.push(m); toast('✨ ' + monName(m) + ' присоединяется к братве!'); }
        else { G.storage.push(m); toast('✨ ' + monName(m) + ' ждёт в кармане!'); }
        dexCaught(m);
        sfx('catch');
        updateHUD(); saveGame();
        closeMongen();
      });
    };
  } else if (IS_TMA) {
    makeBtn.textContent = '⭐ Купить генерацию за ' + MONGEN_PRICE + ' Stars';
    makeBtn.onclick = () => netBuyMongen(() => {
      toast('⭐ Оплачено! Собирай братишку.');
      netMongenStatus(s => renderMongenBuy(s));
    });
  } else {
    makeBtn.textContent = 'Покупка — в Telegram: @poketmons_bot';
    makeBtn.onclick = () => toast('Открой игру в Telegram, чтобы купить.');
  }
  box.appendChild(makeBtn);
}

// ===== Экспорт сейва =====

function openExport() {
  saveGame();
  document.getElementById('export-code').value = exportSaveCode();
  document.getElementById('map-panel').classList.add('hidden');
  G.state = 'export';
  document.getElementById('export-panel').classList.remove('hidden');
}

function closeExport() {
  document.getElementById('export-panel').classList.add('hidden');
  G.state = 'world';
}

// ===== Братопедия (панель) =====

function silhouette(spr) {
  const cv = document.createElement('canvas');
  cv.width = spr.width; cv.height = spr.height;
  const c = cv.getContext('2d');
  c.drawImage(spr, 0, 0);
  c.globalCompositeOperation = 'source-in';
  c.fillStyle = '#2e2e3e';
  c.fillRect(0, 0, cv.width, cv.height);
  return cv;
}

function toggleDex() {
  const panel = document.getElementById('dex-panel');
  if (G.state === 'dex') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'dex';
  renderDexGrid();
  panel.classList.remove('hidden');
}

function renderDexGrid() {
  document.getElementById('dex-count').textContent =
    'Поймано видов: ' + G.dex.caught.size + ' · Замечено: ' + G.dex.seen.size;
  const grid = document.getElementById('dex-grid');
  grid.innerHTML = '';
  const seeds = [...G.dex.seen].sort((a, b) => a - b);
  for (const seed of seeds) {
    const sp = getSpecies(seed);
    const isCaught = G.dex.caught.has(seed);
    const card = document.createElement('div');
    card.className = 'dcard' + (isCaught ? '' : ' ghost');
    const cv = document.createElement('canvas');
    cv.width = 24; cv.height = 24;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const isShiny = G.dex.shiny.has(seed);
    const spr = speciesSprite(seed, 0, isShiny);
    c.drawImage(isCaught ? spr : silhouette(spr), Math.floor((24 - spr.width) / 2), Math.floor((24 - spr.height) / 2));
    card.appendChild(cv);
    const t = TYPE_INFO[sp.stages[0].type];
    const info = document.createElement('div');
    if (isCaught) {
      info.innerHTML = '<div class="nm">' + (isShiny ? '✨' : '') + sp.stages[0].name + '</div>' +
        '<div style="color:' + t.color + '">' + t.ru + '</div>' +
        '<div style="opacity:.7">' + sp.stages.map(s => s.name).join(' → ') + '</div>';
      // тап по пойманному виду — открыть карточку с описанием
      card.style.cursor = 'pointer';
      card.onclick = () => openDexCard(seed);
    } else {
      info.innerHTML = '<div class="nm">' + sp.stages[0].name + '</div>' +
        '<div style="opacity:.6">???</div>';
    }
    card.appendChild(info);
    grid.appendChild(card);
  }
  if (!seeds.length) grid.innerHTML = '<p style="opacity:.7">Пока пусто — иди в высокую траву!</p>';
}

// Карточка вида (в стиле Animal Crossing): крупный спрайт, цепочка эволюций,
// статы и процедурное описание. Открывается тапом из грида Братопедии.
function openDexCard(seed) {
  const sp = getSpecies(seed);
  const st0 = sp.stages[0];
  const t = TYPE_INFO[st0.type];
  const isShiny = G.dex.shiny.has(seed);
  document.getElementById('dex-count').textContent = '';
  const dexGrid = document.getElementById('dex-grid');
  dexGrid.innerHTML = '';
  // dex-grid — flex-row wrap (сетка карточек); для детальной карточки кладём
  // всё в один колоночный контейнер, иначе элементы разъедутся по ряду
  const grid = document.createElement('div');
  grid.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:12px;width:100%;';
  dexGrid.appendChild(grid);

  const back = document.createElement('button');
  back.textContent = '‹ Назад к видам';
  back.onclick = () => { document.getElementById('dex-count').textContent = ''; renderDexGrid(); };
  grid.appendChild(back);

  // крупный спрайт
  const big = document.createElement('canvas');
  big.width = 48; big.height = 48;
  big.style.cssText = 'width:120px;height:120px;image-rendering:pixelated;';
  const bc = big.getContext('2d');
  bc.imageSmoothingEnabled = false;
  const spr = speciesSprite(seed, sp.chainLen - 1, isShiny);
  bc.drawImage(spr, Math.floor((48 - spr.width) / 2), Math.floor((48 - spr.height) / 2), spr.width, spr.height);
  grid.appendChild(big);

  const title = document.createElement('div');
  title.style.cssText = 'font-size:18px;font-weight:bold;';
  title.innerHTML = (isShiny ? '✨ ' : '') + st0.name +
    ' <span style="color:' + t.color + ';font-size:14px">' + t.ru + '</span>';
  grid.appendChild(title);

  // цепочка эволюций со спрайтами
  const chain = document.createElement('div');
  chain.style.cssText = 'display:flex;gap:10px;align-items:flex-end;justify-content:center;flex-wrap:wrap;';
  sp.stages.forEach((s, i) => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:2px;';
    const cv = document.createElement('canvas');
    cv.width = 30; cv.height = 30;
    cv.style.cssText = 'width:' + (44 + i * 8) + 'px;image-rendering:pixelated;';
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const s2 = speciesSprite(seed, i, isShiny);
    c.drawImage(s2, Math.floor((30 - s2.width) / 2), Math.floor((30 - s2.height) / 2));
    wrap.appendChild(cv);
    const nm = document.createElement('div');
    nm.style.cssText = 'font-size:11px;opacity:.85;';
    nm.textContent = s.name;
    wrap.appendChild(nm);
    chain.appendChild(wrap);
  });
  grid.appendChild(chain);

  // базовые статы вида
  const b = st0.base;
  const stats = document.createElement('div');
  stats.style.cssText = 'font-size:12px;opacity:.85;';
  stats.textContent = 'Задатки: ОЗ ' + b.hp + ' · АТК ' + b.atk + ' · ЗАЩ ' + b.def + ' · СКР ' + b.spd;
  grid.appendChild(stats);

  // процедурное описание
  const flav = document.createElement('div');
  flav.style.cssText = 'font-size:13px;line-height:1.5;max-width:min(440px,92vw);background:var(--ui-panel);' +
    'border:2px solid var(--ui-border);border-radius:6px;padding:10px 12px;';
  flav.textContent = speciesFlavor(seed);
  grid.appendChild(flav);
}

// ===== Панель команды =====

function togglePartyPanel() {
  const panel = document.getElementById('party-panel');
  if (G.state === 'party') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'party';
  renderPartyRows();
  panel.classList.remove('hidden');
}

// ===== Инвентарь (I / 🎒 в тач-меню): те же категории, что в лавке, без цен =====

function toggleInventory() {
  const panel = document.getElementById('inv-panel');
  if (G.state === 'inv') { closeInventory(); return; }
  if (G.state !== 'world') return;
  G.state = 'inv';
  _invPick = null;
  renderInventory();
  panel.classList.remove('hidden');
}

// закрываем и после применения предмета — иначе тосты не видно под оверлеем
function closeInventory() {
  document.getElementById('inv-panel').classList.add('hidden');
  G.state = 'world';
}

let _invCat = 'potions'; // активная вкладка (та же навигация, что в лавке)
let _invPick = null;     // id зелья, для которого выбираем братишку-цель

// Почему зелье нельзя применить на этого братишку (null — можно)
function invBlockReason(itemId, m) {
  if (itemId === 'tonic') return m.status ? null : 'нет недуга';
  if (itemId === 'ether') return m.moves.some(mv => mv.pp < mv.maxPp) ? null : 'ПП полные';
  // зелья лечения
  if (m.hp <= 0) return 'в нокауте — неси к фонтану';
  return m.hp < m.maxHp ? null : 'здоров';
}

function invApplyToMon(itemId, m) {
  if (itemId === 'potion') { m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp / 2)); return '🧪 ' + monName(m) + ' восстанавливает здоровье!'; }
  if (itemId === 'superpotion') { m.hp = m.maxHp; return '✨ ' + monName(m) + ' полностью здоров!'; }
  if (itemId === 'tonic') { m.status = null; return '💊 Тоник снимает недуг с ' + monName(m) + '!'; }
  m.moves.forEach(mv => { mv.pp = mv.maxPp; });
  return '🔷 Эфир восполняет все умения ' + monName(m) + '!';
}

// Пикер цели: ОЗ, статус и запас ПП — видно, кому зелье нужнее
function renderInvPicker(rows) {
  const item = SHOP_ITEMS.find(it => it.id === _invPick);
  const head = document.createElement('div');
  head.style.cssText = 'font-size:13px;opacity:.9;text-align:left;';
  head.textContent = 'Кому применить «' + item.name + '»?';
  rows.appendChild(head);
  const back = document.createElement('button');
  back.textContent = '‹ Назад';
  back.onclick = () => { _invPick = null; renderInventory(); };
  rows.appendChild(back);
  G.party.forEach(m => {
    const ppSum = m.moves.reduce((a, mv) => a + mv.pp, 0);
    const ppMax = m.moves.reduce((a, mv) => a + mv.maxPp, 0);
    const ppNote = ppSum === 0 ? ' · <b style="color:var(--ui-hp-low)">нет ПП!</b>'
      : ppSum < ppMax * 0.35 ? ' · <span style="color:var(--ui-accent)">мало ПП (' + ppSum + '/' + ppMax + ')</span>'
      : ' · ПП ' + ppSum + '/' + ppMax;
    const why = invBlockReason(_invPick, m);
    const b = document.createElement('button');
    b.style.textAlign = 'left';
    b.innerHTML = (m.shiny ? '✨' : '') + monName(m) + ' (Ур.' + m.level + ')' + statusTag(m) +
      '<br><span style="font-size:12px;opacity:.85">' +
      (m.hp <= 0 ? '<b style="color:var(--ui-hp-low)">0</b>' : m.hp) + '/' + m.maxHp + ' ОЗ' + ppNote +
      (why ? ' · <span style="opacity:.7">' + why + '</span>' : '') + '</span>';
    b.disabled = !!why;
    b.onclick = () => {
      if (!G.bag[_invPick]) return;
      G.bag[_invPick]--;
      const msg = invApplyToMon(_invPick, m);
      sfx('heal');
      closeInventory();
      toast(msg);
      updateHUD();
      saveGame();
    };
    rows.appendChild(b);
  });
}

function renderInventory() {
  const count = it => it.id.startsWith('ball_') ? G.balls[it.id.slice(5)]
    : it.id === 'scroll' ? G.scrolls.length
    : it.id.startsWith('charm_') ? G.charms[it.id.slice(6)]
    : G.bag[it.id] || 0;
  // вкладки — те же категории, что в лавке (кроме премиум-витрины)
  const tabs = document.getElementById('inv-tabs');
  tabs.innerHTML = '';
  for (const [cat, label] of SHOP_CATS) {
    if (cat === 'donate') continue;
    const b = document.createElement('button');
    b.textContent = label;
    b.style.cssText = 'font-size:12px;padding:6px 10px;';
    if (cat === _invCat) { b.style.borderColor = 'var(--ui-accent)'; b.style.color = 'var(--ui-accent)'; }
    b.onclick = () => { _invCat = cat; _invPick = null; renderInventory(); };
    tabs.appendChild(b);
  }
  const rows = document.getElementById('inv-rows');
  rows.innerHTML = '';
  if (_invPick) { renderInvPicker(rows); return; }
  const items = SHOP_ITEMS.filter(it => it.cat === _invCat && count(it) > 0);
  if (!items.length) {
    rows.innerHTML = '<span style="opacity:.6">В этой категории пусто — загляни в лавку в городе.</span>';
    return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'srow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">' + it.name + '</span> — есть ' +
      (it.id === 'rod' ? '✔' : '<b style="color:var(--ui-accent)">' + count(it) + '</b>') +
      '<br><span style="opacity:.8">' + it.desc + '</span>';
    row.appendChild(info);
    // репеллент действует сразу, зелья спрашивают цель
    if (REPEL_STEPS[it.id]) {
      const use = document.createElement('button');
      use.textContent = 'Применить';
      use.onclick = () => {
        if (G.repelSteps > 0) { toast('🚫 Репеллент ещё действует: осталось ' + G.repelSteps + ' шагов.'); return; }
        if (!G.bag[it.id]) return;
        G.bag[it.id]--;
        G.repelSteps = REPEL_STEPS[it.id];
        sfx('pickup');
        closeInventory();
        toast('🚫 Дикие отгоняются ' + G.repelSteps + ' шагов — счётчик виден вверху.');
        updateHUD(); saveGame();
      };
      row.appendChild(use);
    } else if (['potion', 'superpotion', 'tonic', 'ether'].includes(it.id)) {
      const use = document.createElement('button');
      use.textContent = 'Применить';
      use.onclick = () => { _invPick = it.id; renderInventory(); };
      row.appendChild(use);
    }
    rows.appendChild(row);
  }
}

// Компактный список: спрайт, имя, уровень, тип, эво, ОЗ — детали в модалке
function renderPartyRows() {
  const rows = document.getElementById('party-rows');
  rows.innerHTML = '';
  G.party.forEach((m, i) => {
    const st = getSpecies(m.speciesSeed).stages[m.stage];
    const row = document.createElement('div');
    row.className = 'prow';
    row.appendChild(monMiniCanvas(m, 28));

    const t = TYPE_INFO[st.type];
    const pct = Math.max(0, m.hp / m.maxHp * 100);
    const info = document.createElement('div');
    info.className = 'info';
    const shownName = (m.shiny ? '✨' : '') + monName(m) + (m.nick ? ' <span style="opacity:.6">(' + st.name + ')</span>' : '');
    info.innerHTML = '<span class="nm">' + shownName + '</span> Ур.' + m.level + statusTag(m) +
      ' <span style="color:' + t.color + '">' + t.ru + '</span>' +
      (st.evolveLevel ? ' <span style="opacity:.6">эво на ' + st.evolveLevel + '</span>' : '') +
      '<div class="bar"><i class="' + (pct < 30 ? 'low' : '') + '" style="width:' + pct + '%"></i></div>' +
      '<div style="opacity:.75;font-size:11px">' + m.hp + '/' + m.maxHp + ' ОЗ</div>';
    row.appendChild(info);

    const bMore = document.createElement('button');
    bMore.textContent = 'ℹ️';
    bMore.title = 'Подробнее';
    bMore.onclick = () => openMonDetail(i);
    row.appendChild(bMore);
    rows.appendChild(row);
  });
}

// ===== Модалка одного братишки =====

function closeMonDetail() {
  document.getElementById('mon-panel').classList.add('hidden');
  G.state = 'world';
  togglePartyPanel(); // назад к списку команды
}

function openMonDetail(i) {
  const m = G.party[i];
  if (!m) { closeMonDetail(); return; }
  document.getElementById('party-panel').classList.add('hidden');
  G.state = 'mondetail';
  const sp = getSpecies(m.speciesSeed);
  const st = sp.stages[m.stage];
  const t = TYPE_INFO[st.type];
  // после действия перерисовываем модалку этого же монстрика
  const rerender = () => { updateHUD(); saveGame(); openMonDetail(i); };

  document.getElementById('mon-title').innerHTML =
    (m.shiny ? '✨' : '') + monName(m) + (m.nick ? ' <span style="opacity:.6;font-size:14px">(' + st.name + ')</span>' : '');
  const body = document.getElementById('mon-body');
  body.innerHTML = '';

  // шапка: крупный спрайт + основные цифры
  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:16px;';
  const cv = monMiniCanvas(m, 36);
  cv.style.cssText = 'width:120px;height:120px;image-rendering:pixelated;flex-shrink:0;';
  head.appendChild(cv);
  const pct = Math.max(0, m.hp / m.maxHp * 100);
  const info = document.createElement('div');
  info.style.cssText = 'text-align:left;font-size:13px;flex:1;min-width:0;line-height:1.6;';
  info.innerHTML =
    '<div>' + stageWord(m.stage) + ' · Ур.' + m.level + statusTag(m) + ' · <span style="color:' + t.color + '">' + t.ru + '</span> · ' +
    (st.evolveLevel ? 'эво на ' + st.evolveLevel
      : m.mega ? '<span style="color:var(--ui-accent)">💠 МЕГА-ФОРМА</span>'
      : canMega(m) ? 'готов к 💠 мегаэволюции'
      : 'финальная форма (мега с ' + MEGA_LEVEL + ' ур.)') + '</div>' +
    '<div class="bar" style="height:8px;margin:4px 0"><i class="' + (pct < 30 ? 'low' : '') + '" style="width:' + pct + '%"></i></div>' +
    '<div style="opacity:.85">' + m.hp + '/' + m.maxHp + ' ОЗ · АТК ' + m.atk + ' · ЗАЩ ' + m.def + ' · СКР ' + m.spd + '</div>' +
    '<div style="opacity:.85">Опыт: ' + m.exp + '/' + expToNext(m.level) + '</div>' +
    (m.charm ? '<div style="opacity:.85">Амулет: ' + CHARMS[m.charm].ic + ' ' + CHARMS[m.charm].name + '</div>' : '');
  head.appendChild(info);
  body.appendChild(head);

  // умения: тап — поднять выше в списке
  const mvTitle = document.createElement('div');
  mvTitle.style.cssText = 'opacity:.7;font-size:12px;text-align:left;';
  mvTitle.textContent = 'Умения (тап — поднять выше; это порядок в меню боя):';
  body.appendChild(mvTitle);
  const mvDiv = document.createElement('div');
  mvDiv.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
  m.moves.forEach((mv, mi) => {
    const mb = document.createElement('button');
    mb.style.textAlign = 'left';
    mb.innerHTML = (mi + 1) + '. ' + mv.name + ' <span style="color:' + TYPE_INFO[mv.type].color + '">' +
      TYPE_INFO[mv.type].ru + '</span> · сила ' + mv.power + ' · ПП ' + mv.pp + '/' + mv.maxPp + moveEffectLabel(mv);
    mb.onclick = () => {
      if (mi === 0) return;
      [m.moves[mi - 1], m.moves[mi]] = [m.moves[mi], m.moves[mi - 1]];
      saveGame();
      openMonDetail(i);
    };
    mvDiv.appendChild(mb);
  });
  body.appendChild(mvDiv);

  // действия
  const acts = document.createElement('div');
  acts.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:center;';

  const bNick = document.createElement('button');
  bNick.textContent = '✏️ Кличка';
  bNick.onclick = () => {
    const nn = prompt('Кличка для ' + st.name + ' (пусто — сбросить):', m.nick || '');
    if (nn === null) return;
    m.nick = nn.trim().slice(0, 12) || null;
    rerender();
  };
  acts.appendChild(bNick);

  // кастомный спрайт: загрузка своего PNG (платная разблокировка за Stars)
  const bSpr = document.createElement('button');
  const sprOk = sprUnlocked || NZ();
  bSpr.textContent = sprOk
    ? (m.customSprite ? '🖼 Сменить спрайт' : '🖼 Свой спрайт')
    : '🔒 Свой спрайт · ' + SPRITE_PRICE + '⭐';
  bSpr.onclick = () => {
    const hint = document.getElementById('spr-hint');
    if (hint) { hint.remove(); return; }
    const box = document.createElement('div');
    box.id = 'spr-hint';
    box.style.cssText = 'width:100%;background:var(--ui-panel);border:2px solid var(--ui-border);border-radius:6px;padding:10px;font-size:12px;line-height:1.5;display:flex;flex-direction:column;gap:8px;';
    if (!sprOk) {
      // витрина покупки
      box.innerHTML = '<b style="color:var(--ui-accent)">🖼 Свои спрайты братвы</b>' +
        '<br>Загружай собственные PNG-облики для любых своих братишек — навсегда, на все устройства с этим сейвом.';
      const buyRow = document.createElement('div');
      buyRow.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
      if (IS_TMA) {
        const buyBtn = document.createElement('button');
        buyBtn.textContent = '⭐ Купить за ' + SPRITE_PRICE + ' Stars';
        buyBtn.onclick = () => netBuySpriteUnlock(() => {
          toast('🖼 Загрузка своих спрайтов открыта!');
          openMonDetail(i);
        });
        buyRow.appendChild(buyBtn);
      } else {
        const note = document.createElement('div');
        note.style.cssText = 'opacity:.8;';
        note.textContent = 'Покупка за Stars — в Telegram: @poketmons_bot. Или введи промокод:';
        buyRow.appendChild(note);
      }
      const promoBtn = document.createElement('button');
      promoBtn.textContent = '🎟 Промокод';
      promoBtn.onclick = () => {
        const code = prompt('Введи промокод:');
        if (!code || !code.trim()) return;
        netRedeemCode(code.trim(), ok => {
          if (ok) { toast('🎟 Промокод принят — спрайты открыты!'); openMonDetail(i); }
          else toast('Промокод не подошёл или уже израсходован.');
        });
      };
      buyRow.appendChild(promoBtn);
      box.appendChild(buyRow);
      acts.parentNode.insertBefore(box, acts.nextSibling);
      // проверим — вдруг уже куплено на другом устройстве
      netCheckUnlock(ok => { if (ok) { toast('🖼 Спрайты уже открыты!'); openMonDetail(i); } });
      return;
    }
    box.innerHTML = 'Лучше всего выглядит <b>пиксель-арт 24×24</b>: PNG с прозрачным фоном, персонаж <b>смотрит влево</b>.' +
      '<br><span style="opacity:.7">Другие картинки тоже можно — мы обрежем по краям и пикселизуем до 24×24.</span>';
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:8px;justify-content:center;flex-wrap:wrap;';
    const pickBtn = document.createElement('button');
    pickBtn.textContent = '📂 Выбрать файл';
    pickBtn.onclick = () => {
      const inp = document.getElementById('spr-file');
      inp.value = '';
      inp.onchange = () => {
        const file = inp.files && inp.files[0];
        if (!file) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          const dataUrl = pixelateImage(img);
          if (!dataUrl || !validCustomSprite(dataUrl)) { toast('Не вышло: картинка не читается или слишком пёстрая.'); return; }
          m.customSprite = dataUrl;
          _customImgs.delete(dataUrl); // на случай коллизии — перезагрузим
          saveGame();
          toast('🖼 Новый облик для ' + monName(m) + '!');
          openMonDetail(i);
        };
        img.onerror = () => { URL.revokeObjectURL(url); toast('Не удалось открыть картинку.'); };
        img.src = url;
      };
      inp.click();
    };
    row.appendChild(pickBtn);
    if (m.customSprite) {
      const rmBtn = document.createElement('button');
      rmBtn.textContent = '↩️ Вернуть обычный';
      rmBtn.onclick = () => { m.customSprite = null; saveGame(); openMonDetail(i); };
      row.appendChild(rmBtn);
    }
    box.appendChild(row);
    acts.parentNode.insertBefore(box, acts.nextSibling);
  };
  acts.appendChild(bSpr);

  if (m.charm || Object.values(G.charms).some(n => n > 0)) {
    const sel = document.createElement('select');
    sel.style.cssText = 'font-family:inherit;font-size:12px;background:#111;color:#e8e8f0;border:2px solid var(--ui-border);border-radius:4px;padding:6px;max-width:94%;';
    const optNone = document.createElement('option');
    optNone.value = '';
    optNone.textContent = m.charm ? '— снять амулет —' : '🧿 амулет...';
    sel.appendChild(optNone);
    for (const [kind, ch] of Object.entries(CHARMS)) {
      if (kind !== m.charm && G.charms[kind] < 1) continue;
      const opt = document.createElement('option');
      opt.value = kind;
      opt.textContent = ch.ic + ' ' + ch.name + ' (' + ch.desc + ')';
      if (kind === m.charm) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.onchange = () => {
      const ratio = m.hp / m.maxHp;
      if (m.charm) G.charms[m.charm]++;      // вернуть старый в сумку
      m.charm = sel.value || null;
      if (m.charm) G.charms[m.charm]--;
      recalcStats(m);
      m.hp = Math.max(1, Math.round(m.maxHp * ratio));
      rerender();
    };
    acts.appendChild(sel);
  }

  // мегаэволюция: финальная стадия, MEGA_LEVEL+, тратит мега-камень
  if (G.bag.megastone > 0 && canMega(m)) {
    const bMega = document.createElement('button');
    bMega.textContent = '💠 Мегаэволюция';
    bMega.style.color = 'var(--ui-accent)';
    bMega.onclick = () => {
      if (!confirm('Провести мегаэволюцию ' + monName(m) + '? Мега-камень исчезнет, эффект навсегда: +35% ко всем статам.')) return;
      G.bag.megastone--;
      const ratio = m.hp / m.maxHp;
      const oldName = monSpeciesName(m);
      m.mega = true;
      recalcStats(m);
      m.hp = Math.max(1, Math.round(m.maxHp * ratio));
      G.stats.megas = (G.stats.megas || 0) + 1;
      sfx('catch');
      toast('💠 ' + oldName + ' проходит МЕГАЭВОЛЮЦИЮ — теперь это ' + monSpeciesName(m) + '!');
      rerender();
    };
    acts.appendChild(bMega);
  }

  if (G.bag.stone > 0 && st.evolveLevel !== null) {
    const bStone = document.createElement('button');
    bStone.textContent = '🪨 Эво-камень';
    bStone.onclick = () => {
      if (!confirm('Эволюционировать ' + monName(m) + ' камнем? Камень исчезнет.')) return;
      G.bag.stone--;
      const ratio = m.hp / m.maxHp;
      const oldName = monSpeciesName(m);
      m.stage++;
      recalcStats(m);
      m.hp = Math.max(1, Math.round(m.maxHp * ratio));
      G.stats.evolutions++;
      dexCaught(m);
      sfx('catch');
      toast('🪨 ' + oldName + ' эволюционирует в ' + monSpeciesName(m) + '!');
      rerender();
    };
    acts.appendChild(bStone);
  }

  if (G.scrolls.length) {
    const bTeach = document.createElement('button');
    bTeach.textContent = '📜 Свитки (' + G.scrolls.length + ')';
    bTeach.onclick = () => {
      document.getElementById('mon-panel').classList.add('hidden');
      G.state = 'world';
      openTeach(m);
    };
    acts.appendChild(bTeach);
  }

  if (G.bag.ether > 0 && m.moves.some(mv => mv.pp < mv.maxPp)) {
    const bEth = document.createElement('button');
    bEth.textContent = '💧 Эфир';
    bEth.onclick = () => {
      G.bag.ether--;
      m.moves.forEach(mv => { mv.pp = mv.maxPp; });
      sfx('heal');
      rerender();
    };
    acts.appendChild(bEth);
  }

  if (m.hp < m.maxHp && G.bag.potion > 0) {
    const bPot = document.createElement('button');
    bPot.textContent = '🧪 Зелье (x' + G.bag.potion + ')';
    bPot.onclick = () => {
      G.bag.potion--;
      m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp / 2));
      sfx('heal');
      rerender();
    };
    acts.appendChild(bPot);
  }

  if (m.status && G.bag.tonic > 0) {
    const bTon = document.createElement('button');
    bTon.textContent = '💊 Тоник';
    bTon.onclick = () => {
      G.bag.tonic--;
      m.status = null;
      sfx('heal');
      rerender();
    };
    acts.appendChild(bTon);
  }

  if (i > 0) {
    const bLead = document.createElement('button');
    bLead.textContent = '👑 Сделать лидером';
    bLead.onclick = () => {
      G.party.splice(i, 1);
      G.party.unshift(m);
      updateHUD(); saveGame();
      openMonDetail(0);
    };
    acts.appendChild(bLead);
  }

  if (G.party.length > 1) {
    const bBox = document.createElement('button');
    bBox.textContent = '📦 В карман';
    bBox.onclick = () => {
      storageDeposit(i);
      closeMonDetail();
    };
    acts.appendChild(bBox);
  }

  body.appendChild(acts);
  document.getElementById('mon-panel').classList.remove('hidden');
}

// ===== Инициализация =====

function initInput() {
  window.addEventListener('keydown', e => {
    // не перехватываем клавиши, когда пользователь печатает в поле ввода
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'TEXTAREA' || tag === 'INPUT' || tag === 'SELECT') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    if (Battle.onKey(e)) { e.preventDefault(); return; }
    if (e.key === 'Tab') { e.preventDefault(); togglePartyPanel(); return; }
    if (e.code === 'KeyM' && (G.state === 'world' || G.state === 'map')) { toggleMap(); return; }
    if (e.code === 'KeyP' && (G.state === 'world' || G.state === 'dex')) { toggleDex(); return; }
    if (e.code === 'KeyO' && (G.state === 'world' || G.state === 'ach')) { toggleAchievements(); return; }
    if (e.code === 'KeyF' && G.state === 'world') { tryFishing(); return; }
    if (e.code === 'KeyG' && G.state === 'world') { setGrind(!GRIND_ON); return; }
    if (e.code === 'KeyT' && (G.state === 'world' || G.state === 'friend')) { toggleFriendPanel(); return; }
    if (e.code === 'KeyB' && (G.state === 'world' || G.state === 'storage' || G.state === 'party')) { toggleStorage(); return; }
    if (e.code === 'KeyH' && (G.state === 'world' || G.state === 'guide')) { toggleGuide(); return; }
    if (e.code === 'KeyI' && (G.state === 'world' || G.state === 'inv')) { toggleInventory(); return; }
    if (e.code === 'Comma' && (G.state === 'world' || G.state === 'settings')) { toggleSettings(); return; }
    if (e.key === 'Escape' && G.state === 'accshop') { closeAccShop(); return; }
    if (e.key === 'Escape' && G.state === 'wardrobe') { closeWardrobe(); return; }
    if (e.key === 'Escape' && G.state === 'mongen') { closeMongen(); return; }
    if (e.key === 'Escape') {
      if (G.state === 'party') { togglePartyPanel(); return; }
      if (G.state === 'mondetail') { closeMonDetail(); return; }
      if (G.state === 'shop') { closeShop(); return; }
      if (G.state === 'dex') { toggleDex(); return; }
      if (G.state === 'map') { toggleMap(); return; }
      if (G.state === 'ach') { toggleAchievements(); return; }
      if (G.state === 'trade') { closeTrade(); return; }
      if (G.state === 'export') { closeExport(); return; }
      if (G.state === 'teach') { closeTeach(); return; }
      if (G.state === 'nursery') { closeNursery(); return; }
      if (G.state === 'board') { closeBoard(); return; }
      if (G.state === 'friend') { toggleFriendPanel(); return; }
      if (G.state === 'storage') { toggleStorage(); return; }
      if (G.state === 'guide') { closeGuide(); return; }
      if (G.state === 'nzlog') { nzCloseLog(); return; }
      if (G.state === 'inv') { toggleInventory(); return; }
      if (G.state === 'settings') { toggleSettings(); return; }
      if (G.state === 'world') { toggleSettings(); return; }
    }
    keys.add(e.code);
    keys.add(e.key);
    if (e.key.startsWith('Arrow')) e.preventDefault();
  });
  window.addEventListener('keyup', e => {
    keys.delete(e.code);
    keys.delete(e.key);
  });
  window.addEventListener('blur', () => keys.clear());
  document.getElementById('bt-log').addEventListener('click', () => Battle.advance());
}

function initTitle() {
  const hasSave = (() => {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY_MAIN)); return d && d.party && d.party.length; }
    catch (e) { return false; }
  })();
  if (hasSave) document.getElementById('btn-continue').classList.remove('hidden');
  const hasNzSave = (() => {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY_NZ)); return d && d.party && d.party.length; }
    catch (e) { return false; }
  })();
  if (hasNzSave) document.getElementById('btn-continue-nz').classList.remove('hidden');
  document.getElementById('nz-check').onchange = e =>
    document.getElementById('nz-rules').classList.toggle('hidden', !e.target.checked);
  document.getElementById('btn-continue-nz').onclick = () => {
    setSaveSlot('nz');
    if (loadGame()) {
      document.getElementById('title').classList.add('hidden');
      if (NZ() && G.nz.over) { nzGameOver(); return; }   // ран уже мёртв — экран итогов (Task 5)
      G.state = 'world';
      updateHUD();
      toast('☠️ Nuzlocke продолжается. Береги братву.');
    }
  };

  document.getElementById('btn-new').onclick = () => {
    const nz = document.getElementById('nz-check').checked;
    setSaveSlot(nz ? 'nz' : 'main');
    newWorld(document.getElementById('seed-input').value.trim(), nz);
  };
  document.getElementById('btn-continue').onclick = () => {
    setSaveSlot('main');
    if (loadGame()) {
      document.getElementById('title').classList.add('hidden');
      G.state = 'world';
      updateHUD();
      toast('С возвращением!');
    }
  };
  document.getElementById('btn-party-close').onclick = () => togglePartyPanel();
  document.getElementById('btn-mon-close').onclick = () => closeMonDetail();
  document.getElementById('btn-shop-close').onclick = () => closeShop();
  document.getElementById('btn-dex-close').onclick = () => toggleDex();
  document.getElementById('btn-map-close').onclick = () => toggleMap();
  document.getElementById('btn-ach-close').onclick = () => toggleAchievements();
  document.getElementById('btn-settings-close').onclick = () => toggleSettings();
  document.getElementById('bt-save').onclick = () => Battle.battleSave();
  document.getElementById('bt-load').onclick = () => Battle.battleReload();
  document.getElementById('bt-auto').onclick = () => Battle.setAuto(!Battle._auto);
  document.getElementById('bt-speed').onclick = () => Battle.cycleSpeed();
  document.getElementById('set-wardrobe').onclick = () => openWardrobe();
  document.getElementById('set-guide').onclick = () => openGuide();
  document.getElementById('btn-guide-close').onclick = () => closeGuide();
  document.getElementById('btn-inv-close').onclick = () => toggleInventory();
  document.getElementById('btn-wardrobe-close').onclick = () => closeWardrobe();
  document.getElementById('wrd-shop').onclick = () => openAccShop();
  document.getElementById('btn-accshop-close').onclick = () => closeAccShop();
  document.getElementById('btn-mongen-close').onclick = () => closeMongen();
  document.getElementById('mg-reroll').onclick = () => mongenReroll();
  document.getElementById('btn-teach-close').onclick = () => closeTeach();
  document.getElementById('btn-nursery-close').onclick = () => closeNursery();
  document.getElementById('btn-board-close').onclick = () => closeBoard();
  document.getElementById('btn-friend-close').onclick = () => toggleFriendPanel();
  document.getElementById('btn-friend-offer').onclick = () => friendOfferFlow();
  document.getElementById('btn-friend-process').onclick = () => friendProcessCode();
  document.getElementById('btn-friend-pvp').onclick = () => pvpChallengeFlow();
  const tgPvpBtn = document.getElementById('btn-friend-tgpvp');
  if (tgPvpBtn) tgPvpBtn.onclick = () => pvpTgChallengeFlow();
  document.getElementById('btn-storage-open').onclick = () => toggleStorage();
  document.getElementById('btn-storage-close').onclick = () => toggleStorage();
  document.getElementById('btn-trade-close').onclick = () => closeTrade();
  document.getElementById('btn-export').onclick = () => openExport();
  document.getElementById('btn-export-close').onclick = () => closeExport();
  document.getElementById('btn-copy-code').onclick = () => {
    const ta = document.getElementById('export-code');
    ta.select();
    try { navigator.clipboard.writeText(ta.value); } catch (e) { document.execCommand('copy'); }
    toast('Код скопирован!');
  };
  document.getElementById('btn-nzover-share').onclick = () => {
    const t = document.getElementById('nzover-text').textContent;
    try { navigator.clipboard.writeText(t); toast('📋 Летопись скопирована!'); }
    catch (e) { toast('Не вышло скопировать — выдели текст пальцем.'); }
  };
  document.getElementById('btn-nzover-restart').onclick = () => nzWipeRun();
  document.getElementById('btn-nzlog-close').onclick = () => nzCloseLog();
  document.getElementById('btn-nzlog-share').onclick = () => {
    try { navigator.clipboard.writeText(nzFullStory()); toast('📋 Фанфик скопирован — неси в чат!'); }
    catch (e) { toast('Не вышло скопировать.'); }
  };

  document.getElementById('btn-import').onclick = () => {
    const code = document.getElementById('import-code').value;
    const r = importSaveCode(code);
    if (typeof r === 'string') {
      document.getElementById('import-error').textContent = r;
      return;
    }
    setSaveSlot(r.nz ? 'nz' : 'main');
    if (loadGame()) {
      document.getElementById('title').classList.add('hidden');
      G.state = 'world';
      updateHUD();
      toast('Сейв перенесён — с возвращением!');
    } else {
      document.getElementById('import-error').textContent = 'Код применён, но загрузка не удалась.';
    }
  };
}

// ===== Тач-управление =====

// Принудительный режим из настроек: 'desktop' | 'mobile' | null (авто).
// Слабее URL-параметров (?desktop/?mobile — отладка), сильнее автодетекта.
const FORCED_MODE = (() => {
  try { const v = localStorage.getItem('mw-mode'); return v === 'desktop' || v === 'mobile' ? v : null; }
  catch (e) { return null; }
})();

// let — внутри Telegram initTelegram() дожимает в true уже по данным SDK
// (hash-признак не всегда доживает до нас во всех клиентах Telegram)
let IS_MOBILE = /[?&]desktop/.test(location.search) ? false :
                /[?&]mobile/.test(location.search) ? true :
                FORCED_MODE ? FORCED_MODE === 'mobile' :
                /tgWebApp/i.test(location.hash) || /tgWebApp/i.test(location.search) ||
                'ontouchstart' in window || navigator.maxTouchPoints > 0 ||
                (window.matchMedia && matchMedia('(pointer: coarse)').matches);

// Вектор виртуального джойстика; step() читает его напрямую
const joy = { x: 0, y: 0 };

function initTouch() {
  if (!IS_MOBILE) return;
  document.getElementById('touch-ui').classList.remove('hidden');
  // джойстик: тянем ручку от центра, персонаж идёт в ту же сторону (360°)
  const base = document.getElementById('joy-base');
  const knob = document.getElementById('joy-knob');
  const R = 44;          // ход ручки, px
  const DEAD = 0.22;     // мёртвая зона
  let pid = null;
  const update = e => {
    const rect = base.getBoundingClientRect();
    let dx = e.clientX - (rect.left + rect.width / 2);
    let dy = e.clientY - (rect.top + rect.height / 2);
    const d = Math.hypot(dx, dy) || 1;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    knob.style.transform = 'translate(' + dx + 'px,' + dy + 'px)';
    const nx = dx / R, ny = dy / R;
    if (Math.hypot(nx, ny) < DEAD) { joy.x = 0; joy.y = 0; }
    else { joy.x = nx; joy.y = ny; }
  };
  base.addEventListener('pointerdown', e => {
    e.preventDefault();
    pid = e.pointerId;
    base.setPointerCapture(pid);
    base.classList.add('on');
    update(e);
  });
  base.addEventListener('pointermove', e => { if (e.pointerId === pid) update(e); });
  const joyEnd = e => {
    if (e.pointerId !== pid) return;
    pid = null;
    joy.x = 0; joy.y = 0;
    knob.style.transform = '';
    base.classList.remove('on');
  };
  base.addEventListener('pointerup', joyEnd);
  base.addEventListener('pointercancel', joyEnd);
  // бег — переключатель
  const runBtn = document.getElementById('t-run');
  runBtn.addEventListener('pointerdown', e => {
    e.preventDefault();
    if (keys.has('Shift')) { keys.delete('Shift'); runBtn.classList.remove('on'); }
    else { keys.add('Shift'); runBtn.classList.add('on'); }
  });
  document.getElementById('t-fish').addEventListener('pointerdown', e => { e.preventDefault(); tryFishing(); });
  document.getElementById('t-grind').addEventListener('pointerdown', e => { e.preventDefault(); setGrind(!GRIND_ON); });
  // меню-кнопки
  const panelFns = { party: togglePartyPanel, map: toggleMap, dex: toggleDex, ach: toggleAchievements, nzlog: nzOpenLog, friend: toggleFriendPanel, inv: toggleInventory, settings: toggleSettings };
  document.querySelectorAll('#touch-menu .tbtn').forEach(btn => {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); panelFns[btn.dataset.panel](); });
  });
}

// Открыт по ссылке-вызову: если есть сейв — входим в мир и открываем вызов,
// иначе просим сначала завести братву (ссылка в чате остаётся — вернётся позже)
function handlePvpDeepLink(id) {
  const hasSave = (() => {
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && d.party && d.party.length; }
    catch (e) { return false; }
  })();
  if (hasSave && loadGame()) {
    document.getElementById('title').classList.add('hidden');
    G.state = 'world';
    updateHUD();
    openPvpFromLink(id);
  } else {
    toast('⚔️ Сначала заведи братву, потом открой вызов по ссылке ещё раз.');
  }
}

function main() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  initTelegram();
  if (IS_MOBILE) {
    document.body.classList.add('mobile');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));
  }
  buildTileAtlas();
  applyOutfit();
  trainerSprite = makePersonSprite('#3a6ab0', '#2a2a38');
  masterSprite = makePersonSprite('#d8a018', '#f0f0f0');
  traderSprite = makePersonSprite('#3a9a50', '#5a3a1e');
  // смотритель башни — человек в чёрном балахоне (та же вещь продаётся в Магазине стиля)
  towerSprite = makePersonSprite('#16161e', '#16161e', null, '#c8a888', { costume: 'balahon' });
  initInput();
  initTitle();
  initTouch();
  initDesktopZoom();
  applyJoySide();
  stripKeyHints();
  updateHUD();
  // разовые покупки (спрайты/самокат/сейвскам) — одним запросом /status;
  // «живого» соперника тянем лениво при первом бою (не при старте), чтобы
  // не жечь KV-операции почём зря
  netCheckStatus();

  // запуск по deep-link на PvP-вызов (?startapp=pvp<id>)
  if (IS_TMA && /^pvp[a-z0-9]+$/i.test(START_PARAM)) handlePvpDeepLink(START_PARAM.slice(3));

  // PWA: офлайн-кэш (только по http/https — с file:// SW не работает)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    // как только новый SW (свежая версия кэша) берёт контроль — один раз
    // перезагружаемся, чтобы подтянуть свежий код без ручного «перезапусти дважды».
    // hadController: на первой установке SW контроллера ещё нет — там reload не нужен
    const hadController = !!navigator.serviceWorker.controller;
    let swReloaded = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swReloaded || !hadController) return;
      swReloaded = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.body.dataset.state !== G.state) document.body.dataset.state = G.state;
    step(dt);
    maybeStartGrowth();   // после боя/PvP-опыта: церемония эволюции/умения
    if (G.state === 'world' || G.state === 'party') render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(saveGame, 15000);
}

window.addEventListener('DOMContentLoaded', main);
