// Usage: node tests/video-browser-fixture.cjs <local MP4>. Loopback only; never connects to real Telegram/DB.
const fs=require('node:fs');
process.env.JWT_SECRET='isolated-browser-video-test-key';
const {createMediaGateway}=require('./helpers/mediaGateway.cjs');
if(!process.argv[2]) throw Error('Supply a local test MP4');
const {app,counters}=createMediaGateway(fs.readFileSync(process.argv[2]));
app.get('/test/metrics',(_,res)=>res.json(counters));
app.listen(3033,'127.0.0.1',()=>console.log('Isolated video gateway ready on 3033'));
