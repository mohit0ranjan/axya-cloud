const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const moduleExports = {};
const code = ts.transpileModule(fs.readFileSync('src/utils/filePages.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports:moduleExports,Set,String,Math,encodeURIComponent});

test('page query covers search, folder, type and stable offset',()=>{
  const url=moduleExports.filePageUrl({folderId:'folder 1',sortKey:'file_name_ASC',query:'résumé & notes',type:'docs',offset:560});
  assert.equal(url,'/files?sort=file_name&order=ASC&limit=80&offset=560&folder_id=folder%201&q=r%C3%A9sum%C3%A9%20%26%20notes&type=docs');
});
test('a 600-file folder can append every server page without duplicates',()=>{
  let rows=[];
  for(let offset=0;offset<600;offset+=80){
    const page=Array.from({length:Math.min(80,600-offset)},(_,i)=>({id:String(offset+i)}));
    rows=moduleExports.appendUniqueFiles(rows,page);
  }
  rows=moduleExports.appendUniqueFiles(rows,[{id:'599'},{id:'new'}]);
  assert.equal(rows.length,601); assert.equal(rows[599].id,'599'); assert.equal(rows[600].id,'new');
});
