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

// Временная заглушка — заменится в Task 5 (экран итогов рана).
function nzGameOver() { toast('Ран окончен.'); }
