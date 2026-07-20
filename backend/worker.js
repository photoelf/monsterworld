'use strict';

// ===== Monsterworld API: снапшоты команд игроков + Stars-платежи =====
// Cloudflare Worker. Горячий игровой поток (команды/лидерборд/PvP) — D1 (binding DB,
// см. backend/schema.sql); покупки и редкие ключи — KV (binding SNAPS). D1 даёт
// 100k записей/сутки против 1000 у KV: игровой поток (запись после каждого боя)
// упирался в дневной лимит KV. Секреты: BOT_TOKEN, WEBHOOK_SECRET.
// POST /team          {id, nick, team:[monDump...]} — залить свою команду
// GET  /team/random?not=<id>                        — случайная чужая команда
// POST /invoice       {id}                          — ссылка-счёт Telegram Stars
// POST /bot                                          — webhook Telegram-бота
// GET  /unlock?id=<id>                              — куплена ли загрузка спрайтов
// GET  /health                                      — проверка живости
//
// Снапшоты валидируются и здесь, и на клиенте (tradeMonRevive пересчитывает
// статы из вида — «нарисовать» имбу нельзя). Ник — только буквы/цифры/._- .
//
// Безопасность: read-эндпоинты (/unlock, /accs, /mongen) под rateLimited;
// verifyInitData проверяет подпись HMAC + срок auth_date (24ч). VIP/анлоки
// завязаны на подписанный tg-id; для TMA покупки пока по clientId (см. планы).

const SPRITE_PRICE_STARS = 10;   // цена разблокировки кастомных спрайтов, XTR
const WARDROBE_PRICE_STARS = 15; // цена гардероба игрока, XTR
const MONGEN_PRICE_STARS = 25;   // цена одной генерации заказного братишки, XTR
const SCOOT_PRICE_STARS = 50;    // цена премиум-маунта «Электросамокат», XTR
const SCUM_PRICE_STARS = 10;     // цена режима сейвскамера, XTR
const AUTO_PRICE_STARS = 50;     // цена автобоя, XTR
const GRIND_PRICE_STARS = 100;   // цена автокача (бандл: требует купленный автобой), XTR

// Товары: once — одноразовая разблокировка (KV-флаг), иначе счётчик кредитов
const PRODUCTS = {
  spr: { once: true,  price: SPRITE_PRICE_STARS,   key: id => 'unlock:' + id,
         title: 'Свои спрайты братвы',
         desc: 'Загружай собственные PNG-облики для своих братишек. Навсегда.',
         thanks: '⭐ Спасибо за поддержку Карманной Братвы! Загрузка своих спрайтов открыта — вернись в игру и обнови её.' },
  // wrd оставлен для гранфазеринга старых покупок (15⭐ за всё): новые счета не выписываем
  wrd: { once: true,  price: WARDROBE_PRICE_STARS, key: id => 'wrd:' + id,
         title: 'Гардероб игрока',
         desc: 'Перекраски + аксессуары. Навсегда.',
         thanks: '⭐ Спасибо! Гардероб открыт — вернись в игру и приоденься.' },
  mon: { once: false, price: MONGEN_PRICE_STARS,   key: id => 'mon:' + id,
         title: 'Заказной братишка',
         desc: 'Уникальный братишка: твой тип, окрас и имя. Одна генерация.',
         thanks: '⭐ Спасибо! Генерация оплачена — вернись в игру и собери своего братишку.' },
  scoot: { once: true, price: SCOOT_PRICE_STARS,   key: id => 'scoot:' + id,
         title: 'Электросамокат',
         desc: 'Премиум-маунт: гоняй по суше быстрее всех. Навсегда.',
         thanks: '⭐ Спасибо! Электросамокат в гараже — вернись в игру и прокатись.' },
  scum: { once: true, price: SCUM_PRICE_STARS,     key: id => 'scum:' + id,
         title: 'Режим сейвскамера',
         desc: 'Сохраняйся и откатывайся прямо в бою — переигрывай любой удар. Навсегда.',
         thanks: '⭐ Спасибо! Режим сейвскамера открыт — включи его в настройках.' },
  auto: { once: true, price: AUTO_PRICE_STARS,     key: id => 'auto:' + id,
         title: 'Автобой',
         desc: 'Тренер сам ведёт бой: умные атаки, подмены и ускорение ×2/×3. Навсегда.',
         thanks: '⭐ Спасибо! Автобой открыт — кнопки Авто и скорости появятся в бою.' },
  grind: { once: true, price: GRIND_PRICE_STARS,   key: id => 'grind:' + id,
         title: 'Автокач',
         desc: 'Тренер сам бегает по дикой зоне и качает братву в автобоях. Навсегда.',
         thanks: '⭐ Спасибо! Автокач открыт — кнопка появится в дикой зоне.' },
};

const SNAP_TTL = 60 * 86400;    // неактивные команды выпадают из выборки через 60 дней
const PVP_TTL = 3 * 86400;      // PvP-вызов живёт 3 дня
const LB_CAP = 50;              // сколько строк лидерборда отдаём

// ts в строках D1 — миллисекунды (Date.now()); TTL-константы в секундах → ×1000.
// msAgo(SNAP_TTL) = порог «моложе которого команда ещё в выборке».
const msAgo = secs => Date.now() - secs * 1000;

// Сила братвы из уже валидированной команды
// (level ≤ 100, stage ≤ 2, шайни +5, мега +15 → потолок 6×140 = 840)
function teamPower(team) {
  return team.reduce((s, m) => s + m.level + m.stage * 10 + (m.shiny ? 5 : 0) + (m.mega ? 15 : 0), 0);
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  });

const TYPES = ['normal', 'fire', 'water', 'grass', 'electric', 'ice', 'psychic', 'shadow'];
const PALETTES = ['ruby', 'ocean', 'forest', 'gold', 'violet', 'ice', 'shadow', 'rose'];

// Аксессуары гардероба: поштучно, 1–5 Stars (цены синхронно с ACC_PRICES в net.js)
const ACC_PRICES = {
  cap: 1, fightband: 1, pirate: 1,
  glasses: 2, anaglyph: 2, merc: 2, invader: 2,
  plumber: 3, elfcap: 3, hedgehog: 3, champcap: 3, redvisor: 3, frogcap: 3,
  ghostpal: 4, shroom: 4, robohelm: 4,
  crown: 5, spartan: 5,
  // костюмы и принты на футболку
  kimono: 2, tracksuit: 3, balahon: 3, labcoat: 4, vault: 4, tux: 5, armor: 5,
  printheart: 1, printinvader: 2,
};
const ACC_NAMES = {
  cap: 'Кепка', fightband: 'Повязка бойца', pirate: 'Бандана пирата',
  glasses: 'Очки', anaglyph: '3D-очки', merc: 'Бандана наёмника', invader: 'Антенны пришельца',
  plumber: 'Кепка сантехника', elfcap: 'Колпак героя в зелёном', hedgehog: 'Иглы синего ежа',
  champcap: 'Кепка юного чемпиона', redvisor: 'Красный визор', frogcap: 'Лягушачий капюшон',
  ghostpal: 'Призрачный кореш', shroom: 'Грибная шляпа',
  robohelm: 'Шлем робобойца', crown: 'Корона',
  spartan: 'Шлем спартанца',
  kimono: 'Кимоно бойца', tracksuit: 'Спортивка братана', balahon: 'Чёрный балахон', labcoat: 'Халат профессора',
  vault: 'Комбез убежища', tux: 'Смокинг агента', armor: 'Силовая броня',
  printheart: 'Принт «сердце»', printinvader: 'Принт «пришелец»',
};

function sanitizeNick(nick) {
  const s = String(nick || '').replace(/[^\p{L}\p{N} ._-]/gu, '').trim().slice(0, 20);
  return s || 'Тренер';
}

// Валидация одного монстрика в формате tradeMonDump
function validMon(m) {
  if (!m || typeof m !== 'object') return null;
  const out = {
    speciesSeed: (m.speciesSeed >>> 0),
    stage: Math.min(2, Math.max(0, m.stage | 0)),
    level: Math.min(100, Math.max(1, m.level | 0)),
    exp: Math.max(0, m.exp | 0),
    shiny: !!m.shiny,
    // мега-форма: клиент довалидирует по стадии/уровню (tradeMonRevive),
    // здесь достаточно ограничить тип — на силу влияет фиксированные +15
    mega: !!m.mega && (m.level | 0) >= 75,
    nick: m.nick ? String(m.nick).replace(/[^\p{L}\p{N} ._-]/gu, '').slice(0, 12) || null : null,
    palette: PALETTES.includes(m.palette) ? m.palette : null,
    moves: [],
  };
  if (!Array.isArray(m.moves) || !m.moves.length) return null;
  out.moves = m.moves.slice(0, 4).map(mv => ({
    name: String((mv && mv.name) || 'Удар').replace(/[<>&"']/g, '').slice(0, 40),
    type: TYPES.includes(mv && mv.type) ? mv.type : 'normal',
    power: Math.min(115, Math.max(20, (mv && mv.power) | 0)),
    acc: Math.min(100, Math.max(60, (mv && mv.acc) | 0)),
    maxPp: Math.min(20, Math.max(4, (mv && mv.maxPp) | 0 || 10)),
  }));
  return out;
}

// HMAC-SHA256 → байты
async function hmac(keyBytes, msgBytes) {
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, msgBytes));
}

// Проверка подписи Telegram initData; возвращает объект user или null
async function verifyInitData(env, initData) {
  try {
    if (!initData || initData.length > 4096) return null;
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const dcs = [...p.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([k, v]) => k + '=' + v).join('\n');
    const enc = new TextEncoder();
    const secret = await hmac(enc.encode('WebAppData'), enc.encode(env.BOT_TOKEN));
    const sig = await hmac(secret, enc.encode(dcs));
    const hex = [...sig].map(b => b.toString(16).padStart(2, '0')).join('');
    if (hex !== hash) return null;
    // подпись валидна — теперь ограничим срок жизни (перехваченный initData не
    // должен работать вечно). auth_date подписан, так что проверяем после hash.
    const authDate = parseInt(p.get('auth_date') || '0', 10);
    if (!authDate || Date.now() / 1000 - authDate > 86400) return null; // старше 24 ч
    return JSON.parse(p.get('user') || 'null');
  } catch (e) { return null; }
}

async function tgApi(env, method, params) {
  const r = await fetch('https://api.telegram.org/bot' + env.BOT_TOKEN + '/' + method, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  return r.json();
}

function cleanId(raw) {
  return String(raw || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
}

// Ключ покупателя. Для TMA — подписанный tg-id ('tg'+id): покупка привязана к
// аккаунту Telegram, а не к устройству/clientId и не к сейву (сейв tg-id не
// содержит — передача сейва чужому НЕ разблокирует платное). Для браузера без
// initData — фоллбэк на clientId. vip: состоит ли покупатель в VIP-списке.
async function buyerKey(env, body) {
  if (body && body.initData) {
    const user = await verifyInitData(env, body.initData);
    if (user && user.id) {
      const vip = !!(await env.SNAPS.get('vip:' + user.id));
      return { key: 'tg' + user.id, tg: user.id, vip };
    }
  }
  return { key: cleanId(body && body.id), tg: null, vip: false };
}
// clientId (браузер) должен быть достаточно длинным; tg-ключ валиден всегда
function badBuyer(b) { return b.tg === null && b.key.length < 8; }

// Рейт-лимит в памяти изолята. Раньше счётчики жили в KV и каждая проверка
// стоила чтение+ЗАПИСЬ — ~700 из 800 записей/день, упирались в лимит 1000.
// Изоляты не разделяют память между PoP и могут пересоздаваться, так что
// лимит «мягкий» (распределённый абьюз пробьёт больше 30 req/min), но от
// спама и кривых клиентских циклов защищает, а KV не трогает вовсе.
const RL = new Map(); // ip → { min, n }
function rateLimited(env, ip) {
  const min = Math.floor(Date.now() / 60000);
  const e = RL.get(ip);
  if (!e || e.min !== min) {
    if (RL.size > 5000) RL.clear();
    RL.set(ip, { min, n: 1 });
    return false;
  }
  return ++e.n > 30;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (url.pathname === '/health') return json({ ok: true });

    const ip = req.headers.get('CF-Connecting-IP') || '0';

    // --- залить снапшот команды ---
    if (url.pathname === '/team' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = String(body.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
      if (id.length < 8) return json({ err: 'bad id' }, 400);
      if (!Array.isArray(body.team)) return json({ err: 'bad team' }, 400);
      const team = body.team.slice(0, 6).map(validMon).filter(Boolean);
      if (!team.length) return json({ err: 'empty team' }, 400);
      const nick = sanitizeNick(body.nick);
      const now = Date.now();
      // один INSERT OR REPLACE — индекс пула (был массив idx в KV) больше не нужен:
      // случайного соперника даёт ORDER BY RANDOM() в /team/random.
      await env.DB.prepare('INSERT OR REPLACE INTO teams(id,nick,team,ts) VALUES(?,?,?,?)')
        .bind(id, nick, JSON.stringify(team), now).run();

      // лидерборд гейтится подписанным tg-id: открытый /team накручивается
      // curl-ом, поэтому анонимные снапшоты кормят только пул соперников.
      // Строка = последний залитый снапшот этого tg-id (дедуп по PRIMARY KEY tg).
      const user = body.initData ? await verifyInitData(env, body.initData) : null;
      if (user && user.id) {
        const power = teamPower(team);
        const badges = Math.min(99, Math.max(0, body.badges | 0));
        const dex = Math.min(999, Math.max(0, body.dex | 0));
        // не переписываем строку, если ничего не изменилось (ts не в счёт)
        const prev = await env.DB.prepare('SELECT nick,power,badges,dex FROM leaderboard WHERE tg=?')
          .bind(user.id).first();
        const same = prev && prev.nick === nick && prev.power === power
          && prev.badges === badges && prev.dex === dex;
        if (!same) {
          await env.DB.prepare('INSERT OR REPLACE INTO leaderboard(tg,nick,power,badges,dex,ts) VALUES(?,?,?,?,?,?)')
            .bind(user.id, nick, power, badges, dex, now).run();
        }
      }

      // ленивая чистка старья вместо TTL (у D1 его нет) — изредка, дёшево
      if (Math.random() < 0.02) {
        await env.DB.prepare('DELETE FROM teams WHERE ts < ?').bind(msAgo(SNAP_TTL)).run();
      }
      return json({ ok: true });
    }

    // --- лидерборд: топ по силе братвы (tg-id наружу не отдаём) ---
    if (url.pathname === '/leaderboard' && req.method === 'GET') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      const rows = await env.DB.prepare(
        'SELECT nick,power,badges,dex FROM leaderboard ORDER BY power DESC LIMIT ?'
      ).bind(LB_CAP).all();
      const top = (rows.results || []).map(e => ({ nick: e.nick, power: e.power | 0, badges: e.badges | 0, dex: e.dex | 0 }));
      return json({ top });
    }

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

    // --- случайная чужая команда ---
    if (url.pathname === '/team/random' && req.method === 'GET') {
      const not = String(url.searchParams.get('not') || '');
      // ts-фильтр заменяет TTL: старше 60 дней в выборку не попадает
      const row = await env.DB.prepare(
        'SELECT nick,team FROM teams WHERE id != ? AND ts > ? ORDER BY RANDOM() LIMIT 1'
      ).bind(not, msAgo(SNAP_TTL)).first();
      if (!row) return json({ snap: null });
      return json({ snap: { nick: row.nick, team: JSON.parse(row.team) } });
    }

    // --- PvP через Telegram: создать вызов ---
    // A шлёт свою команду; вызов живёт в KV, делится deep-link'ом в TG.
    if (url.pathname === '/pvp/create' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ err: 'bad id' }, 400);
      const team = Array.isArray(body.team) ? body.team.slice(0, 6).map(validMon).filter(Boolean) : [];
      if (!team.length) return json({ err: 'empty team' }, 400);
      const id = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
      const ch = {
        fromKey: b.key, fromTg: b.tg, fromNick: sanitizeNick(body.nick),
        teamA: team, nonceA: String(body.nonce || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || '0',
        status: 'open', ts: Date.now(),
      };
      await env.DB.prepare('INSERT OR REPLACE INTO pvp(id,data,ts) VALUES(?,?,?)')
        .bind(id, JSON.stringify(ch), ch.ts).run();
      if (Math.random() < 0.02) {
        await env.DB.prepare('DELETE FROM pvp WHERE ts < ?').bind(msAgo(PVP_TTL)).run();
      }
      return json({ id });
    }

    // --- PvP: прочитать вызов (для показа/боя); mySide вычисляется по initData ---
    // ch — id вызова, id — clientId покупателя (для buyerKey), не путать
    if (url.pathname === '/pvp/get' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.ch);
      // ts-фильтр заменяет TTL: вызов старше 3 дней считается несуществующим
      const row = await env.DB.prepare('SELECT data FROM pvp WHERE id=? AND ts > ?')
        .bind(id, msAgo(PVP_TTL)).first();
      if (!row) return json({ err: 'not found' }, 404);
      const ch = JSON.parse(row.data);
      const b = await buyerKey(env, body);
      let mySide = null;
      if (b.key && b.key === ch.fromKey) mySide = 'A';
      else if (b.key && ch.toKey && b.key === ch.toKey) mySide = 'B';
      return json({
        status: ch.status, mySide,
        fromNick: ch.fromNick, toNick: ch.toNick || null,
        teamA: ch.teamA, nonceA: ch.nonceA,
        teamB: ch.teamB || null, nonceB: ch.nonceB || null,
        result: ch.result || null,
      });
    }

    // --- PvP: принять вызов (B шлёт свою команду и вычисленный вердикт) ---
    // ch — id вызова, id — clientId покупателя (для buyerKey)
    if (url.pathname === '/pvp/accept' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.ch);
      const row = await env.DB.prepare('SELECT data FROM pvp WHERE id=? AND ts > ?')
        .bind(id, msAgo(PVP_TTL)).first();
      if (!row) return json({ err: 'not found' }, 404);
      const ch = JSON.parse(row.data);
      if (ch.status !== 'open') return json({ err: 'taken' }, 409);
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ err: 'bad id' }, 400);
      if (b.key === ch.fromKey) return json({ err: 'own challenge' }, 400);
      const team = Array.isArray(body.team) ? body.team.slice(0, 6).map(validMon).filter(Boolean) : [];
      if (!team.length) return json({ err: 'empty team' }, 400);
      ch.toKey = b.key; ch.toTg = b.tg; ch.toNick = sanitizeNick(body.nick);
      ch.teamB = team; ch.nonceB = String(body.nonce || '').replace(/[^a-z0-9]/gi, '').slice(0, 16) || '0';
      ch.result = (body.result === 'A' || body.result === 'B' || body.result === 'draw') ? body.result : 'draw';
      ch.status = 'done';
      await env.DB.prepare('UPDATE pvp SET data=? WHERE id=?').bind(JSON.stringify(ch), id).run();
      // пуш отправителю (best-effort): бот пишет только тем, кто с ним в диалоге
      if (ch.fromTg) {
        const gameUrl = 'https://t.me/poketmons_bot?startapp=pvp' + id;
        await tgApi(env, 'sendMessage', {
          chat_id: ch.fromTg,
          text: '⚔️ ' + ch.toNick + ' принял твой вызов в Карманной Братве! Открой игру — смотри бой.',
          reply_markup: { inline_keyboard: [[{ text: '👊 Смотреть бой', url: gameUrl }]] },
        }).catch(() => {});
      }
      return json({ ok: true });
    }

    // --- счёт на покупку (Telegram Stars); product: spr|mon|scoot|acc (+item) ---
    // VIP получает товар бесплатно, но ТОЛЬКО по явному нажатию (granted:true) —
    // авто-выдачи при проверке статуса больше нет.
    if (url.pathname === '/invoice' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ err: 'bad id' }, 400);

      // аксессуар гардероба — поштучный товар со своей ценой
      if (body.product === 'acc') {
        const item = String(body.item || '');
        if (!ACC_PRICES[item]) return json({ err: 'bad item' }, 400);
        let owned = [];
        try { owned = JSON.parse(await env.SNAPS.get('accs:' + b.key) || '[]'); } catch (e) {}
        if (owned.includes(item)) return json({ err: 'already unlocked' }, 409);
        if (b.vip) {
          owned.push(item);
          await env.SNAPS.put('accs:' + b.key, JSON.stringify(owned));
          return json({ granted: true, vip: true });
        }
        const r = await tgApi(env, 'createInvoiceLink', {
          title: 'Аксессуар: ' + ACC_NAMES[item],
          description: 'Аксессуар гардероба «' + ACC_NAMES[item] + '». Навсегда.',
          payload: 'acc:' + item + ':' + b.key,
          currency: 'XTR',
          prices: [{ label: ACC_NAMES[item], amount: ACC_PRICES[item] }],
        });
        if (!r.ok) return json({ err: 'tg error' }, 502);
        return json({ link: r.result, price: ACC_PRICES[item] });
      }

      const prod = PRODUCTS[body.product] ? body.product : 'spr';
      const p = PRODUCTS[prod];
      if (p.once && await env.SNAPS.get(p.key(b.key))) return json({ err: 'already unlocked' }, 409);
      // автокач — бандл поверх автобоя: без купленного автобоя не продаём (и VIP тоже)
      if (prod === 'grind' && !(await env.SNAPS.get('auto:' + b.key))) return json({ err: 'need auto' }, 409);
      if (b.vip) {
        if (p.once) await env.SNAPS.put(p.key(b.key), 'vip');
        else { const c = parseInt(await env.SNAPS.get(p.key(b.key)), 10) || 0; await env.SNAPS.put(p.key(b.key), String(c + 1)); }
        return json({ granted: true, vip: true });
      }
      const r = await tgApi(env, 'createInvoiceLink', {
        title: p.title,
        description: p.desc,
        payload: prod + ':' + b.key,
        currency: 'XTR',
        prices: [{ label: p.once ? 'Разблокировка' : 'Генерация', amount: p.price }],
      });
      if (!r.ok) return json({ err: 'tg error' }, 502);
      return json({ link: r.result, price: p.price });
    }

    // --- статус покупки (GET — совместимость со старыми клиентами) ---
    if (url.pathname === '/unlock' && req.method === 'GET') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      const id = cleanId(url.searchParams.get('id'));
      if (id.length < 8) return json({ unlocked: false });
      return json({ unlocked: !!(await env.SNAPS.get('unlock:' + id)) });
    }

    // --- статус покупки по ключу покупателя (tg-id/clientId); без авто-VIP ---
    if (url.pathname === '/unlock' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ unlocked: false });
      const prod = PRODUCTS[body.product] && body.product !== 'mon' ? body.product : 'spr';
      return json({ unlocked: !!(await env.SNAPS.get(PRODUCTS[prod].key(b.key))) });
    }

    // --- объединённый статус всех разовых покупок за один запрос (экономит KV) ---
    if (url.pathname === '/status' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({});
      const [spr, scoot, scum, auto, grind] = await Promise.all([
        env.SNAPS.get('unlock:' + b.key),
        env.SNAPS.get('scoot:' + b.key),
        env.SNAPS.get('scum:' + b.key),
        env.SNAPS.get('auto:' + b.key),
        env.SNAPS.get('grind:' + b.key),
      ]);
      return json({ spr: !!spr, scoot: !!scoot, scum: !!scum, auto: !!auto, grind: !!grind, vip: b.vip });
    }

    // --- гардероб: какие аксессуары реально куплены (по ключу покупателя) ---
    if (url.pathname === '/accs' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ owned: [] });
      const all = Object.keys(ACC_PRICES);
      let owned = [];
      try { owned = JSON.parse(await env.SNAPS.get('accs:' + b.key) || '[]'); } catch (e) {}
      return json({ owned: owned.filter(a => all.includes(a)) });
    }

    // --- генератор: сколько оплаченных генераций; vip — флаг «бесплатно» для UI ---
    if (url.pathname === '/mongen' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ credits: 0 });
      const credits = parseInt(await env.SNAPS.get('mon:' + b.key), 10) || 0;
      return json({ credits, vip: b.vip });
    }

    // --- генератор: списать одну генерацию (VIP — без ограничений) ---
    if (url.pathname === '/mongen/claim' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      if (badBuyer(b)) return json({ ok: false });
      if (b.vip) return json({ ok: true, vip: true });
      const credits = parseInt(await env.SNAPS.get('mon:' + b.key), 10) || 0;
      if (credits < 1) return json({ ok: false });
      await env.SNAPS.put('mon:' + b.key, String(credits - 1));
      return json({ ok: true, left: credits - 1 });
    }

    // --- промокод ---
    if (url.pathname === '/redeem' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const b = await buyerKey(env, body);
      const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
      if (badBuyer(b) || code.length < 4) return json({ ok: false });
      const raw = await env.SNAPS.get('promo:' + code);
      if (!raw) return json({ ok: false });
      let promo;
      try { promo = JSON.parse(raw); } catch (e) { return json({ ok: false }); }
      if (!promo || !(promo.uses > 0)) return json({ ok: false });
      promo.uses--;
      await env.SNAPS.put('promo:' + code, JSON.stringify(promo));
      await env.SNAPS.put('unlock:' + b.key, 'promo:' + code);
      return json({ ok: true, left: promo.uses });
    }

    // --- webhook Telegram-бота ---
    if (url.pathname === '/bot' && req.method === 'POST') {
      if (req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.WEBHOOK_SECRET) {
        return new Response('forbidden', { status: 403 });
      }
      let upd;
      try { upd = await req.json(); } catch (e) { return new Response('ok'); }

      if (upd.pre_checkout_query) {
        await tgApi(env, 'answerPreCheckoutQuery', {
          pre_checkout_query_id: upd.pre_checkout_query.id,
          ok: true,
        });
        return new Response('ok');
      }

      const msg = upd.message;
      if (msg && msg.successful_payment) {
        const payload = String(msg.successful_payment.invoice_payload || '');
        let thanks = '⭐ Спасибо за поддержку Карманной Братвы!';
        const acc = payload.match(/^acc:([a-z]+):(.+)$/);
        if (acc && ACC_PRICES[acc[1]]) {
          const id = cleanId(acc[2]);
          if (id.length >= 8) {
            let owned = [];
            try { owned = JSON.parse(await env.SNAPS.get('accs:' + id) || '[]'); } catch (e) {}
            if (!owned.includes(acc[1])) owned.push(acc[1]);
            await env.SNAPS.put('accs:' + id, JSON.stringify(owned));
          }
          await tgApi(env, 'sendMessage', {
            chat_id: msg.chat.id,
            text: '⭐ Спасибо! «' + ACC_NAMES[acc[1]] + '» теперь в твоём гардеробе — вернись в игру и надень.',
          });
          return new Response('ok');
        }
        // ВСЕ продаваемые товары обязаны быть в этом regex — иначе оплата
        // пройдёт, а выдачи не будет. Новый товар = дописать сюда.
        const m = payload.match(/^(spr|wrd|mon|scoot|scum|auto|grind):(.+)$/);
        if (m) {
          const p = PRODUCTS[m[1]];
          const id = cleanId(m[2]);
          if (id.length >= 8) {
            if (p.once) await env.SNAPS.put(p.key(id), '1');
            else {
              const cur = parseInt(await env.SNAPS.get(p.key(id)), 10) || 0;
              await env.SNAPS.put(p.key(id), String(cur + 1));
            }
          }
          thanks = p.thanks;
        }
        await tgApi(env, 'sendMessage', { chat_id: msg.chat.id, text: thanks });
        return new Response('ok');
      }

      if (msg && msg.text) {
        if (msg.text.startsWith('/id')) {
          await tgApi(env, 'sendMessage', {
            chat_id: msg.chat.id,
            text: 'Твой Telegram ID: ' + (msg.from && msg.from.id),
          });
          return new Response('ok');
        }
        await tgApi(env, 'sendMessage', {
          chat_id: msg.chat.id,
          text: 'Карманная Братва — лови братишек, прокачивай и сражайся!',
          reply_markup: { inline_keyboard: [[{ text: '🎮 Играть', web_app: { url: 'https://photoelf.github.io/monsterworld/' } }]] },
        });
      }
      return new Response('ok');
    }

    return json({ err: 'not found' }, 404);
  },
};
