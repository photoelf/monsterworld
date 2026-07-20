-- Monsterworld D1: горячий игровой поток (команды/лидерборд/PvP).
-- Применить: wrangler d1 execute monsterworld --file=backend/schema.sql [--remote]
-- KV (SNAPS) остаётся под покупки и редкие ключи. TTL у D1 нет — истечение
-- эмулируется фильтром WHERE ts > порог + ленивым DELETE в worker.js.

CREATE TABLE IF NOT EXISTS teams (
  id   TEXT PRIMARY KEY,   -- clientId (был ключ t:<id> в KV)
  nick TEXT NOT NULL,
  team TEXT NOT NULL,      -- JSON массива команды (валидированные monDump)
  ts   INTEGER NOT NULL    -- Date.now() в мс
);
CREATE INDEX IF NOT EXISTS teams_ts ON teams(ts);

CREATE TABLE IF NOT EXISTS leaderboard (
  tg     INTEGER PRIMARY KEY,  -- дедуп по Telegram-id
  nick   TEXT NOT NULL,
  power  INTEGER NOT NULL,
  badges INTEGER NOT NULL,
  dex    INTEGER NOT NULL,
  ts     INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lb_power ON leaderboard(power DESC);

CREATE TABLE IF NOT EXISTS pvp (
  id   TEXT PRIMARY KEY,   -- был ключ pvp:<id> в KV
  data TEXT NOT NULL,      -- JSON объекта вызова целиком
  ts   INTEGER NOT NULL    -- создание, мс; окно жизни 3 дня
);
CREATE INDEX IF NOT EXISTS pvp_ts ON pvp(ts);
