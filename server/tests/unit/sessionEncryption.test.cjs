const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { encryptSession, decryptSession } = require('../../dist/utils/sessionEncryption');

test('sessions encrypt with unique nonces and decrypt without exposing plaintext', () => {
    process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    const first = encryptSession('test-telegram-session');
    const second = encryptSession('test-telegram-session');
    assert.notEqual(first, second);
    assert.ok(!first.includes('test-telegram-session'));
    assert.equal(decryptSession(first), 'test-telegram-session');
    assert.equal(decryptSession('legacy-session'), 'legacy-session');
    const parts = first.split('.');
    const data = Buffer.from(parts[2], 'base64url');
    data[0] ^= 1;
    parts[2] = data.toString('base64url');
    assert.throws(() => decryptSession(parts.join('.')));
    process.env.SESSION_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');
    assert.throws(() => decryptSession(first));
});

test('new writes require a valid dedicated key', () => {
    delete process.env.SESSION_ENCRYPTION_KEY;
    assert.throws(() => encryptSession('session'), /32-byte/);
});
