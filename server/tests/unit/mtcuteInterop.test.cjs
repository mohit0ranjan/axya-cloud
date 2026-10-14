const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
test('existing GramJS authorization round-trips through mtcute without exposing or rewriting account keys',async()=>{
 const {convertFromGramjsSession,convertToGramjsSession}=await import('@mtcute/convert');
 const {StringSession}=require('telegram/sessions');const {AuthKey}=require('telegram/crypto/AuthKey');
 const session=new StringSession('');session.setDC(2,'149.154.167.51',443);
 const auth=new AuthKey();await auth.setKey(crypto.randomBytes(256));session.authKey=auth;
 const original=session.save(),converted=convertFromGramjsSession(original);
 assert.equal(converted.primaryDcs.main.id,2);assert.equal(convertToGramjsSession(converted),original);
});
test('mtcute temporary handles preserve the Telegram ID, type and part count for SendMedia',()=>{
 const {toGramjsInputFile}=require('../../dist/services/storage/mtcute-upload');
 const big=toGramjsInputFile({_: 'inputFileBig',id:{toString:()=>'-9007199254740993'},parts:21,name:'large.bin'});
 assert.equal(big.id.toString(),'-9007199254740993');assert.equal(big.className,'InputFileBig');assert.equal(big.parts,21);
 const small=toGramjsInputFile({_: 'inputFile',id:{toString:()=>'123'},parts:1,name:'a',md5Checksum:'hash'});assert.equal(small.md5Checksum,'hash');
 assert.throws(()=>toGramjsInputFile({_: 'bogus',id:1,parts:1,name:'a'}),/INVALID_FILE_HANDLE/);
});
