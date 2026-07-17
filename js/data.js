'use strict';

// ===== Типы и таблица эффективности =====

const TYPE_LIST = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'psychic', 'shadow'];

const TYPE_INFO = {
  normal:   { ru: 'Обычный',  color: '#a8a090', dark: '#6b655a', light: '#d8d2c4' },
  fire:     { ru: 'Огонь',    color: '#e8613c', dark: '#8f2f18', light: '#ffb37a' },
  water:    { ru: 'Вода',     color: '#3f8fe0', dark: '#1d4f8f', light: '#9fd0ff' },
  grass:    { ru: 'Трава',    color: '#57b04a', dark: '#2c6b2a', light: '#a8e08a' },
  electric: { ru: 'Электро',  color: '#e8c832', dark: '#94781a', light: '#fff09a' },
  ice:      { ru: 'Лёд',      color: '#7fd4e0', dark: '#3a8a99', light: '#d4f4fa' },
  psychic:  { ru: 'Психо',    color: '#d060c8', dark: '#7a2f78', light: '#f0b0ec' },
  shadow:   { ru: 'Тьма',     color: '#6b5a8f', dark: '#332a4a', light: '#a898cc' },
};

const EFFECTIVENESS = {
  normal:   { shadow: 0.5 },
  fire:     { grass: 2, ice: 2, fire: 0.5, water: 0.5 },
  water:    { fire: 2, water: 0.5, grass: 0.5 },
  grass:    { water: 2, grass: 0.5, fire: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5 },
  ice:      { grass: 2, fire: 0.5, water: 0.5, ice: 0.5 },
  psychic:  { ice: 2, electric: 2, psychic: 0.5, shadow: 0.5 },
  shadow:   { psychic: 2, shadow: 0.5, normal: 0.5 },
};

function effMult(att, def) {
  return (EFFECTIVENESS[att] && EFFECTIVENESS[att][def]) || 1;
}

// Смежные стихии — у монстра могут быть атаки этих типов
const TYPE_ADJ = {
  normal:   ['grass', 'electric'],
  fire:     ['electric', 'shadow'],
  water:    ['ice', 'grass'],
  grass:    ['water', 'normal'],
  electric: ['fire', 'psychic'],
  ice:      ['water', 'psychic'],
  psychic:  ['shadow', 'ice'],
  shadow:   ['psychic', 'fire'],
};

// Запас использований умения: сильные — реже
function ppForPower(p) {
  return p >= 75 ? 6 : p >= 55 ? 10 : p >= 40 ? 14 : 18;
}

// Когда все ПП кончились
const STRUGGLE = { name: 'Отчаянный удар', type: 'normal', power: 35, acc: 100, struggle: true };

// ===== Статусные эффекты =====

const STATUS_INFO = {
  poison: { ru: 'ЯД',   color: '#9a4ab0', verb: 'отравлен' },
  burn:   { ru: 'ОЖГ',  color: '#e8613c', verb: 'получает ожог' },
  para:   { ru: 'ПРЛ',  color: '#e8c832', verb: 'парализован' },
  sleep:  { ru: 'СОН',  color: '#8a8aa0', verb: 'засыпает' },
  freeze: { ru: 'ЗМР',  color: '#7fd4e0', verb: 'замерзает' },
};
// какой тип умения какой статус может наложить
const STATUS_BY_TYPE = {
  grass: 'poison', fire: 'burn', electric: 'para', psychic: 'sleep', ice: 'freeze',
};

function statusTag(m) {
  if (!m.status) return '';
  const s = STATUS_INFO[m.status];
  return '<span class="stat-tag" style="background:' + s.color + ';color:#111">' + s.ru + '</span>';
}

// эффективные статы с учётом статуса
function effSpd(m) { return m.status === 'para' ? Math.floor(m.spd / 2) : m.spd; }
function effAtk(m) { return m.status === 'burn' ? Math.floor(m.atk * 0.65) : m.atk; }

// ===== Амулеты (носимые предметы) =====

const CHARMS = {
  atk: { name: 'Амулет силы',    ic: '⚔️', desc: '+15% к атаке' },
  def: { name: 'Амулет щита',    ic: '🛡️', desc: '+15% к защите' },
  spd: { name: 'Амулет ветра',   ic: '💨', desc: '+15% к скорости' },
  hp:  { name: 'Амулет жизни',   ic: '❤️', desc: '+12% к здоровью' },
  exp: { name: 'Амулет мудрости', ic: '🦉', desc: '+25% опыта в бою' },
};

// ===== Предметы лавки =====

const SHOP_ITEMS = [
  { id: 'orb',    name: 'Сфера ловли',  price: 80,  desc: 'Для поимки диких братишек.' },
  { id: 'potion', name: 'Зелье',        price: 120, desc: 'Восстанавливает 50% ОЗ.' },
  { id: 'superpotion', name: 'Суперзелье', price: 350, desc: 'Полностью восстанавливает ОЗ.' },
  { id: 'tonic',  name: 'Тоник',        price: 90,  desc: 'Снимает любой статусный эффект.' },
  { id: 'ether',  name: 'Эфир',         price: 250, desc: 'Восполняет все ПП умений одного братишки.' },
  { id: 'scroll', name: 'Свиток умения', price: 400, desc: 'Случайное умение — научи любого братишку.' },
  { id: 'rod',    name: 'Удочка',       price: 600, desc: 'Рыбачь у воды клавишей F. Покупается один раз.' },
  { id: 'stone',  name: 'Камень эволюции', price: 1500, desc: 'Мгновенно эволюционирует братишку.' },
  { id: 'charm_atk', name: 'Амулет силы',    price: 800, desc: '+15% к атаке носителя.' },
  { id: 'charm_def', name: 'Амулет щита',    price: 800, desc: '+15% к защите носителя.' },
  { id: 'charm_spd', name: 'Амулет ветра',   price: 800, desc: '+15% к скорости носителя.' },
  { id: 'charm_hp',  name: 'Амулет жизни',   price: 800, desc: '+12% к здоровью носителя.' },
  { id: 'charm_exp', name: 'Амулет мудрости', price: 800, desc: '+25% опыта носителю.' },
];

// ===== Генерация имён =====

const SYLLABLES = ['бу', 'ла', 'мо', 'ри', 'та', 'зу', 'ки', 'ва', 'по', 'ня',
  'гро', 'фи', 'ло', 'ши', 'дра', 'кве', 'ми', 'ор', 'ци', 'ху',
  'пе', 'сни', 'кра', 'ле', 'дун', 'го', 'ра', 'вью', 'жу', 'тэ'];
const EVO_SUFFIXES = ['зар', 'дон', 'рекс', 'гон', 'мор', 'кинг', 'торн', 'айз', 'рой', 'зилла'];

const TRAINER_NAMES = ['Аня', 'Борис', 'Вика', 'Гоша', 'Дана', 'Егор', 'Женя', 'Зоя', 'Иван',
  'Кира', 'Лёва', 'Мила', 'Никита', 'Оля', 'Паша', 'Рита', 'Соня', 'Тимур', 'Уля', 'Федя'];
const TRAINER_TITLES = ['Скаут', 'Тренер', 'Рейнджер', 'Коллекционер', 'Ас'];
// Супертренеры — легендарная четвёрка, часто возглавляют города
const SUPER_TRAINERS = ['Иван', 'Полина', 'Андрей', 'Миша'];

// Существо по стадии эволюции: братишка → брат → братан
function stageWord(stage) {
  return ['братишка', 'брат', 'братан'][stage] || 'братишка';
}

// ===== Генерация умений =====

const MOVE_ADJ = {
  normal:   ['Быстрый', 'Мощный', 'Дикий', 'Верный'],
  fire:     ['Огненный', 'Пылающий', 'Жаркий', 'Лавовый'],
  water:    ['Водный', 'Пенный', 'Ливневый', 'Приливный'],
  grass:    ['Листовой', 'Шипастый', 'Цветочный', 'Мшистый'],
  electric: ['Грозовой', 'Искровой', 'Разрядный', 'Статический'],
  ice:      ['Ледяной', 'Морозный', 'Снежный', 'Стылый'],
  psychic:  ['Ментальный', 'Астральный', 'Гипно', 'Мысленный'],
  shadow:   ['Теневой', 'Мрачный', 'Ночной', 'Жуткий'],
};
const MOVE_NOUN = ['клык', 'вихрь', 'луч', 'залп', 'удар', 'шторм', 'коготь',
  'взрыв', 'импульс', 'укус', 'таран', 'рывок', 'хвост', 'вой'];

function makeMove(rng, forceType, powerBonus) {
  const type = forceType || pick(rng, TYPE_LIST);
  const power = 35 + Math.floor(rng() * 56) + (powerBonus || 0);
  return {
    name: pick(rng, MOVE_ADJ[type]) + ' ' + pick(rng, MOVE_NOUN),
    type,
    power,
    acc: 100 - irange(rng, 0, 3) * 5, // 85..100
    maxPp: ppForPower(power),
  };
}

// Копия умения как экземпляр у монстра (с полным запасом ПП)
function moveInstance(mv) {
  const maxPp = mv.maxPp || ppForPower(mv.power);
  return { name: mv.name, type: mv.type, power: mv.power, acc: mv.acc, pp: maxPp, maxPp };
}

// ===== Виды монстров (цепочка эволюций из сида) =====

const _speciesCache = new Map();

function getSpecies(seed) {
  seed = seed >>> 0;
  if (_speciesCache.has(seed)) return _speciesCache.get(seed);

  const rng = mulberry32(seed);
  const chainLen = 1 + Math.floor(rng() * 3); // 1..3 стадии
  const type = pick(rng, TYPE_LIST);
  const base = {
    hp:  irange(rng, 45, 95),
    atk: irange(rng, 40, 95),
    def: irange(rng, 40, 95),
    spd: irange(rng, 35, 95),
  };
  let name = cap(pick(rng, SYLLABLES)) + pick(rng, SYLLABLES);

  const stages = [];
  const STAGE_MULT = [1, 1.35, 1.75];
  const LEARN_LEVELS = [1, 1, 6, 12, 18, 26];
  for (let st = 0; st < chainLen; st++) {
    if (st === 1) name = name + pick(rng, SYLLABLES);
    if (st === 2) name = name + pick(rng, EVO_SUFFIXES);
    const moves = [];
    for (let i = 0; i < LEARN_LEVELS.length; i++) {
      // первая атака родная, дальше смесь: родной тип / обычный / смежные / случайный
      let forced;
      if (i === 0) forced = type;
      else {
        const r = rng();
        forced = r < 0.35 ? type : r < 0.60 ? 'normal' : r < 0.85 ? pick(rng, TYPE_ADJ[type]) : null;
      }
      const mv = makeMove(rng, forced, st * 6 + (i >= 4 ? 10 : 0));
      mv.learnLevel = LEARN_LEVELS[i] + st * 2;
      moves.push(mv);
    }
    stages.push({
      name,
      type,
      base,
      mult: STAGE_MULT[st],
      moves,
      evolveLevel: st < chainLen - 1 ? (st === 0 ? irange(rng, 9, 16) : irange(rng, 22, 30)) : null,
      spriteSeed: hash2u(seed, st * 7919 + 13, 0xBEEF),
    });
  }

  const sp = { seed, chainLen, stages };
  _speciesCache.set(seed, sp);
  return sp;
}

// Ищет вид с типом из списка, начиная с сида (детерминированно)
function findSpeciesOfType(baseSeed, types) {
  let s = baseSeed >>> 0;
  for (let i = 0; i < 300; i++) {
    if (types.includes(getSpecies(s).stages[0].type)) return s;
    s = (s + 0x9E3779B9) >>> 0;
  }
  return baseSeed >>> 0;
}

// Ищет вид с полной цепочкой из 3 стадий (для гнёзд)
function findSpeciesChain3(baseSeed) {
  let s = baseSeed >>> 0;
  for (let i = 0; i < 300; i++) {
    if (getSpecies(s).chainLen === 3) return s;
    s = (s + 0x9E3779B9) >>> 0;
  }
  return baseSeed >>> 0;
}

// ===== Экземпляр монстра =====

function recalcStats(m) {
  const st = getSpecies(m.speciesSeed).stages[m.stage];
  const k = st.mult * m.level * (m.shiny ? 1.18 : 1);
  m.maxHp = Math.floor((14 + st.base.hp * k * 0.055) * (m.charm === 'hp' ? 1.12 : 1));
  m.atk = Math.floor((5 + st.base.atk * k * 0.045) * (m.charm === 'atk' ? 1.15 : 1));
  m.def = Math.floor((5 + st.base.def * k * 0.045) * (m.charm === 'def' ? 1.15 : 1));
  m.spd = Math.floor((5 + st.base.spd * k * 0.045) * (m.charm === 'spd' ? 1.15 : 1));
  if (m.hp > m.maxHp) m.hp = m.maxHp;
}

function makeMonster(speciesSeed, stage, level) {
  const sp = getSpecies(speciesSeed);
  stage = clamp(stage, 0, sp.chainLen - 1);
  const st = sp.stages[stage];
  const known = st.moves.filter(mv => mv.learnLevel <= level).slice(-4);
  const m = {
    speciesSeed: speciesSeed >>> 0,
    stage, level,
    exp: 0,
    moves: known.map(moveInstance),
    hp: 0,
    status: null,
    shiny: false,
    nick: null,
    charm: null,
  };
  recalcStats(m);
  m.hp = m.maxHp;
  return m;
}

function monName(m) { return m.nick || getSpecies(m.speciesSeed).stages[m.stage].name; }
function monSpeciesName(m) { return getSpecies(m.speciesSeed).stages[m.stage].name; }
function monType(m) { return getSpecies(m.speciesSeed).stages[m.stage].type; }
function expToNext(level) { return level * 20 + 15; }

// Опыт за победу; возвращает список сообщений (левелапы, эволюции, новые умения)
function grantExp(m, amount) {
  const msgs = [];
  m.exp += amount;
  while (m.exp >= expToNext(m.level) && m.level < 70) {
    m.exp -= expToNext(m.level);
    m.level++;
    const ratio = m.hp / m.maxHp;
    recalcStats(m);
    m.hp = Math.max(1, Math.round(m.maxHp * ratio));
    msgs.push({ kind: 'level', text: monName(m) + ' достигает уровня ' + m.level + '!' });

    const sp = getSpecies(m.speciesSeed);
    let st = sp.stages[m.stage];
    // эволюция
    if (st.evolveLevel !== null && m.level >= st.evolveLevel) {
      const oldName = st.name;
      m.stage++;
      recalcStats(m);
      m.hp = Math.max(1, Math.round(m.maxHp * ratio));
      st = sp.stages[m.stage];
      msgs.push({ kind: 'evolve', text: 'Невероятно! ' + oldName + ' эволюционирует в ' + st.name + '!' });
    }
    // новые умения этой стадии
    for (const mv of st.moves) {
      if (mv.learnLevel === m.level) {
        if (m.moves.length < 4) {
          m.moves.push(moveInstance(mv));
          msgs.push({ kind: 'move', text: monName(m) + ' изучает умение «' + mv.name + '»!' });
        } else {
          // заменяем самое слабое, если новое сильнее
          let wi = 0;
          for (let i = 1; i < 4; i++) if (m.moves[i].power < m.moves[wi].power) wi = i;
          if (m.moves[wi].power < mv.power) {
            const old = m.moves[wi].name;
            m.moves[wi] = moveInstance(mv);
            msgs.push({ kind: 'move', text: monName(m) + ' забывает «' + old + '» и изучает «' + mv.name + '»!' });
          }
        }
      }
    }
  }
  return msgs;
}

// ===== Процедурные пиксельные спрайты =====

const _spriteCache = new Map();

// Генерирует симметричного пиксельного монстрика на canvas
// shiny = редкая золотая вариация; back = вид со спины (без глаз)
function speciesSprite(speciesSeed, stage, shiny, back) {
  const key = speciesSeed + ':' + stage + (shiny ? ':s' : '') + (back ? ':b' : '');
  if (_spriteCache.has(key)) return _spriteCache.get(key);

  const st = getSpecies(speciesSeed).stages[stage];
  const rng = mulberry32(st.spriteSeed);
  const size = 12 + stage * 3;          // 12 / 15 / 18
  const half = Math.ceil(size / 2);

  // случайная заливка половины, плотнее к центру тела
  let grid = [];
  for (let y = 0; y < size; y++) {
    grid.push([]);
    for (let x = 0; x < half; x++) {
      const cx = (half - 1 - x) / half;            // 0 у оси симметрии
      const cy = Math.abs(y - size * 0.55) / (size * 0.55);
      const p = 0.82 - cx * 0.55 - cy * 0.5;
      grid[y].push(rng() < p ? 1 : 0);
    }
  }
  // два прохода клеточного сглаживания — получаются цельные "тушки"
  for (let pass = 0; pass < 2; pass++) {
    const ng = grid.map(r => r.slice());
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < half; x++) {
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const yy = y + dy;
          let xx = x + dx;
          if (xx >= half) xx = half - 1;           // зеркальный сосед за осью
          if (yy < 0 || yy >= size || xx < 0) continue;
          n += grid[yy][xx];
        }
        ng[y][x] = grid[y][x] ? (n >= 2 ? 1 : 0) : (n >= 5 ? 1 : 0);
      }
    }
    grid = ng;
  }
  // страховка: если тело почти пустое — рисуем овал
  let mass = 0;
  for (const row of grid) for (const c of row) mass += c;
  if (mass < size * half * 0.2) {
    for (let y = 2; y < size - 2; y++)
      for (let x = Math.floor(half / 3); x < half; x++) grid[y][x] = 1;
  }

  let info = TYPE_INFO[st.type];
  let accent = TYPE_INFO[pick(rng, TYPE_LIST)].light;
  if (shiny) {
    info = { color: '#e8c95a', dark: '#8f7222', light: '#fff0b0' };
    accent = '#ffffff';
  }
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');

  const full = (x, y) => {
    if (y < 0 || y >= size) return 0;
    const hx = x < half ? x : size - 1 - x;
    if (hx < 0 || hx >= half) return 0;
    return grid[y][hx];
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!full(x, y)) continue;
      const edge = !full(x - 1, y) || !full(x + 1, y) || !full(x, y - 1) || !full(x, y + 1);
      let col = edge ? info.dark : info.color;
      if (!edge && hash2(x < half ? x : size - 1 - x, y, st.spriteSeed) < 0.22) col = accent;
      ctx.fillStyle = col;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // глаза: первая достаточно широкая строка сверху (со спины глаз не видно)
  for (let y = 1; !back && y < size - 2; y++) {
    let w = 0;
    for (let x = 0; x < size; x++) if (full(x, y)) w++;
    if (w >= size * 0.45) {
      const ey = y + 1 + Math.floor(rng() * 2);
      const ex = Math.floor(size * 0.30);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(ex, ey, 1, 1); ctx.fillRect(size - 1 - ex, ey, 1, 1);
      ctx.fillStyle = '#101018';
      ctx.fillRect(ex, ey + 1, 1, 1); ctx.fillRect(size - 1 - ex, ey + 1, 1, 1);
      break;
    }
  }

  _spriteCache.set(key, cv);
  return cv;
}
