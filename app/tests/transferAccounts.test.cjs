const test=require('node:test'); const assert=require('node:assert/strict'); const fs=require('node:fs'); const vm=require('node:vm');const ts=require('typescript');
test('Android transfer queues are isolated by account and cleared from memory on sign-out',async()=>{
 const storage=new Map(); const task=(id,name)=>({id,file:{uri:'file:///draft.m4a',name,size:10},status:'paused',retryCount:0,progress:0,bytesUploaded:0,createdAt:1,updatedAt:1,fingerprint:id});
 storage.set('@upload_queue_v3:alice',JSON.stringify([task('a','Alice private recording')]));storage.set('@upload_queue_v3:bob',JSON.stringify([task('b','Bob document')]));
 const exports={};const stubs={
  'react-native':{Platform:{OS:'web'},AppState:{currentState:'active',addEventListener:()=>({remove(){}})}},
  '@react-native-async-storage/async-storage':{getItem:async key=>storage.get(key)||null,setItem:async(key,value)=>{storage.set(key,value);}},
  '../utils/fileSafety':{sanitizeFileName:name=>name,normalizeUploadFile:file=>file},
  './serverReadiness':{serverReadiness:{subscribe:()=>()=>{},getSnapshot:()=>({phase:'ready'})}},
  '../utils/preferences':{getNotificationsEnabled:async()=>false},
  './apiClient':{get:async()=>({data:{sessions:[]}})},
  'buffer':require('node:buffer'),
 };
 const code=ts.transpileModule(fs.readFileSync('src/services/UploadManager.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:name=>stubs[name]||{},console,Date,Map,Set,AbortController,setTimeout:()=>1,clearTimeout(){}});
 const manager=exports.uploadManager;
 await manager.bindOwner('alice');assert.equal(manager.tasks.length,1);assert.equal(manager.tasks[0].id,'a');
 await manager.bindOwner('bob');assert.equal(manager.tasks.length,1);assert.equal(manager.tasks[0].id,'b');
 await manager.bindOwner(null);assert.equal(manager.tasks.length,0);
 assert.equal(JSON.parse(storage.get('@upload_queue_v3:alice'))[0].id,'a');
 assert.equal(JSON.parse(storage.get('@upload_queue_v3:bob'))[0].id,'b');
});
