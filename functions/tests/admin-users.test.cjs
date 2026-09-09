const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');

const calls = [];
let duplicate = false;
let missing = false;
let failWrite = false;
const firebase = {
  adminAuth: {
    getUser: async () => ({ email: 'old@example.org', customClaims: { role: 'USER', extra: true } }),
    updateUser: async (id, data) => {
      if (duplicate) throw { code: 'auth/email-already-exists' };
      calls.push(['auth', id, data]);
    },
    setCustomUserClaims: async (id, data) => calls.push(['claims', id, data]),
  },
  db: { collection: () => ({ doc: () => ({
    get: async () => ({ exists: !missing }),
    update: async (data) => { if (failWrite) throw new Error('write failed'); calls.push(['db', data]); },
  }) }) },
};
const originalLoad = Module._load;
Module._load = function (name, ...args) {
  return name === '../lib/firebase' ? firebase : originalLoad.call(this, name, ...args);
};
const { updateUser, resetUserPassword } = require('../lib/controllers/admin.controller');
Module._load = originalLoad;

async function invoke(handler, body) {
  const res = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(data) { this.body = data; return this; } };
  await handler({ params: { id: 'stable-uid' }, body }, res);
  return res;
}

test('admin user editing and password reset', async () => {
  let res = await invoke(updateUser, { email: 'new@example.org', level: 'NATIONAL', geoState: 'old scope' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls[0], ['auth', 'stable-uid', { email: 'new@example.org' }]);
  assert.deepEqual(calls[1][2], { role: 'USER', extra: true, level: 'NATIONAL', geoState: null, geoDistrict: null, geoBlock: null });
  assert.equal(calls[2][1].email, 'new@example.org');

  calls.length = 0;
  res = await invoke(updateUser, { email: 'new@example.org', level: 'BLOCK' });
  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
  duplicate = true;
  assert.equal((await invoke(updateUser, { email: 'new@example.org' })).statusCode, 409);
  duplicate = false;
  missing = true;
  assert.equal((await invoke(updateUser, { email: 'new@example.org' })).statusCode, 404);
  missing = false;

  failWrite = true;
  assert.equal((await invoke(updateUser, { email: 'new@example.org' })).statusCode, 500);
  assert.deepEqual(calls.at(-2), ['auth', 'stable-uid', { email: 'old@example.org' }]);
  assert.deepEqual(calls.at(-1)[2], { role: 'USER', extra: true });
  failWrite = false;
  calls.length = 0;
  assert.equal((await invoke(resetUserPassword, { password: 'short' })).statusCode, 400);
  assert.equal(calls.length, 0);
  assert.equal((await invoke(resetUserPassword, { password: 'NewPassword123!' })).statusCode, 200);
  assert.deepEqual(calls, [['auth', 'stable-uid', { password: 'NewPassword123!' }]]);
});
