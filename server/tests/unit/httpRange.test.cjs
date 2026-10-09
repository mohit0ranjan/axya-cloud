const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseByteRange } = require('../../dist/utils/httpRange');

test('open, bounded and suffix ranges select the correct bytes', () => {
    assert.equal(parseByteRange(undefined, 1000), null);
    assert.deepEqual(parseByteRange('bytes=200-', 1000), { start: 200, end: 999 });
    assert.deepEqual(parseByteRange('bytes=100-200', 1000), { start: 100, end: 200 });
    assert.deepEqual(parseByteRange('bytes=-500', 1000), { start: 500, end: 999 });
    assert.deepEqual(parseByteRange('bytes=-2000', 1000), { start: 0, end: 999 });
    assert.deepEqual(parseByteRange('bytes=900-2000', 1000), { start: 900, end: 999 });
});

test('invalid and unsatisfiable ranges cannot produce misleading responses', () => {
    for (const header of ['bytes=-0', 'bytes=-', 'bytes=1000-', 'bytes=200-100', 'bytes=0-1,4-5', 'junk bytes=0-1', 'bytes=999999999999999999999-']) {
        assert.throws(() => parseByteRange(header, 1000), RangeError);
    }
    assert.throws(() => parseByteRange('bytes=0-', 0), RangeError);
});
