/**
 * Cloudflare Worker — backend API dla aplikacji "Zarządzanie Wynajmem".
 * Zastępuje wcześniejszy Google Apps Script (GAS_URL + JSONP).
 *
 * Endpointy:
 *   GET  /api/kv?key=...          -> { found: true, value: "..." } | { found: false }
 *   POST /api/kv  {key,value}     -> { ok: true }
 *   GET  /api/health              -> { ok: true }
 *   GET  /api/export              -> { rows: [{key, value, updated_at}, ...] }  (kopia zapasowa)
 *   POST /api/admin/init          -> tworzy tabele w D1, jeśli jeszcze nie istnieją
 *   POST /api/admin/import {rows:[{key,value},...]} -> zbiorczy import/aktualizacja wielu kluczy naraz
 *
 * Endpointy /api/admin/* istnieją po to, żeby NIE trzeba było ręcznie wklejać
 * SQL-a w konsoli D1 w panelu Cloudflare (co bywa zawodne przy kopiowaniu/wklejaniu) —
 * wystarczy otworzyć narzedzie-instalacyjne.html z paczki i kliknąć przyciski.
 *
 * Autoryzacja: nagłówek "X-Api-Key" musi być równy
 * sekretowi API_TOKEN ustawionemu przez `wrangler secret put API_TOKEN`
 * (albo wpisany w panelu Cloudflare: Settings → Variables and Secrets).
 *
 * Trasy administracyjne wymagają osobnego ADMIN_TOKEN.
 */

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || 'null',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Api-Key',
    'Access-Control-Max-Age': '86400',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (!env.DB) {
      return json({ error: 'Baza danych (D1) nie jest podpięta do tego Workera. Sprawdź [[d1_databases]] w wrangler.toml.' }, 500, env);
    }
    if (!env.API_TOKEN) {
      return json({ error: 'Brak skonfigurowanego API_TOKEN. Uruchom: wrangler secret put API_TOKEN' }, 500, env);
    }

    // --- autoryzacja ---
    const supplied = request.headers.get('X-Api-Key');
    const isAdmin = url.pathname.startsWith('/api/admin/');
    if (!supplied || (isAdmin ? (!env.ADMIN_TOKEN || supplied !== env.ADMIN_TOKEN) : supplied !== env.API_TOKEN)) {
      return json({ error: 'unauthorized' }, 401, env);
    }

    try {
      if (url.pathname === '/api/health' && request.method === 'GET') {
        return json({ ok: true }, 200, env);
      }

      if (url.pathname === '/api/kv' && request.method === 'GET') {
        const key = url.searchParams.get('key');
        if (!key) return json({ error: 'Brak parametru "key"' }, 400, env);

        const row = await env.DB.prepare('SELECT value FROM kv_store WHERE key = ?1').bind(key).first();
        return json(row ? { found: true, value: row.value } : { found: false }, 200, env);
      }

      if (url.pathname === '/api/kv' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { body = null; }
        if (!body || typeof body.key !== 'string' || typeof body.value !== 'string' || !body.key ||
            !Object.hasOwn(body, 'expectedValue') ||
            (body.expectedValue !== null && typeof body.expectedValue !== 'string')) {
          return json({ error: 'Wymagane: key, value i expectedValue (poprzednia wartość albo null)' }, 400, env);
        }
        const stmt = body.expectedValue === null
          ? env.DB.prepare(`INSERT INTO kv_store (key, value, updated_at)
              VALUES (?1, ?2, datetime('now')) ON CONFLICT(key) DO NOTHING`).bind(body.key, body.value)
          : env.DB.prepare(`UPDATE kv_store SET value = ?2, updated_at = datetime('now')
              WHERE key = ?1 AND value = ?3`).bind(body.key, body.value, body.expectedValue);
        const result = await stmt.run();
        if (!result.meta?.changes) return json({ error: 'conflict' }, 409, env);
        try {
          await env.DB.prepare(
            `INSERT INTO kv_store_history (key, value, written_at) VALUES (?1, ?2, datetime('now'))`
          ).bind(body.key, body.value).run();
        } catch (historyError) {
          // Zapis główny już się powiódł; błąd historii nie może skłonić klienta do ponowienia zapisu.
          console.error('Nie udało się dopisać historii:', historyError);
        }

        return json({ ok: true }, 200, env);
      }

      if (url.pathname === '/api/export' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT key, value, updated_at FROM kv_store ORDER BY key').all();
        return json({ rows: results }, 200, env);
      }

      // ── /api/admin/init: tworzy tabele, jeśli jeszcze nie istnieją ──
      // Bezpieczne do wielokrotnego wywołania (IF NOT EXISTS) — nigdy nie kasuje danych.
      if (url.pathname === '/api/admin/init' && request.method === 'POST') {
        await env.DB.batch([
          env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS kv_store (
               key TEXT PRIMARY KEY,
               value TEXT NOT NULL,
               updated_at TEXT NOT NULL DEFAULT (datetime('now'))
             )`
          ),
          env.DB.prepare(
            `CREATE TABLE IF NOT EXISTS kv_store_history (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               key TEXT NOT NULL,
               value TEXT NOT NULL,
               written_at TEXT NOT NULL DEFAULT (datetime('now'))
             )`
          ),
          env.DB.prepare(`CREATE INDEX IF NOT EXISTS idx_kv_history_key ON kv_store_history(key, written_at)`),
        ]);
        return json({ ok: true, message: 'Tabele istnieją (utworzone teraz albo już wcześniej istniały).' }, 200, env);
      }

      // ── /api/admin/import: zbiorczy import wielu par key/value naraz ──
      // Ciało: { "rows": [ { "key": "...", "value": "..." }, ... ] }
      // Idempotentne (ON CONFLICT DO UPDATE) — można uruchomić wielokrotnie bez obaw o duplikaty.
      if (url.pathname === '/api/admin/import' && request.method === 'POST') {
        let body;
        try { body = await request.json(); } catch { body = null; }
        if (!body || !Array.isArray(body.rows) || body.rows.length > 1000) {
          return json({ error: 'Body musi być JSON-em postaci {"rows": [{"key":"...","value":"..."}, ...]}' }, 400, env);
        }
        const stmts = [];
        let skipped = 0;
        for (const r of body.rows) {
          if (!r || typeof r.key !== 'string' || typeof r.value !== 'string' || !r.key) { skipped++; continue; }
          stmts.push(
            env.DB.prepare(
              `INSERT INTO kv_store (key, value, updated_at) VALUES (?1, ?2, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
            ).bind(r.key, r.value)
          );
        }
        if (stmts.length) await env.DB.batch(stmts);
        return json({ ok: true, imported: stmts.length, skipped }, 200, env);
      }

      return json({ error: 'not found' }, 404, env);
    } catch (e) {
      console.error('Błąd API:', e);
      return json({ error: 'Błąd serwera. Spróbuj ponownie.' }, 500, env);
    }
  },
};
