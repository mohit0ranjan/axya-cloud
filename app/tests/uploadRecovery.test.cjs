const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function manager(){const exports={};const stubs={'react-native':{Platform:{OS:'web'},AppState:{}},'@react-native-async-storage/async-storage':{setItem:async()=>{}},'../utils/fileSafety':{sanitizeFileName:n=>n,normalizeUploadFile:f=>({...f,type:f.mimeType})},'./serverReadiness':{serverReadiness:{subscribe:()=>()=>{}}},'../utils/preferences':{getNotificationsEnabled:async()=>false},'buffer':require('node:buffer')};const code=ts.transpileModule(fs.readFileSync('src/services/UploadManager.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(code,{exports,require:n=>stubs[n]||{},console,Date,Map,Set,AbortController,setTimeout:()=>1,setInterval:()=>1,clearTimeout(){},clearInterval(){}});const m=exports.uploadManager;m.notifyListeners=()=>{};m.scheduleQueuePump=()=>{};m.ownerId='owner';m.queueReady=true;return m;}
function task(){return {id:'one',file:{uri:'blob:source',name:'name.txt',size:10,mimeType:'text/plain'},status:'queued',retryCount:0,progress:0,bytesUploaded:0,createdAt:1,updatedAt:1};}
test('workers retain task identity and upload IDs while UI receives copies',()=>{const m=manager(),t=task();m.tasks=[t];m.updateTask(t.id,{uploadId:'remote',status:'uploading'});assert.equal(m.tasks[0],t);assert.equal(t.uploadId,'remote');const snapshot=m.snapshotTasks();assert.notEqual(snapshot[0],t);assert.notEqual(snapshot[0].file,t.file);m.updateTask(t.id,{status:'paused'});assert.equal(t.status,'paused');});
for(const stop of ['paused','cancelled'])for(const fallback of [false,true])test(`${stop} upload cannot report completed (${fallback?'fallback':'normal'} worker)`,async()=>{const m=manager(),t=task();m.tasks=[t];if(fallback)m.getRunnableWindowTaskIds=()=>new Set();m.performUpload=async()=>m.updateTask(t.id,{status:stop});await m.processQueue();assert.equal(t.status,stop);assert.notEqual(t.progress,100);assert.equal(m.inFlightTaskIds.size,0);});
test('upload normalization preserves provider handles and international names',()=>{const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/utils/fileSafety.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,console});const f=exports.normalizeUploadFile({uri:'content://provider/a%2Fb%2520c',name:'दस्तावेज़ café.pdf'});assert.equal(f.uri,'content://provider/a%2Fb%2520c');assert.equal(f.name,'दस्तावेज़ café.pdf');});

test('foreground return resumes background pauses but preserves a manual pause',()=>{const m=manager(),background={...task(),id:'background',status:'uploading'},manual={...task(),id:'manual',status:'paused'};m.tasks=[background,manual];m.pauseAllBackground();assert.equal(background.status,'paused');assert.equal(background.pausedForBackground,true);m.resumeAllBackground();assert.equal(background.status,'queued');assert.equal(manual.status,'paused');assert.equal(background.pausedForBackground,false);});
test('clearing finished transfers retains failed files and retry information',()=>{const m=manager(),failed={...task(),status:'failed',error:'connection lost',uploadId:'remote'};m.tasks=[failed];m.clearCompleted();assert.equal(m.tasks.length,1);assert.equal(m.tasks[0],failed);assert.equal(m.tasks[0].uploadId,'remote');});
test('source preparation cannot cross an account switch',async()=>{
 const m=manager(),t=task();m.tasks=[t];let release;
 m.sourceRetention.set(t.id,new Promise(resolve=>{release=resolve}));
 const result=m.performUpload(t);assert.ok(m.abortControllers.has(t.id));
 m.ownerId='another-owner';m.accountRevision++;release();
 await assert.rejects(result,/Cancelled/);assert.equal(t.uploadId,undefined);
});
test('rapid resume is not cancelled by the previous aborted worker',()=>{
 const m=manager(),t=task();m.tasks=[t];t.status='uploading';m.pause(t.id);m.resume(t.id);
 m.handleUploadError(t,Object.assign(new Error('Cancelled'),{name:'AbortError'}));
 assert.equal(t.status,'queued');assert.equal(t.retryCount,0);
});
test('late completion from an old account cannot mark a transfer completed',async()=>{
 const m=manager(),t=task();m.tasks=[t];m.performUpload=async()=>{m.ownerId='another-owner';m.accountRevision++;};
 await m.processQueue();assert.notEqual(t.status,'completed');assert.notEqual(t.progress,100);
});
test('offline events preserve manual pauses and resume only connectivity pauses',()=>{
 const m=manager(),t=task(),manual={...task(),id:'manual',status:'paused'};m.tasks=[t,manual];
 m.handleConnectivity({isConnected:false});m.handleConnectivity({isConnected:false});
 assert.equal(t.status,'paused');assert.equal(t.pausedForConnection,true);assert.equal(t.retryCount,0);
 assert.equal(manual.pausedForConnection,undefined);
 m.handleConnectivity({isConnected:true,isInternetReachable:true});
 assert.equal(t.status,'queued');assert.equal(t.pausedForConnection,false);assert.equal(manual.status,'paused');
});
test('cold launch resumes interrupted work without overriding a deliberate pause',async()=>{
 let pumps=0;
 const stored=[{...task(),id:'interrupted',status:'uploading'},
   {...task(),id:'background',status:'paused',pausedForBackground:true},
   {...task(),id:'manual',status:'paused',pausedForBackground:false}];
 // loadQueue uses the same persisted shape as the app's account-scoped queue.
 const exports={};const stubs={'react-native':{Platform:{OS:'web'},AppState:{}},
  '@react-native-async-storage/async-storage':{getItem:async key=>key.includes('queue')?JSON.stringify(stored):null,setItem:async()=>{}},
  '../utils/fileSafety':{sanitizeFileName:n=>n,normalizeUploadFile:f=>({...f,type:f.mimeType})},
  './serverReadiness':{serverReadiness:{subscribe:()=>()=>{}}},'../utils/preferences':{},'buffer':require('node:buffer')};
 const code=ts.transpileModule(fs.readFileSync('src/services/UploadManager.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>stubs[n]||{},console,Date,Map,Set,AbortController,setTimeout:()=>1,setInterval:()=>1,clearTimeout(){},clearInterval(){}});
 const restored=exports.uploadManager;restored.ownerId='owner';restored.queueReady=true;restored.notifyListeners=()=>{};restored.scheduleQueuePump=()=>{};restored.processQueue=async()=>{pumps++};
 await restored.loadQueue();
 assert.equal(restored.tasks.find(t=>t.id==='interrupted').status,'queued');
 assert.equal(restored.tasks.find(t=>t.id==='background').status,'queued');
 assert.equal(restored.tasks.find(t=>t.id==='manual').status,'paused');
 assert.ok(pumps>0);
});
