'use strict';

// ===== Глобальное состояние =====

const G = {
  state: 'title',        // title | starter | world | battle | party | shop | dex | map
  seed: 0,
  player: { x: 0.5, y: 0.5, dir: 'down', frame: 0, animT: 0, moving: false },
  spawn: { x: 0.5, y: 0.5 },
  party: [],
  orbs: 15,
  money: 300,
  bag: { potion: 1, superpotion: 0, tonic: 0, ether: 0, rod: 0, stone: 0 },
  scrolls: [],           // свитки умений (объекты умений)
  charms: { atk: 0, def: 0, spd: 0, hp: 0, exp: 0 },  // амулеты в сумке
  egg: null,             // яйцо из питомника: {speciesSeed, shiny, steps, inherit, from}
  quest: null,           // активное задание с доски
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
           eggsHatched: 0, quests: 0, sawSnow: 0, sawDesert: 0, friendTrades: 0, pvpBattles: 0, pvpWins: 0 },
  clock: 0,              // игровое время, сек
  phase: 'day',          // day | evening | night | morning
  weather: 'clear',      // clear | rain
  follower: null,        // спутник: {x, y, moving, bounceT}
  lastTileKey: '',
  graceSteps: 0,         // шаги без встреч после боя
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
  { id: 'catch1',   ic: '🐾', name: 'Первый друг',      desc: 'Поймай монстрика',                   test: () => G.dex.caught.size >= 1 },
  { id: 'catch10',  ic: '📗', name: 'Коллекционер',     desc: 'Поймай 10 видов',                    test: () => G.dex.caught.size >= 10 },
  { id: 'catch25',  ic: '📚', name: 'Архивариус',       desc: 'Поймай 25 видов',                    test: () => G.dex.caught.size >= 25 },
  { id: 'shiny1',   ic: '✨', name: 'Золотая лихорадка', desc: 'Поймай сияющего монстрика',          test: () => G.dex.shiny.size >= 1 },
  { id: 'evolve1',  ic: '🦋', name: 'Метаморфоза',      desc: 'Эволюционируй монстрика',            test: () => G.stats.evolutions >= 1 },
  { id: 'party6',   ic: '👥', name: 'Полный состав',    desc: 'Собери команду из 6',                test: () => G.party.length >= 6 },
  { id: 'badge1',   ic: '🏅', name: 'Претендент',       desc: 'Выиграй значок арены',               test: () => G.badges.length >= 1 },
  { id: 'badge3',   ic: '👑', name: 'Чемпион',          desc: 'Собери 3 значка арены',              test: () => G.badges.length >= 3 },
  { id: 'train10',  ic: '⚔️', name: 'Гроза тренеров',   desc: 'Победи 10 тренеров',                 test: () => G.stats.trainersBeaten >= 10 },
  { id: 'rich',     ic: '💰', name: 'Богач',            desc: 'Накопи 5000₴',                        test: () => G.money >= 5000 },
  { id: 'far',      ic: '🧭', name: 'Первопроходец',    desc: 'Уйди на 300 тайлов от старта',        test: () => G.stats.maxDist >= 300 },
  { id: 'nest1',    ic: '🥚', name: 'Разоритель гнёзд', desc: 'Найди гнездо редкого монстра',        test: () => G.stats.nests >= 1 },
  { id: 'trade1',   ic: '🔄', name: 'Сделка века',      desc: 'Обменяйся монстриками с NPC',         test: () => G.stats.trades >= 1 },
  { id: 'surf1',    ic: '🌊', name: 'Мореплаватель',    desc: 'Проплыви по воде на монстрике',       test: () => G.stats.surfed >= 1 },
  { id: 'fish1',    ic: '🎣', name: 'Рыбак',            desc: 'Выуди монстрика удочкой',             test: () => G.stats.fished >= 1 },
  { id: 'tower5',   ic: '🗼', name: 'Покоритель башни', desc: 'Пройди 5 этажей башни испытаний',     test: () => G.stats.towerBest >= 5 },
  { id: 'legend1',  ic: '⚡', name: 'Легенда',          desc: 'Поймай легендарного монстра',         test: () => G.stats.legends >= 1 },
  { id: 'teach1',   ic: '📜', name: 'Наставник',        desc: 'Научи монстрика умению со свитка',    test: () => G.stats.taught >= 1 },
  { id: 'egg1',     ic: '🐣', name: 'Родитель',         desc: 'Выведи монстрика из яйца',            test: () => G.stats.eggsHatched >= 1 },
  { id: 'quest3',   ic: '📋', name: 'Подрядчик',        desc: 'Выполни 3 задания с доски',           test: () => G.stats.quests >= 3 },
  { id: 'charm1',   ic: '🧿', name: 'Талисман',         desc: 'Надень амулет на монстрика',          test: () => G.party.some(m => m.charm) },
  { id: 'climate',  ic: '🌍', name: 'Климатолог',       desc: 'Побывай в снегах и в пустыне',        test: () => G.stats.sawSnow >= 1 && G.stats.sawDesert >= 1 },
  { id: 'ptrade1',  ic: '🤝', name: 'Настоящий друг',   desc: 'Обменяйся монстриком с другим игроком', test: () => G.stats.friendTrades >= 1 },
  { id: 'pvp1',     ic: '⚔️', name: 'Дуэлянт',          desc: 'Сыграй PvP-бой с другом',              test: () => G.stats.pvpBattles >= 1 },
  { id: 'pvpwin',   ic: '🥇', name: 'Гладиатор',        desc: 'Выиграй PvP-бой',                      test: () => G.stats.pvpWins >= 1 },
];

// Прогресс активного задания с доски
function questProgress(kind, param) {
  const q = G.quest;
  if (!q || q.kind !== kind) return;
  if (kind === 'catch' && q.param !== param) return;
  q.progress++;
  if (q.progress >= q.need) {
    G.money += q.reward;
    if (q.bonus === 'scroll') G.scrolls.push(makeMove(mulberry32((Math.random() * 4294967296) >>> 0)));
    else G.bag.ether++;
    G.stats.quests++;
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

// ===== Монстропедия =====

function dexSee(m) { G.dex.seen.add(m.speciesSeed); }
function dexCaught(m) {
  G.dex.seen.add(m.speciesSeed);
  G.dex.caught.add(m.speciesSeed);
  if (m.shiny) G.dex.shiny.add(m.speciesSeed);
}

const SAVE_KEY = 'monsterworld-save-v1';
const keys = new Set();
let canvas, ctx;

// ===== Спрайты людей (рисуются кодом) =====

function makePersonSprite(shirt, hair) {
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
      c.fillStyle = '#e8b088';
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
    }
  }
  return cv;
}

let playerSprite = null, trainerSprite = null, masterSprite = null, traderSprite = null;
const DIR_INDEX = { down: 0, up: 1, left: 2, right: 3 };

// ===== HUD и всплывашки =====

function updateHUD() {
  checkAchievements();
  // кнопка рыбалки появляется только после покупки удочки
  document.getElementById('t-fish').classList.toggle('hidden', !G.bag.rod);
  const s = document.getElementById('hud-stats');
  const px = Math.floor(G.player.x), py = Math.floor(G.player.y);
  s.innerHTML = '🔮 <b>' + G.orbs + '</b> · 💰 <b>' + G.money + '₴</b> · 🏅 <b>' + G.badges.length +
    '</b> · 🏆 <b>' + G.achievements.size + '</b> · ' + PHASE_ICON[G.phase] + (G.weather === 'rain' ? '☔' : '') + '<br>' +
    '<span style="opacity:.7">📕 ' + G.dex.caught.size + '/' + G.dex.seen.size +
    (G.egg ? ' · 🥚 ' + G.egg.steps : '') +
    (G.quest ? ' · 📋 ' + G.quest.progress + '/' + G.quest.need : '') +
    ' · x:' + px + ' y:' + py + ' · ур. диких ~' + World.levelAt(px, py) + '</span>';
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

// ===== Сохранение =====

function dumpOwnedMon(m) {
  return {
    speciesSeed: m.speciesSeed, stage: m.stage, level: m.level,
    exp: m.exp, hp: m.hp, moves: m.moves, status: m.status || null,
    shiny: !!m.shiny, nick: m.nick || null, charm: m.charm || null,
  };
}

function reviveOwnedMon(md) {
  const m = {
    speciesSeed: md.speciesSeed >>> 0, stage: md.stage, level: md.level,
    exp: md.exp, hp: md.hp, moves: md.moves, status: md.status || null,
    shiny: !!md.shiny, nick: md.nick || null, charm: md.charm || null,
  };
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
    seed: G.seed,
    x: G.player.x, y: G.player.y,
    spawn: G.spawn,
    orbs: G.orbs,
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
  };
}

function saveGame() {
  if (G.state === 'title' || G.state === 'starter') return;
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(buildSaveData())); } catch (e) {}
}

// Код сейва: JSON -> base64 (безопасно для юникода)
function exportSaveCode() {
  return btoa(unescape(encodeURIComponent(JSON.stringify(buildSaveData()))));
}

function importSaveCode(code) {
  let data;
  try {
    data = JSON.parse(decodeURIComponent(escape(atob(code.trim()))));
  } catch (e) { return 'Не удалось прочитать код — проверь, что скопирован целиком.'; }
  if (!data || data.seed === undefined || !Array.isArray(data.party) || !data.party.length) {
    return 'Код прочитан, но данные повреждены.';
  }
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(data)); } catch (e) {}
  return null; // успех
}

function loadGame() {
  let data;
  try { data = JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return false; }
  if (!data || !data.party || !data.party.length) return false;
  G.seed = data.seed >>> 0;
  World.init(G.seed);
  G.player.x = data.x; G.player.y = data.y;
  G.spawn = data.spawn || { x: 0.5, y: 0.5 };
  G.orbs = data.orbs;
  G.money = data.money !== undefined ? data.money : 300;
  G.bag = Object.assign({ potion: 1, superpotion: 0, tonic: 0, ether: 0, rod: 0, stone: 0 }, data.bag || {});
  G.scrolls = (data.scrolls || []).map(mv => Object.assign({ maxPp: ppForPower(mv.power) }, mv));
  G.charms = Object.assign({ atk: 0, def: 0, spd: 0, hp: 0, exp: 0 }, data.charms || {});
  G.egg = data.egg || null;
  G.quest = data.quest || null;
  G.tradeOut = data.tradeOut || null;
  G.tradeIn = data.tradeIn || null;
  G.usedTrades = new Set(data.usedTrades || []);
  G.storage = (data.storage || []).map(reviveOwnedMon);
  G.pvpOut = data.pvpOut || null;
  G.badges = data.badges || [];
  G.dex = {
    seen: new Set(data.dexSeen || []),
    caught: new Set(data.dexCaught || []),
    shiny: new Set(data.dexShiny || []),
  };
  G.fountains = data.fountains || [];
  G.usedNests = new Set(data.usedNests || []);
  G.usedShrines = new Set(data.usedShrines || []);
  G.traded = new Set(data.traded || []);
  G.achievements = new Set(data.achievements || []);
  G.stats = Object.assign({ trainersBeaten: 0, evolutions: 0, nests: 0, trades: 0, maxDist: 0,
                            surfed: 0, fished: 0, towerBest: 0, legends: 0, taught: 0,
                            eggsHatched: 0, quests: 0, sawSnow: 0, sawDesert: 0, friendTrades: 0, pvpBattles: 0, pvpWins: 0 }, data.stats || {});
  G.clock = data.clock || 0;
  G.party = data.party.map(reviveOwnedMon);
  G.defeated = new Set(data.defeated || []);
  G.picked = new Set(data.picked || []);
  resetFollower();
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

function newWorld(seedText) {
  G.seed = seedText ? strSeed(seedText) : (Math.random() * 4294967296) >>> 0;
  World.init(G.seed);
  G.party = [];
  G.orbs = 15;
  G.money = 300;
  G.bag = { potion: 1, superpotion: 0, tonic: 0, ether: 0, rod: 0, stone: 0 };
  G.scrolls = [];
  G.charms = { atk: 0, def: 0, spd: 0, hp: 0, exp: 0 };
  G.egg = null;
  G.quest = null;
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
              eggsHatched: 0, quests: 0, sawSnow: 0, sawDesert: 0, friendTrades: 0, pvpBattles: 0, pvpWins: 0 };
  G.clock = 0;
  G.defeated = new Set();
  G.picked = new Set();
  G.spawn = findSpawn();
  G.player.x = G.spawn.x; G.player.y = G.spawn.y;
  resetFollower();
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
    c.drawImage(spr, Math.floor((32 - spr.width) / 2), 32 - spr.height - 2);
    div.appendChild(cv);
    const t = TYPE_INFO[sp.stages[0].type];
    const info = document.createElement('div');
    info.innerHTML = '<div class="nm">' + sp.stages[0].name + '</div>' +
      '<div class="tp" style="color:' + t.color + '">' + t.ru + '</div>' +
      '<div class="tp" style="opacity:.7">' + sp.chainLen + ' стадии эволюции</div>';
    div.appendChild(info);
    div.onclick = () => {
      G.party = [makeMonster(seed, 0, 5)];
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
  const team = World.trainerTeam(tr);
  const result = await Battle.run({
    kind: 'trainer', enemyParty: team, trainerName: tr.name,
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
    envText = '🥚 Из гнезда выбирается редкий монстр!';
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
  const result = await Battle.run({ kind: 'wild', enemyParty: [wild], envText });
  if (mode === 'shrine' && result === 'caught') {
    G.stats.legends++;
    toast('⚡ Легендарный монстр пойман!');
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
      kind: 'trainer', enemyParty: team,
      trainerName: 'Смотритель этажа ' + floor,
      reward: 40 + floor * 35,
    });
    if (result !== 'win') break;
    G.stats.trainersBeaten++;
    questProgress('trainer');
    G.stats.towerBest = Math.max(G.stats.towerBest, floor);
    if (floor % 3 === 0) {
      const mv = makeMove(mulberry32((Math.random() * 4294967296) >>> 0), null, 10);
      G.scrolls.push(mv);
      toast('📜 Награда башни: свиток «' + mv.name + '»!');
    }
    floor++;
    if (!confirm('Этаж ' + (floor - 1) + ' пройден! Подняться выше? Этаж ' + floor +
      ' будет сильнее, а команда НЕ лечится.')) break;
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
  if (result === 'lose') {
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
    toast(f ? 'Ты приходишь в себя у знакомого фонтана.' : 'Монстрики отдохнули у точки старта.');
  }
  G.graceSteps = 3;
  G.bumpCooldown = 0.8;
  G.state = 'world';
  updateHUD();
  saveGame();
}

function healAtFountain(tx, ty) {
  // регистрируем фонтан как точку быстрого перемещения
  const fid = 'F' + Math.floor(tx / 12) + ',' + Math.floor(ty / 12);
  if (!G.fountains.some(f => f.id === fid)) {
    G.fountains.push({ id: fid, x: G.player.x, y: G.player.y });
    toast('⛲ Фонтан отмечен на карте — теперь сюда можно телепортироваться!');
  }
  const needed = G.party.some(m => m.hp < m.maxHp || m.status || m.moves.some(mv => mv.pp < mv.maxPp)) || G.orbs < 10;
  if (needed) {
    for (const m of G.party) {
      m.hp = m.maxHp;
      m.status = null;
      m.moves.forEach(mv => { mv.pp = mv.maxPp; });
    }
    if (G.orbs < 10) G.orbs = 10;
    sfx('heal');
    toast('Фонтан лечит команду, снимает недуги и восполняет ПП!');
  }
  updateHUD();
  saveGame();
}

function onTileEnter(tx, ty) {
  G.stats.maxDist = Math.max(G.stats.maxDist, Math.max(Math.abs(tx), Math.abs(ty)));
  // климат для ачивки
  const tile0 = World.tileAt(tx, ty);
  if ((tile0 === T.SNOW || tile0 === T.SNOWTALL) && !G.stats.sawSnow) {
    G.stats.sawSnow = 1;
    toast('❄ Ты забрёл в снежные земли — тут водятся ледяные монстрики!');
  }
  if ((tile0 === T.DESERT || tile0 === T.DESERTTALL) && !G.stats.sawDesert) {
    G.stats.sawDesert = 1;
    toast('🏜 Пустыня! Здесь кишат огненные и электрические монстрики.');
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
    G.orbs += 3;
    sfx('pickup');
    toast('Найдено 3 сферы ловли!');
    updateHUD();
    saveGame();
  }
  // сёрфинг: первый заплыв
  if (World.tileAt(tx, ty) === T.WATER && !G.stats.surfed) {
    G.stats.surfed = 1;
    toast('🌊 Ты плывёшь на монстрике! На воде водится своя живность.');
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
  let chance = ENCOUNTER_CHANCE[World.tileAt(tx, ty)];
  if (chance && G.phase === 'night') chance *= 1.3;
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
  const parts = (code || '').trim().split('.');
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
    shiny: !!m.shiny, nick: m.nick || null,
    moves: m.moves.map(mv => ({ name: mv.name, type: mv.type, power: mv.power, acc: mv.acc, maxPp: mv.maxPp })),
  };
}

// Восстановление чужого монстрика с жёсткой валидацией: статы всегда
// пересчитываются из вида, так что «нарисовать» себе имбу в коде нельзя
function tradeMonRevive(md) {
  const seed = md.speciesSeed >>> 0;
  const sp = getSpecies(seed);
  const stage = clamp(md.stage | 0, 0, sp.chainLen - 1);
  const level = clamp(md.level | 0, 1, 70);
  const m = makeMonster(seed, stage, level);
  m.shiny = !!md.shiny;
  m.nick = md.nick ? String(md.nick).slice(0, 12) : null;
  m.exp = clamp(md.exp | 0, 0, expToNext(level) - 1);
  if (Array.isArray(md.moves) && md.moves.length) {
    m.moves = md.moves.slice(0, 4).map(mv => {
      const power = clamp(mv.power | 0, 20, 115);
      const maxPp = clamp((mv.maxPp | 0) || ppForPower(power), 4, 20);
      return {
        name: String(mv.name || 'Удар').slice(0, 40),
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

// Полученный монстрик идёт в команду, при полной — в хранилище
function tradeReceive(received) {
  if (G.party.length < 6) { G.party.push(received); return 'party'; }
  G.storage.push(received);
  return 'store';
}

function tradeMakeOffer(src, idx) {
  if (G.tradeOut) return { err: 'У тебя уже есть активное предложение — отмени его или заверши обмен.' };
  if (src === 'party' && G.party.length < 2) return { err: 'Нельзя предложить последнего монстрика из команды.' };
  const arr = src === 'store' ? G.storage : G.party;
  if (!arr[idx]) return { err: 'Нет такого монстрика.' };
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
  if (src === 'party' && G.party.length < 2) return { err: 'Нельзя отдать последнего монстрика из команды.' };
  const arr = src === 'store' ? G.storage : G.party;
  if (!arr[giveIdx]) return { err: 'Нет такого монстрика.' };
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
  if (tradeMonHash(payload.mon) !== G.tradeIn.expectHash) return { err: 'Обман! В коде не тот монстрик, что был обещан в предложении.' };
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
    status.innerHTML = '<span style="opacity:.75;font-size:13px;max-width:600px;">Обменивайся монстриками с другом на другой машине: создай предложение и отправь код,<br>или вставь код друга ниже. Сделка идёт в 3 шага — никто не рискует остаться ни с чем.</span>';
  }
  if (G.tradeOut) {
    const wrap = document.createElement('div');
    wrap.innerHTML = '<b style="color:var(--ui-accent)">📤 Ты предлагаешь:</b>';
    const row = friendMonRow(G.tradeOut.mon);
    const cancel = document.createElement('button');
    cancel.textContent = 'Отменить';
    cancel.onclick = () => {
      if (!confirm('Отменить предложение и вернуть монстрика? Делай это только если друг ещё НЕ ответил на него.')) return;
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
  title.textContent = 'Кого предложить другу? (📦 — из хранилища)';
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
    pick.textContent = 'Кого отдать взамен? (📦 — из хранилища)';
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
      toast('🤝 Обмен! ' + monName(r.received) + (r.dest === 'store' ? ' ждёт в хранилище (B).' : ' теперь с тобой.'));
      renderFriendPanel();
      friendShowCode('Финальный код — ОБЯЗАТЕЛЬНО отправь другу, иначе он не получит монстрика:', r.code);
    };
    main.appendChild(btn);
    return;
  }

  // final
  const r = tradeFinalize(payload);
  if (r.err) { friendError(r.err); return; }
  sfx('catch');
  toast('🤝 Обмен завершён! ' + monName(r.received) + (r.dest === 'store' ? ' ждёт в хранилище (B).' : ' теперь с тобой.'));
  renderFriendPanel();
  const done = document.createElement('b');
  done.style.color = 'var(--ui-accent)';
  done.textContent = '🎉 Сделка закрыта — ты получил:';
  main.appendChild(done);
  main.appendChild(friendMonRow(tradeMonDump(r.received)));
}

// ===== Монстрохранилище =====

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
  if (G.party.length >= 6) { toast('Команда полна!'); return false; }
  const m = G.storage.splice(i, 1)[0];
  if (m) G.party.push(m);
  updateHUD(); saveGame();
  return true;
}

function storageDeposit(partyIdx) {
  if (G.party.length < 2) { toast('Нельзя убрать последнего монстрика!'); return false; }
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

function renderStorage() {
  document.getElementById('storage-info').textContent =
    G.storage.length ? 'Хранится: ' + G.storage.length + '. Отсюда можно брать в команду, для яиц и обменов.' :
    'Пусто. Сюда попадают пойманные при полной команде — и кого сам уберёшь из команды.';
  const rows = document.getElementById('storage-rows');
  rows.innerHTML = '';
  G.storage.forEach((m, i) => {
    const st = getSpecies(m.speciesSeed).stages[m.stage];
    const t = TYPE_INFO[st.type];
    const row = document.createElement('div');
    row.className = 'prow';
    row.appendChild(monMiniCanvas(m, 28));
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">' + (m.shiny ? '✨' : '') + monName(m) + '</span> Ур.' + m.level +
      ' <span style="color:' + t.color + '">' + t.ru + '</span>' +
      '<div style="opacity:.75;font-size:11px">ОЗ ' + m.maxHp + ' · АТК ' + m.atk + ' · ЗАЩ ' + m.def + ' · СКР ' + m.spd + '</div>';
    row.appendChild(info);
    const bTake = document.createElement('button');
    bTake.textContent = 'В команду';
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
    (dest === 'store' ? '! Он ждёт в хранилище (B).' : '!'));
  updateHUD();
  saveGame();
}

function openNursery() {
  if (G.state !== 'world') return;
  if (G.egg) { toast('🥚 Питомник: «Сначала выноси текущее яйцо! Осталось шагов: ' + G.egg.steps + '»'); return; }
  if (G.party.length + G.storage.length < 2) { toast('🥚 Питомник: «Приходи с двумя монстриками!»'); return; }
  G.state = 'nursery';
  renderNursery([]);
  document.getElementById('nursery-panel').classList.remove('hidden');
}

function renderNursery(picked) {
  const mons = allMons();
  const info = document.getElementById('nursery-info');
  info.innerHTML = picked.length === 0
    ? 'Выбери <b>первого</b> родителя (500₴ за яйцо, 📦 — из хранилища):'
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
  const rng = mulberry32(hash2u(strSeed(boardId), tb, G.seed ^ 0xB0A2D));
  const lvl = World.levelAt(Math.floor(G.player.x), Math.floor(G.player.y));
  const kinds = ['catch', 'trainer', 'wild'];
  const kind = pick(rng, kinds);
  const q = { kind, progress: 0, reward: 300 + lvl * 25, bonus: rng() < 0.5 ? 'scroll' : 'ether' };
  if (kind === 'catch') {
    q.param = pick(rng, TYPE_LIST);
    q.need = 1;
    q.text = 'Поймай монстрика типа «' + TYPE_INFO[q.param].ru + '»';
  } else if (kind === 'trainer') {
    q.need = irange(rng, 2, 3);
    q.text = 'Победи ' + q.need + ' тренеров';
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
      (offer.bonus === 'scroll' ? 'свиток умения' : 'эфир');
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
  if (!G.bag.rod) { toast('🎣 Нужна удочка — продаётся в лавке.'); return; }
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
      G.orbs++;
      sfx('pickup');
      toast('Сорвалось! Но на крючке блеснула сфера (+1).');
      G.state = 'world';
      updateHUD();
    }
  }, 1100);
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
    if (newWeather === 'rain' && G.weather !== 'rain') toast('☔ Начинается дождь — водные монстрики оживились!');
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

  const p = G.player;
  const speed = keys.has('Shift') ? 8.6 : 5.2;  // Shift — бег
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
        openNursery();
      } else if (bumpTile === T.BOARD) {
        G.bumpCooldown = 1.2;
        openBoard(hit.tx, hit.ty);
      } else if (bumpTile === T.WATER && !canSurf()) {
        G.bumpCooldown = 2.5;
        toast('🌊 Нужен водный монстрик 15+ уровня, чтобы плыть.');
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

  // спутник — первый живой монстрик, с подпрыгиванием при ходьбе
  const leader = G.party.find(m => m.hp > 0);
  if (leader && G.follower) {
    const f = G.follower;
    const spr = speciesSprite(leader.speciesSeed, leader.stage, leader.shiny);
    const bounce = f.moving ? Math.round(Math.abs(Math.sin(f.bounceT * 9)) * 3) : 0;
    const fx = Math.round((f.x - camX) * TILE) - Math.floor(spr.width / 2);
    const fy = Math.round((f.y - camY) * TILE) - spr.height + 4 - bounce;
    // тень под спутником
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(Math.round((f.x - camX) * TILE) - 4, Math.round((f.y - camY) * TILE) + 2, 8, 2);
    ctx.drawImage(spr, fx, fy);
  }

  // игрок в центре (на воде — круги под ним)
  const psx = Math.round((p.x - camX) * TILE) - 8;
  const psy = Math.round((p.y - camY) * TILE) - 12;
  if (World.tileAt(Math.floor(p.x), Math.floor(p.y)) === T.WATER) {
    const rippleW = 12 + Math.round(Math.abs(Math.sin(G.clock * 4)) * 3);
    ctx.fillStyle = 'rgba(200, 230, 255, 0.5)';
    ctx.fillRect(psx + 8 - rippleW / 2, psy + 13, rippleW, 2);
  }
  ctx.drawImage(playerSprite, DIR_INDEX[p.dir] * 16, (p.moving ? p.frame : 0) * 16, 16, 16, psx, psy, 16, 16);

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

function renderShop() {
  document.getElementById('shop-money').textContent = 'У тебя: ' + G.money + '₴';
  const rows = document.getElementById('shop-rows');
  rows.innerHTML = '';
  for (const item of SHOP_ITEMS) {
    const isCharm = item.id.startsWith('charm_');
    const charmKind = isCharm ? item.id.slice(6) : null;
    const have = item.id === 'orb' ? G.orbs
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
    const btn = document.createElement('button');
    btn.textContent = rodOwned ? 'Куплено' : 'Купить';
    btn.disabled = G.money < item.price || rodOwned;
    btn.onclick = () => {
      if (G.money < item.price) return;
      G.money -= item.price;
      if (item.id === 'orb') G.orbs++;
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

  // кнопки быстрого перемещения
  const travel = document.getElementById('map-travel');
  travel.innerHTML = G.fountains.length ? '' : '<span style="opacity:.6;font-size:12px">Коснись фонтана в городе, чтобы открыть телепорт к нему.</span>';
  for (const f of G.fountains.slice(-12)) {
    const b = document.createElement('button');
    const dist = Math.round(Math.hypot(f.x - G.player.x, f.y - G.player.y));
    b.textContent = '⛲ (' + Math.round(f.x) + ', ' + Math.round(f.y) + ') · ' + dist + ' т.';
    b.onclick = () => travelToFountain(f);
    travel.appendChild(b);
  }
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

function monMiniCanvas(m, size) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const c = cv.getContext('2d');
  c.imageSmoothingEnabled = false;
  const spr = speciesSprite(m.speciesSeed, m.stage, m.shiny);
  c.drawImage(spr, Math.floor((size - spr.width) / 2), size - spr.height - 1);
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
    'Хочет взамен монстрика типа <b style="color:' + wt.color + '">' + wt.ru + '</b>:';

  const rows = document.getElementById('trade-rows');
  rows.innerHTML = '';
  const candidates = G.party.filter(m => monType(m) === wantsType);
  if (G.party.length < 2) {
    rows.innerHTML = '<span style="opacity:.7">Нельзя отдать последнего монстрика.</span>';
  } else if (!candidates.length) {
    rows.innerHTML = '<span style="opacity:.7">У тебя нет монстрика типа «' + wt.ru + '».</span>';
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

function openTeach(mon) {
  document.getElementById('party-panel').classList.add('hidden');
  G.state = 'teach';
  const panel = document.getElementById('teach-panel');
  document.getElementById('teach-info').innerHTML =
    'Выбери свиток для <b style="color:var(--ui-accent)">' + monName(mon) + '</b>:';
  const rows = document.getElementById('teach-rows');
  rows.innerHTML = '';
  G.scrolls.forEach((mv, si) => {
    const row = document.createElement('div');
    row.className = 'srow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">📜 ' + mv.name + '</span> — <span style="color:' + TYPE_INFO[mv.type].color + '">' +
      TYPE_INFO[mv.type].ru + '</span> · сила ' + mv.power + ' · точн. ' + mv.acc + ' · ПП ' + (mv.maxPp || ppForPower(mv.power));
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
  // все 4 слота заняты — выбираем, что забыть
  document.getElementById('teach-info').innerHTML =
    'Какое умение <b style="color:var(--ui-accent)">' + monName(mon) + '</b> забудет ради «' + mv.name + '»?';
  const rows = document.getElementById('teach-rows');
  rows.innerHTML = '';
  mon.moves.forEach((old, oi) => {
    const row = document.createElement('div');
    row.className = 'srow';
    const info = document.createElement('div');
    info.className = 'info';
    info.innerHTML = '<span class="nm">' + old.name + '</span> — ' + TYPE_INFO[old.type].ru + ' · сила ' + old.power;
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

function toggleAchievements() {
  const panel = document.getElementById('ach-panel');
  if (G.state === 'ach') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'ach';
  checkAchievements();
  document.getElementById('ach-count').textContent =
    'Открыто: ' + G.achievements.size + ' из ' + ACHIEVEMENTS.length;
  const rows = document.getElementById('ach-rows');
  rows.innerHTML = '';
  for (const a of ACHIEVEMENTS) {
    const got = G.achievements.has(a.id);
    const row = document.createElement('div');
    row.className = 'arow' + (got ? '' : ' locked');
    row.innerHTML = '<span class="ic">' + (got ? a.ic : '🔒') + '</span>' +
      '<span><span class="nm">' + a.name + '</span><br><span style="opacity:.8;font-size:12px">' + a.desc + '</span></span>';
    rows.appendChild(row);
  }
  panel.classList.remove('hidden');
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

// ===== Монстропедия (панель) =====

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
    c.drawImage(isCaught ? spr : silhouette(spr), Math.floor((24 - spr.width) / 2), 24 - spr.height - 1);
    card.appendChild(cv);
    const t = TYPE_INFO[sp.stages[0].type];
    const info = document.createElement('div');
    if (isCaught) {
      info.innerHTML = '<div class="nm">' + (isShiny ? '✨' : '') + sp.stages[0].name + '</div>' +
        '<div style="color:' + t.color + '">' + t.ru + '</div>' +
        '<div style="opacity:.7">' + sp.stages.map(s => s.name).join(' → ') + '</div>';
    } else {
      info.innerHTML = '<div class="nm">' + sp.stages[0].name + '</div>' +
        '<div style="opacity:.6">???</div>';
    }
    card.appendChild(info);
    grid.appendChild(card);
  }
  if (!seeds.length) grid.innerHTML = '<p style="opacity:.7">Пока пусто — иди в высокую траву!</p>';
  panel.classList.remove('hidden');
}

// ===== Панель команды =====

// Какие карточки в «Команде» развёрнуты (переживает перерисовку панели)
const _partyExpanded = new Set();

function togglePartyPanel() {
  const panel = document.getElementById('party-panel');
  if (G.state === 'party') {
    panel.classList.add('hidden');
    G.state = 'world';
    return;
  }
  if (G.state !== 'world') return;
  G.state = 'party';
  const rows = document.getElementById('party-rows');
  rows.innerHTML = '';
  G.party.forEach((m, i) => {
    const sp = getSpecies(m.speciesSeed);
    const st = sp.stages[m.stage];
    const row = document.createElement('div');
    row.className = 'prow';
    const cv = document.createElement('canvas');
    cv.width = 28; cv.height = 28;
    const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false;
    const spr = speciesSprite(m.speciesSeed, m.stage, m.shiny);
    c.drawImage(spr, Math.floor((28 - spr.width) / 2), 28 - spr.height - 1);
    row.appendChild(cv);

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

    // подробности (статы, атаки, действия) — скрыты за кнопкой
    const details = document.createElement('div');
    details.style.cssText = 'width:100%;display:flex;flex-wrap:wrap;gap:6px;align-items:center;';
    if (!_partyExpanded.has(i)) details.classList.add('hidden');
    const statLine = document.createElement('div');
    statLine.style.cssText = 'width:100%;opacity:.75;font-size:11px;';
    statLine.innerHTML = 'АТК ' + m.atk + ' · ЗАЩ ' + m.def + ' · СКР ' + m.spd +
      ' · опыт ' + m.exp + '/' + expToNext(m.level);
    details.appendChild(statLine);
    // атаки: клик — поднять выше в списке
    const mvDiv = document.createElement('div');
    mvDiv.className = 'mv';
    mvDiv.style.width = '100%';
    m.moves.forEach((mv, mi) => {
      const mb = document.createElement('button');
      mb.style.cssText = 'font-size:10px;padding:2px 6px;margin:2px 3px 0 0;';
      mb.title = 'Клик — поднять атаку выше в списке';
      mb.innerHTML = (mi + 1) + '. ' + mv.name + ' <span style="color:' + TYPE_INFO[mv.type].color + '">' +
        TYPE_INFO[mv.type].ru + '</span> ' + mv.power + ' · ПП ' + mv.pp + '/' + mv.maxPp;
      mb.onclick = () => {
        if (mi === 0) return;
        [m.moves[mi - 1], m.moves[mi]] = [m.moves[mi], m.moves[mi - 1]];
        G.state = 'world'; togglePartyPanel(); // перерисовать
        saveGame();
      };
      mvDiv.appendChild(mb);
    });
    details.appendChild(mvDiv);

    const bMore = document.createElement('button');
    const setMoreLabel = () => { bMore.textContent = _partyExpanded.has(i) ? 'Свернуть ▴' : 'Подробнее ▾'; };
    setMoreLabel();
    bMore.onclick = () => {
      if (_partyExpanded.has(i)) _partyExpanded.delete(i); else _partyExpanded.add(i);
      details.classList.toggle('hidden');
      setMoreLabel();
    };
    row.appendChild(bMore);

    // кличка
    const bNick = document.createElement('button');
    bNick.textContent = '✏️';
    bNick.title = 'Дать кличку';
    bNick.onclick = () => {
      const nn = prompt('Кличка для ' + st.name + ' (пусто — сбросить):', m.nick || '');
      if (nn === null) return;
      m.nick = nn.trim().slice(0, 12) || null;
      G.state = 'world'; togglePartyPanel();
      updateHUD(); saveGame();
    };
    details.appendChild(bNick);

    // амулет: выпадающий выбор
    if (m.charm || Object.values(G.charms).some(n => n > 0)) {
      const sel = document.createElement('select');
      sel.style.cssText = 'font-family:inherit;font-size:11px;background:#111;color:#e8e8f0;border:2px solid var(--ui-border);border-radius:4px;padding:3px;';
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
        G.state = 'world'; togglePartyPanel();
        updateHUD(); saveGame();
      };
      details.appendChild(sel);
    }
    // камень эволюции
    if (G.bag.stone > 0 && st.evolveLevel !== null) {
      const bStone = document.createElement('button');
      bStone.textContent = '🪨 Эво';
      bStone.title = 'Камень эволюции: эволюционировать сейчас';
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
        G.state = 'world'; togglePartyPanel();
        updateHUD(); saveGame();
      };
      details.appendChild(bStone);
    }
    // научить со свитка
    if (G.scrolls.length) {
      const bTeach = document.createElement('button');
      bTeach.textContent = '📜 (' + G.scrolls.length + ')';
      bTeach.title = 'Научить умению со свитка';
      bTeach.onclick = () => openTeach(m);
      details.appendChild(bTeach);
    }
    // эфир
    if (G.bag.ether > 0 && m.moves.some(mv => mv.pp < mv.maxPp)) {
      const bEth = document.createElement('button');
      bEth.textContent = '💧 Эфир';
      bEth.onclick = () => {
        G.bag.ether--;
        m.moves.forEach(mv => { mv.pp = mv.maxPp; });
        sfx('heal');
        G.state = 'world'; togglePartyPanel();
        updateHUD(); saveGame();
      };
      details.appendChild(bEth);
    }

    if (m.hp < m.maxHp && G.bag.potion > 0) {
      const bPot = document.createElement('button');
      bPot.textContent = '🧪 Зелье (x' + G.bag.potion + ')';
      bPot.onclick = () => {
        G.bag.potion--;
        m.hp = Math.min(m.maxHp, m.hp + Math.ceil(m.maxHp / 2));
        sfx('heal');
        G.state = 'world';
        togglePartyPanel();
        updateHUD(); saveGame();
      };
      details.appendChild(bPot);
    }
    if (m.status && G.bag.tonic > 0) {
      const bTon = document.createElement('button');
      bTon.textContent = '💊 Тоник';
      bTon.onclick = () => {
        G.bag.tonic--;
        m.status = null;
        sfx('heal');
        G.state = 'world';
        togglePartyPanel();
        updateHUD(); saveGame();
      };
      details.appendChild(bTon);
    }
    if (i > 0) {
      const bLead = document.createElement('button');
      bLead.textContent = '⭐ Лидер';
      bLead.onclick = () => {
        G.party.splice(i, 1);
        G.party.unshift(m);
        G.state = 'world';
        togglePartyPanel();
        updateHUD(); saveGame();
      };
      details.appendChild(bLead);
    }
    if (G.party.length > 1) {
      const bBox = document.createElement('button');
      bBox.textContent = '📦';
      bBox.title = 'Убрать в Монстрохранилище';
      bBox.onclick = () => {
        storageDeposit(i);
        G.state = 'world';
        togglePartyPanel();
      };
      details.appendChild(bBox);
    }
    row.appendChild(details);
    rows.appendChild(row);
  });
  panel.classList.remove('hidden');
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
    if (e.code === 'KeyT' && (G.state === 'world' || G.state === 'friend')) { toggleFriendPanel(); return; }
    if (e.code === 'KeyB' && (G.state === 'world' || G.state === 'storage' || G.state === 'party')) { toggleStorage(); return; }
    if (e.key === 'Escape') {
      if (G.state === 'party') { togglePartyPanel(); return; }
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
    try { const d = JSON.parse(localStorage.getItem(SAVE_KEY)); return d && d.party && d.party.length; }
    catch (e) { return false; }
  })();
  if (hasSave) document.getElementById('btn-continue').classList.remove('hidden');

  document.getElementById('btn-new').onclick = () => {
    newWorld(document.getElementById('seed-input').value.trim());
  };
  document.getElementById('btn-continue').onclick = () => {
    if (loadGame()) {
      document.getElementById('title').classList.add('hidden');
      G.state = 'world';
      updateHUD();
      toast('С возвращением!');
    }
  };
  document.getElementById('btn-party-close').onclick = () => togglePartyPanel();
  document.getElementById('btn-shop-close').onclick = () => closeShop();
  document.getElementById('btn-dex-close').onclick = () => toggleDex();
  document.getElementById('btn-map-close').onclick = () => toggleMap();
  document.getElementById('btn-ach-close').onclick = () => toggleAchievements();
  document.getElementById('btn-teach-close').onclick = () => closeTeach();
  document.getElementById('btn-nursery-close').onclick = () => closeNursery();
  document.getElementById('btn-board-close').onclick = () => closeBoard();
  document.getElementById('btn-friend-close').onclick = () => toggleFriendPanel();
  document.getElementById('btn-friend-offer').onclick = () => friendOfferFlow();
  document.getElementById('btn-friend-process').onclick = () => friendProcessCode();
  document.getElementById('btn-friend-pvp').onclick = () => pvpChallengeFlow();
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
  document.getElementById('btn-import').onclick = () => {
    const code = document.getElementById('import-code').value;
    const err = importSaveCode(code);
    if (err) {
      document.getElementById('import-error').textContent = err;
      return;
    }
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

const IS_MOBILE = /[?&]desktop/.test(location.search) ? false :
                  /[?&]mobile/.test(location.search) ? true :
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
  // меню-кнопки
  const panelFns = { party: togglePartyPanel, map: toggleMap, dex: toggleDex, ach: toggleAchievements, friend: toggleFriendPanel };
  document.querySelectorAll('#touch-menu .tbtn').forEach(btn => {
    btn.addEventListener('pointerdown', e => { e.preventDefault(); panelFns[btn.dataset.panel](); });
  });
}

function main() {
  canvas = document.getElementById('game');
  ctx = canvas.getContext('2d');
  if (IS_MOBILE) {
    document.body.classList.add('mobile');
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', () => setTimeout(resizeCanvas, 250));
  }
  buildTileAtlas();
  playerSprite = makePersonSprite('#d84848', '#6b3a1e');
  trainerSprite = makePersonSprite('#3a6ab0', '#2a2a38');
  masterSprite = makePersonSprite('#d8a018', '#f0f0f0');
  traderSprite = makePersonSprite('#3a9a50', '#5a3a1e');
  initInput();
  initTitle();
  initTouch();
  updateHUD();

  // PWA: офлайн-кэш (только по http/https — с file:// SW не работает)
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (document.body.dataset.state !== G.state) document.body.dataset.state = G.state;
    step(dt);
    if (G.state === 'world' || G.state === 'party') render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  setInterval(saveGame, 15000);
}

window.addEventListener('DOMContentLoaded', main);
