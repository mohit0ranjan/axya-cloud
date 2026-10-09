// Explicit live diagnostic: uploads only generated data to the local account's Saved Messages.
// Does not print or persist account/session credentials. Keeps the resulting diagnostic file for review.
require('dotenv').config({ quiet: true });
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const pool = require('../dist/config/db').default;
const base = 'http://localhost:3000';

(async () => {
  try {
    const owner = (await pool.query("SELECT id FROM users WHERE phone NOT LIKE 'test:%' ORDER BY created_at LIMIT 1")).rows[0];
    assert.ok(owner, 'Sign in to the local app before running the diagnostic.');
    const token = jwt.sign({ userId: owner.id }, process.env.JWT_SECRET, { expiresIn: '15m' });
    const headers = { authorization: `Bearer ${token}` };
    async function json(route, body) {
      const response = await fetch(base + route, { method: body ? 'POST' : 'GET', headers: { ...headers, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000) });
      const result = await response.json();
      assert.ok(response.ok, `${route}: ${response.status} ${result.code || result.error || ''}`);
      return result;
    }
    const bytes = Buffer.from(`Axya generated upload diagnostic. No personal data. ${crypto.randomUUID()}\n`);
    const selection = { originalname: 'Axya upload diagnostic.txt', size: bytes.length, mimetype: 'text/plain', telegram_chat_id: 'me', chunk_size_bytes: 5 * 1024 * 1024, client_upload_key: crypto.randomUUID() };
    const init = await json('/files/upload/init', selection);
    const repeatedInit = await json('/files/upload/init', selection);
    assert.equal(repeatedInit.uploadId, init.uploadId, 'Lost initialization response created a duplicate session');
    console.log('INIT RETRY: same upload session');
    console.log('INIT:', init.status);
    let state = init;
    const admissionDeadline = Date.now() + 240000;
    while (state.status === 'queued' && Date.now() < admissionDeadline) { await new Promise(resolve => setTimeout(resolve, 1500)); state = await json(`/files/upload/status/${init.uploadId}`); }
    assert.equal(state.status, 'uploading', 'Upload admission timed out');
    const form = new FormData(); form.append('uploadId', init.uploadId); form.append('chunkIndex', '0'); form.append('chunk', new Blob([bytes]), 'chunk.bin');
    const chunk = await fetch(base + '/files/upload/chunk', { method: 'POST', headers, body: form, signal: AbortSignal.timeout(60000) });
    const chunkResult = await chunk.json(); assert.ok(chunk.ok, `CHUNK: ${chunk.status} ${chunkResult.error || ''}`); console.log('CHUNK: accepted');
    await json('/files/upload/complete', { uploadId: init.uploadId }); console.log('FINALIZE: processing');
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      state = await json(`/files/upload/status/${init.uploadId}`);
      if (['completed', 'failed', 'error', 'cancelled'].includes(state.status)) break;
      await new Promise(resolve => setTimeout(resolve, 1500));
    }
    assert.equal(state.status, 'completed', `FINALIZE: ${state.status}; ${state.errorCode || ''}: ${state.error || ''}`);
    console.log('TELEGRAM: completed');
    const record = (await pool.query('SELECT file_id FROM upload_sessions WHERE upload_id = $1', [init.uploadId])).rows[0];
    const download = await fetch(`${base}/files/${record.file_id}/download`, { headers, signal: AbortSignal.timeout(60000) });
    assert.equal(download.status, 200); assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
    console.log('DOWNLOAD: original bytes verified');
  } finally { await pool.end(); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
