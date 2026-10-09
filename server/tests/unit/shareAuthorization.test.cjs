const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){const exports={};let queries=0;const share={id:'share',slug:'slug',revoked_at:new Date(),allow_preview:false,allow_download:false};const stubs={
 '../config/db':{query:async(sql)=>{if(sql.includes("SELECT") && (sql.includes("share_links_v2") || sql.includes("share_access_sessions_v2"))) queries++;return sql.includes('share_access_sessions_v2')?{rows:[{id:'session'}],rowCount:1}:{rows:[share],rowCount:1}}},
 '../services/cache.service':{cacheGet:()=>({...share,revoked_at:null,allow_preview:true,allow_download:true}),cacheSet(){},cacheDelByPrefix(){}},
 '../services/share-v2/token.service':{verifyShareV2SessionToken:()=>({sid:'session',shareId:'share'}),hashSessionToken:()=> 'hash'},
 '../utils/apiError':{sendApiError:(res,status,code)=>res.status(status).json({code})},fs:{mkdirSync(){}},
 };
 const compiled=ts.transpileModule(fs.readFileSync('src/controllers/share-v2.controller.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(compiled+'\nexports.resolveForTest = resolvePublicSession; exports.slugForTest = getShareBySlug;', {exports,require:n=>stubs[n]||(['crypto','path','os','stream'].includes(n)?require(n):{}),process,Buffer,setTimeout,setInterval:()=>0});
 const res={code:200,status(code){this.code=code;return this},json(body){this.body=body;return this}};return{exports,res,queries:()=>queries};
}
test('revoked share rejects a valid session even when cache contains an older grant',async()=>{const h=harness();const result=await h.exports.resolveForTest({headers:{authorization:'Bearer session'},params:{slug:'slug'},query:{}},h.res);assert.equal(result,null);assert.equal(h.res.code,410);assert.equal(h.res.body.code,'share_revoked');assert.equal(h.queries(),2);});
test('opening a share reads current policy instead of a stale cached grant',async()=>{const h=harness();const share=await h.exports.slugForTest('slug');assert.ok(share.revoked_at);assert.equal(h.queries(),1);});
