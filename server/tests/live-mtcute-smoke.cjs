// Opt-in: creates one diagnostic Saved Messages document and removes it after
// verifying every downloaded byte. Never prints sessions, tokens or API hashes.
require('dotenv').config({quiet:true});
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {Api}=require('telegram');
const {getDynamicClient}=require('../dist/services/telegram.service');
const {uploadWithMtcute}=require('../dist/services/storage/mtcute-upload');
const pool=require('../dist/config/db').default;
(async()=>{
 if(process.env.AXYA_RUN_LIVE_UPLOAD!=='1')throw Error('Set AXYA_RUN_LIVE_UPLOAD=1 to run this scoped Telegram smoke test');
 let dir,message,client;
 try{
  const owner=(await pool.query("SELECT id,session_string FROM users WHERE phone NOT LIKE 'test:%' AND session_string IS NOT NULL ORDER BY created_at LIMIT 1")).rows[0];
  assert.ok(owner,'No signed-in Telegram account');client=await getDynamicClient(owner.session_string);
  const bytes=crypto.randomBytes(12*1024*1024+19),name='Axya transport diagnostic.bin';
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'axya-mtcute-'));const source=path.join(dir,name);await fs.writeFile(source,bytes);
  const started=Date.now();
  const handle=await uploadWithMtcute({ownerSessionString:owner.session_string,requestedChatId:'me',filePath:source,fileName:name,fileSize:bytes.length,mimeType:'application/octet-stream'});
  message=await client.sendFile('me',{file:handle,forceDocument:true,caption:'Axya transport diagnostic — temporary verification document'});
  assert.ok(message.document);assert.equal(Number(message.document.size),bytes.length);
  const received=await client.downloadMedia(message,{});
  assert.ok(Buffer.isBuffer(received));assert.equal(crypto.createHash('sha256').update(received).digest('hex'),crypto.createHash('sha256').update(bytes).digest('hex'));
  console.log(JSON.stringify({result:'pass',bytes:bytes.length,elapsedMs:Date.now()-started,checks:['mtcute upload','GramJS SendMedia interoperability','exact downloaded SHA256'],host:'local machine; not a Render or phone speed benchmark'}));
 }finally{
  if(message)await client.deleteMessages('me',[message.id],{revoke:true});
  if(client)await client.disconnect();if(dir)await fs.rm(dir,{recursive:true,force:true});await pool.end();
 }
})().then(()=>process.exit(0)).catch(error=>{
 let detail=String(error?.message||'unknown failure').replace(/[A-Za-z0-9+/=_-]{40,}/g,'[redacted]');
 for(const [key,value] of Object.entries(process.env))if(/SECRET|HASH|KEY|SESSION|DATABASE/.test(key)&&value)detail=detail.split(value).join('[redacted]');
 console.error('Scoped Telegram smoke test failed: '+detail.slice(0,300));process.exit(1);
});
