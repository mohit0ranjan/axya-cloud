const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),ts=require('typescript');
test('document range streaming supplies an explicit Telegram input location and yields exactly requested bytes',async()=>{
const exports={};class Location{constructor(values){Object.assign(this,values)}}class Cache{constructor(){}on(){}get(){}set(){}keys(){return []}}
const stubs={telegram:{Api:{InputDocumentFileLocation:Location}},'node-cache':Cache,'../utils/logger':{logger:{}},dotenv:{config(){}},'big-integer':require('big-integer')};
const code=ts.transpileModule(fs.readFileSync('src/services/telegram.service.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,esModuleInterop:true,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,require:n=>stubs[n]||{},process,Buffer,setInterval:()=>0});let options;const client={async *iterDownload(input){options=input;yield Buffer.from('abcdefgh');yield Buffer.from('ijklmnop')}};
const document={id:'document',accessHash:'hash',fileReference:Buffer.from('ref'),dcId:2,size:16};const pieces=[];for await(const chunk of exports.iterFileDownload(client,{media:{document}},3,5))pieces.push(chunk);
assert.ok(options.file instanceof Location);assert.equal(options.file.thumbSize,'');assert.equal(options.dcId,2);assert.equal(options.offset.toString(),'3');assert.equal(Buffer.concat(pieces).toString(),'abcde');
});
