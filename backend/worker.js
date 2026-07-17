'use strict';

// ===== Monsterworld API: снапшоты команд игроков =====
// Cloudflare Worker + KV (binding SNAPS).
// POST /team          {id, nick, team:[monDump...]} — залить свою команду
// GET  /team/random?not=<id>                        — случайная чужая команда
// GET  /health                                      — проверка живости
//
// Снапшоты валидируются и здесь, и на клиенте (tradeMonRevive пересчитывает
// статы из вида — «нарисовать» имбу нельзя). Ник — только буквы/цифры/._- .

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

    return json({ err: 'not found' }, 404);
  },
};
