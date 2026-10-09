const test = require('node:test'), assert = require('node:assert/strict'), { Writable } = require('node:stream');
const { pipeMediaChunks } = require('../../dist/utils/pipeMedia');
test('slow clients receive exactly the requested bytes without reading ahead', async () => {
    let reads = 0, writes = 0; const bytes = [];
    async function* chunks() { for (let i=0;i<10;i++) { reads++; assert.ok(reads-writes<=1); yield Buffer.from([i,i]); } }
    const output = new Writable({ highWaterMark: 1, write(chunk, _, callback) { bytes.push(chunk); setTimeout(()=>{ writes++; callback(); }, 2); } });
    const sent = await pipeMediaChunks(chunks(), output, 5, new AbortController().signal);
    assert.equal(sent, 5); assert.equal(reads, 3); assert.deepEqual([...Buffer.concat(bytes)], [0,0,1,1,2]);
});
test('seek/disconnect cancels a blocked transfer and closes the upstream iterator', async () => {
    const abort = new AbortController(); let reads=0, closed=false;
    async function* chunks() { try { while (true) { reads++; yield Buffer.alloc(1024); } } finally { closed=true; } }
    const output = new Writable({ highWaterMark: 1, write(_,__,callback) { setTimeout(()=>{ abort.abort(); callback(); }, 5); } });
    await pipeMediaChunks(chunks(), output, 10240, abort.signal);
    assert.equal(reads, 1); assert.equal(closed, true); output.destroy();
});
test('truncated Telegram responses fail instead of reporting a complete video', async () => {
    async function* chunks() { yield Buffer.from('short'); }
    const output = new Writable({ write(_,__,cb) { cb(); } });
    await assert.rejects(pipeMediaChunks(chunks(), output, 10, new AbortController().signal), /ended before/);
    output.destroy();
});
