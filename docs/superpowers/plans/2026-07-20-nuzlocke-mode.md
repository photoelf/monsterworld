# Nuzlocke-режим — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Хардкорный режим Nuzlocke в отдельном слоте сейва: пермасмерть, правило первой встречи по «областям» (Вороной-ячейки городов), клички, левел-кап, летопись-фанфик с ботом.

**Architecture:** Вариант A из спеки `docs/superpowers/specs/2026-07-20-nuzlocke-design.md`: флаг `G.nuzlocke` + блок `G.nz` в сейве, весь новый код в **новом файле `js/nz.js`**, точечные гейты `NZ()` в существующих файлах. Второй слот сейва — те же функции с другим ключом localStorage и другим префиксом облачных чанков.

**Tech Stack:** Ванильный JS без сборки (репо-конвенции!), Cloudflare Worker (backend/worker.js), Telegram Mini App.

## Global Constraints

- Спека — источник правил: `docs/superpowers/specs/2026-07-20-nuzlocke-design.md`. Прочитай её перед своей задачей.
- Новый файл `js/nz.js` подключается в `index.html` МЕЖДУ `battle.js` и `main.js` и добавляется в `ASSETS` в `sw.js` (Task 1). Версию `CACHE` в sw.js поднимает ТОЛЬКО Task 11 (один бамп на весь релиз): `monsterworld-v53` → `monsterworld-v54`.
- Порядок деплоя: воркер (`cd backend && env -u CLOUDFLARE_API_TOKEN npx wrangler deploy`) РАНЬШЕ пуша фронта. Деплой делает только Task 11.
- Проверка синтаксиса после каждой правки: `node --check js/<файл>.js` (для воркера `node --check backend/worker.js`).
- Все тексты UI — русский, тёплый уличный тон («братва», «семья»). Клички/ники в innerHTML — только через существующие санитайзеры; новые чужие строки не рендерить innerHTML.
- Не использовать нативный `confirm()`/`prompt()` ВНУТРИ активного боя (ломает async-поток); после закрытия боевого экрана — можно.
- В воркере /nzlog KV НЕ трогать вообще (лимит 1000 записей/день).
- Set-режим уже соблюдён в текущем бое (замен при нокауте врага нет) — отдельная работа не нужна, это проверенный факт.
- Коммит после каждой задачи, сообщения на русском, суффикс `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Слоты сейва, каркас G.nz, титул

**Files:**
- Create: `js/nz.js`
- Modify: `js/main.js` (SAVE_KEY ~134, buildSaveData ~508, loadGame ~579, newWorld ~650, initTitle ~4224)
- Modify: `js/tg.js` (cloudUpload ~94, cloudDownload ~117, cloudSyncOnLaunch ~150)
- Modify: `index.html` (титул ~434, список скриптов ~745)
- Modify: `sw.js` (ASSETS, строка 10 — только добавить `'./js/nz.js'`, версию НЕ трогать)

**Interfaces (Produces — на них опираются все следующие задачи):**
- `NZ()` → boolean — активен ли Nuzlocke в текущем сейве.
- `G.nz` — объект `{cap, zones, lineages, graveyard, log, cities, stats, over}` (см. спеку).
- `nzFreshState()`, `nzLog(kind, data)` — добавляет `{t: Date.now(), k: kind, ...data}` в `G.nz.log`.
- `SAVE_SLOT` ('main'|'nz'), `SAVE_KEY_MAIN`, `SAVE_KEY_NZ`, `setSaveSlot(slot)` — глобальные в main.js.
- `newWorld(seedText, nz)` — второй аргумент включает режим.

- [ ] **Step 1: создать js/nz.js с каркасом**

```js
'use strict';

// ===== Nuzlocke-режим («☠️ Nuzlocke») =====
// Хардкорный режим в отдельном слоте сейва. Правила: пермасмерть, одна поимка
// на «область» (Вороной-ячейка города), обязательные клички, левел-кап,
// запрет предметов в бою, скорость ×0.5, спавн диких ×0.3, летопись рана.
// Спека: docs/superpowers/specs/2026-07-20-nuzlocke-design.md

function NZ() { return !!(typeof G !== 'undefined' && G && G.nuzlocke); }

function nzFreshState() {
  return {
    cap: 15,        // левел-кап; растёт победами над лидерами (nzRecalcCap)
    zones: {},      // zoneId -> 'used' (нет ключа = встреча области доступна)
    lineages: [],   // speciesSeed пойманных эво-линий (Dupes Clause)
    graveyard: [],  // павшие: {mon, caughtLvl, diedLvl, battles, killer, place, ts}
    log: [],        // события летописи {t, k, ...} — текст генерится при рендере
    cities: {},     // открытые города: id -> {x, y} (для пересчёта капа)
    stats: { catches: 0, deaths: 0, leaders: 0, battles: 0 },
    over: false,    // блэкаут случился — ран мёртв, показываем итоги
  };
}

function nzLoadState(d) { return Object.assign(nzFreshState(), d || {}); }

// Событие летописи. Только данные — текст соберёт nzLogText при рендере,
// поэтому сейв не пухнет и старые записи получают новые формулировки.
function nzLog(kind, data) {
  if (!NZ()) return;
  G.nz.log.push(Object.assign({ t: Date.now(), k: kind }, data || {}));
}
```

- [ ] **Step 2: подключить nz.js**

В `index.html` между battle.js и main.js:
```html
<script src="js/battle.js"></script>
<script src="js/nz.js"></script>
<script src="js/main.js"></script>
```
В `sw.js` в ASSETS: `'./js/battle.js', './js/nz.js', './js/main.js',` (вставить `'./js/nz.js'` в список на строке 10).

- [ ] **Step 3: слоты сейва в main.js**

Заменить `const SAVE_KEY = 'monsterworld-save-v1';` (строка ~134) на:
```js
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
```

- [ ] **Step 4: G.nuzlocke в сейве**

В `buildSaveData()` добавить два поля (после `hints: G.hints,`):
```js
    nuzlocke: !!G.nuzlocke,
    nz: G.nuzlocke ? G.nz : undefined,
```
В `loadGame()` перед `GROWTH_QUEUE.length = 0;`:
```js
  G.nuzlocke = !!data.nuzlocke;
  G.nz = G.nuzlocke ? nzLoadState(data.nz) : null;
```
В `newWorld(seedText)` сменить сигнатуру на `newWorld(seedText, nz)` и перед `G.spawn = findSpawn();` добавить:
```js
  G.nuzlocke = !!nz;
  G.nz = nz ? nzFreshState() : null;
  if (nz) nzLog('start', { seed: G.seed });
```

- [ ] **Step 5: титул — чекбокс и вторая кнопка**

В `index.html` в `#title` после `<button id="btn-continue" ...>`:
```html
    <button id="btn-continue-nz" class="hidden">☠️ Продолжить Nuzlocke</button>
```
После `.title-row` с btn-new:
```html
    <label style="font-size:14px;display:flex;gap:6px;align-items:center;cursor:pointer;">
      <input type="checkbox" id="nz-check"> ☠️ Режим Nuzlocke
    </label>
    <div id="nz-rules" class="hidden" style="font-size:12px;opacity:.85;max-width:min(420px,92vw);text-align:left;line-height:1.5;border:1px solid var(--ui-border);border-radius:6px;padding:8px 10px;">
      Жёсткие правила улицы: братишка с 0 ОЗ <b>погибает навсегда</b>; в каждой
      области можно поймать <b>только первого</b> встреченного (дубли не в счёт,
      ✨шайни — всегда можно); каждому — <b>кличка</b>; предметы в бою запрещены;
      левел-кап растёт победами над лидерами. Пали все — ран окончен.
      <b>Купленные за звёзды бонусы тут не работают.</b> Зато «Свой спрайт» — бесплатно.
    </div>
```
В `initTitle()` (main.js):
```js
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
```
`hasSave` (основной слот) считать по `SAVE_KEY_MAIN` вместо `SAVE_KEY` (титул не знает, какой слот был активен). В `btn-continue.onclick` первой строкой `setSaveSlot('main');`. В `btn-new.onclick`:
```js
  document.getElementById('btn-new').onclick = () => {
    const nz = document.getElementById('nz-check').checked;
    setSaveSlot(nz ? 'nz' : 'main');
    newWorld(document.getElementById('seed-input').value.trim(), nz);
  };
```
До Task 5 функции `nzGameOver` нет — добавить в nz.js временную заглушку: `function nzGameOver() { toast('Ран окончен.'); }` (Task 5 заменит).

- [ ] **Step 6: облако — чанки обоих слотов (tg.js)**

`cloudUpload`/`cloudDownload`/`cloudSyncOnLaunch` параметризовать слотом. Префикс: `sv` для main, `nz` для nz. Заменить тела:
```js
function cloudSlotKeys(slot) {
  return slot === 'nz'
    ? { local: SAVE_KEY_NZ, pre: 'nz' }
    : { local: SAVE_KEY_MAIN, pre: 'sv' };
}

// Залить сейв АКТИВНОГО слота в облако
async function cloudUpload() {
  const { local, pre } = cloudSlotKeys(SAVE_SLOT);
  const raw = localStorage.getItem(local);
  if (!raw) return;
  const enc = b64e(raw);
  const n = Math.ceil(enc.length / CLOUD_CHUNK);
  const jobs = [];
  for (let i = 0; i < n; i++) {
    jobs.push(csSet(pre + '_' + i, enc.slice(i * CLOUD_CHUNK, (i + 1) * CLOUD_CHUNK)));
  }
  await Promise.all(jobs);
  await csSet(pre + '_meta', JSON.stringify({ n, ts: Date.now(), len: enc.length }));
  let meta0 = null;
  try { meta0 = JSON.parse(await csGet(pre + '_meta_prev')); } catch (e) {}
  if (meta0 && meta0.n > n) {
    const stale = [];
    for (let i = n; i < meta0.n; i++) stale.push(pre + '_' + i);
    csRemove(stale).catch(() => {});
  }
  csSet(pre + '_meta_prev', JSON.stringify({ n })).catch(() => {});
}

async function cloudDownload(slot) {
  const { pre } = cloudSlotKeys(slot);
  let meta = null;
  try { meta = JSON.parse(await csGet(pre + '_meta')); } catch (e) { return null; }
  if (!meta || !meta.n) return null;
  const keys = [];
  for (let i = 0; i < meta.n; i++) keys.push(pre + '_' + i);
  const parts = await csGetMany(keys);
  let enc = '';
  for (let i = 0; i < meta.n; i++) {
    const p = parts[pre + '_' + i];
    if (!p) return null;
    enc += p;
  }
  if (meta.len && enc.length !== meta.len) return null;
  try { return { json: b64d(enc), ts: meta.ts || 0 }; } catch (e) { return null; }
}

// При запуске синкаем ОБА слота: на новом устройстве появляются обе кнопки
async function cloudSyncOnLaunch() {
  for (const slot of ['main', 'nz']) {
    const { local } = cloudSlotKeys(slot);
    const cloud = await cloudDownload(slot).catch(() => null);
    if (!cloud) continue;
    let localTs = -1;
    try {
      const d = JSON.parse(localStorage.getItem(local));
      if (d && d.party && d.party.length) localTs = d.ts || 0;
    } catch (e) {}
    if (cloud.ts > localTs) {
      try {
        const cd = JSON.parse(cloud.json);
        if (!cd || !cd.party || !cd.party.length) continue;
        localStorage.setItem(local, cloud.json);
      } catch (e) { continue; }
      if (G.state === 'title') {
        document.getElementById(slot === 'nz' ? 'btn-continue-nz' : 'btn-continue').classList.remove('hidden');
        toast('☁️ Сейв загружен из облака Telegram');
      }
    }
  }
}
```
`importSaveCode` (main.js): после успешного парса писать в слот по флагу данных: `localStorage.setItem(data.nuzlocke ? SAVE_KEY_NZ : SAVE_KEY_MAIN, JSON.stringify(data));` и перед `loadGame()` в обработчике btn-import вызвать `setSaveSlot(data.nuzlocke ? 'nz' : 'main')` — вернуть флаг из importSaveCode: пусть importSaveCode при успехе возвращает `{ nz: !!data.nuzlocke }` вместо `null`, а ошибки — строкой как раньше; обработчик: `const r = importSaveCode(code); if (typeof r === 'string') { ...ошибка... } else { setSaveSlot(r.nz ? 'nz' : 'main'); if (loadGame()) ... }`.

- [ ] **Step 7: проверка и коммит**

```bash
node --check js/nz.js && node --check js/main.js && node --check js/tg.js
git add -A && git commit -m "Nuzlocke 1/11: слоты сейва, каркас G.nz, титул"
```

---

### Task 2: Скорость ×0.5, спавн ×0.3, самокат off

**Files:**
- Modify: `js/main.js` (step ~2039, onTileEnter ~1233, activeMount ~775, landMountKind ~761)

**Interfaces:** Consumes `NZ()`.

- [ ] **Step 1: скорость**

Строка ~2039 в `step()`:
```js
  const speed = (keys.has('Shift') ? 8.6 : 5.2) * (mount ? mount.mult : 1) * (NZ() ? 0.5 : 1);
```

- [ ] **Step 2: спавн диких ×0.3**

В `onTileEnter` после `if (chance && G.phase === 'night') chance *= 1.3;`:
```js
  if (chance && NZ()) chance *= 0.3;   // Nuzlocke: реже случайные бои
```

- [ ] **Step 3: самокат отключён в NZ**

В `activeMount()`: `if (!NZ() && scootUnlocked && G.scootOn) return { kind: 'scooter', mult: 1.8 };`
В `landMountKind()`: `if (!NZ() && scootUnlocked && G.scootOn) return 'scooter';`

- [ ] **Step 4: проверка и коммит**

```bash
node --check js/main.js
git add -A && git commit -m "Nuzlocke 2/11: скорость ×0.5, спавн ×0.3, самокат off"
```

---

### Task 3: Области и правило первой встречи

**Files:**
- Modify: `js/nz.js` (зоны, гейт ловли, кличка)
- Modify: `js/main.js` (startWildBattle ~881, updateHUD ~421, обработчик выбора стартера — найти по греп `starters`)
- Modify: `js/battle.js` (кнопка «Поймать» ~506)

**Interfaces:**
- Produces: `nzZoneAt(x, y)` → центр живого города `{id, name, x, y, ...}`; `nzEncounterInfo(x, y, wild)` → `{zone, kind: 'enc'|'dupe'|'used'|'shiny', catch: {ok, why?}}`; `nzAfterWild(enc, wild, result)`; `nzForceNick(mon)`; `nzOnStarter(mon)`.
- Battle.run получает новый opts-параметр `nzCatch: {ok, why?} | null`.

- [ ] **Step 1: nzZoneAt в nz.js**

```js
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
```
Внимание: цикл при r=2..4 повторно сканирует внутренние ячейки — это ок (кэш центров), не «оптимизировать» ценой детерминизма.

- [ ] **Step 2: правило встречи в nz.js**

```js
// Статус дикого боя по правилам Nuzlocke (вызывается ДО Battle.run)
function nzEncounterInfo(x, y, wild) {
  const zone = nzZoneAt(x, y);
  if (wild.shiny) return { zone, kind: 'shiny', catch: { ok: true } };            // Shiny Clause
  if (G.nz.zones[zone.id]) return { zone, kind: 'used', catch: { ok: false, why: 'встреча области уже была' } };
  if (G.nz.lineages.includes(wild.speciesSeed))
    return { zone, kind: 'dupe', catch: { ok: false, why: 'такой уже есть в семье' } };  // Dupes Clause
  return { zone, kind: 'enc', catch: { ok: true } };
}

// После дикого боя: пометить область, записать летопись, оформить поимку
function nzAfterWild(enc, wild, result) {
  if (!NZ() || !enc) return;
  if (enc.kind === 'enc') {
    G.nz.zones[enc.zone.id] = 'used';
    nzLog('meet', { sp: wild.speciesSeed, st: wild.stage, lvl: wild.level, zn: enc.zone.name,
      out: result === 'caught' ? 'c' : result === 'run' ? 'r' : result === 'lose' ? 'l' : 'k' });
  }
  if (result === 'caught') {
    if (!G.nz.lineages.includes(wild.speciesSeed)) G.nz.lineages.push(wild.speciesSeed);
    G.nz.stats.catches++;
    wild.nzCaughtLvl = wild.level;
    nzForceNick(wild);
    nzLog('name', { sp: wild.speciesSeed, nick: wild.nick });
  }
  saveGame();
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
```

- [ ] **Step 3: интеграция в startWildBattle (main.js)**

```js
async function startWildBattle(x, y, mode) {
  ...существующий код формирования wild/envText...
  const nzEnc = NZ() ? nzEncounterInfo(x, y, wild) : null;
  const result = await Battle.run({ kind: 'wild', enemyParty: [wild], envText,
    nzCatch: nzEnc ? nzEnc.catch : null });
  if (nzEnc) nzAfterWild(nzEnc, wild, result);
  ...существующие if (mode === 'fish' ...) и afterBattle(result)...
```

- [ ] **Step 4: кнопка «Поймать» в battle.js**

Заменить строки ~505-507:
```js
          opts.kind !== 'wild'
            ? { label: 'Поймать', small: 'нельзя: чужой', disabled: true }
            : (opts.nzCatch && !opts.nzCatch.ok)
              ? { label: 'Поймать', small: '☠️ ' + opts.nzCatch.why, disabled: true }
              : { label: 'Поймать', small: 'сфер: ' + ballsTotal(G.balls), disabled: ballsTotal(G.balls) < 1 },
```

- [ ] **Step 5: стартер**

Найти обработчик выбора стартера: `grep -n "starters" js/main.js` → в функции, где выбранный стартер пушится в `G.party` (рядом с `showStarterPick`). Сразу после добавления в party и ДО перехода в мир вставить `nzOnStarter(<переменная стартера>);`.

- [ ] **Step 6: HUD-индикатор области**

В `updateHUD()` в конец шаблона hud-stats (после блока с cityInfoAt) добавить:
```js
    (NZ() ? (() => { const z = nzZoneAt(px, py);
      return ' · 📍' + z.name + (G.nz.zones[z.id] ? ' ✔' : ' 🎯'); })() : '') +
```
(вставить внутрь конкатенации перед закрывающим `'</span>'`).

- [ ] **Step 7: проверка и коммит**

```bash
node --check js/nz.js && node --check js/main.js && node --check js/battle.js
git add -A && git commit -m "Nuzlocke 3/11: области, первая встреча, dupes/shiny, клички"
```

---

### Task 4: Пермасмерть и Кладбище

**Files:**
- Modify: `js/nz.js` (nzNoteFaint, nzAfterBattle, nzBury)
- Modify: `js/battle.js` (две точки нокаута своего: ~721 и ~725)
- Modify: `js/main.js` (afterBattle ~954, dumpOwnedMon ~477, reviveOwnedMon ~486, renderStorage — греп `renderStorage`)
- Modify: `index.html` (storage-panel ~711)

**Interfaces:**
- Produces: `nzAfterBattle(result)` → true если случился блэкаут (afterBattle прерывается); `nzNoteFaint(pm, em, opts)`; `nzBury(mon)`; `_nzStorageTab` ('box'|'grave').
- У братишек появляются поля `nzCaughtLvl`, `nzBattles`, эфемерные `nzKiller`/`nzPlace`.

- [ ] **Step 1: хуки убийцы в battle.js**

В ветке `if (party[pi].hp <= 0) {` (~725) сразу после `await this.say(... 'теряет сознание!')`:
```js
        if (typeof nzNoteFaint === 'function') nzNoteFaint(party[pi], enemyParty[ei], opts);
```
В ветке взаимного нокаута (~721), ПЕРЕД `result = this.firstAlive(party) === -1 ? 'lose' : 'win';`:
```js
          if (typeof nzNoteFaint === 'function' && party[pi].hp <= 0) nzNoteFaint(party[pi], enemyParty[ei], opts);
```

- [ ] **Step 2: nz.js — смерть и похороны**

```js
// Запомнить, кто добил бойца (зовётся из battle.js в момент нокаута)
function nzNoteFaint(pm, em, opts) {
  if (!NZ()) return;
  pm.nzKiller = (opts.kind === 'trainer' ? (opts.trainerName || 'тренер') + ': ' : 'дикий ')
    + monSpeciesName(em) + ' (ур.' + em.level + ')';
  pm.nzPlace = opts.foe === 'tower' ? 'башня испытаний'
    : 'обл. ' + nzZoneAt(G.player.x, G.player.y).name;
}

function nzBury(m) {
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
```

- [ ] **Step 3: afterBattle (main.js)**

Первой строкой `afterBattle(result)`:
```js
  if (NZ() && nzAfterBattle(result)) return;   // блэкаут показал свой экран
```

- [ ] **Step 4: nz-поля в сейве братишки**

`dumpOwnedMon`: добавить `nzCaughtLvl: m.nzCaughtLvl || undefined, nzBattles: m.nzBattles || undefined,`.
`reviveOwnedMon`: в литерал `m` добавить `nzCaughtLvl: md.nzCaughtLvl | 0 || undefined, nzBattles: md.nzBattles | 0 || undefined,`.

- [ ] **Step 5: вкладка Кладбище в Кармане**

В `index.html` в `#storage-panel` перед `#storage-sort`:
```html
    <div id="storage-tabs" style="display:flex;gap:6px;justify-content:center;"></div>
```
В main.js: глобальная `let _nzStorageTab = 'box';`. В начале `renderStorage()` (найти греп `function renderStorage`):
```js
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
```
В nz.js:
```js
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
```
Примечание: `e.killer`/`e.place` собираются из наших же строк (monSpeciesName/trainerName уже проходят через санитайзеры игры) — innerHTML допустим, как в остальном Кармане; `monName` кличёк даёт свои, введённые этим же игроком.

- [ ] **Step 6: фонтан не воскрешает**

Мёртвых в party к моменту фонтана уже нет (их забирает nzAfterBattle) — healAtFountain лечит только живых автоматически. Проверить глазами, что нигде больше нет воскрешений: `grep -n "hp = m.maxHp" js/main.js` — все вхождения работают по G.party (живые). Ничего менять не надо, это шаг-проверка.

- [ ] **Step 7: проверка и коммит**

```bash
node --check js/nz.js && node --check js/main.js && node --check js/battle.js
git add -A && git commit -m "Nuzlocke 4/11: пермасмерть, кладбище, добор из кармана"
```

---

### Task 5: Блэкаут — экран итогов

**Files:**
- Modify: `js/nz.js` (nzGameOver — заменить заглушку, nzWipeRun)
- Modify: `js/tg.js` (nzCloudWipe)
- Modify: `index.html` (новая панель #nzover-panel)
- Modify: `js/main.js` (initTitle — обработчики кнопок панели)

**Interfaces:**
- Produces: `nzGameOver()` (показ экрана; идемпотентна — повторный вызов просто показывает панель), `nzWipeRun()` (стирает NZ-слот локально и в облаке, возвращает на титул). Consumes: `nzFullStory()` из Task 8 — до Task 8 использовать заглушку `function nzFullStory() { return 'Летопись пишется...'; }` в nz.js (Task 8 заменит).

- [ ] **Step 1: панель в index.html** (рядом с другими .overlay, например после #storage-panel)

```html
  <!-- Nuzlocke: конец рана -->
  <div id="nzover-panel" class="overlay hidden">
    <h1 style="font-size:22px;">☠️ Ран окончен</h1>
    <div id="nzover-stats" style="opacity:.9;"></div>
    <div id="nzover-text" style="max-height:44vh;overflow-y:auto;white-space:pre-wrap;text-align:left;font-size:13px;line-height:1.55;border:1px solid var(--ui-border);border-radius:6px;padding:10px;width:min(560px,94vw);"></div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;justify-content:center;">
      <button id="btn-nzover-share">📋 Скопировать летопись</button>
      <button id="btn-nzover-restart">💀 Начать новый ран</button>
    </div>
  </div>
```

- [ ] **Step 2: nzGameOver и nzWipeRun в nz.js** (заменить заглушку из Task 1)

```js
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
  saveGame();
}

// Стереть NZ-слот (локально + облако) и вернуться на титул
function nzWipeRun() {
  try { localStorage.removeItem(SAVE_KEY_NZ); } catch (e) {}
  if (typeof nzCloudWipe === 'function') nzCloudWipe();
  document.getElementById('nzover-panel').classList.add('hidden');
  document.getElementById('btn-continue-nz').classList.add('hidden');
  setSaveSlot('main');
  location.reload();   // чистый старт с титула — надёжнее ручного сброса G
}
```

- [ ] **Step 3: nzCloudWipe в tg.js** (после cloudSyncOnLaunch)

```js
// Стереть облачные чанки Nuzlocke-слота (после блэкаута)
function nzCloudWipe() {
  if (!IS_TMA || !TG.CloudStorage) return;
  cloudDownload('nz').then(() => {
    // meta знает число чанков; сносим с запасом
    csGet('nz_meta').then(raw => {
      let n = 12;
      try { n = Math.max(12, (JSON.parse(raw).n | 0) + 2); } catch (e) {}
      const keys = ['nz_meta', 'nz_meta_prev'];
      for (let i = 0; i < n; i++) keys.push('nz_' + i);
      csRemove(keys).catch(() => {});
    }).catch(() => {});
  }).catch(() => {});
}
```

- [ ] **Step 4: обработчики кнопок в initTitle (main.js)**

```js
  document.getElementById('btn-nzover-share').onclick = () => {
    const t = document.getElementById('nzover-text').textContent;
    try { navigator.clipboard.writeText(t); toast('📋 Летопись скопирована!'); }
    catch (e) { toast('Не вышло скопировать — выдели текст пальцем.'); }
  };
  document.getElementById('btn-nzover-restart').onclick = () => nzWipeRun();
```

- [ ] **Step 5: проверка и коммит**

```bash
node --check js/nz.js && node --check js/tg.js && node --check js/main.js
git add -A && git commit -m "Nuzlocke 5/11: блэкаут — экран итогов, wipe рана"
```

---

### Task 6: Левел-кап

**Files:**
- Modify: `js/data.js` (grantExp ~456)
- Modify: `js/nz.js` (nzCap, nzRecalcCap, nzAceLevel)
- Modify: `js/main.js` (onTileEnter ~1159 — регистрация города; startArenaBattle ~863 — победа; updateHUD ~421)

**Interfaces:**
- Produces: `nzCap()` → number (LEVEL_CAP вне NZ); `nzRecalcCap(justBeatenMaster?)`; `nzRegisterCity(city)`.

- [ ] **Step 1: grantExp в data.js**

```js
function grantExp(m, amount) {
  const msgs = [];
  m.exp += amount;
  // Nuzlocke: левел-кап рана (вне режима nzCap() возвращает LEVEL_CAP)
  const cap = typeof nzCap === 'function' ? nzCap() : LEVEL_CAP;
  while (m.exp >= expToNext(m.level) && m.level < cap) {
    ...тело цикла без изменений...
  }
  if (typeof NZ === 'function' && NZ() && m.level >= cap) m.exp = 0;  // сверх капа — сгорает
  return msgs;
}
```

- [ ] **Step 2: nz.js — кап и пересчёт**

```js
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
```
Замечание: центр города выровнен на середину квартала, поэтому мастер арены стоит ровно в `(city.x, city.y)` — `World.arenaMasterAt(c.x, c.y)` вернёт его (проверено по world.js: _blockRole daёт 'arena' центральному кварталу, мастер на xm==6,ym==6).

- [ ] **Step 3: интеграция в main.js**

В `onTileEnter` в блоке приветствия города (после `if (city) toast('🏙️ ...')`):
```js
    if (city) nzRegisterCity(city);
```
В `startArenaBattle` в ветке `if (result === 'win') {`:
```js
    if (NZ()) {
      G.nz.stats.leaders++;
      nzLog('leader', { name: master.name, ace: nzAceLevel(master) });
      nzRecalcCap(master);
    }
```
В `updateHUD()` рядом с индикатором области (Task 3) добавить в шаблон:
```js
    (NZ() ? ' · ⛔' + nzCap() : '') +
```

- [ ] **Step 4: проверка и коммит**

```bash
node --check js/data.js && node --check js/nz.js && node --check js/main.js
git add -A && git commit -m "Nuzlocke 6/11: левел-кап растёт победами над лидерами"
```

---

### Task 7: Отключение премиума и соцсистем, «Свой спрайт» бесплатно, предметы в бою

**Files:**
- Modify: `js/battle.js` (пункт «Предметы» ~508, updateScumBtns ~798, updateAutoBtns — рядом)
- Modify: `js/main.js` (setGrind — греп `function setGrind`; updateHUD t-grind ~416; бамп trader/nursery в step ~2065 и обработчике тайлов; touch-меню — греп `data-panel`; toggleAchievements — греп; openMonDetail bSpr ~3939; лавка «Особое» — греп `SHOP_CATS` в renderShop; renderSettings премиум-тумблеры)
- Modify: `js/net.js` (netUploadTeam ~24)
- Modify: `js/pvp.js` (pvpTgChallengeFlow/pvpChallengeFlow — гейт на входе)

**Interfaces:** Consumes `NZ()`. Produces: touch-кнопка `data-panel="nzlog"` (панель придёт в Task 8; до того клик просто ничего не открывает — допустимо в пределах одной сессии работ).

- [ ] **Step 1: бой — предметы запрещены**

battle.js, массив actions (~503): заменить `{ label: 'Предметы' },` на:
```js
          (typeof NZ === 'function' && NZ())
            ? { label: 'Предметы', small: '☠️ Nuzlocke: в бою нельзя', disabled: true }
            : { label: 'Предметы' },
```

- [ ] **Step 2: сейвскам и автобой скрыты**

`updateScumBtns`: в условие `on` добавить `&& !(typeof NZ === 'function' && NZ())`.
`updateAutoBtns` (найти рядом): так же добавить `!(typeof NZ === 'function' && NZ())` в условие показа.

- [ ] **Step 3: автокач и его кнопка**

В `setGrind(on, ...)` первой строкой: `if (on && NZ()) { toast('☠️ Nuzlocke: качаться придётся руками.'); return; }`.
В `updateHUD` в условие скрытия `grindBtn` добавить `|| NZ()` (кнопка не видна).

- [ ] **Step 4: обменник и питомник**

В `step()` в обработчике бампа `hit.kind === 'trader'`: перед `openTrade(hit.trader)`:
```js
        if (NZ()) { toast('☠️ Nuzlocke: обмены запрещены — своя ноша ближе.'); return; }
```
Питомник: найти вход (`grep -n "openNursery\|NURSERY" js/main.js`) — в обработчике взаимодействия с тайлом питомника аналогичный гейт: `if (NZ()) { toast('☠️ Nuzlocke: питомник закрыт — братва не разводится.'); return; }`.

- [ ] **Step 5: соцпанели**

- `netUploadTeam` (net.js) после первой строки: `if (typeof NZ === 'function' && NZ()) return;` — NZ-команды не идут в пул/лидерборд.
- pvp.js: в начале `pvpChallengeFlow` и `pvpTgChallengeFlow`: `if (typeof NZ === 'function' && NZ()) { toast('☠️ Nuzlocke: PvP недоступен.'); return; }`.
- Тач-меню: найти обработчик `data-panel` (греп в main.js). При входе в мир (после loadGame/newWorld — удобнее в updateHUD или отдельной функции `nzApplyMenuMode()`, зови из loadGame и newWorld):
```js
// Туч-меню в NZ: 🏆 Достижения → 📜 Летопись, 🤝 Обмен/PvP скрыт
function nzApplyMenuMode() {
  const ach = document.querySelector('#touch-menu .tbtn[data-panel="ach"], #touch-menu .tbtn[data-panel="nzlog"]');
  const friend = document.querySelector('#touch-menu .tbtn[data-panel="friend"]');
  if (!ach || !friend) return;
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
```
(положить в nz.js; в диспетчере панелей добавить кейс `nzlog` → `nzOpenLog()` — до Task 8 заглушка `function nzOpenLog() {}` в nz.js).
- Десктоп: `toggleAchievements` первой строкой `if (NZ()) { nzOpenLog(); return; }`.
- Панель друга (клавиша/вход): в `toggleFriendPanel` первой строкой `if (NZ()) { toast('☠️ Nuzlocke: обмены и PvP закрыты.'); return; }`.

- [ ] **Step 6: «Свой спрайт» бесплатно, витрины премиума скрыты**

`openMonDetail`, блок кнопки bSpr (~3939): ввести `const sprOk = sprUnlocked || NZ();` и заменить обе проверки `sprUnlocked` внутри блока на `sprOk` (текст кнопки и onclick-ветвление; в NZ покупка не предлагается).
Лавка: в рендере вкладок лавки (греп `SHOP_CATS` в main.js, функция рендера магазина) пропускать категорию премиум-витрин при NZ так же, как инвентарь пропускает `donate` (найти точное имя категории в SHOP_CATS — `donate`): `if (NZ() && cat.id === 'donate') continue;` (подстроить под реальную структуру цикла).
Настройки: в `renderSettings` скрыть премиум-тумблеры (сейвскам/самокат) при NZ — добавить `&& !NZ()` в условия их показа.

- [ ] **Step 7: проверка и коммит**

```bash
node --check js/battle.js && node --check js/main.js && node --check js/net.js && node --check js/pvp.js && node --check js/nz.js
git add -A && git commit -m "Nuzlocke 7/11: гейты премиума и соцсистем, спрайты бесплатно"
```

---

### Task 8: Летопись — тексты, панель, экспорт

**Files:**
- Modify: `js/nz.js` (nzLogText, nzFullStory — заменить заглушку, nzOpenLog/nzRenderLog — заменить заглушку, nzShare)
- Modify: `index.html` (панель #nzlog-panel)
- Modify: `js/main.js` (закрытие панели по Esc — блок обработки Esc ~4200; события эволюции)

**Interfaces:**
- Produces: `nzFullStory()` → string (весь фанфик); `nzOpenLog()`; события `evo` пишутся из церемонии роста.
- Consumes: события `start/meet/name/death/leader/blackout` уже пишутся задачами 1-6.

- [ ] **Step 1: панель в index.html** (после #nzover-panel)

```html
  <!-- Nuzlocke: летопись рана -->
  <div id="nzlog-panel" class="overlay hidden">
    <h1 style="font-size:22px;">📜 Летопись Братвы</h1>
    <button id="btn-nzlog-close" class="close-top">Закрыть (Esc)</button>
    <div id="nzlog-text" style="max-height:56vh;overflow-y:auto;white-space:pre-wrap;text-align:left;font-size:13px;line-height:1.55;border:1px solid var(--ui-border);border-radius:6px;padding:10px;width:min(560px,94vw);"></div>
    <button id="btn-nzlog-share">📋 Скопировать фанфик</button>
  </div>
```

- [ ] **Step 2: тексты в nz.js** (заменить заглушки nzFullStory/nzOpenLog)

```js
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
```

- [ ] **Step 3: событие эволюции**

main.js, `openGrowthEvolve`, внутри onclick кнопки «✨ Эволюционировать» после `G.stats.evolutions++;`:
```js
    if (NZ()) nzLog('evo', { nick: monName(m), sp: m.speciesSeed, st: m.stage });
```

- [ ] **Step 4: провода закрытия**

initTitle:
```js
  document.getElementById('btn-nzlog-close').onclick = () => nzCloseLog();
  document.getElementById('btn-nzlog-share').onclick = () => {
    try { navigator.clipboard.writeText(nzFullStory()); toast('📋 Фанфик скопирован — неси в чат!'); }
    catch (e) { toast('Не вышло скопировать.'); }
  };
```
В Esc-диспетчере (~4200) добавить: `if (G.state === 'nzlog') { nzCloseLog(); return; }`.
Убедиться, что кейс `nzlog` в диспетчере тач-панелей (Task 7) зовёт `nzOpenLog()`.

- [ ] **Step 5: проверка и коммит**

```bash
node --check js/nz.js && node --check js/main.js
git add -A && git commit -m "Nuzlocke 8/11: летопись — тексты, панель, экспорт"
```

---

### Task 9: Главы в чат бота (/nzlog)

**Files:**
- Modify: `backend/worker.js` (новый эндпоинт — вставить рядом с /team, ~229)
- Modify: `js/net.js` (netNzChapter)
- Modify: `js/nz.js` (nzPostcard, nzChapter + вызовы)
- Modify: `js/main.js` (renderSettings — тумблер)

**Interfaces:**
- Produces: `nzChapter(title)` — best-effort отправка главы со скрином-открыткой; воркер POST `/nzlog {initData, text, photo?}` → `{ok:true}`.
- Майлстоны: первая поимка (nzAfterWild), смерть (nzBury), лидер (startArenaBattle win), блэкаут (nzGameOver).

- [ ] **Step 1: воркер**

В `backend/worker.js` после блока `/leaderboard` вставить:
```js
    // --- Nuzlocke: глава летописи в чат игрока (только TMA; KV не трогаем) ---
    if (url.pathname === '/nzlog' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const user = await verifyInitData(env, body.initData);
      if (!user || !user.id) return json({ err: 'tma only' }, 403);
      const text = String(body.text || '').slice(0, 1000);
      const photo = typeof body.photo === 'string' ? body.photo : '';
      try {
        if (photo.startsWith('data:image/jpeg;base64,') && photo.length < 300000) {
          const bin = Uint8Array.from(atob(photo.slice(photo.indexOf(',') + 1)), ch => ch.charCodeAt(0));
          const fd = new FormData();
          fd.append('chat_id', String(user.id));
          fd.append('caption', text);
          fd.append('photo', new Blob([bin], { type: 'image/jpeg' }), 'chapter.jpg');
          await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/sendPhoto', { method: 'POST', body: fd });
        } else if (text) {
          await tgApi(env, 'sendMessage', { chat_id: user.id, text });
        }
      } catch (e) {}
      return json({ ok: true });
    }
```

- [ ] **Step 2: net.js**

```js
// Nuzlocke: глава летописи со скрином в чат бота (best-effort, только TMA)
function netNzChapter(text, photoDataUrl) {
  if (!API_BASE || !tgInitData()) return;
  fetch(API_BASE + '/nzlog', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ initData: tgInitData(), text: String(text).slice(0, 900), photo: photoDataUrl || null }),
  }).catch(() => {});
}
```

- [ ] **Step 3: открытка и отправка в nz.js**

```js
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
```
Вызовы добавить:
- в `nzAfterWild` после инкремента catches: `if (G.nz.stats.catches === 1) nzChapter('Первая поимка рана');`
- в `nzBury` последней строкой: `nzChapter('Потеря: ' + monName(m));`
- в `startArenaBattle` (main.js) в NZ-ветке победы: `nzChapter('Лидер повержен: ' + master.name);`
- в `nzGameOver` перед saveGame: `nzChapter('Полный блэкаут — ран окончен');` (обойдёт троттлинг смерти? да, 30с могли не пройти после последней смерти — для blackout сбросить: `_nzChapterTs = 0;` строкой выше вызова).

- [ ] **Step 4: тумблер в настройках**

В `renderSettings` (main.js) добавить кнопку-тумблер (видна только `NZ() && IS_TMA`): «📖 Главы в чат: вкл/выкл», переключает `localStorage('mw-nz-chapters')` между `'1'`/`'0'` (дефолт вкл = отсутствие ключа или `'1'`). Оформить в стиле соседних тумблеров renderSettings.

- [ ] **Step 5: проверка и коммит**

```bash
node --check backend/worker.js && node --check js/net.js && node --check js/nz.js && node --check js/main.js
git add -A && git commit -m "Nuzlocke 9/11: главы летописи в чат бота (/nzlog)"
```
Воркер НЕ деплоить сейчас — задеплоит Task 11 (раньше фронта).

---

### Task 10: Области на карте

**Files:**
- Modify: `js/main.js` (drawMiniMap — греп `function drawMiniMap`; блок подписей городов ~2600)

**Interfaces:** Consumes `nzZoneAt`, `G.nz.zones`.

- [ ] **Step 1: границы областей**

В `drawMiniMap` после отрисовки тайлов (найти конец тайлового цикла, до подписей городов) добавить:
```js
  // Nuzlocke: границы областей (Вороной живых городов) — тёмный пунктир
  if (typeof NZ === 'function' && NZ()) {
    c.fillStyle = 'rgba(0,0,0,0.45)';
    const stepz = 2;   // каждые 2 тайла — дёшево и глазу достаточно
    for (let ty = 0; ty < th; ty += stepz) {
      for (let tx = 0; tx < tw; tx += stepz) {
        const wx = x0 + tx, wy = y0 + ty;
        const z = nzZoneAt(wx, wy).id;
        if (nzZoneAt(wx + stepz, wy).id !== z || nzZoneAt(wx, wy + stepz).id !== z) {
          c.fillRect(tx * MAP_PX, ty * MAP_PX, MAP_PX, MAP_PX);
        }
      }
    }
  }
```
Точные имена локалей (`x0, y0, tw, th, MAP_PX, c`) сверить с телом drawMiniMap и подставить реальные.

- [ ] **Step 2: значок статуса у имени города**

В блоке подписей городов (~2600-2610) изменить текст лейбла:
```js
      const label = info.name + (typeof NZ === 'function' && NZ()
        ? (G.nz.zones[info.id] ? ' ✔' : ' 🎯') : '');
```
и использовать `label` вместо `info.name` в measureText/fillText.

- [ ] **Step 3: проверка и коммит**

```bash
node --check js/main.js
git add -A && git commit -m "Nuzlocke 10/11: области и статус поимки на карте"
```

---

### Task 11: Релиз — SW, тесты, деплой, документация

**Files:**
- Modify: `sw.js` (CACHE v53 → v54)
- Modify: `CLAUDE.md` (раздел про Nuzlocke в «Ключевые механики»)
- Deploy: воркер, затем фронт

- [ ] **Step 1: бамп SW**

`sw.js`: `const CACHE = 'monsterworld-v54';`

- [ ] **Step 2: синтакс-чек всего**

```bash
node --check js/nz.js && node --check js/main.js && node --check js/battle.js && node --check js/data.js && node --check js/tg.js && node --check js/net.js && node --check js/pvp.js && node --check backend/worker.js
```

- [ ] **Step 3: Playwright-прогон** (сервер `python -m http.server 8765` в фоне; перед проверкой снять SW-регистрации и caches, отключить HTTP-кэш через CDP — см. CLAUDE.md «Тестирование»)

Сценарии (каждый — отдельная проверка, ожидание указано):
1. Титул: чекбокс «☠️ Режим Nuzlocke» виден; включение раскрывает правила.
2. Новая игра с чекбоксом → выбор стартера → prompt клички (замокать `window.prompt = () => 'Кент'`) → в мире HUD содержит «⛔15» и «📍».
3. `localStorage`: сейв лежит в `monsterworld-save-nz1`, поле `nuzlocke:true`; ключ `monsterworld-save-v1` не тронут.
4. Перезагрузка страницы → на титуле обе кнопки («Продолжить» скрыта, если основного сейва нет; «☠️ Продолжить Nuzlocke» видна) → продолжение загружает NZ-мир.
5. Дикий бой в свежей области: кнопка «Поймать» активна; после боя (любой исход, проще убить) повторная встреча в той же области показывает «Поймать» с «☠️ встреча области уже была» (disabled). Бой скриптовать через консоль: `startWildBattle(Math.floor(G.player.x), Math.floor(G.player.y))` + клики по меню.
6. Смерть: через консоль убить бойца (`G.party[0].hp = 0; afterBattle('win')`) → братишка исчез из party, `G.nz.graveyard.length === 1`; в Кармане вкладка «⚰️ Кладбище (1)» с грейскейл-строкой.
7. Блэкаут: `G.party.forEach(m=>m.hp=0); G.storage=[]; afterBattle('lose')` → панель «☠️ Ран окончен» с текстом летописи.
8. В бою пункт «Предметы» disabled с подписью «☠️ Nuzlocke: в бою нельзя».
9. Основной режим не сломан: обычная новая игра без чекбокса — HUD без «⛔», Предметы в бою активны, вкладок в Кармане нет.
10. `/nzlog` воркера: локально не проверяем (нужен BOT_TOKEN) — проверить после деплоя curl-ом: `curl -X POST https://monsterworld-api.photoelf.workers.dev/nzlog -d '{"initData":"x","text":"t"}'` → ожидание `{"err":"tma only"}`.

- [ ] **Step 4: CLAUDE.md**

Добавить в «Ключевые механики» сжатый раздел «Nuzlocke-режим» (слоты сейва и облачные префиксы sv_/nz_, nz.js, правила, /nzlog, что отключено) и упомянуть v54.

- [ ] **Step 5: деплой (порядок строгий!)**

```bash
cd backend && env -u CLOUDFLARE_API_TOKEN npx wrangler deploy && cd ..
# подождать ~30с, проверить /nzlog (ожидание {"err":"tma only"})
git add -A && git commit -m "Nuzlocke 11/11: SW v54, тесты, документация"
git push origin main
# через ~60с: curl -s https://photoelf.github.io/monsterworld/sw.js | grep v54
```

---

## Self-Review (выполнен при написании)

- Покрытие спеки: слоты ✔ (T1), правила движения/спавна ✔ (T2), области+dupes+shiny+клички ✔ (T3), пермасмерть+кладбище ✔ (T4), блэкаут ✔ (T5), кап ✔ (T6), отключения+spr бесплатно+предметы+Set(уже есть) ✔ (T7), летопись ✔ (T8), бот-главы ✔ (T9), карта ✔ (T10), SW/деплой/тесты ✔ (T11).
- Типы согласованы: `NZ()`, `G.nz.*`, `nzCatch` в opts Battle.run, `nzZoneAt().id/name` — единые имена во всех задачах.
- Известные упрощения (осознанные): при lose уцелевших в NZ не бывает только у активной братвы — добор из кармана автоматический; этаж башни в эпитафии не указывается (просто «башня испытаний»).
