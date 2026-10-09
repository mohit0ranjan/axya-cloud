const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, stubs) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{exports,require: name => { if (!(name in stubs)) throw new Error(`Unexpected dependency: ${name}`); return stubs[name]; },process:{memoryUsage:()=>({heapTotal:100,heapUsed:50,rss:100*1024*1024})},Date});
  return exports;
}
function capacity(available,total) {
  return load('src/controllers/upload/upload.capacity.ts', {
    fs:{mkdirSync(){},statfsSync:()=>({bsize:1,blocks:total,bavail:available})},
    '../../config/db':{}, './upload.helpers':{toInt:Number,clamp:(v,a,b)=>Math.min(b,Math.max(a,v))},
    './upload.types':{UPLOAD_TMP_ROOT:'test',RESERVED_DISK_BYTES:150*1024*1024,DISK_PAUSE_THRESHOLD_PERCENT:80,DISK_CRITICAL_THRESHOLD_PERCENT:92,SAFE_ACTIVE_UPLOADS_GLOBAL:3,SAFE_ACTIVE_UPLOADS_PER_USER:2,BURST_ACTIVE_UPLOADS_GLOBAL:5,BURST_ACTIVE_UPLOADS_PER_USER:3,getTmpUsageCache:()=>({at:Date.now(),bytes:0})}
  });
}
test('93% used volume with 15 GB free still admits uploads',()=>{
  const c=capacity(15e9,234e9).getAdaptiveConcurrencyLimits({activeGlobal:0,queuedGlobal:0});
  assert.equal(c.diskPauseNewUploads,false); assert.equal(c.diskCritical,false); assert.ok(c.globalLimit>0);
});
test('actual low disk space stops admission and critically low space stops chunks',()=>{
  const c=capacity(50e6,234e9).getAdaptiveConcurrencyLimits({activeGlobal:0,queuedGlobal:0});
  assert.equal(c.diskPauseNewUploads,true); assert.equal(c.diskCritical,true); assert.equal(c.globalLimit,0);
});
test('a healthy queued batch does not reduce transfer concurrency by itself',()=>{
  const limits=capacity(15e9,234e9).getAdaptiveConcurrencyLimits({activeGlobal:2,queuedGlobal:50});
  assert.equal(limits.perUserLimit,3);
  assert.equal(limits.globalLimit,5);
});
test('queue promotion does not query a fake UUID and enforces per-user capacity',async()=>{
  const calls=[];
  const client={query:async(sql,args)=>{calls.push({sql,args}); return {rows:sql.includes('try_advisory')?[{acquired:true}]:sql.includes('COUNT(*) FILTER')?[{active_global:0,queued_global:1}]:sql.includes('SELECT upload_id, user_id')?[{upload_id:'upload'}]:[]};},release(){}};
  const q=load('src/controllers/upload/upload.queue.ts',{
    '../../config/db':{connect:async()=>client},'./upload.helpers':{toInt:Number,logUploadStage(){}},
    './upload.capacity':{getCapacitySnapshot(){throw new Error('Sentinel UUID query');},getAdaptiveConcurrencyLimits:()=>({globalLimit:3,perUserLimit:2,diskPauseNewUploads:false,diskCritical:false})},
    './upload.types':{QUEUE_PROMOTION_LOCK_KEY:42,MAX_ACTIVE_SESSION_FETCH:50}
  });
  await q.promoteQueuedSessionsIfCapacity();
  const selection=calls.find(x=>x.sql.includes('SELECT upload_id, user_id'));
  assert.equal(selection.args[1],2); assert.match(selection.sql,/active.user_id = us.user_id/);
  assert.ok(calls.some(x=>x.sql.includes('UPDATE upload_sessions')));
  assert.ok(calls.some(x=>x.sql === 'COMMIT'));
});
