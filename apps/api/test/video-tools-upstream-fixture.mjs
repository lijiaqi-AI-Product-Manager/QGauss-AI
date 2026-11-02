/** Local native queue contracts and real media only; never imported by the application. */
import {readFile} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
const files={normal:await readFile(new URL('./fixtures/qgauss-reference-video.mp4',import.meta.url)),upscaled:await readFile(new URL('./fixtures/qgauss-reference-upscaled.mp4',import.meta.url)),lipsync:await readFile(new URL('./fixtures/qgauss-reference-lipsync.mp4',import.meta.url))},jobs=new Map(),calls=[];
async function source(value){const url=new URL(value);if(url.hostname!=='127.0.0.1'||!/^\/api\/video\/input\//.test(url.pathname))throw Error('Local fixture refuses non-local inputs');const res=await fetch(url,{signal:AbortSignal.timeout(8000)}),bytes=Buffer.from(await res.arrayBuffer());return{url:value,status:res.status,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),mime:res.headers.get('content-type')};}
export async function videoToolsUpstream(req,res){
 const url=new URL(req.url,'http://'+req.headers.host);if(!url.pathname.startsWith('/film-fixture/'))return false;
 const reply=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
 if(url.pathname==='/film-fixture/stats'){reply(200,{calls,jobs:[...jobs.values()]});return true;}
 if(url.pathname.startsWith('/film-fixture/assets/')){const kind=url.pathname.split('/').pop()?.split('.')[0],buffer=files[kind]||Buffer.from('not an mp4');res.writeHead(200,{'Content-Type':'video/mp4','Content-Length':buffer.length});res.end(buffer);return true;}
 if(url.pathname.startsWith('/film-fixture/release/')){const job=jobs.get(url.pathname.split('/').pop());if(job)job.released=true;reply(200,{});return true;}
 if(req.method==='POST'){
  let raw='';for await(const chunk of req)raw+=chunk;const body=JSON.parse(raw||'{}'),fal=!url.pathname.includes('/ark/'),auth=req.headers.authorization;
  if(auth!==(fal?'Key ':'Bearer ')+'qg-video-tool-key'){reply(401,{error:'fixture-auth'});return true;}
  const expected=body.video_url?body.audio_url?'/film-fixture/fal-ai/sync-lipsync/v3':'/film-fixture/topaz/upscale/video/precision':'/film-fixture/ark/contents/generations/tasks';if(url.pathname!==expected){reply(404,{error:'wrong-native-path'});return true;}
  const urls=fal?[body.video_url,...(body.audio_url?[body.audio_url]:[])]:body.content.filter(x=>x.type!=='text').map(x=>x[x.type].url),inputs=[];
  for(const input of urls){const entry=await source(input);inputs.push(entry);if(entry.status!==200){reply(422,{error:'inaccessible-private-material'});return true;}}
  const prompt=body.content?.find(x=>x.type==='text')?.text||'',id=randomUUID(),job={id,fal,prompt,body,auth,inputs,polls:0,released:!prompt.includes('[hold]')&&body.model!=='Theia Fine Tune Detail'&&body.sync_mode!=='loop',canceled:false};jobs.set(id,job);calls.push({method:'POST',path:url.pathname,id});if(body.model==='Iris Low Quality')return true;reply(200,fal?{request_id:id,status:'IN_QUEUE',response_url:'https://untrusted.qgauss.test/ignore-this',status_url:'https://untrusted.qgauss.test/ignore-this'}:{id});return true;
 }
 const id=url.pathname.split('/').find(x=>jobs.has(x)),job=jobs.get(id);if(!job){reply(404,{error:'not-found'});return true;}
 if(req.headers.authorization!==(job.fal?'Key ':'Bearer ')+'qg-video-tool-key'){reply(401,{error:'wrong-pinned-authorization'});return true;}
 calls.push({method:req.method,path:url.pathname,id});const origin='http://'+req.headers.host;
 if(req.method==='PUT'&&url.pathname.endsWith('/cancel')){job.canceled=true;reply(202,{status:'CANCELLATION_REQUESTED'});return true;}
 if(req.method==='DELETE'){job.canceled=true;reply(200,{});return true;}
 job.polls++;
 if(job.fal){const root=job.body.audio_url?'/film-fixture/fal-ai/sync-lipsync':'/film-fixture/topaz/upscale';if(!url.pathname.startsWith(root+'/requests/'+id)){reply(404,{error:'wrong-observation-root'});return true;}
  if(url.pathname.endsWith('/status')){reply(200,{request_id:id,status:job.released?'COMPLETED':'IN_PROGRESS'});return true;}
  reply(200,{video:{url:origin+'/film-fixture/assets/'+(job.body.audio_url?'lipsync':job.body.model==='Iris'?'normal':'upscaled')+'.mp4'}});return true;
 }
 reply(200,{id,status:job.canceled?'cancelled':job.released?'succeeded':'running',content:{video_url:origin+'/film-fixture/assets/normal.mp4'}});return true;
}
