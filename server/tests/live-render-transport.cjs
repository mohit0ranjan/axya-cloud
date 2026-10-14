// Generated-data release gate against the actual Render upload/download path.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const pool=require('../dist/config/db').default;
const {getDynamicClient}=require('../dist/services/telegram.service');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let diagnosticStage='initialization';
(async()=>{
 if(process.env.AXYA_RUN_LIVE_UPLOAD!=='1')throw Error('Live upload requires opt-in');
 const origin='https://axya-cloud-zxjk.onrender.com';let owner,fileId,client,uploadId;
 try{
  owner=(await pool.query("SELECT id,session_string FROM users WHERE phone NOT LIKE 'test:%' ORDER BY created_at LIMIT 1")).rows[0];assert.ok(owner);
  const token=jwt.sign({userId:owner.id},process.env.JWT_SECRET,{expiresIn:'15m'}),headers={Authorization:'Bearer '+token};
  async function json(route,body){const response=await fetch(origin+route,{method:body?'POST':'GET',headers:{...headers,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(90000)});const data=await response.json();assert.ok(response.ok,route+': '+response.status+' '+(data.code||''));return data;}
  const bytes=crypto.randomBytes(12*1024*1024+19),sha256=crypto.createHash('sha256').update(bytes).digest('hex'),start=Date.now();
  let state=await json('/files/upload/init',{originalname:'Axya Render transport diagnostic.bin',size:bytes.length,mimetype:'application/octet-stream',telegram_chat_id:'me',chunk_size_bytes:1024*1024,client_upload_key:crypto.randomUUID()});
  console.log(JSON.stringify({stage:'initialized',status:state.status,chunkSize:state.chunkSizeBytes}));
  uploadId=state.uploadId;const deadline=Date.now()+240000;
  while(state.status==='queued'&&Date.now()<deadline){await json('/files/upload/heartbeat',{uploadId});await sleep(1500);state=await json('/files/upload/status/'+uploadId);}
  assert.equal(state.status,'uploading');const chunkSize=state.chunkSizeBytes||5*1024*1024;
  for(let offset=0,index=0;offset<bytes.length;offset+=chunkSize,index++){
   diagnosticStage='chunk '+index;
   const form=new FormData();form.append('uploadId',uploadId);form.append('chunkIndex',String(index));form.append('chunk',new Blob([bytes.subarray(offset,offset+chunkSize)]),'chunk.bin');
   const response=await fetch(origin+'/files/upload/chunk',{method:'POST',headers,body:form,signal:AbortSignal.timeout(90000)});assert.ok(response.ok,'Chunk rejected: '+response.status);
   console.log(JSON.stringify({stage:diagnosticStage,status:response.status,elapsedMs:Date.now()-start}));
  }
  diagnosticStage='finalization';
  await json('/files/upload/complete',{uploadId});
  while(Date.now()<deadline){state=await json('/files/upload/status/'+uploadId);if(['completed','failed','error','cancelled'].includes(state.status))break;await sleep(1500);}
  assert.equal(state.status,'completed');fileId=state.file.id;const uploadMs=Date.now()-start;
  diagnosticStage='download';
  const row=(await pool.query('SELECT * FROM files WHERE id=$1 AND user_id=$2',[fileId,owner.id])).rows[0];assert.equal(row.sha256_hash,sha256);
  const response=await fetch(origin+'/files/'+fileId+'/download',{headers,signal:AbortSignal.timeout(90000)});assert.equal(response.status,200);
  const downloaded=Buffer.from(await response.arrayBuffer());assert.equal(downloaded.length,bytes.length);assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'),sha256);
  console.log(JSON.stringify({result:'pass',host:'Render API',bytes:bytes.length,uploadAndCommitMs:uploadMs,totalWithDownloadMs:Date.now()-start,checks:['3-part HTTP staging','Telegram delivery','atomic metadata','stored SHA256','full downloaded SHA256']}));
 }finally{
  if(fileId&&owner){const row=(await pool.query('SELECT telegram_message_id,telegram_chat_id,file_name FROM files WHERE id=$1 AND user_id=$2',[fileId,owner.id])).rows[0];if(row?.file_name==='Axya Render transport diagnostic.bin'){
   client=await getDynamicClient(owner.session_string);await client.deleteMessages(row.telegram_chat_id,[Number(row.telegram_message_id)],{revoke:true});
   await pool.query('DELETE FROM files WHERE id=$1 AND user_id=$2',[fileId,owner.id]);
  }}
  if(client)await client.disconnect();await pool.end();
 }
})().then(()=>process.exit(0)).catch(e=>{console.error(diagnosticStage+': '+String(e?.message||'Render transport failed').replace(/[A-Za-z0-9+/=_-]{40,}/g,'[redacted]').slice(0,300));process.exit(1);});
