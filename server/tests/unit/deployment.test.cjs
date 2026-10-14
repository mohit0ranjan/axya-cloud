const test = require('node:test'), assert = require('node:assert/strict');
const express = require('express');
const path = require('node:path');
const { productionConfigErrors, assertProductionConfig } = require('../../dist/utils/productionConfig');
const { createReadinessHandler } = require('../../dist/utils/healthReadiness');

function validConfig() {
    return { NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:private-test-password@db.example.com/db',
        SESSION_ENCRYPTION_KEY: 'ab'.repeat(32), TELEGRAM_API_ID: '123456', TELEGRAM_API_HASH: 'cd'.repeat(16),
        JWT_SECRET: 'jwt-test-only-'.repeat(4), COOKIE_SECRET: 'cookie-test-only-'.repeat(4),
        SHARE_V2_SESSION_SECRET: 'session-test-only-'.repeat(4), SHARE_V2_TICKET_SECRET: 'ticket-test-only-'.repeat(4),
        SHARE_V2_LINK_PEPPER: 'pepper-test-only-'.repeat(4),
        SERVER_BASE_URL: 'https://api.example.com', FRONTEND_BASE_URL: 'https://web.example.com',
        ALLOWED_ORIGINS: 'https://web.example.com', UPLOAD_STORAGE_DIR: path.resolve('test-deployment-staging') };
}
test('production rejects missing/unsafe config without echoing secrets', () => {
    assert.deepEqual(productionConfigErrors(validConfig()), []);
    assert.deepEqual(productionConfigErrors({ NODE_ENV: 'development' }), []);
    for (const name of Object.keys(validConfig()).filter(name => name !== 'NODE_ENV')) {
        assert.ok(productionConfigErrors({ ...validConfig(), [name]: '' }).includes(name), name);
    }
    const invalid = { ...validConfig(), DATABASE_URL: 'private-test-password', COOKIE_SECRET: 'short',
        SESSION_ENCRYPTION_KEY: 'wrong', SERVER_BASE_URL: 'http://localhost', ALLOWED_ORIGINS: '*', UPLOAD_STORAGE_DIR: './relative', PORT: '99999' };
    for (const name of ['DATABASE_URL', 'COOKIE_SECRET', 'SESSION_ENCRYPTION_KEY', 'SERVER_BASE_URL', 'ALLOWED_ORIGINS', 'UPLOAD_STORAGE_DIR', 'PORT']) assert.ok(productionConfigErrors(invalid).includes(name));
    assert.throws(() => assertProductionConfig(invalid), err => !err.message.includes('private-test-password'));
});

async function withProbe(deps, fn) {
    const app = express();
    app.get('/readyz', createReadinessHandler({ schema: () => 'ready', shuttingDown: () => false,
        telegramConfigured: () => true, staging: () => ({ ready: true, reason: 'ready' }),
        database: async () => true, databaseTimeoutMs: 25, ...deps }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise(resolve => server.once('listening', resolve));
    try { await fn(`http://127.0.0.1:${server.address().port}/readyz`); }
    finally { await new Promise(resolve => server.close(resolve)); }
}
test('readiness refuses traffic when schema, DB, Telegram config, staging or shutdown is unhealthy', async () => {
    await withProbe({}, async url => {
        const res = await fetch(url); assert.equal(res.status, 200);
        assert.equal((await res.json()).readyForUploads, true);
        assert.equal(res.headers.get('cache-control'), 'no-store');
    });
    for (const deps of [{ schema: () => 'starting' }, { database: async () => { throw new Error('private-db-error'); } },
        { telegramConfigured: () => false }, { staging: () => ({ ready: false, reason: 'read-only' }) }, { shuttingDown: () => true }]) {
        await withProbe(deps, async url => {
            const res = await fetch(url); assert.equal(res.status, 503);
            const body = await res.text(); assert.equal(JSON.parse(body).readyForUploads, false);
            assert.ok(!body.includes('private-db-error')); assert.equal(res.headers.get('retry-after'), '5');
        });
    }
});
test('hung DB probes return promptly and share one pending query', async () => {
    let queries = 0;
    await withProbe({ database: () => { queries++; return new Promise(() => {}); } }, async url => {
        const results = await Promise.all([fetch(url), fetch(url), fetch(url)]);
        assert.ok(results.every(res => res.status === 503));
        assert.equal(queries, 1);
        assert.equal((await fetch(url)).status, 503); assert.equal(queries, 1);
    });
});

test('readiness cannot return healthy if shutdown starts during a database probe', async () => {
    let shuttingDown = false;
    await withProbe({ shuttingDown: () => shuttingDown, database: async () => { shuttingDown = true; } }, async url => {
        const response = await fetch(url);
        assert.equal(response.status, 503);
        assert.equal((await response.json()).checks.terminating, true);
    });
});
