const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function manager(fetchImpl=async()=>{throw Error('Unexpected fetch')}){
 const exports={},saved=[];const stubs={'react-native':{Platform:{OS:'web'}},'../utils/preferences':{getNotificationsEnabled:async()=>false},'../utils/fileSafety':{buildApiFileUrl:(_base,id)=>'http://local/files/'+id+'/download'},'./apiClient':{API_BASE:'http://local'}};
 const code=ts.transpileModule(fs.readFileSync('src/services/DownloadManager.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:n=>stubs[n]||{},console,Date,Map,AbortController,Blob,fetch:fetchImpl,URL:{createObjectURL:()=> 'blob:download',revokeObjectURL(){}},document:{body:{appendChild(){}},createElement:()=>({click(){saved.push(this.download)},remove(){}})},window:{setTimeout:()=>1},setTimeout:()=>1,clearTimeout(){}});
 const m=exports.downloadManager;m.notifyListeners=()=>{};return {m,saved};
}
test('browser download authenticates its handoff and preserves original filename',async()=>{
 let auth;const {m,saved}=manager(async(_url,options)=>{auth=options.headers.Authorization;return new Response('hello',{headers:{'content-length':'5'}})});
 const t={id:'one',fileId:'one',fileName:'दस्तावेज़.txt',status:'downloading',progress:0};await m.performDownload(t,'token');assert.equal(auth,'Bearer token');assert.deepEqual(saved,['दस्तावेज़.txt']);assert.equal(t.browserHandoff,true);
});
test('browser does not report a failed or incomplete response as a saved file',async()=>{
 for(const response of [new Response('denied',{status:401}),new Response('short',{headers:{'content-length':'9'}})]){
  const {m,saved}=manager(async()=>response);const t={id:'one',fileId:'one',fileName:'photo.png',status:'downloading',progress:0};
  await assert.rejects(m.performDownload(t,'token'));assert.deepEqual(saved,[]);assert.notEqual(t.browserHandoff,true);
 }
});
test('cancelling a worker before it resolves cannot report completion',async()=>{
 const {m}=manager();const t={id:'one',fileId:'one',fileName:'file.txt',status:'queued',progress:0};m.tasks=[t];m.credentials.set(t.id,'token');m.performDownload=async()=>m.cancel(t.id);await m.processQueue();assert.equal(t.status,'cancelled');assert.equal(t.progress,0);
});
test('each queued download uses its own credential',async()=>{
 const {m}=manager();const tokens=[];m.tasks=['one','two'].map(id=>({id,fileId:id,fileName:id,status:'queued',progress:0}));m.credentials.set('one','first');m.credentials.set('two','second');m.performDownload=async(_task,token)=>tokens.push(token);await m.processQueue();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(tokens,['first','second']);
});
test('account switch cancels old downloads and clears visible history',()=>{
 const {m}=manager();m.bindOwner('first');const t={id:'one',status:'downloading',progress:50};m.tasks=[t];let aborted=false;m.webControllers.set(t.id,{abort(){aborted=true}});m.bindOwner('second');assert.equal(t.status,'cancelled');assert.equal(aborted,true);assert.equal(m.tasks.length,0);
});
