const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');

function exporter(data, options = {}) {
  let offset = 0, closed = false, deleted = false, saved = Buffer.alloc(0), maxRead = 0;
  class File {
    constructor(uri) { this.uri = uri; }
    get size() { return this.uri === 'source' ? data.length : saved.length + (options.wrongSize ? 1 : 0); }
    open() { return { readBytes(length) { maxRead = Math.max(maxRead, length); const bytes = options.shortRead ? new Uint8Array(0) : data.subarray(offset, offset + length); offset += bytes.length; return bytes; }, close() { closed = true; } }; }
    write(bytes, { append } = {}) { saved = append ? Buffer.concat([saved, bytes]) : Buffer.from(bytes); }
    delete() { saved = Buffer.alloc(0); deleted = true; }
  }
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('src/services/exportDownloadedFile.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ File }), Uint8Array, Number, Promise, Error, setTimeout });
  return { copy: exports.exportDownloadedFile, result: () => ({ saved, closed, deleted, maxRead }) };
}

test('large export preserves bytes while limiting individual reads to 1 MB', async () => {
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 7, 137), ex = exporter(bytes), progress = [];
  await ex.copy('source', 'destination', () => {}, fraction => progress.push(fraction));
  assert.deepEqual(ex.result().saved, bytes); assert.equal(ex.result().maxRead, 1024 * 1024); assert.equal(ex.result().closed, true); assert.equal(progress.at(-1), 1);
});
test('cancellation removes partial exported file and closes the source', async () => {
  const ex = exporter(Buffer.alloc(2 * 1024 * 1024)); let cancelled = false;
  await assert.rejects(ex.copy('source', 'destination', () => { if (cancelled) throw Error('Cancelled'); }, () => { cancelled = true; }), /Cancelled/);
  assert.equal(ex.result().deleted, true); assert.equal(ex.result().closed, true);
});
test('short reads or provider size mismatch cannot report successful export', async () => {
  for (const options of [{ shortRead: true }, { wrongSize: true }]) {
    const ex = exporter(Buffer.alloc(9), options);
    await assert.rejects(ex.copy('source', 'destination', () => {}, () => {}));
    assert.equal(ex.result().deleted, true); assert.equal(ex.result().closed, true);
  }
});
