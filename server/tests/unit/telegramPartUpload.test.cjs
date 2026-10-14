const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { uploadTelegramParts } = require('../../dist/services/storage/telegram-part-upload');
const PART = 512 * 1024;
async function source(t, size) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'axya-parts-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filePath = path.join(dir, 'sample.bin');
  const bytes = crypto.randomBytes(size);
  await fs.writeFile(filePath, bytes);
  return { filePath, fileName: 'sample.bin', fileSize: size, bytes };
}
function client(send) { return { session: { dcId: 2 }, getSender: async () => ({ send }) }; }
test('failed part retries with the same ID; successful parts are not repeated and bytes match', async t => {
  const file = await source(t, PART * 4 + 17), counts = new Map(), received = new Map(), ids = new Set(), progress = [];
  const result = await uploadTelegramParts(client(async request => {
    const n = request.filePart;
    ids.add(request.fileId.toString()); counts.set(n, (counts.get(n) || 0) + 1);
    if (n === 1 && counts.get(n) === 1) throw Error('ECONNRESET');
    received.set(n, request.bytes); return true;
  }), { ...file, workers: 3, wait: async () => {}, onProgress: n => progress.push(n) });
  assert.equal(ids.size, 1); assert.equal(counts.get(1), 2);
  for (const [n, count] of counts) if (n !== 1) assert.equal(count, 1);
  assert.deepEqual(Buffer.concat([...received].sort((a,b) => a[0]-b[0]).map(x => x[1])), file.bytes);
  assert.equal(result.md5Checksum, crypto.createHash('md5').update(file.bytes).digest('hex'));
  assert.equal(progress.at(-1), 1); assert.ok(progress.every((n,i) => i === 0 || n >= progress[i-1]));
});
test('continuous workers fill vacancies without waiting for a slow batch peer', async t => {
  const file = await source(t, PART * 5);
  let unblock; const gate = new Promise(resolve => { unblock = resolve; });
  const started = [];
  await uploadTelegramParts(client(async request => {
    started.push(request.filePart);
    if (request.filePart === 0) await gate;
    if (request.filePart === 3) unblock();
    return true;
  }), { ...file, workers: 2 });
  assert.deepEqual(started, [0,1,2,3,4]);
});
test('permanent errors fail without retrying; a negative acknowledgement is never success', async t => {
  const file = await source(t, 100);
  let count = 0;
  await assert.rejects(uploadTelegramParts(client(async () => { count++; throw Error('AUTH_KEY_UNREGISTERED'); }), file), /AUTH_KEY/);
  assert.equal(count, 1);
  count = 0;
  await assert.rejects(uploadTelegramParts(client(async () => { count++; return false; }), { ...file, wait: async () => {} }), /NOT_ACKNOWLEDGED/);
  assert.equal(count, 5);
});
test('large files use big-part RPCs and do not exceed configured parallel memory window', async t => {
  const file = await source(t, 10 * 1024 * 1024 + 1);
  let active = 0, peak = 0;
  const result = await uploadTelegramParts(client(async request => {
    assert.equal(request.className, 'upload.SaveBigFilePart');
    assert.equal(request.fileTotalParts, 21); assert.ok(request.bytes.length <= PART);
    peak = Math.max(peak, ++active); await new Promise(resolve => setImmediate(resolve)); active--; return true;
  }), { ...file, workers: 3 });
  assert.equal(result.className, 'InputFileBig'); assert.ok(peak <= 3); assert.equal(active, 0);
});
test('source size mismatch cannot upload truncated or unrelated bytes', async t => {
  const file = await source(t, 100);
  await assert.rejects(uploadTelegramParts(client(async () => { throw Error('must not send'); }), { ...file, fileSize: 200 }), /SIZE_CHANGED/);
});
