const test = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const vm = require('node:vm'); const ts = require('typescript');
function controllerHarness(rows = []) {
  let cacheReads = 0; const queries = [];
  const pool = { query: async (sql, params) => { queries.push({ sql, params }); return { rows }; } };
  const exports = {};
  const stubs = {
    fs: { mkdirSync() {}, existsSync: () => true, statSync: () => ({ size: 64, mtimeMs: Date.now() }), createReadStream: () => { cacheReads++; throw new Error('Private cache was accessed'); } },
    '../config/db': pool,
    '../utils/formatters': {formatFileRow: row => row},
    '../utils/apiError': { sendApiError: (res, status, code, message) => res.status(status).json({ code, error: message }) },
    '../utils/logger': { logger: { error() {}, warn() {}, info() {} } },
  };
  const code = ts.transpileModule(fs.readFileSync('src/controllers/file.controller.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, { exports, require: name => name in stubs ? stubs[name] : ['path', 'os', 'crypto'].includes(name) ? require(name) : {}, process, Buffer, setTimeout, setInterval: () => 0 });
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, set() { return this; } };
  const req = { user: { id: 'owner', sessionString: 'session' }, params: { id: 'private-file' }, query: {}, body: {} };
  return { exports, req, res, queries, cacheReads: () => cacheReads };
}
test('thumbnail disk cache cannot bypass file ownership', async () => {
  const h = controllerHarness(); await h.exports.getThumbnail(h.req, h.res);
  assert.equal(h.res.code, 404); assert.equal(h.cacheReads(), 0);
  assert.match(h.queries[0].sql, /user_id = \$2 AND is_trashed = false/);
  assert.equal(h.queries[0].params[1], 'owner');
});
test('moving a file to an unavailable folder performs no update', async () => {
  const h = controllerHarness(); h.req.body = { folder_id: '11111111-1111-4111-8111-111111111111' };
  await h.exports.updateFile(h.req, h.res);
  assert.equal(h.res.code, 404); assert.equal(h.queries.length, 1); assert.match(h.queries[0].sql, /SELECT id FROM folders.*user_id/);
});
test('folder creation rejects a parent belonging to another user', async () => {
  const h = controllerHarness(); h.req.body = { name: 'Photos', parent_id: '11111111-1111-4111-8111-111111111111' };
  await h.exports.createFolder(h.req, h.res);
  assert.equal(h.res.code, 404); assert.equal(h.queries.length, 1); assert.match(h.queries[0].sql, /SELECT id FROM folders.*user_id/);
});

test('folder listing count uses an owned UUID parameter rather than an integer literal', async () => {
  const h = controllerHarness(); h.req.query = {folder_id: '11111111-1111-4111-8111-111111111111'};
  await h.exports.fetchFiles(h.req, h.res);
  assert.equal(h.res.code, 200);
  const count = h.queries.find(q => q.sql.includes('COUNT(*)'));
  assert.match(count.sql, /folder_id = \$2/);
  assert.equal(count.params[0], 'owner');
  assert.equal(count.params[1], h.req.query.folder_id);
});
