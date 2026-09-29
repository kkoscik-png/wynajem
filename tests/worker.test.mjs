import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/src/index.js';

function fakeDb() {
  const values = new Map();
  const history = [];
  return {
    values, history,
    prepare(sql) {
      let args = [];
      return {
        bind(...values) { args = values; return this; },
        async first() { return values.has(args[0]) ? { value: values.get(args[0]) } : null; },
        async run() {
          if (sql.includes('INSERT INTO kv_store_history')) { history.push(args); return { meta: { changes: 1 } }; }
          if (sql.includes('ON CONFLICT(key) DO NOTHING')) {
            if (values.has(args[0])) return { meta: { changes: 0 } };
            values.set(args[0], args[1]); return { meta: { changes: 1 } };
          }
          if (sql.startsWith('UPDATE kv_store')) {
            if (values.get(args[0]) !== args[2]) return { meta: { changes: 0 } };
            values.set(args[0], args[1]); return { meta: { changes: 1 } };
          }
          throw new Error('Unexpected SQL: ' + sql);
        },
      };
    },
  };
}

function request(path, token, method = 'GET', body) {
  return new Request('https://api.example.test' + path, {
    method, headers: { 'X-Api-Key': token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

test('write rejects stale data and keeps the newer monthly settlement', async () => {
  const db = fakeDb();
  const env = { DB: db, API_TOKEN: 'user', ADMIN_TOKEN: 'admin' };
  const write = (value, expectedValue) => worker.fetch(request('/api/kv', 'user', 'POST', { key:'rental-odczyty-zdrojowa', value, expectedValue }), env);
  assert.equal((await write('[1]', null)).status, 200);
  assert.equal((await write('[2]', '[1]')).status, 200);
  assert.equal((await write('[3]', '[1]')).status, 409);
  assert.equal(db.values.get('rental-odczyty-zdrojowa'), '[2]');
  assert.equal(db.history.length, 2);
});

test('admin routes require separate secret and URL tokens are rejected', async () => {
  const env = { DB: fakeDb(), API_TOKEN: 'user', ADMIN_TOKEN: 'admin' };
  assert.equal((await worker.fetch(request('/api/health', 'user'), env)).status, 200);
  assert.equal((await worker.fetch(request('/api/admin/init', 'user', 'POST'), env)).status, 401);
  assert.equal((await worker.fetch(new Request('https://api.example.test/api/health?token=user'), env)).status, 401);
  assert.equal((await worker.fetch(request('/api/kv', 'user', 'POST', { key:'x', value:'y' }), env)).status, 400);
});
