const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
function cache() {
  const exports = {};
  const stubs = { 'react-native': { Platform: { OS: 'web' } }, './fileSafety': { sanitizeRemoteUri: value => value }, 'expo-file-system/legacy': {} };
  const source = ts.transpileModule(fs.readFileSync('src/utils/previewCache.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(source, { exports, require: name => stubs[name], Date, Map, Promise, encodeURIComponent });
  return exports;
}
test('same-size content replacement gets different thumbnail, download and stream URLs', () => {
  const c = cache(), old = c.buildPreviewMediaUrls('https://api.test', 'file', { revision: 'old' }), next = c.buildPreviewMediaUrls('https://api.test', 'file', { revision: 'new' });
  for (const key of ['thumbUrl', 'downloadUrl', 'streamUrl']) { assert.notEqual(old[key], next[key]); assert.match(next[key], /[?&]v=new/); }
});
test('preview warmup cannot reuse bytes from a different content revision', async () => {
  const c = cache();
  await c.warmPreviewAssetUri('https://api.test', 'file', 'token', 'download', { revision: 'old', mimeType: 'image/png' });
  assert.equal(c.getCachedPreviewAssetUri('https://api.test', 'file', 'download', { revision: 'new', mimeType: 'image/png' }), null);
  assert.match(c.resolvePreviewAssetUri('https://api.test', 'file', 'download', { revision: 'new' }), /v=new/);
});
