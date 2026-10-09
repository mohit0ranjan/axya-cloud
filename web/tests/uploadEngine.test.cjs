const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

const settle = async () => { for (let i = 0; i < 12; i++) await new Promise(resolve => setImmediate(resolve)); };
function harness(overrides = {}) {
  const patches = []; const timers = new Set(); const calls = { init: 0, complete: 0, chunk: 0 };
  let state = 'uploading';
  const uploadService = {
    initUpload: async () => { calls.init++; return { uploadId: 'session-1', totalChunks: 1, chunkSizeBytes: 5 * 1024 * 1024 }; },
    uploadChunk: async () => { calls.chunk++; return { success: true }; },
    completeUpload: async () => { calls.complete++; state = 'processing'; return { success: true }; },
    getUploadStatus: async () => ({ status: state, uploadedChunks: [0], receivedBytes: 3, totalChunks: 1 }),
    resumeUpload: async () => ({}), pauseUpload: async () => ({}), cancelUpload: async () => ({}), ...overrides,
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('lib/upload/uploadEngine.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: () => ({ uploadService }), crypto: webcrypto, performance, Blob, AbortController, setTimeout, clearTimeout, setInterval: callback => { timers.add(callback); return callback; }, clearInterval: callback => timers.delete(callback) });
  const engine = new exports.UploadEngine({ onPatch: (id, patch) => patches.push(patch) });
  const task = { id: 'task-1', name: 'note.txt', file: new File(['abc'], 'note.txt', { type: 'text/plain' }), size: 3 };
  return { engine, task, patches, calls, timers, setState: value => { state = value; }, tick: async () => { for (const callback of [...timers]) callback(); await settle(); } };
}

test('successful chunk transfer waits for Telegram confirmation', async () => {
  const h = harness(); h.engine.enqueue(h.task);
  for (let i = 0; i < 100 && !h.patches.some(patch => ['processing', 'failed'].includes(patch.status)); i++) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(h.calls.complete, 1, JSON.stringify(h.patches)); assert.ok(h.patches.some(patch => patch.status === 'processing'));
  assert.ok(!h.patches.some(patch => patch.status === 'completed'));
  h.setState('completed'); await h.tick();
  assert.equal(h.patches.at(-1).status, 'completed'); assert.equal(h.timers.size, 0);
});
test('recovering a completed server session does not create or resend the file', async () => {
  const h = harness(); h.setState('completed'); h.engine.enqueue({ ...h.task, uploadId: 'session-1' }); await settle();
  assert.equal(h.calls.init, 0); assert.equal(h.calls.chunk, 0); assert.equal(h.calls.complete, 0);
  assert.equal(h.patches.at(-1).status, 'completed');
});
test('recovering a processing session monitors it without uploading again', async () => {
  const h = harness(); h.setState('processing'); h.engine.enqueue({ ...h.task, uploadId: 'session-1' }); await settle();
  assert.equal(h.calls.chunk, 0); assert.equal(h.calls.init, 0); assert.equal(h.patches.at(-1).status, 'processing');
  h.setState('failed'); await h.tick(); assert.equal(h.patches.at(-1).status, 'failed'); assert.equal(h.timers.size, 0);
});
