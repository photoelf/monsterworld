'use strict';

// ===== Тайлы =====

const T = {
  WATER: 0, SAND: 1, GRASS: 2, TALL: 3, FLOOR: 4, TREE: 5,
  FLOWER: 6, ROAD: 7, PAVE: 8, BUILD: 9, FOUNTAIN: 10, PARK: 11,
  ARENA: 12, SHOP: 13, TOWER: 14,
  SNOW: 15, SNOWTALL: 16, SNOWTREE: 17, DESERT: 18, DESERTTALL: 19, CACTUS: 20,
  NURSERY: 21, BOARD: 22,
};
const TILE_COUNT = 23;
const SOLID_TILES = new Set([T.WATER, T.TREE, T.BUILD, T.FOUNTAIN, T.SHOP, T.TOWER,
  T.SNOWTREE, T.CACTUS, T.NURSERY, T.BOARD]);
// шанс встретить дикого монстрика при заходе на тайл
const ENCOUNTER_CHANCE = {
  [T.TALL]: 0.11, [T.FLOOR]: 0.075, [T.FLOWER]: 0.05, [T.WATER]: 0.07,
  [T.SNOWTALL]: 0.11, [T.DESERTTALL]: 0.11, [T.SNOW]: 0.03, [T.DESERT]: 0.03,
};
// на каких тайлах живёт "дикая природа" (гнёзда, святилища, предметы)
const WILD_TILES = new Set([T.GRASS, T.TALL, T.FLOOR, T.SNOW, T.SNOWTALL, T.DESERT, T.DESERTTALL]);

// ===== Города как сущности =====
// Мир делится на ячейки CITY_CELL×CITY_CELL; в каждой — точка-центр (Вороной).
// Городское «пятно» принадлежит ближайшему центру: у него имя, одна арена,
// а между соседними центрами через глушь идут дороги.

const CITY_CELL = 96;

const CITY_PRE = ['Ново', 'Старо', 'Верхне', 'Нижне', 'Бело', 'Черно', 'Красно',
  'Зелено', 'Тихо', 'Громо', 'Звездо', 'Мохо', 'Ясно', 'Дально', 'Крипто', 'Монстро'];
const CITY_ROOT = ['горск', 'реченск', 'полье', 'лесск', 'озёрск', 'камск', 'травинск',
  'цветовск', 'холмск', 'бережск', 'градск', 'варинск', 'мшинск', 'клыковск'];

function cityName(u) {
  const rng = mulberry32(u >>> 0);
  return pick(rng, CITY_PRE) + pick(rng, CITY_ROOT);
}

// расстояние от точки до отрезка
function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy || 1;
  let t = ((px - ax) * dx + (py - ay) * dy) / len2;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t, qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

const World = {
  seed: 0,
  _tiles: new Map(),

  init(seed) {
    this.seed = seed >>> 0;
    this._tiles.clear();
    this._centers = new Map();
  },

  // Центр города ячейки Вороного (кэшируется — зовётся на каждый тайл)
  cityCenter(cellX, cellY) {
    const key = cellX + ',' + cellY;
    let c = this._centers && this._centers.get(key);
    if (c) return c;
    const hx = hash2u(cellX, cellY, this.seed ^ 0xC171);
    const hy = hash2u(cellX, cellY, this.seed ^ 0xC172);
    c = {
      // центр выровнен на середину квартала 12×12 — арена ложится ровно
      x: (Math.floor((cellX * CITY_CELL + 18 + hx % (CITY_CELL - 36)) / 12)) * 12 + 6,
      y: (Math.floor((cellY * CITY_CELL + 18 + hy % (CITY_CELL - 36)) / 12)) * 12 + 6,
      r: 16 + hx % 6,   // радиус городка: 16-21 тайл (≈3×3 квартала)
    };
    // центр в воде/на пляже — город не вырос (ячейка без города)
    c.dead = fbm(c.x, c.y, 55, this.seed ^ 0xA1A1, 3) < 0.37;
    if (!this._centers) this._centers = new Map();
    this._centers.set(key, c);
    return c;
  },

  // Ближайший центр города к точке (по 3×3 соседним ячейкам)
  nearestCityCenter(x, y) {
    const cellX = Math.floor(x / CITY_CELL), cellY = Math.floor(y / CITY_CELL);
    let best = null, bd = Infinity;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.cityCenter(cellX + dx, cellY + dy);
        const d = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
        if (d < bd) { bd = d; best = c; }
      }
    }
    if (!best.id) {
      best.id = 'C' + best.x + ',' + best.y;
      best.name = cityName(hash2u(best.x, best.y, this.seed ^ 0xC173));
    }
    return best;
  },

  // Информация о городе, если точка внутри городского круга (иначе null)
  cityInfoAt(x, y) {
    const c = this.nearestCityCenter(x, y);
    if (c.dead) return null;
    const d2 = (c.x - x) * (c.x - x) + (c.y - y) * (c.y - y);
    return d2 <= c.r * c.r ? c : null;
  },

  // Роль квартала 12×12 в городке: ровно по одной постройке каждого типа
  // вокруг центрального квартала с ареной; в остальных — дома и скверы.
  _blockRole(bx, by, city) {
    const dx = bx - Math.floor(city.x / 12);
    const dy = by - Math.floor(city.y / 12);
    if (dx === 0 && dy === 0) return 'arena';
    if (dx === -1 && dy === 0) return 'fountain';
    if (dx === 1 && dy === 0) return 'shop';
    if (dx === 0 && dy === -1) return 'tower';
    if (dx === 0 && dy === 1) return 'nursery';
    // остальное: изредка сквер с доской заданий, чаще дома
    const bh = hash2(bx, by, this.seed ^ 0xD4D4);
    if (bh < 0.22) return 'park';
    return 'houses';
  },

  // Межгородская дорога: точка близка к отрезку между соседними живыми центрами
  _onHighway(x, y) {
    const cellX = Math.floor(x / CITY_CELL), cellY = Math.floor(y / CITY_CELL);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const a = this.cityCenter(cellX + dx, cellY + dy);
        if (a.dead) continue;
        const right = this.cityCenter(cellX + dx + 1, cellY + dy);
        const down = this.cityCenter(cellX + dx, cellY + dy + 1);
        if (!right.dead && distToSeg(x, y, a.x, a.y, right.x, right.y) < 1.3) return true;
        if (!down.dead && distToSeg(x, y, a.x, a.y, down.x, down.y) < 1.3) return true;
      }
    }
    return false;
  },

  tileAt(x, y) {
    const key = x + ',' + y;
    const c = this._tiles.get(key);
    if (c !== undefined) return c;
    const t = this._compute(x, y);
    if (this._tiles.size > 250000) this._tiles.clear();
    this._tiles.set(key, t);
    return t;
  },

  // Климат: снега, умеренный пояс, пустыни
  climateAt(x, y) {
    const t = fbm(x, y, 150, this.seed ^ 0x7E3A, 2);
    return t < 0.37 ? 'cold' : t > 0.63 ? 'hot' : 'mild';
  },

  _compute(x, y) {
    let t = this._computeBase(x, y);
    // климат перекрашивает дикую природу (города и парки живут своей жизнью)
    const cl = this.climateAt(x, y);
    if (cl === 'cold') {
      if (t === T.GRASS || t === T.FLOOR || t === T.FLOWER) t = T.SNOW;
      else if (t === T.TALL) t = T.SNOWTALL;
      else if (t === T.TREE) t = T.SNOWTREE;
    } else if (cl === 'hot') {
      if (t === T.GRASS || t === T.FLOOR || t === T.FLOWER) t = T.DESERT;
      else if (t === T.TALL) t = T.DESERTTALL;
      else if (t === T.TREE) t = T.CACTUS;
    }
    return t;
  },

  _computeBase(x, y) {
    const s = this.seed;
    const e = fbm(x, y, 55, s ^ 0xA1A1, 3);   // высота
    const m = fbm(x, y, 40, s ^ 0xB2B2, 3);   // влажность
    const c = fbm(x, y, 95, s ^ 0xC3C3, 2);   // урбанизация

    if (e < 0.34) return T.WATER;

    // --- компактный городок вокруг центра Вороного ---
    const city = this.cityInfoAt(x, y);
    if (city) {
      const xm = ((x % 12) + 12) % 12;
      const ym = ((y % 12) + 12) % 12;
      if (xm <= 1 || ym <= 1) return T.ROAD;
      const bx = Math.floor(x / 12), by = Math.floor(y / 12);
      const role = this._blockRole(bx, by, city);
      if (role === 'arena') {
        if (xm >= 3 && xm <= 9 && ym >= 3 && ym <= 9) return T.ARENA;
        return T.PAVE;
      }
      if (role === 'fountain') {
        // сквер с фонтаном и главной доской заданий
        if (xm >= 6 && xm <= 7 && ym >= 6 && ym <= 7) return T.FOUNTAIN;
        if (xm === 3 && ym === 3) return T.BOARD;
        return T.PARK;
      }
      if (role === 'shop') {
        if (xm >= 5 && xm <= 7 && ym >= 5 && ym <= 6) return T.SHOP;
        return T.PAVE;
      }
      if (role === 'tower') {
        if (xm >= 5 && xm <= 7 && ym >= 4 && ym <= 7) return T.TOWER;
        return T.PAVE;
      }
      if (role === 'nursery') {
        if (xm >= 5 && xm <= 7 && ym >= 5 && ym <= 6) return T.NURSERY;
        return T.PAVE;
      }
      if (role === 'park') {
        // сквер, иногда с дополнительной доской заданий
        if (xm === 6 && ym === 6 && hash2(bx, by, s ^ 0xB0A2) < 0.5) return T.BOARD;
        return T.PARK;
      }
      const inQx = (xm >= 3 && xm <= 5) ? 0 : (xm >= 7 && xm <= 9) ? 1 : -1;
      const inQy = (ym >= 3 && ym <= 5) ? 0 : (ym >= 7 && ym <= 9) ? 1 : -1;
      if (inQx >= 0 && inQy >= 0) {
        const qh = hash2(bx * 4 + inQx + inQy * 2, by * 3 + 1, s ^ 0xE5E5);
        if (qh < 0.72) return T.BUILD;
      }
      return T.PAVE;
    }

    // --- межгородская дорога: тракт между соседними центрами городов ---
    if (this._onHighway(x, y)) return T.ROAD;

    if (e < 0.37) return T.SAND;

    // --- парк: клумбы, редкие деревья ---
    if (c > 0.54) {
      const h = hash2(x, y, s ^ 0xF6F6);
      if (h < 0.045) return T.TREE;
      if (h < 0.17) return T.FLOWER;
      return T.PARK;
    }

    // --- лес ---
    if (m > 0.57) {
      const density = 0.22 + vnoise(x, y, 14, s ^ 0x1717) * 0.18;
      if (hash2(x, y, s ^ 0x2828) < density) return T.TREE;
      return T.FLOOR;
    }

    // --- поля ---
    if (vnoise(x, y, 9, s ^ 0x3939) > 0.60) return T.TALL;
    if (hash2(x, y, s ^ 0x4A4A) < 0.015) return T.TREE;
    return T.GRASS;
  },

  isSolid(x, y) {
    return SOLID_TILES.has(this.tileAt(x, y));
  },

  // Уровень диких монстров растёт с удалением от точки старта
  levelAt(x, y) {
    const dist = Math.max(Math.abs(x), Math.abs(y));
    return clamp(2 + Math.floor(dist / 45), 2, 55);
  },

  // Локальная фауна: у каждого региона 48x48 свои 4 вида
  regionSpeciesSeed(x, y, slot) {
    const rx = Math.floor(x / 48), ry = Math.floor(y / 48);
    return hash2u(rx * 4 + slot, ry * 7 + slot * 3, this.seed ^ 0x9E37);
  },

  // Дикий монстрик для встречи на тайле; env = {night, rain, water, lvlBonus}
  makeWildMonster(x, y, rng, env) {
    const r = rng();
    const slot = r < 0.4 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3;
    let seed = this.regionSpeciesSeed(x, y, slot);
    // среда меняет фауну: вода/рыбалка > климат > погода > ночь
    if (env && env.water) {
      seed = findSpeciesOfType(hash2u(seed, 0xAB0A, this.seed), ['water', 'ice']);
    } else if (env && env.climate === 'cold' && rng() < 0.6) {
      seed = findSpeciesOfType(hash2u(seed, 0xC01D, this.seed), ['ice', 'water']);
    } else if (env && env.climate === 'hot' && rng() < 0.55) {
      seed = findSpeciesOfType(hash2u(seed, 0x407E, this.seed), ['fire', 'electric']);
    } else if (env && env.rain && rng() < 0.5) {
      seed = findSpeciesOfType(hash2u(seed, 0x7A11, this.seed), ['water', 'ice']);
    } else if (env && env.night && rng() < 0.45) {
      seed = findSpeciesOfType(hash2u(seed, 0x1417, this.seed), ['shadow', 'psychic']);
    }
    const level = clamp(this.levelAt(x, y) + irange(rng, -1, 2) + ((env && env.lvlBonus) || 0), 2, 62);
    const sp = getSpecies(seed);
    let stage = 0;
    if (level >= 18 && sp.chainLen > 1 && rng() < 0.35) stage = 1;
    if (level >= 30 && sp.chainLen > 2 && rng() < 0.25) stage = 2;
    const m = makeMonster(seed, stage, level);
    if (rng() < 1 / 64) {   // ✨ сияющий: редкий, усиленный
      m.shiny = true;
      recalcStats(m);
      m.hp = m.maxHp;
    }
    return m;
  },

  // Монстр из гнезда: редкий вид с полной цепочкой, повышенный уровень, шанс сияния 1/16
  makeNestMonster(x, y, rng) {
    const seed = findSpeciesChain3(hash2u(x, y, this.seed ^ 0x6E57));
    const level = clamp(this.levelAt(x, y) + 3 + irange(rng, 0, 2), 4, 62);
    const sp = getSpecies(seed);
    let stage = 0;
    if (level >= 14 && rng() < 0.6) stage = 1;
    if (level >= 26 && rng() < 0.4) stage = 2;
    stage = Math.min(stage, sp.chainLen - 1);
    const m = makeMonster(seed, stage, level);
    if (rng() < 1 / 16) {
      m.shiny = true;
      recalcStats(m);
      m.hp = m.maxHp;
    }
    return m;
  },

  // Гнездо редкого монстра на тайле?
  nestAt(x, y) {
    if (!WILD_TILES.has(this.tileAt(x, y))) return false;
    return hash2(x, y, this.seed ^ 0x6E58) < 0.0005;
  },

  // Погода: детерминированна по региону и блоку игрового времени
  weatherAt(x, y, clock) {
    const rx = Math.floor(x / 48), ry = Math.floor(y / 48);
    const tb = Math.floor(clock / 150); // меняется каждые 2.5 минуты
    return hash2(rx * 3 + tb, ry * 5 - tb, this.seed ^ 0xFA17) < 0.27 ? 'rain' : 'clear';
  },

  // Башня испытаний на тайле (или null)
  towerAt(x, y) {
    if (this.tileAt(x, y) !== T.TOWER) return null;
    const bx = Math.floor(x / 12), by = Math.floor(y / 12);
    return {
      id: 'W' + bx + ',' + by,
      seed: hash2u(bx, by, this.seed ^ 0xC0DE),
      level: this.levelAt(x, y),
    };
  },

  // Команда этажа башни: чем выше, тем злее
  towerTeam(tw, floor) {
    const rng = mulberry32(hash2u(tw.seed, floor * 131, 0x70E8));
    const size = 1 + (floor >= 3 ? 1 : 0) + (floor >= 6 ? 1 : 0);
    const team = [];
    for (let i = 0; i < size; i++) {
      const seed = hash2u(Math.floor(rng() * 100000), 71 + i, this.seed ^ 0x70E9);
      const level = clamp(tw.level + floor * 2 + irange(rng, 0, 2), 4, 68);
      const sp = getSpecies(seed);
      let stage = 0;
      if (level >= 14 && sp.chainLen > 1) stage = 1;
      if (level >= 26 && sp.chainLen > 2) stage = 2;
      team.push(makeMonster(seed, stage, level));
    }
    return team;
  },

  // Легендарное святилище на тайле? (только в глубокой глуши)
  shrineAt(x, y) {
    if (Math.max(Math.abs(x), Math.abs(y)) < 180) return false;
    if (!WILD_TILES.has(this.tileAt(x, y))) return false;
    return hash2(x, y, this.seed ^ 0x1E97) < 0.00015;
  },

  // Легендарный монстр святилища
  makeLegendMonster(x, y, rng) {
    const seed = findSpeciesChain3(hash2u(x, y, this.seed ^ 0x1E98));
    const dist = Math.max(Math.abs(x), Math.abs(y));
    const level = clamp(Math.floor(dist / 5), 40, 66);
    const m = makeMonster(seed, 2, level);
    if (rng() < 1 / 8) {
      m.shiny = true;
      recalcStats(m);
      m.hp = m.maxHp;
    }
    return m;
  },

  // NPC-обменник на тайле (или null)
  traderAt(x, y) {
    const t = this.tileAt(x, y);
    if (t !== T.PARK && t !== T.PAVE) return null;
    if (hash2(x, y, this.seed ^ 0x7261) >= 0.0045) return null;
    if (this.trainerAt(x, y)) return null; // не совмещаем с тренером
    const u = hash2u(x, y, this.seed ^ 0x7262);
    return { x, y, id: 'T' + x + ',' + y, seed: u };
  },

  // Что обменник предлагает и что хочет взамен
  traderOffer(td) {
    const rng = mulberry32(td.seed);
    const seed = hash2u(Math.floor(rng() * 100000), 53, this.seed ^ 0x7263);
    const level = clamp(this.levelAt(td.x, td.y) + irange(rng, 1, 3), 3, 60);
    const sp = getSpecies(seed);
    let stage = 0;
    if (level >= 16 && sp.chainLen > 1 && rng() < 0.5) stage = 1;
    const offered = makeMonster(seed, stage, level);
    if (rng() < 0.05) {
      offered.shiny = true;
      recalcStats(offered);
      offered.hp = offered.maxHp;
    }
    const wantsType = pick(rng, TYPE_LIST);
    return { offered, wantsType };
  },

  // Детерминированный NPC-тренер на тайле (или null)
  trainerAt(x, y) {
    const t = this.tileAt(x, y);
    let chance = 0;
    if (t === T.PAVE) chance = 0.010;
    else if (t === T.PARK) chance = 0.007;
    else if (t === T.GRASS) chance = 0.0016;
    if (!chance) return null;
    const h = hash2(x, y, this.seed ^ 0x3333);
    if (h >= chance) return null;
    const u = hash2u(x, y, this.seed ^ 0x5555);
    const lvl = this.levelAt(x, y);
    const tier = Math.min(4, Math.floor(lvl / 10));
    return {
      x, y,
      id: x + ',' + y,
      seed: u,
      name: TRAINER_TITLES[tier] + ' ' + TRAINER_NAMES[u % TRAINER_NAMES.length],
      level: lvl,
    };
  },

  // Команда тренера
  trainerTeam(tr) {
    const rng = mulberry32(tr.seed);
    const size = 1 + (tr.level >= 8 ? 1 : 0) + (tr.level >= 18 ? 1 : 0);
    const team = [];
    for (let i = 0; i < size; i++) {
      const seed = rng() < 0.5
        ? this.regionSpeciesSeed(tr.x, tr.y, Math.floor(rng() * 4))
        : hash2u(Math.floor(rng() * 100000), 17, this.seed ^ 0x7777);
      const level = clamp(tr.level + irange(rng, 0, 2), 2, 60);
      const sp = getSpecies(seed);
      let stage = 0;
      if (level >= 16 && sp.chainLen > 1 && rng() < 0.5) stage = 1;
      if (level >= 28 && sp.chainLen > 2 && rng() < 0.35) stage = 2;
      team.push(makeMonster(seed, stage, level));
    }
    return team;
  },

  // Мастер арены на тайле (стоит в центре арены)
  arenaMasterAt(x, y) {
    if (this.tileAt(x, y) !== T.ARENA) return null;
    const xm = ((x % 12) + 12) % 12;
    const ym = ((y % 12) + 12) % 12;
    if (xm !== 6 || ym !== 6) return null;
    const bx = Math.floor(x / 12), by = Math.floor(y / 12);
    const u = hash2u(bx, by, this.seed ^ 0xAAAA);
    const lvl = clamp(this.levelAt(x, y) + 4, 6, 60);
    const city = this.nearestCityCenter(x, y);
    return {
      x, y,
      id: 'A' + bx + ',' + by,
      seed: u,
      name: 'Лидер города ' + city.name + ' — ' + TRAINER_NAMES[u % TRAINER_NAMES.length],
      level: lvl,
      isMaster: true,
    };
  },

  // Команда мастера арены: 3 сильных монстра на максимальных стадиях
  masterTeam(master) {
    const rng = mulberry32(master.seed);
    const team = [];
    for (let i = 0; i < 3; i++) {
      const seed = hash2u(Math.floor(rng() * 100000), 31 + i, this.seed ^ 0xBBBB);
      const level = clamp(master.level + irange(rng, 0, 3), 6, 62);
      const sp = getSpecies(seed);
      let stage = 0;
      if (level >= 14 && sp.chainLen > 1) stage = 1;
      if (level >= 26 && sp.chainLen > 2) stage = 2;
      team.push(makeMonster(seed, stage, level));
    }
    return team;
  },

  // Предмет-сфера на тайле?
  itemAt(x, y) {
    const t = this.tileAt(x, y);
    if (!WILD_TILES.has(t) && t !== T.PARK) return false;
    if (t === T.TALL || t === T.SNOWTALL || t === T.DESERTTALL) return false;
    return hash2(x, y, this.seed ^ 0x4444) < 0.0022;
  },
};

// ===== Атлас тайлов (рисуется кодом один раз) =====

const TILE = 16;
const TILE_VARIANTS = 2;
let tileAtlas = null;

function buildTileAtlas() {
  tileAtlas = document.createElement('canvas');
  tileAtlas.width = TILE * TILE_COUNT;
  tileAtlas.height = TILE * TILE_VARIANTS;
  const ctx = tileAtlas.getContext('2d');

  const px = (ox, oy, x, y, w, h, col) => {
    ctx.fillStyle = col;
    ctx.fillRect(ox + x, oy + y, w, h);
  };

  for (let v = 0; v < TILE_VARIANTS; v++) {
    const oy = v * TILE;
    const rng = mulberry32(0xA77A + v * 999);
    const dots = (ox, col, n, sz) => {
      for (let i = 0; i < n; i++)
        px(ox, oy, irange(rng, 1, 14), irange(rng, 1, 14), sz, sz, col);
    };

    let ox;
    // WATER
    ox = T.WATER * TILE;
    px(ox, oy, 0, 0, 16, 16, '#2f63ae');
    dots(ox, '#3d75c4', 5, 2);
    px(ox, oy, irange(rng, 1, 10), irange(rng, 2, 12), 4, 1, '#7fb0e8');
    px(ox, oy, irange(rng, 1, 10), irange(rng, 2, 12), 3, 1, '#7fb0e8');
    // SAND
    ox = T.SAND * TILE;
    px(ox, oy, 0, 0, 16, 16, '#d8c286');
    dots(ox, '#c4ad6f', 6, 1);
    dots(ox, '#e8d6a2', 4, 1);
    // GRASS
    ox = T.GRASS * TILE;
    px(ox, oy, 0, 0, 16, 16, '#5aa348');
    dots(ox, '#4d9040', 7, 1);
    dots(ox, '#6cb457', 5, 1);
    // TALL — высокая трава
    ox = T.TALL * TILE;
    px(ox, oy, 0, 0, 16, 16, '#4d9040');
    for (let i = 0; i < 7; i++) {
      const tx = irange(rng, 1, 13);
      const ty = irange(rng, 3, 11);
      px(ox, oy, tx, ty, 1, 5, '#2e6b28');
      px(ox, oy, tx + 1, ty + 1, 1, 4, '#3a7d32');
    }
    // FLOOR — лесная подстилка
    ox = T.FLOOR * TILE;
    px(ox, oy, 0, 0, 16, 16, '#3f7a38');
    dots(ox, '#35682f', 7, 2);
    dots(ox, '#553f28', 3, 1);
    // TREE
    ox = T.TREE * TILE;
    px(ox, oy, 0, 0, 16, 16, '#4d9040');
    px(ox, oy, 6, 11, 4, 5, '#6b4a2a');
    px(ox, oy, 2, 2, 12, 10, '#2e6b28');
    px(ox, oy, 4, 1, 8, 12, '#2e6b28');
    px(ox, oy, 1, 4, 14, 6, '#2e6b28');
    dots(ox, '#3d8534', 6, 2);
    px(ox, oy, irange(rng, 3, 9), 2, 3, 2, '#4d9c40');
    // FLOWER
    ox = T.FLOWER * TILE;
    px(ox, oy, 0, 0, 16, 16, '#63ad50');
    for (let i = 0; i < 4; i++) {
      const fx = irange(rng, 1, 13), fy = irange(rng, 1, 13);
      const col = pick(rng, ['#e86a6a', '#f0d858', '#f0f0f0', '#c878e8']);
      px(ox, oy, fx, fy, 2, 2, col);
      px(ox, oy, fx, fy, 1, 1, '#fff2b0');
    }
    // ROAD
    ox = T.ROAD * TILE;
    px(ox, oy, 0, 0, 16, 16, '#5a5a62');
    dots(ox, '#4e4e56', 5, 2);
    dots(ox, '#68686f', 4, 1);
    // PAVE — тротуарная плитка
    ox = T.PAVE * TILE;
    px(ox, oy, 0, 0, 16, 16, '#9a9aa2');
    px(ox, oy, 0, 7, 16, 1, '#84848c');
    px(ox, oy, 7, 0, 1, 8, '#84848c');
    px(ox, oy, 11, 8, 1, 8, '#84848c');
    // BUILD — крыша дома
    ox = T.BUILD * TILE;
    const roof = pick(rng, ['#b0523a', '#3a6ab0', '#b08a3a']);
    px(ox, oy, 0, 0, 16, 16, roof);
    px(ox, oy, 0, 0, 16, 2, '#00000030');
    px(ox, oy, 0, 0, 2, 16, '#00000030');
    px(ox, oy, 4, 4, 8, 8, '#ffffff20');
    px(ox, oy, 7, 0, 2, 16, '#00000018');
    // FOUNTAIN
    ox = T.FOUNTAIN * TILE;
    px(ox, oy, 0, 0, 16, 16, '#9a9aa2');
    px(ox, oy, 1, 1, 14, 14, '#7a7a85');
    px(ox, oy, 3, 3, 10, 10, '#3f8fe0');
    px(ox, oy, 5, 5, 6, 6, '#7fb8f0');
    px(ox, oy, 7, 4, 2, 2, '#d8f0ff');
    // PARK — газон
    ox = T.PARK * TILE;
    px(ox, oy, 0, 0, 16, 16, '#63ad50');
    dots(ox, '#57a046', 6, 1);
    dots(ox, '#74bd5e', 5, 1);
    // ARENA — боевая площадка
    ox = T.ARENA * TILE;
    px(ox, oy, 0, 0, 16, 16, '#c9a35c');
    dots(ox, '#b8924b', 6, 1);
    dots(ox, '#d8b46e', 4, 1);
    px(ox, oy, 0, 0, 16, 1, '#a8823c');
    px(ox, oy, 0, 0, 1, 16, '#a8823c');
    // SHOP — киоск с полосатым навесом
    ox = T.SHOP * TILE;
    px(ox, oy, 0, 0, 16, 16, '#8a5a34');
    px(ox, oy, 0, 0, 16, 5, '#d84848');
    px(ox, oy, 2, 0, 3, 5, '#f0f0f0');
    px(ox, oy, 8, 0, 3, 5, '#f0f0f0');
    px(ox, oy, 14, 0, 2, 5, '#f0f0f0');
    px(ox, oy, 3, 7, 10, 6, '#6b4322');
    px(ox, oy, 4, 8, 8, 3, '#ffd75e');
    // TOWER — тёмный камень с бойницами
    ox = T.TOWER * TILE;
    px(ox, oy, 0, 0, 16, 16, '#4a4a5a');
    px(ox, oy, 0, 0, 16, 2, '#5c5c70');
    px(ox, oy, 0, 14, 16, 2, '#38384a');
    px(ox, oy, 3, 4, 2, 5, '#ffd75e');
    px(ox, oy, 11, 4, 2, 5, '#ffd75e');
    px(ox, oy, 7, 8, 2, 6, '#2a2a38');
    dots(ox, '#55556a', 4, 1);
    // SNOW — снег
    ox = T.SNOW * TILE;
    px(ox, oy, 0, 0, 16, 16, '#e8eef4');
    dots(ox, '#d4dfe8', 6, 1);
    dots(ox, '#ffffff', 4, 1);
    // SNOWTALL — заснеженная трава
    ox = T.SNOWTALL * TILE;
    px(ox, oy, 0, 0, 16, 16, '#dce6ee');
    for (let i = 0; i < 6; i++) {
      const tx = irange(rng, 1, 13), ty = irange(rng, 3, 11);
      px(ox, oy, tx, ty, 1, 5, '#8aa8bc');
      px(ox, oy, tx + 1, ty, 1, 2, '#ffffff');
    }
    // SNOWTREE — ель в снегу
    ox = T.SNOWTREE * TILE;
    px(ox, oy, 0, 0, 16, 16, '#e8eef4');
    px(ox, oy, 6, 11, 4, 5, '#5a4632');
    px(ox, oy, 3, 2, 10, 10, '#2e5a44');
    px(ox, oy, 5, 1, 6, 12, '#2e5a44');
    px(ox, oy, 3, 2, 10, 2, '#ffffff');
    px(ox, oy, 5, 6, 6, 1, '#ffffff');
    px(ox, oy, irange(rng, 4, 9), 4, 2, 1, '#ffffff');
    // DESERT — пустыня
    ox = T.DESERT * TILE;
    px(ox, oy, 0, 0, 16, 16, '#e0cc8e');
    dots(ox, '#cdb877', 6, 1);
    px(ox, oy, irange(rng, 1, 8), irange(rng, 2, 12), 6, 1, '#d3bd7e');
    px(ox, oy, irange(rng, 1, 8), irange(rng, 2, 12), 5, 1, '#eddaa0');
    // DESERTTALL — сухостой
    ox = T.DESERTTALL * TILE;
    px(ox, oy, 0, 0, 16, 16, '#d8c384');
    for (let i = 0; i < 6; i++) {
      const tx = irange(rng, 1, 13), ty = irange(rng, 3, 11);
      px(ox, oy, tx, ty, 1, 5, '#a08a4a');
      px(ox, oy, tx + 1, ty + 1, 1, 3, '#8a7538');
    }
    // CACTUS — кактус
    ox = T.CACTUS * TILE;
    px(ox, oy, 0, 0, 16, 16, '#e0cc8e');
    px(ox, oy, 7, 3, 3, 11, '#3f8a3a');
    px(ox, oy, 3, 5, 3, 2, '#3f8a3a');
    px(ox, oy, 3, 3, 2, 4, '#3f8a3a');
    px(ox, oy, 11, 7, 3, 2, '#3f8a3a');
    px(ox, oy, 12, 4, 2, 5, '#3f8a3a');
    px(ox, oy, 8, 3, 1, 11, '#5aa850');
    dots(ox, '#cdb877', 3, 1);
    // NURSERY — домик питомника с сердечком
    ox = T.NURSERY * TILE;
    px(ox, oy, 0, 0, 16, 16, '#e08ab0');
    px(ox, oy, 0, 0, 16, 2, '#00000030');
    px(ox, oy, 0, 0, 2, 16, '#00000030');
    px(ox, oy, 4, 4, 8, 8, '#ffffff30');
    px(ox, oy, 6, 6, 2, 2, '#ffffff');
    px(ox, oy, 9, 6, 2, 2, '#ffffff');
    px(ox, oy, 6, 8, 5, 2, '#ffffff');
    px(ox, oy, 7, 10, 3, 1, '#ffffff');
    px(ox, oy, 8, 11, 1, 1, '#ffffff');
    // BOARD — доска заданий
    ox = T.BOARD * TILE;
    px(ox, oy, 0, 0, 16, 16, '#63ad50');
    px(ox, oy, 7, 9, 2, 7, '#6b4a2a');
    px(ox, oy, 2, 2, 12, 8, '#8a6a3a');
    px(ox, oy, 3, 3, 10, 6, '#c9b489');
    px(ox, oy, 4, 4, 8, 1, '#6b5638');
    px(ox, oy, 4, 6, 6, 1, '#6b5638');
    px(ox, oy, 4, 8, 7, 1, '#6b5638');
  }
}

function drawTile(ctx, tile, x, y, dx, dy, scale) {
  const v = hash2u(x, y, 0x1234) % TILE_VARIANTS;
  ctx.drawImage(tileAtlas, tile * TILE, v * TILE, TILE, TILE, dx, dy, scale, scale);
}
