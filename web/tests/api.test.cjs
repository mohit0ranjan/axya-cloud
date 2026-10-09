const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
function harness(){const exports={};let timer,signal;const code=ts.transpileModule(fs.readFileSync('lib/api.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,require:()=>({API_URL:'https://api.invalid'}),AbortController,FormData,setTimeout:f=>{timer=f;return 1;},clearTimeout(){},fetch:async(url,init)=>{signal=init.signal;return {ok:true,json:async()=>({success:true})};}});
 return {api:exports.api,timer:()=>timer(),signal:()=>signal};}
test('API deadline still cancels when the caller supplies a signal',async()=>{const h=harness(),caller=new AbortController();await h.api('/test',{signal:caller.signal});h.timer();assert.equal(h.signal().aborted,true);assert.equal(caller.signal.aborted,false);});
test('an already cancelled caller is not sent as a live request',async()=>{const h=harness(),caller=new AbortController();caller.abort();await h.api('/test',{signal:caller.signal});assert.equal(h.signal().aborted,true);});
