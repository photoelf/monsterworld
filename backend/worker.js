'use strict';

// ===== Monsterworld API: снапшоты команд игроков + Stars-платежи =====
// Cloudflare Worker + KV (binding SNAPS). Секреты: BOT_TOKEN, WEBHOOK_SECRET.
// POST /team          {id, nick, team:[monDump...]} — залить свою команду
// GET  /team/random?not=<id>                        — случайная чужая команда
// POST /invoice       {id}                          — ссылка-счёт Telegram Stars
// POST /bot                                          — webhook Telegram-бота
// GET  /unlock?id=<id>                              — куплена ли загрузка спрайтов
// GET  /health                                      — проверка живости
//
// Снапшоты валидируются и здесь, и на клиенте (tradeMonRevive пересчитывает
// статы из вида — «нарисовать» имбу нельзя). Ник — только буквы/цифры/._- .

const SPRITE_PRICE_STARS = 10;   // цена разблокировки кастомных спрайтов, XTR
const WARDROBE_PRICE_STARS = 15; // цена гардероба игрока, XTR
const MONGEN_PRICE_STARS = 25;   // цена одной генерации заказного братишки, XTR

// Товары: once — одноразовая разблокировка (KV-флаг), иначе счётчик кредитов
const PRODUCTS = {
  spr: { once: true,  price: SPRITE_PRICE_STARS,   key: id => 'unlock:' + id,
         title: 'Свои спрайты братвы',
         desc: 'Загружай собственные PNG-облики для своих братишек. Навсегда.',
         thanks: '⭐ Спасибо за поддержку Карманной Братвы! Загрузка своих спрайтов открыта — вернись в игру и обнови её.' },
  wrd: { once: true,  price: WARDROBE_PRICE_STARS, key: id => 'wrd:' + id,
         title: 'Гардероб игрока',
         desc: 'Перекраски футболки и волос + аксессуары: кепка, очки, корона. Навсегда.',
         thanks: '⭐ Спасибо! Гардероб открыт — вернись в игру и приоденься.' },
  mon: { once: false, price: MONGEN_PRICE_STARS,   key: id => 'mon:' + id,
         title: 'Заказной братишка',
         desc: 'Уникальный братишка: твой тип, окрас и имя. Одна генерация.',
         thanks: '⭐ Спасибо! Генерация оплачена — вернись в игру и собери своего братишку.' },
};

const INDEX_KEY = 'idx';
const INDEX_CAP = 1500;         // сколько команд держим в ротации
const SNAP_TTL = 60 * 86400;    // сейчас неактивные игроки уходят из ротации через 60 дней

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
    level: Math.min(70, Math.max(1, m.level | 0)),
    exp: Math.max(0, m.exp | 0),
    shiny: !!m.shiny,
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

async function rateLimited(env, ip) {
  const key = 'rl:' + ip + ':' + Math.floor(Date.now() / 60000);
  const n = parseInt(await env.SNAPS.get(key) || '0', 10);
  if (n >= 30) return true;
  await env.SNAPS.put(key, String(n + 1), { expirationTtl: 120 });
  return false;
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
      const snap = {
        nick: sanitizeNick(body.nick),
        team,
        ts: Date.now(),
      };
      await env.SNAPS.put('t:' + id, JSON.stringify(snap), { expirationTtl: SNAP_TTL });
      // индекс для случайной выборки (гонки записи не критичны)
      let idx = [];
      try { idx = JSON.parse(await env.SNAPS.get(INDEX_KEY)) || []; } catch (e) {}
      if (!idx.includes(id)) {
        idx.push(id);
        if (idx.length > INDEX_CAP) idx.splice(Math.floor(Math.random() * idx.length), 1);
        await env.SNAPS.put(INDEX_KEY, JSON.stringify(idx));
      }
      return json({ ok: true, pool: idx.length });
    }

    // --- случайная чужая команда ---
    if (url.pathname === '/team/random' && req.method === 'GET') {
      const not = String(url.searchParams.get('not') || '');
      let idx = [];
      try { idx = JSON.parse(await env.SNAPS.get(INDEX_KEY)) || []; } catch (e) {}
      const pool = idx.filter(i => i !== not);
      if (!pool.length) return json({ snap: null });
      // до 3 попыток: ключ мог истечь по TTL
      for (let tries = 0; tries < 3 && pool.length; tries++) {
        const k = Math.floor(Math.random() * pool.length);
        const id = pool.splice(k, 1)[0];
        const raw = await env.SNAPS.get('t:' + id);
        if (raw) return json({ snap: JSON.parse(raw) });
      }
      return json({ snap: null });
    }

    // --- счёт на покупку (Telegram Stars); product: spr|wrd|mon ---
    if (url.pathname === '/invoice' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.id);
      if (id.length < 8) return json({ err: 'bad id' }, 400);
      const prod = PRODUCTS[body.product] ? body.product : 'spr';
      const p = PRODUCTS[prod];
      if (p.once && await env.SNAPS.get(p.key(id))) return json({ err: 'already unlocked' }, 409);
      const r = await tgApi(env, 'createInvoiceLink', {
        title: p.title,
        description: p.desc,
        payload: prod + ':' + id,
        currency: 'XTR',
        prices: [{ label: p.once ? 'Разблокировка' : 'Генерация', amount: p.price }],
      });
      if (!r.ok) return json({ err: 'tg error' }, 502);
      return json({ link: r.result, price: p.price });
    }

    // --- статус покупки (GET — совместимость со старыми клиентами) ---
    if (url.pathname === '/unlock' && req.method === 'GET') {
      const id = cleanId(url.searchParams.get('id'));
      if (id.length < 8) return json({ unlocked: false });
      return json({ unlocked: !!(await env.SNAPS.get('unlock:' + id)) });
    }

    // --- статус покупки + VIP по подписанному Telegram-id; product: spr|wrd ---
    if (url.pathname === '/unlock' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.id);
      if (id.length < 8) return json({ unlocked: false });
      const prod = (body.product === 'wrd') ? 'wrd' : 'spr';
      const key = PRODUCTS[prod].key(id);
      if (await env.SNAPS.get(key)) return json({ unlocked: true });
      // initData подписан Telegram — подделать чужой tg-id нельзя
      if (body.initData) {
        const user = await verifyInitData(env, body.initData);
        if (user && user.id && await env.SNAPS.get('vip:' + user.id)) {
          await env.SNAPS.put(key, 'vip');
          return json({ unlocked: true, vip: true });
        }
      }
      return json({ unlocked: false });
    }

    // --- генератор: сколько оплаченных генераций; VIP — без ограничений ---
    if (url.pathname === '/mongen' && req.method === 'POST') {
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.id);
      if (id.length < 8) return json({ credits: 0 });
      const credits = parseInt(await env.SNAPS.get('mon:' + id), 10) || 0;
      let vip = false;
      if (body.initData) {
        const user = await verifyInitData(env, body.initData);
        vip = !!(user && user.id && await env.SNAPS.get('vip:' + user.id));
      }
      return json({ credits, vip });
    }

    // --- генератор: списать один кредит ---
    if (url.pathname === '/mongen/claim' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.id);
      if (id.length < 8) return json({ ok: false });
      if (body.initData) {
        const user = await verifyInitData(env, body.initData);
        if (user && user.id && await env.SNAPS.get('vip:' + user.id)) return json({ ok: true, vip: true });
      }
      const credits = parseInt(await env.SNAPS.get('mon:' + id), 10) || 0;
      if (credits < 1) return json({ ok: false });
      await env.SNAPS.put('mon:' + id, String(credits - 1));
      return json({ ok: true, left: credits - 1 });
    }

    // --- промокод ---
    if (url.pathname === '/redeem' && req.method === 'POST') {
      if (await rateLimited(env, ip)) return json({ err: 'slow down' }, 429);
      let body;
      try { body = await req.json(); } catch (e) { return json({ err: 'bad json' }, 400); }
      const id = cleanId(body.id);
      const code = String(body.code || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
      if (id.length < 8 || code.length < 4) return json({ ok: false });
      const raw = await env.SNAPS.get('promo:' + code);
      if (!raw) return json({ ok: false });
      let promo;
      try { promo = JSON.parse(raw); } catch (e) { return json({ ok: false }); }
      if (!promo || !(promo.uses > 0)) return json({ ok: false });
      promo.uses--;
      await env.SNAPS.put('promo:' + code, JSON.stringify(promo));
      await env.SNAPS.put('unlock:' + id, 'promo:' + code);
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
        const m = payload.match(/^(spr|wrd|mon):(.+)$/);
        let thanks = '⭐ Спасибо за поддержку Карманной Братвы!';
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
