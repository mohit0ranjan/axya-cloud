const test=require('node:test'), assert=require('node:assert/strict');
process.env.JWT_SECRET='isolated-video-gateway-test';
const {createMediaGateway}=require('../helpers/mediaGateway.cjs');
const {mediaRevision,signMediaTicket}=require('../../dist/utils/mediaTicket');
async function gateway(t,options={}) {
    const bytes=Buffer.from(Array.from({length:14000},(_,i)=>i%251)), fixture=createMediaGateway(bytes,options);
    const server=await new Promise(resolve=>{const server=fixture.app.listen(0,'127.0.0.1',()=>resolve(server));});
    t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
    return {...fixture,bytes,url:`http://127.0.0.1:${server.address().port}`};
}
test('cold video serves exact full, bounded, arbitrary-offset and suffix ranges without a full download',async t=>{
    const g=await gateway(t), headers={Authorization:'Bearer video-test-only'};
    for(const [range,start,end,status] of [[undefined,0,13999,200],['bytes=4097-5001',4097,5001,206],['bytes=-19',13981,13999,206],['bytes=11000-',11000,13999,206]]) {
        const response=await fetch(`${g.url}/files/video-fixture/stream`,{headers:{...headers,...(range?{Range:range}:{})}});
        assert.equal(response.status,status);assert.equal(Number(response.headers.get('content-length')),end-start+1);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()),g.bytes.subarray(start,end+1));
        if(range)assert.equal(response.headers.get('content-range'),`bytes ${start}-${end}/14000`);
    }
    assert.equal(g.counters.fullDownloads,0);assert.equal(g.counters.closed,4);
});
test('HEAD, invalid ranges and missing files do not download Telegram bytes',async t=>{
    const g=await gateway(t), headers={Authorization:'Bearer video-test-only'};
    assert.equal((await fetch(`${g.url}/files/video-fixture/stream`,{headers,method:'HEAD'})).status,200);
    assert.equal((await fetch(`${g.url}/files/video-fixture/stream`,{headers:{...headers,Range:'bytes=14000-'}})).status,416);
    assert.equal((await fetch(`${g.url}/files/missing/stream`,{headers})).status,404);
    assert.equal(g.counters.resolutions,0);assert.equal(g.counters.reads,0);
});
test('browser tickets allow range playback but deny tampering, other files and replaced content',async t=>{
    const g=await gateway(t);
    const issued=await fetch(`${g.url}/files/video-fixture/playback-ticket`,{method:'POST',headers:{Authorization:'Bearer video-test-only'}});
    const {ticket}=await issued.json();assert.ok(ticket);
    const media=`${g.url}/files/media/video-fixture?ticket=${ticket}`;
    const response=await fetch(media,{headers:{Range:'bytes=0-7'}});
    assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),g.bytes.subarray(0,8));
    assert.equal((await fetch(media+'tampered')).status,401);
    assert.equal((await fetch(`${g.url}/files/media/another?ticket=${ticket}`)).status,401);
    g.file.telegram_message_id='102';assert.equal((await fetch(media)).status,401);
    const otherOwner=signMediaTicket('another-owner','video-fixture',mediaRevision('fixture-chat','102'));
    assert.equal((await fetch(`${g.url}/files/media/video-fixture?ticket=${otherOwner}`)).status,401);
});
test('Telegram failure returns a retryable error before sending video headers',async t=>{
    const g=await gateway(t,{unavailable:true});
    const response=await fetch(`${g.url}/files/video-fixture/stream`,{headers:{Authorization:'Bearer video-test-only'}});
    assert.equal(response.status,502);assert.equal((await response.json()).retryable,true);
});
test('verified complete caches serve seeking bytes without another Telegram request',async t=>{
    const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
    const g=await gateway(t),id=crypto.randomUUID();
    const cache=path.join(os.tmpdir(),'axya_streams',`${id}_${mediaRevision('fixture-chat','101')}.cache`);
    await fs.writeFile(cache,g.bytes);t.after(()=>fs.unlink(cache));
    const headers={Authorization:'Bearer video-test-only'};
    const response=await fetch(`${g.url}/files/${id}/stream`,{headers:{...headers,Range:'bytes=500-999'}});
    assert.equal(response.status,206);assert.deepEqual(Buffer.from(await response.arrayBuffer()),g.bytes.subarray(500,1000));
    const state=await (await fetch(`${g.url}/files/${id}/stream/status`,{headers})).json();
    assert.equal(state.cached,true);assert.equal(state.progress,100);assert.equal(g.counters.resolutions,0);
});
