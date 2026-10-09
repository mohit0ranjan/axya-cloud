// Isolated metadata fixtures; this test never opens a public link or calls Telegram.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const pool = require('../dist/config/db').default;
const { encryptSession } = require('../dist/utils/sessionEncryption');
const { listSharesV2 } = require('../dist/controllers/share-v2.controller');
const owners = [crypto.randomUUID(), crypto.randomUUID()];
const folders = [crypto.randomUUID(), crypto.randomUUID()];
const links = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
const inserted = [];
(async () => {
  try {
    for (let i = 0; i < owners.length; i++) {
      await pool.query('INSERT INTO users(id,phone,name,session_string) VALUES($1,$2,$3,$4)',
        [owners[i], 'test:' + owners[i], 'Sharing UI test', encryptSession('isolated-no-telegram-session')]);
      inserted.push(owners[i]);
      await pool.query('INSERT INTO folders(id,user_id,name) VALUES($1,$2,$3)',
        [folders[i], owners[i], i ? 'Other owner private folder' : 'Personal library']);
    }
    for (let i = 0; i < links.length; i++) {
      await pool.query('INSERT INTO share_links_v2(id,owner_user_id,resource_type,root_folder_id,slug,link_secret_hash) VALUES($1,$2,$3,$4,$5,$6)',
        [links[i], owners[i === 1 ? 1 : 0], 'folder', folders[i === 0 ? 0 : 1], 'test-' + links[i], 'test-only-no-public-secret']);
    }
    const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await listSharesV2({ user: { id: owners[0] } }, response);
    assert.equal(response.code, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.shares.length, 2);
    assert.equal(response.body.shares.find(s => s.id === links[0]).resourceName, 'Personal library');
    assert.equal(response.body.shares.find(s => s.id === links[2]).resourceName, null);
    assert.ok(!response.body.shares.some(s => s.id === links[1]));
    assert.ok(!JSON.stringify(response.body).includes('Other owner private folder'));
    assert.ok(!JSON.stringify(response.body).includes('test-only-no-public-secret'));
    console.log('PASS: owned sharing resource names, cross-owner isolation and secret-free response');
  } finally {
    if (inserted.length) await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [inserted]);
    await pool.end();
  }
})().then(() => process.exit(0)).catch(e => { console.error(e.message); process.exit(1); });
