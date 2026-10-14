// Exercises the deployed authenticated contract without uploading user files.
require('dotenv').config({quiet:true});
const assert=require('node:assert/strict'),crypto=require('node:crypto'),jwt=require('jsonwebtoken');
const pool=require('../dist/config/db').default;
(async()=>{
 const origin='https://axya-cloud-zxjk.onrender.com';let reservation,owner;
 try{
  owner=(await pool.query("SELECT id FROM users WHERE phone NOT LIKE 'test:%' ORDER BY created_at LIMIT 1")).rows[0];assert.ok(owner);
  const token=jwt.sign({userId:owner.id},process.env.JWT_SECRET,{expiresIn:'10m'});
  async function call(url,body){const response=await fetch(origin+'/upload/'+url,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000)});return {status:response.status,body:await response.json()};}
  const config=await call('native-config');
  if(config.status!==200){console.log(JSON.stringify({state:'not_ready',nativeConfigStatus:config.status}));return;}
  assert.ok(config.body.apiId&&config.body.apiHash&&config.body.telegramUserId&&config.body.phone);
  const init=await call('direct/init',{clientKey:'diagnostic_'+crypto.randomUUID(),name:'Native transport handshake.txt',size:17,mime:'text/plain',folderId:null});
  assert.equal(init.status,200);reservation=init.body.id;assert.ok(reservation);
  const forged=await call('direct/'+reservation+'/complete',{completed:true,fileId:'forged'});
  assert.equal(forged.status,409);assert.equal(forged.body.code,'telegram_delivery_pending');
  const cancelled=await call('direct/'+reservation+'/cancel',{});assert.equal(cancelled.status,200);
  const after=await call('direct/'+reservation+'/complete',{});assert.equal(after.status,409);assert.equal(after.body.code,'upload_cancelled');
  console.log(JSON.stringify({state:'pass',checks:['authenticated native config','owned reservation','forged completion rejected','cancel persists and blocks completion']}));
 }finally{if(reservation&&owner)await pool.query('DELETE FROM direct_uploads WHERE id=$1 AND user_id=$2 AND file_id IS NULL',[reservation,owner.id]);await pool.end();}
})().catch(()=>{console.error('Native API contract check failed; no credentials printed.');process.exitCode=1});
