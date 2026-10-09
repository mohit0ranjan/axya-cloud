// Requires a running local API and the explicitly configured testing database.
// Only creates and deletes rows belonging to its own newly generated test users.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict'); const crypto = require('node:crypto');
const jwt = require('jsonwebtoken'); const signature = require('cookie-signature');
const pool = require('../dist/config/db').default; const { encryptSession } = require('../dist/utils/sessionEncryption');
const base = process.env.TEST_API_URL || 'http://localhost:3000'; const ids = [crypto.randomUUID(), crypto.randomUUID()];
const token = id => jwt.sign({ userId: id }, process.env.JWT_SECRET, { expiresIn: '10m' });
async function request(route, { user = ids[0], status = 200, method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(base + route, { method, headers: { authorization: `Bearer ${token(user)}`, 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(20000) });
  const result = await response.json().catch(() => ({})); assert.equal(response.status, status, `${method} ${route}: ${result.error || result.message || ''}`); return result;
}
(async () => {
  try {
    for (const id of ids) await pool.query('INSERT INTO users (id, phone, session_string, name) VALUES ($1, $2, $3, $4)', [id, `test:${id}`, encryptSession('metadata-test-no-telegram-access'), 'Axya integration test']);
    const me = await request('/auth/me'); assert.equal(me.user.id, ids[0]);
    const folder = (await request('/files/folder', { method: 'POST', body: { name: 'Integration test folder' }, status: 201 })).folder;
    await request('/files/folder', { user: ids[1], method: 'POST', body: { name: 'Unauthorized child', parent_id: folder.id }, status: 404 });
    const fileId = crypto.randomUUID();
    await pool.query('INSERT INTO files (id, user_id, file_name, file_size, telegram_file_id, telegram_message_id, mime_type) VALUES ($1, $2, $3, $4, $5, $6, $7)', [fileId, ids[0], 'test note.txt', 3, 'metadata-test', 1, 'text/plain']);
    assert.ok((await request('/files')).files.some(file => file.id === fileId));
    await request(`/files/${fileId}`, { method: 'PATCH', body: { file_name: 'Renamed note.txt', folder_id: folder.id } });
    await request(`/files/${fileId}`, { user: ids[1], method: 'PATCH', body: { folder_id: folder.id }, status: 404 });
    await request(`/files/${fileId}/thumbnail`, { user: ids[1], status: 404 });
    assert.ok((await request('/files/search?q=Renamed')).results.some(file => file.id === fileId));
    await request(`/files/${fileId}/star`, { method: 'PATCH', body: {} });
    assert.ok((await request('/files/starred')).files.some(file => file.id === fileId));
    await request(`/files/${fileId}/trash`, { method: 'PATCH', body: {} });
    assert.ok((await request('/files/trash')).files.some(file => file.id === fileId));
    await request(`/files/${fileId}/restore`, { method: 'PATCH', body: {} });
    await request(`/files/${fileId}/restore`, { method: 'PATCH', body: {}, status: 404 });
    const duplicateId = crypto.randomUUID(); const hash = crypto.createHash('sha256').update('abc').digest('hex');
    await pool.query('UPDATE files SET sha256_hash = $2 WHERE id = $1', [fileId, hash]);
    await pool.query('INSERT INTO files (id, user_id, file_name, file_size, telegram_file_id, telegram_message_id, mime_type, sha256_hash) VALUES ($1,$2,$3,3,$4,1,$5,$6)', [duplicateId, ids[0], 'duplicate.txt', 'metadata-test', 'text/plain', hash]);
    const duplicates = await request('/files/duplicates'); assert.equal(duplicates.groups[0].copies, 2);
    assert.equal((await request('/files/duplicates', { user: ids[1] })).groups.length, 0);
    assert.equal((await request('/files/health')).health.unchecked, 2);
    // Fake Telegram session must not be used: the original still needs this message.
    await request(`/files/${duplicateId}`, { method: 'DELETE' });
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM files WHERE id = $1', [fileId])).rows[0].n, 1);
    const child = (await request('/files/folder', { method: 'POST', body: { name: 'Nested folder', parent_id: folder.id }, status: 201 })).folder;
    await request('/files/bulk', { method: 'POST', body: { ids: [folder.id], action: 'move', folder_id: child.id }, status: 400 });
    await request('/files/bulk', { method: 'POST', body: { ids: [folder.id], action: 'move', folder_id: folder.id }, status: 400 });
    const parentAfterRejectedMove = await pool.query('SELECT parent_id FROM folders WHERE id = $1', [folder.id]);
    assert.equal(parentAfterRejectedMove.rows[0].parent_id, null);
    await request('/files/bulk', { method: 'POST', body: { ids: [child.id], action: 'move', folder_id: null } });
    const movedToRoot = await pool.query('SELECT parent_id FROM folders WHERE id = $1', [child.id]);
    assert.equal(movedToRoot.rows[0].parent_id, null);
    await request('/files/bulk', { method: 'POST', body: { ids: [child.id], action: 'move', folder_id: folder.id } });
    const earlierTrash = crypto.randomUUID();
    await pool.query('INSERT INTO files (id, user_id, file_name, file_size, telegram_file_id, telegram_message_id, mime_type, folder_id, is_trashed, trashed_at) VALUES ($1, $2, $3, 3, $4, 1, $5, $6, true, NOW() - INTERVAL \'1 hour\')', [earlierTrash, ids[0], 'Earlier trash.txt', 'metadata-test', 'text/plain', child.id]);
    await request(`/files/${fileId}`, { method: 'PATCH', body: { folder_id: child.id } });
    await request(`/files/folder/${folder.id}`, { method: 'DELETE' });
    await request(`/files/${folder.id}/restore`, { user: ids[1], method: 'PATCH', body: {}, status: 404 });
    await request(`/files/${folder.id}/restore`, { method: 'PATCH', body: {} });
    const restored = await pool.query('SELECT is_trashed FROM files WHERE id = $1', [fileId]); assert.equal(restored.rows[0].is_trashed, false);
    const preserved = await pool.query('SELECT is_trashed FROM files WHERE id = $1', [earlierTrash]); assert.equal(preserved.rows[0].is_trashed, true);
    const restoredChild = await pool.query('SELECT is_trashed FROM folders WHERE id = $1', [child.id]); assert.equal(restoredChild.rows[0].is_trashed, false);
    const cookie = `axya_session=${encodeURIComponent('s:' + signature.sign(token(ids[0]), process.env.COOKIE_SECRET))}`;
    await request('/auth/me', { headers: { authorization: '', cookie } });
    await request(`/files/${fileId}/star`, { method: 'PATCH', body: {}, status: 403, headers: { authorization: '', cookie, origin: 'https://untrusted.invalid' } });
    await request(`/files/${fileId}/star`, { method: 'PATCH', body: {}, headers: { authorization: '', cookie, origin: 'http://localhost:3001' } });
    await request(`/files/folder/${folder.id}`, { method: 'PATCH', body: { name: 'Renamed integration folder' } });
    const share = await request('/api/v2/shares', { method: 'POST', status: 201, body: { resource_type: 'file', root_file_id: fileId, password: 'test-password', expires_at: new Date(Date.now() + 3600000).toISOString() } });
    assert.ok(share.share_url); assert.ok((await request('/api/v2/shares')).shares.some(item => item.id === share.share.id));
    await request(`/api/v2/shares/${share.share.id}`, { user: ids[1], method: 'DELETE', status: 404 });
    await request(`/api/v2/shares/${share.share.id}`, { method: 'DELETE' });
    await request(`/api/v2/public/shares/${share.slug}/open`, { method: 'POST', body: { secret: share.secret, password: 'test-password' }, status: 410 });
    console.log('PASS: live Neon metadata CRUD, search, star/trash/restore, account isolation, signed cookies and browser origin checks.');
  } finally { await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]); await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
