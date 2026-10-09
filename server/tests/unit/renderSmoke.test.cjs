const test = require('node:test'), assert = require('node:assert/strict');
const { smoke, origin } = require('../../../tools/scripts/deployment/render-smoke.cjs');
test('smoke check rejects false health success and a missing web API proxy', async () => {
    const checks = await smoke('https://api.example.com', 'https://web.example.com', async url => {
        if (url.endsWith('/test/upload')) return new Response('', { status: 404 });
        if (url.endsWith('/backend/readyz')) return new Response('not found', { status: 404 });
        if (url.endsWith('/readyz')) return Response.json({ readyForUploads: false }, { status: 503 });
        if (url.endsWith('/health')) return Response.json({ status: 'starting', readyForUploads: false });
        return new Response('<html/>', { headers: { 'Content-Type': 'text/html' } });
    });
    assert.deepEqual(checks.map(check => check.ok), [false, false, true, false, true]);
    assert.throws(() => origin('https://user:secret@example.com'));
    assert.throws(() => origin('http://public.example.com'));
    assert.equal(origin('http://127.0.0.1:3000/'), 'http://127.0.0.1:3000');
});
