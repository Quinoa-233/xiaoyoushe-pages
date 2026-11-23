/**
 * 校游社后端 —— Cloudflare Pages Functions + D1
 *
 * 路由（全部走 /api/*）：
 *   POST /api/register   { sid, password, nickname?, cls? }  学号首次登录即注册
 *   POST /api/login      { sid, password }
 *   POST /api/logout
 *   GET  /api/me         当前用户 + 今天已送花数 + 今天送过的游戏
 *   GET  /api/summary    全站每款游戏的点击 / 时长 / 小红花
 *   POST /api/click      { gameId }        记一次点击
 *   POST /api/play       { gameId, seconds }  累计游玩时长
 *   POST /api/flower     { gameId, on }    送花 / 收回（每天 10 朵）
 *
 * 说明：表结构在第一次请求时自动建好（IF NOT EXISTS），不需要手动跑 SQL。
 */

const DAY = () => {
  // 统一按北京时间算“今天”，避免 UTC 跨天
  const d = new Date(Date.now() + 8 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
};

const enc = new TextEncoder();

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function bad(msg, status = 400) {
  return json({ ok: false, error: msg }, status);
}

/* ---------- 密码哈希（PBKDF2-SHA256） ---------- */
function hex(buf) {
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hashPassword(password, saltHex) {
  const salt = saltHex ? Uint8Array.from(saltHex.match(/../g).map(h => parseInt(h, 16))) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' }, key, 256);
  return { hash: hex(bits), salt: saltHex || hex(salt) };
}

async function verifyPassword(password, hashHex, saltHex) {
  const { hash } = await hashPassword(password, saltHex);
  if (hash.length !== hashHex.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ hashHex.charCodeAt(i);
  return diff === 0;
}

/* ---------- 建表 ---------- */
let schemaReady = null;
function ensureSchema(env) {
  if (!schemaReady) {
    schemaReady = env.DB.batch([
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sid TEXT UNIQUE NOT NULL,
        nickname TEXT,
        cls TEXT,
        pw_hash TEXT NOT NULL,
        pw_salt TEXT NOT NULL,
        created_at TEXT NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_stats (
        game_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        clicks INTEGER NOT NULL DEFAULT 0,
        seconds INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (game_id, day)
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS game_totals (
        game_id INTEGER PRIMARY KEY,
        clicks INTEGER NOT NULL DEFAULT 0,
        seconds INTEGER NOT NULL DEFAULT 0
      )`),
      env.DB.prepare(`CREATE TABLE IF NOT EXISTS flowers (
        user_id INTEGER NOT NULL,
        game_id INTEGER NOT NULL,
        day TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (user_id, game_id, day)
      )`),
    ]).catch(e => { schemaReady = null; throw e; });
  }
  return schemaReady;
}

/* ---------- 会话 ---------- */
const TOKEN_TTL = 30 * 24 * 3600 * 1000;

async function createSession(env, userId) {
  const token = hex(crypto.getRandomValues(new Uint8Array(24)));
  await env.DB.prepare('INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
    .bind(token, userId, new Date().toISOString(), Date.now() + TOKEN_TTL).run();
  return token;
}

async function currentUser(env, request) {
  const auth = request.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const row = await env.DB.prepare(
    'SELECT s.token, s.expires_at, u.id, u.sid, u.nickname, u.cls FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?'
  ).bind(token).first();
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
    return null;
  }
  return row;
}

async function publicUser(env, user) {
  const day = DAY();
  const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM flowers WHERE user_id = ? AND day = ?')
    .bind(user.id, day).first();
  const mine = await env.DB.prepare('SELECT game_id FROM flowers WHERE user_id = ? AND day = ?')
    .bind(user.id, day).all();
  return {
    sid: user.sid,
    nickname: user.nickname || '',
    cls: user.cls || '',
    todayFlowers: used ? used.n : 0,
    dailyLimit: DAILY_LIMIT,
    myFlowers: (mine.results || []).map(r => r.game_id),
  };
}

/* ---------- 主入口 ---------- */
const DAILY_LIMIT = 10;

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api\/?/, '').replace(/\/$/, '');
  const method = request.method;

  if (!env.DB) {
    return json({ ok: false, error: 'D1_NOT_BOUND', message: '还没绑定 D1 数据库（Cloudflare Pages → Settings → Functions → D1 bindings，变量名填 DB）' }, 503);
  }

  try {
    await ensureSchema(env);
  } catch (e) {
    return json({ ok: false, error: 'DB_INIT_FAILED', message: String(e && e.message || e) }, 500);
  }

  let body = {};
  if (method === 'POST') {
    try { body = await request.json(); } catch (e) { body = {}; }
  }

  try {
    /* 注册 */
    if (path === 'register' && method === 'POST') {
      const sid = String(body.sid || '').trim();
      const password = String(body.password || '');
      if (!/^[0-9A-Za-z]{4,20}$/.test(sid)) return bad('学号要是 4–20 位数字或字母');
      if (password.length < 6) return bad('密码至少 6 位');
      const exist = await env.DB.prepare('SELECT id FROM users WHERE sid = ?').bind(sid).first();
      if (exist) return bad('这个学号已经注册过了，直接登录吧');
      const { hash, salt } = await hashPassword(password);
      const now = new Date().toISOString();
      const res = await env.DB.prepare(
        'INSERT INTO users (sid, nickname, cls, pw_hash, pw_salt, created_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(sid, String(body.nickname || '').trim().slice(0, 20), String(body.cls || '').trim().slice(0, 30), hash, salt, now).run();
      const userId = res.meta.last_row_id;
      const token = await createSession(env, userId);
      const user = await env.DB.prepare('SELECT id, sid, nickname, cls FROM users WHERE id = ?').bind(userId).first();
      return json({ ok: true, token, user: await publicUser(env, user) });
    }

    /* 登录 */
    if (path === 'login' && method === 'POST') {
      const sid = String(body.sid || '').trim();
      const password = String(body.password || '');
      const user = await env.DB.prepare('SELECT id, sid, nickname, cls, pw_hash, pw_salt FROM users WHERE sid = ?').bind(sid).first();
      if (!user) return bad('这个学号还没注册过，先注册一下', 404);
      const okPw = await verifyPassword(password, user.pw_hash, user.pw_salt);
      if (!okPw) return bad('密码不对', 401);
      const token = await createSession(env, user.id);
      return json({ ok: true, token, user: await publicUser(env, user) });
    }

    /* 退出 */
    if (path === 'logout' && method === 'POST') {
      const auth = request.headers.get('authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (token) await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
      return json({ ok: true });
    }

    /* 当前用户 */
    if (path === 'me' && method === 'GET') {
      const user = await currentUser(env, request);
      if (!user) return json({ ok: true, user: null });
      return json({ ok: true, user: await publicUser(env, user) });
    }

    /* 全站统计 */
    if (path === 'summary' && method === 'GET') {
      const totals = await env.DB.prepare('SELECT game_id, clicks, seconds FROM game_totals').all();
      const flowers = await env.DB.prepare('SELECT game_id, COUNT(*) AS n FROM flowers GROUP BY game_id').all();
      const since = new Date(Date.now() + 8 * 3600 * 1000 - 6 * 86400000).toISOString().slice(0, 10);
      const weekRows = await env.DB.prepare('SELECT game_id, SUM(clicks) AS c FROM game_stats WHERE day >= ? GROUP BY game_id').bind(since).all();
      const games = {};
      for (const r of totals.results || []) games[r.game_id] = { clicks: r.clicks, seconds: r.seconds, weekClicks: 0, flowers: 0 };
      for (const r of weekRows.results || []) {
        if (!games[r.game_id]) games[r.game_id] = { clicks: 0, seconds: 0, weekClicks: 0, flowers: 0 };
        games[r.game_id].weekClicks = r.c || 0;
      }
      for (const r of flowers.results || []) {
        if (!games[r.game_id]) games[r.game_id] = { clicks: 0, seconds: 0, flowers: 0 };
        games[r.game_id].flowers = r.n;
      }
      const user = await currentUser(env, request);
      return json({ ok: true, games, me: user ? await publicUser(env, user) : null, day: DAY() });
    }

    /* 点击 */
    if (path === 'click' && method === 'POST') {
      const gameId = Number(body.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) return bad('gameId 不对');
      const day = DAY();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO game_stats (game_id, day, clicks, seconds) VALUES (?, ?, 1, 0)
          ON CONFLICT(game_id, day) DO UPDATE SET clicks = clicks + 1`).bind(gameId, day),
        env.DB.prepare(`INSERT INTO game_totals (game_id, clicks, seconds) VALUES (?, 1, 0)
          ON CONFLICT(game_id) DO UPDATE SET clicks = clicks + 1`).bind(gameId),
      ]);
      const row = await env.DB.prepare('SELECT clicks FROM game_totals WHERE game_id = ?').bind(gameId).first();
      return json({ ok: true, clicks: row ? row.clicks : 1 });
    }

    /* 游玩时长 */
    if (path === 'play' && method === 'POST') {
      const gameId = Number(body.gameId);
      let seconds = Math.round(Number(body.seconds));
      if (!Number.isInteger(gameId) || gameId <= 0) return bad('gameId 不对');
      if (!Number.isFinite(seconds) || seconds <= 0) return bad('seconds 不对');
      if (seconds > 3600) seconds = 3600; // 单次最多记一小时，防止乱报
      const day = DAY();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO game_stats (game_id, day, clicks, seconds) VALUES (?, ?, 0, ?)
          ON CONFLICT(game_id, day) DO UPDATE SET seconds = seconds + excluded.seconds`).bind(gameId, day, seconds),
        env.DB.prepare(`INSERT INTO game_totals (game_id, clicks, seconds) VALUES (?, 0, ?)
          ON CONFLICT(game_id) DO UPDATE SET seconds = seconds + excluded.seconds`).bind(gameId, seconds),
      ]);
      return json({ ok: true });
    }

    /* 送花 */
    if (path === 'flower' && method === 'POST') {
      const user = await currentUser(env, request);
      if (!user) return bad('先登录才能送小红花', 401);
      const gameId = Number(body.gameId);
      if (!Number.isInteger(gameId) || gameId <= 0) return bad('gameId 不对');
      const day = DAY();
      const want = body.on !== false;
      const mine = await env.DB.prepare('SELECT 1 AS x FROM flowers WHERE user_id = ? AND game_id = ? AND day = ?')
        .bind(user.id, gameId, day).first();

      if (want && !mine) {
        const used = await env.DB.prepare('SELECT COUNT(*) AS n FROM flowers WHERE user_id = ? AND day = ?')
          .bind(user.id, day).first();
        if (used && used.n >= DAILY_LIMIT) {
          return json({ ok: false, error: '今天的 10 朵已经送完了，明天再来', code: 'QUOTA', todayFlowers: used.n }, 409);
        }
        await env.DB.prepare('INSERT OR IGNORE INTO flowers (user_id, game_id, day, created_at) VALUES (?, ?, ?, ?)')
          .bind(user.id, gameId, day, new Date().toISOString()).run();
      } else if (!want && mine) {
        await env.DB.prepare('DELETE FROM flowers WHERE user_id = ? AND game_id = ? AND day = ?')
          .bind(user.id, gameId, day).run();
      }

      const total = await env.DB.prepare('SELECT COUNT(*) AS n FROM flowers WHERE game_id = ?').bind(gameId).first();
      return json({ ok: true, flowers: total ? total.n : 0, me: await publicUser(env, user) });
    }

    return bad('没有这个接口：' + (path || '/'), 404);
  } catch (e) {
    return json({ ok: false, error: 'SERVER_ERROR', message: String(e && e.message || e) }, 500);
  }
}
