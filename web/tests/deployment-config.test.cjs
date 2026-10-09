const test = require('node:test'), assert = require('node:assert/strict');
const { backendOrigin } = require('../scripts/backend-origin.cjs');

test('production cannot silently proxy to localhost or bypass cookie proxy', () => {
    const env = { NODE_ENV: 'production', RENDER: 'true' };
    assert.throws(() => backendOrigin(env), /required/);
    assert.throws(() => backendOrigin({ ...env, AXYA_API_URL: 'http://localhost:3000' }), /HTTPS/);
    assert.throws(() => backendOrigin({ ...env, AXYA_API_URL: 'https://api.example.com', NEXT_PUBLIC_API_URL: 'https://api.example.com' }), /\/backend/);
    assert.equal(backendOrigin({ ...env, AXYA_API_URL: 'https://api.example.com/', NEXT_PUBLIC_API_URL: '/backend' }), 'https://api.example.com');
    assert.equal(backendOrigin({ NODE_ENV: 'development' }), 'http://localhost:3000');
});

test('proxy rejects credentials and paths without including their value in errors', () => {
    for (const value of ['https://user:private-secret@api.example.com', 'https://api.example.com/path', 'https://api.example.com?token=private-secret', 'file:///tmp/file']) {
        assert.throws(() => backendOrigin({ AXYA_API_URL: value }), error => !error.message.includes('private-secret') && /origin/.test(error.message));
    }
});
