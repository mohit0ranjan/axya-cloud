const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function load(file, stubs) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, require: name => {
      if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`);
      return stubs[name];
    },
    process: { env: { NODE_ENV: 'production', UPLOAD_STORAGE_DIR: path.resolve('staging') } },
    setInterval, Date,
  });
  return exports;
}

test('cleanup only removes a UUID upload directory inside the staging root', () => {
  const root = path.resolve('staging');
  const removed = [];
  const temp = load('src/controllers/upload/upload.temp.ts', {
    fs: {
      constants: fs.constants, mkdirSync() {}, accessSync() {}, existsSync: () => true,
      statSync: () => ({ isDirectory: () => true }),
      rmSync: target => removed.push(target), unlinkSync: target => removed.push(target),
    },
    path, os: require('node:os'), '../../config/db': {}, '../../utils/logger': { logger: {} },
    '../../services/upload-job-queue.service': {}, './upload.helpers': {},
    './upload.types': { UPLOAD_TMP_ROOT: root }, './upload.finalizer': {}, './upload.queue': {},
  });
  const id = '9ccfb1fa-0a57-4c31-a3bd-a304f50c8db7';
  temp.cleanupSessionTempFile(path.join(root + '-other', id));
  temp.cleanupSessionTempFile(root);
  temp.cleanupSessionTempFile(path.join(root, '..', id));
  assert.equal(removed.length, 0);
  temp.cleanupSessionTempFile(path.join(root, id) + '.assembled');
  assert.deepEqual(removed, [path.join(root, id), path.join(root, id) + '.assembled']);
});

test('missing acknowledged chunks are removed so resume requests their bytes again', async () => {
  const root = path.resolve('staging');
  const queries = [];
  const session = {
    upload_id: '9ccfb1fa-0a57-4c31-a3bd-a304f50c8db7',
    temp_file_path: path.join(root, '9ccfb1fa-0a57-4c31-a3bd-a304f50c8db7'),
    status: 'uploading', uploaded_chunks: [0, 1], received_bytes: 10,
  };
  const fakePool = { query: async (sql, args) => {
    queries.push({ sql, args });
    if (sql.includes('SELECT chunk_index')) return { rows: [{ chunk_index: 0, chunk_size_bytes: 5 }, { chunk_index: 1, chunk_size_bytes: 5 }] };
    if (sql.includes('COUNT(*)::int')) return { rows: [{ uploaded_count: 1, uploaded_bytes: 5, uploaded_chunks: [0] }] };
    return { rows: [] };
  } };
  const api = load('src/controllers/upload/upload.session.ts', {
    fs: { promises: { stat: async target => {
      if (target.endsWith('chunk_1.tmp')) throw new Error('missing');
      return { isFile: () => true, size: 5 };
    } } },
    path, '../../config/db': fakePool, '../../utils/formatters': {},
    './upload.helpers': { toInt: Number, parseUploadedChunks: value => value },
    './upload.capacity': {}, './upload.queue': {}, './upload.resume': {},
    './upload.types': { UPLOAD_TMP_ROOT: root },
  });
  assert.equal(await api.reconcileStoredChunks(session), 1);
  const deletion = queries.find(item => item.sql.includes('DELETE FROM upload_session_chunks'));
  assert.deepEqual(Array.from(deletion.args[1]), [1]);
  assert.deepEqual(Array.from(session.uploaded_chunks), [0]);
  assert.equal(session.received_bytes, 5);
});
