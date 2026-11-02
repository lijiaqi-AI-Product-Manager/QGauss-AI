/** Loopback-only synthetic Coze counterpart. Never use provider credentials in this fixture. */
import {verify,createHash} from 'node:crypto';
const stats={requests:[],uploads:[],tokens:0,cancels:[],connections:0},controls=new Map(),tokens=new Map();let seq=0;
const json=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
export async function cozeUpstreamFixture(req,res){
 const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/agents-fixture/'))return false;
 if(url.pathname==='/agents-fixture/stats'){json(res,stats);return true;}
 const chunks=[];for await(const chunk of req)chunks.push(chunk);const buffer=Buffer.concat(chunks);let body={};if(String(req.headers['content-type']).includes('application/json'))try{body=JSON.parse(buffer.toString());}catch{json(res,{code:400},400);return true;}
 if(url.pathname==='/agents-fixture/control'){controls.set(body.mode,{...controls.get(body.mode),...body});json(res,{ok:true});return true;}
 const match=/^\/agents-fixture\/([a-z-]+)(\/.*)$/.exec(url.pathname);if(!match){json(res,{code:404},404);return true;}const[,mode,path]=match,control=controls.get(mode)||{};
 stats.requests.push({mode,path,method:req.method,query:Object.fromEntries(url.searchParams),...(path.includes('files/upload')?{}:{body})});
 if(path==='/api/permission/oauth2/token'){
   const jwt=String(req.headers.authorization||'').replace(/^Bearer /,''),parts=jwt.split('.');let valid=false;try{const header=JSON.parse(Buffer.from(parts[0],'base64url')),claims=JSON.parse(Buffer.from(parts[1],'base64url'));valid=header.alg==='RS256'&&header.kid==='fixture-fingerprint'&&claims.iss==='fixture-app'&&claims.aud===req.headers.host&&claims.exp-claims.iat===300&&Math.abs(claims.iat-Date.now()/1000)<60&&verify('RSA-SHA256',Buffer.from(parts.slice(0,2).join('.')),control.publicKey,Buffer.from(parts[2],'base64url'))&&body.grant_type==='urn:ietf:params:oauth:grant-type:jwt-bearer';}catch{}if(!valid){json(res,{code:401},401);return true;}stats.tokens++;const token='synthetic-oauth-'+(++seq);tokens.set(token,mode);json(res,{access_token:token,expires_in:Math.floor(Date.now()/1000)+900,token_type:'Bearer'});return true;
 }
 const token=String(req.headers.authorization||'').replace(/^Bearer /,'');if(!token.startsWith('qgauss-synthetic-agent-')&&tokens.get(token)!==mode){json(res,{code:401},401);return true;}
 if(path==='/v1/workspaces'){json(res,{code:0,data:{workspaces:[{id:'42',name:'QGauss 合成空间'}],total_count:1}});return true;}
 if(path==='/v1/space/published_bots_list'){json(res,{code:0,data:{total:2,space_bots:[{bot_id:'123',bot_name:'行动规划搭档',description:'本地合成搭档'},{bot_id:'124',bot_name:'资料整理搭档',description:'本地合成搭档'}]}});return true;}
 if(/^\/v1\/bots\/\d+$/.test(path)){const id=path.split('/').at(-1);if(id==='999'){json(res,{code:403},403);return true;}json(res,{code:0,data:{bot_id:id,name:id==='123'?'行动规划搭档':'资料整理搭档',description:'本地合成验收搭档',onboarding_info:{prologue:'你好，一起完成下一步。',suggested_questions:['先从哪里开始？']},model_info:{model_name:'synthetic-model'},plugin_info_list:[{name:'资料查找',description:'合成工具'}],workflow_info_list:[{name:'整理步骤',description:'合成工作流'}],prompt_info:{prompt:'private upstream system'},variables:[{keyword:'private variable'}]}});return true;}
 if(path==='/v1/files/upload'){if(mode==='upload-fail'){json(res,{code:500},500);return true;}const contentType=String(req.headers['content-type']);if(!contentType.includes('multipart/form-data')||!buffer.toString().includes('name="file"')){json(res,{code:400},400);return true;}stats.uploads.push({mode,bytes:buffer.length,sha256:createHash('sha256').update(buffer).digest('hex'),hasSyntheticText:buffer.toString().includes('QGauss synthetic attachment')});json(res,{code:0,data:{id:'file_'+(++seq)}});return true;}
 if(path==='/v3/chat/cancel'){stats.cancels.push({mode,...body});if(mode==='cancel-fail'&&!control.allowCancel){json(res,{code:503},503);return true;}json(res,{code:0,data:{id:body.chat_id,conversation_id:body.conversation_id,status:'canceled'}});return true;}
 if(path!=='/v3/chat'){json(res,{code:404},404);return true;}
 if(mode==='http-error'){json(res,{code:500},500);return true;}
 const chatId='chat_'+(++seq),conversationId=url.searchParams.get('conversation_id')||'conv_'+(++seq),chat={id:chatId,conversation_id:conversationId,bot_id:body.bot_id,status:'in_progress'},message={id:'msg_'+(++seq),chat_id:chatId,conversation_id:conversationId,bot_id:body.bot_id,role:'assistant',type:'answer',content_type:'text'};
 res.writeHead(200,{'Content-Type':'text/event-stream'});stats.connections++;let ended=false;res.once('close',()=>{ended=true;stats.connections--;});const send=(event,data)=>{if(!ended)res.write('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n');};send('conversation.chat.created',chat);await pause(25);
 if(mode==='requires-action'){send('conversation.chat.requires_action',{...chat,required_action:{type:'submit_tool_outputs'}});res.end();return true;}
 if(mode==='no-answer'){send('conversation.chat.completed',{...chat,status:'completed'});res.end();return true;}
 const text='这是已完成的合成协作结果。';send('conversation.message.delta',{...message,content:mode==='mismatch'?'不一致的开头':text.slice(0,5)});
 if(['hold','cancel-fail'].includes(mode)){const timer=setInterval(()=>{if(!ended)res.write(': synthetic heartbeat\n\n');},1000);res.once('close',()=>clearInterval(timer));return true;}
 if(mode==='truncated'){res.end();return true;}
 for(const type of ['function_call','tool_response'])send('conversation.message.completed',{...message,id:'tool_'+seq,type,content:JSON.stringify({workflow_id:'wf_fixture',workflow_name:'整理下一步',arguments:'private argument',output:'private tool output'})});
 send('conversation.message.completed',{...message,content:text});send('conversation.message.completed',{...message,id:'follow_'+seq,type:'follow_up',content:'接下来如何行动？'});send('conversation.chat.completed',{...chat,status:'completed',usage:{input_count:7,output_count:5}});res.end();return true;
}
