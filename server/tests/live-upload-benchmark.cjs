require('dotenv').config({quiet:true});
const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const pool=require('../dist/config/db').default;
const {getDynamicClient}=require('../dist/services/telegram.service');
const {CustomFile}=require('telegram/client/uploads');
const {uploadWithMtcute}=require('../dist/services/storage/mtcute-upload');
(async()=>{
 if(process.env.AXYA_RUN_LIVE_UPLOAD!=='1')throw Error('Live benchmark requires explicit opt-in');
 let dir,client;
 try{
  const owner=(await pool.query("SELECT session_string FROM users WHERE phone NOT LIKE 'test:%' AND session_string IS NOT NULL ORDER BY created_at LIMIT 1")).rows[0];
  if(!owner)throw Error('No account available');client=await getDynamicClient(owner.session_string);
  dir=await fs.mkdtemp(path.join(os.tmpdir(),'axya-benchmark-'));const filePath=path.join(dir,'benchmark.bin');const fileSize=12*1024*1024+19;
  await fs.writeFile(filePath,crypto.randomBytes(fileSize));
  const rows=[];
  // Alternate order; no messages are published. Temporary parts expire on Telegram.
  for(const transport of ['gramjs-original','mtcute','mtcute','gramjs-original']){
   const start=Date.now();
   if(transport==='mtcute')await uploadWithMtcute({ownerSessionString:owner.session_string,requestedChatId:'me',filePath,fileName:'benchmark.bin',fileSize,mimeType:'application/octet-stream'});
   else await client.uploadFile({file:new CustomFile('benchmark.bin',fileSize,filePath),workers:4});
   rows.push({transport,bytes:fileSize,elapsedMs:Date.now()-start});
  }
  console.log(JSON.stringify({host:'local Windows machine, same file/account, sequential samples; not Render or Android',results:rows}));
 }finally{if(client)await client.disconnect();if(dir)await fs.rm(dir,{recursive:true,force:true});await pool.end();}
})().then(()=>process.exit(0)).catch(e=>{console.error(String(e?.message||'Benchmark failed').replace(/[A-Za-z0-9+/=_-]{40,}/g,'[redacted]').slice(0,250));process.exit(1);});
