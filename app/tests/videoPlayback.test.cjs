const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const exportsForTest = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/videoPlayback.ts','utf8'), { compilerOptions: {module:ts.ModuleKind.CommonJS} }).outputText, { exports:exportsForTest, URL, encodeURIComponent, decodeURIComponent });
const { isLocalVideo, webPlaybackUrl, videoErrorMessage } = exportsForTest;
test('private web playback uses a scoped ticket and does not retain account tokens or stale revisions', () => {
    const url = new URL(webPlaybackUrl('https://api.example/files/file/stream?v=old&token=account#secret', 'file', 'scoped'));
    assert.equal(url.pathname, '/files/media/file'); assert.equal(url.search, '?ticket=scoped'); assert.equal(url.hash, '');
    assert.throws(()=>webPlaybackUrl('https://api.example/files/other/stream','file','scoped'));
    assert.throws(()=>webPlaybackUrl('javascript:alert(1)','file','scoped'));
});
test('offline sources bypass ticket preparation and codec errors have a download fallback', () => {
    for (const source of ['file:///video%20name.mp4','content://opaque%2Fid','blob:https://app/opaque','data:video/mp4;base64,AA']) assert.equal(isLocalVideo(source),true);
    assert.equal(isLocalVideo('https://api/files/file/stream'),false);
    assert.match(videoErrorMessage(4), /Download the original/); assert.match(videoErrorMessage(2), /connection/);
});
