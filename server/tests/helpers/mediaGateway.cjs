// Real HTTP/controller tests with synthetic Telegram bytes; never reads production credentials or DB.
const fs=require('node:fs'), path=require('node:path'), vm=require('node:vm'), {createRequire}=require('node:module');
const express=require('express');
function load(file,stubs) {
    const filename=path.resolve(__dirname,'../../dist',file), exports={}, requireActual=createRequire(filename);
    vm.runInNewContext(fs.readFileSync(filename,'utf8'), {exports,require:name=>name in stubs ? stubs[name] : requireActual(name),Buffer,process,console,setTimeout,clearTimeout,setInterval,AbortController,URL}, {filename});
    return exports;
}
exports.createMediaGateway=(bytes,options={})=>{
    const counters={fullDownloads:0,reads:0,resolutions:0,closed:0};
    const file={telegram_chat_id:'fixture-chat',telegram_message_id:'101',file_size:bytes.length,file_name:'fixture.mp4',mime_type:'video/mp4'};
    const pool={query:async(sql,args)=>{
        if(sql.includes('FROM users')) return {rows:args[0]==='fixture-owner' ? [{id:'fixture-owner',phone:'',session_string:'fixture-session'}] : []};
        return {rows:args[0]==='missing' || args[1]!=='fixture-owner' ? [] : [{...file}]};
    }};
    const client={getMessages:async()=>{counters.resolutions++; if(options.unavailable) throw Error('Synthetic network failure'); return [{media:{document:{}}}];},downloadMedia:async()=>{counters.fullDownloads++; throw Error('Full download forbidden in playback');}};
    const telegram={getDynamicClient:async()=>client,iterFileDownload:async function*(_,__,offset,limit){
        try {for(let i=offset;i<Math.min(bytes.length,offset+limit);i+=1024) {counters.reads++;if(options.delay)await new Promise(r=>setTimeout(r,options.delay));yield bytes.subarray(i,Math.min(i+1024,offset+limit,bytes.length));}}
        finally{counters.closed++;}
    }};
    const controllers=load('controllers/file.controller.js',{
        '../config/db':pool,'../services/telegram.service':telegram,'../utils/logger':{logger:{error(){}}},
        '../utils/telegramErrors':{},'../utils/formatters':{},'../services/cache.service':{},
    });
    const middleware=load('middlewares/media.middleware.js',{'../config/db':pool,'../utils/sessionEncryption':{decryptSession:value=>value}});
    const app=express();app.use(require('cors')({origin:true,exposedHeaders:['Content-Range','Accept-Ranges']}));app.use(express.json());
    app.get('/health',(_,res)=>res.json({success:true}));
    const fixtureAuth=(req,res,next)=>{if(req.headers.authorization!=='Bearer video-test-only')return res.sendStatus(401);req.user={id:'fixture-owner',phone:'',sessionString:'fixture-session'};next();};
    app.post('/files/:id/playback-ticket',fixtureAuth,controllers.createPlaybackTicket);
    app.get('/files/media/:id',middleware.requireMediaTicket,controllers.streamFile);
    app.get('/files/:id/stream',fixtureAuth,controllers.streamFile);
    app.get('/files/:id/stream/status',fixtureAuth,controllers.streamFileStatus);
    return {app,counters,file};
};
