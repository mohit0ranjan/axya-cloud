const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function load(pool={},tg={}) {
 const exports={};
 const stubs={'../config/db':pool,'../services/telegram.service':{getDynamicClient:async()=>tg},'../utils/formatters':{formatFileRow:r=>r,extractTelegramNativeMeta:()=>({mediaMeta:{}})},'../services/cache.service':{cacheDelByPrefix(){}},'./upload/upload.types':{MAX_FILE_SIZE_BYTES:1073741824},'./upload/upload.helpers':{sanitizeUploadFileName:s=>s.replace(/[\\/]/g,'_')},'../utils/apiError':{sendApiError:(res,status,code)=>res.status(status).json({code})}};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/controllers/direct-upload.controller.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,{exports,require:n=>stubs[n]||require(n),Number,String,JSON});return exports;
}
const row={id:'16fb0f32-0b1c-4306-8d32-4bfbd5d83e61',file_name:'photo.jpg',total_bytes:15};
const marker='#axya_direct_'+row.id.replace(/-/g,'');
const message={document:{size:15,attributes:[{className:'DocumentAttributeFilename',fileName:'photo.jpg'}]},message:'[Axya] photo.jpg\n'+marker};
function res(){return {statusCode:200,status(n){this.statusCode=n;return this;},json(body){this.body=body;return this;}};}
test('direct delivery requires exact marker, filename and acknowledged document size',()=>{
 const api=load();assert.equal(api.verifyDirectDocument(message,row),true);
 for(const bad of [{...message,message:marker+'suffix'},{...message,document:{...message.document,size:14}},{...message,document:{...message.document,attributes:[]}}, {message:marker,photo:{}}])assert.equal(api.verifyDirectDocument(bad,row),false);
});
test('forged client completion pointers cannot publish a pending direct upload',async()=>{
 let queryArgs;const api=load({query:async(sql,args)=>{queryArgs=args;return {rows:[row]};}},{getMessages:async(chat)=>{assert.equal(chat,'me');return [];}});
 const output=res();await api.finishDirectUpload({params:{id:row.id},user:{id:'owner',sessionString:'private'},body:{fileId:'forged',completed:true}},output);
 assert.equal(output.statusCode,409);assert.equal(output.body.code,'telegram_delivery_pending');assert.deepEqual(Array.from(queryArgs),[row.id,'owner']);
});
test('direct init rejects invalid size and mismatched client-key payloads',async()=>{
 const api=load({query:async()=>({rows:[{...row,folder_id:null}],rowCount:1})});
 for(const size of [0,1073741825]) { const output=res();await api.initDirectUpload({body:{clientKey:'native_123',name:'photo.jpg',size,mime:'image/jpeg'},user:{id:'owner'}},output);assert.equal(output.statusCode,400); }
 const output=res();await api.initDirectUpload({body:{clientKey:'native_123',name:'other.jpg',size:15,mime:'image/jpeg'},user:{id:'owner'}},output);assert.equal(output.statusCode,409);
});
test('completion cannot resurrect a removed direct-upload file',async()=>{
 const api=load({query:async()=>({rows:[{...row,completed_at:'done',file_id:null}]})});const output=res();
 await api.finishDirectUpload({params:{id:row.id},user:{id:'owner'}},output);assert.equal(output.statusCode,410);
});
test('cancel and complete serialize on the same owned reservation; confirmed files survive cancellation',async()=>{
 for(const completed of [false,true]){
  const calls=[];let released=false;
  const db={query:async(sql,args)=>{calls.push(sql);if(sql.includes('FOR UPDATE')){assert.deepEqual(Array.from(args),[row.id,'owner']);return {rows:[{...row,completed_at:completed?'done':null}]};}return {rows:[]};},release(){released=true;}};
  const api=load({connect:async()=>db});const output=res();await api.cancelDirectUpload({params:{id:row.id},user:{id:'owner'}},output);
  assert.equal(output.body.completed,completed);assert.equal(calls.some(s=>s.includes('SET cancelled_at')),!completed);
  assert.ok(calls.includes('COMMIT'));assert.ok(released);
 }
});
