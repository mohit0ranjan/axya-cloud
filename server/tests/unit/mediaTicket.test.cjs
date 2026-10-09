const test = require('node:test'), assert = require('node:assert/strict'), jwt = require('jsonwebtoken');
process.env.JWT_SECRET = 'isolated-video-test-secret-not-a-production-key';
const { signMediaTicket, verifyMediaTicket, mediaRevision } = require('../../dist/utils/mediaTicket');
test('media tickets are file scoped, expiring and distinct from account access', () => {
    const revision = mediaRevision('chat', 'message'), ticket = signMediaTicket('owner', 'file', revision);
    const claims = verifyMediaTicket(ticket, 'file');
    assert.equal(claims.userId, 'owner'); assert.equal(claims.purpose, 'media'); assert.equal(claims.exp - claims.iat, 3600);
    assert.equal(verifyMediaTicket(ticket, 'other-file'), null);
    assert.equal(verifyMediaTicket(ticket + 'tampered', 'file'), null);
    assert.equal(verifyMediaTicket(jwt.sign({ userId: 'owner' }, process.env.JWT_SECRET), 'file'), null);
    assert.equal(verifyMediaTicket(jwt.sign({ purpose: 'media', userId: 'owner', fileId: 'file', revision }, process.env.JWT_SECRET, { audience: 'axya-private-video', expiresIn: -1 }), 'file'), null);
    assert.notEqual(mediaRevision('chat', 'replacement'), revision);
});
