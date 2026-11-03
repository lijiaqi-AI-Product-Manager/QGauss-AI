/** Loopback-only native audio counterpart. All content and credentials are synthetic. */
import {readFileSync} from 'node:fs';
const previewMp3=readFileSync(new URL('./fixtures/qgauss-voice-preview.mp3',import.meta.url));
const requests=[],counts=new Map(),controls=new Map();
const json=(res,value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
export function syntheticMp3(){return Buffer.from(previewMp3);}
export async function voiceUpstreamFixture(req,res){
  const url=new URL(req.url,'http://localhost');if(!url.pathname.startsWith('/voice-fixture/'))return false;
  if(url.pathname==='/voice-fixture/stats'){json(res,{requests});return true;}
  const chunks=[];for await(const chunk of req)chunks.push(chunk);const buffer=Buffer.concat(chunks);let body={};if(String(req.headers['content-type']).includes('application/json'))try{body=JSON.parse(buffer.toString());}catch{json(res,{error:'malformed synthetic JSON'},400);return true;}
  if(url.pathname==='/voice-fixture/control'){controls.set(body.mode,body);if(body.reset)counts.set(body.mode,0);json(res,{ok:true});return true;}
  const match=/^\/voice-fixture\/([a-z-]+)(\/audio\/(?:speech|transcriptions))$/.exec(url.pathname);if(!match){json(res,{error:'synthetic route not found'},404);return true;}
  const[,mode,path]=match,call=(counts.get(mode)||0)+1;counts.set(mode,call);
  const authorized=/^Bearer qgauss-synthetic-voice-(?:main|pool)$/.test(String(req.headers.authorization));
  if(path.endsWith('transcriptions'))body={model:buffer.toString().match(/name="model"\r\n\r\n([^\r]+)/)?.[1],language:buffer.toString().match(/name="language"\r\n\r\n([^\r]+)/)?.[1],format:buffer.toString().match(/name="response_format"\r\n\r\n([^\r]+)/)?.[1],hasWav:buffer.includes(Buffer.from('RIFF')),fileBytes:buffer.length,contentType:String(req.headers['content-type'])};
  requests.push({mode,path,body,authorized,call});
  if(!authorized||mode==='auth-error'){json(res,{error:{message:'private provider credential must never leak'}},401);return true;}
  if(mode==='rate-limit'){json(res,{error:'private provider rate limit'},429);return true;}
  if(mode==='fail-second'&&call===2){json(res,{error:'private failed segment'},500);return true;}
  if(mode==='hang'||mode==='slow-body'||mode==='hold'||mode==='progressive'){
    if(mode==='slow-body'){res.writeHead(200,{'Content-Type':'audio/mpeg'});res.write(syntheticMp3().subarray(0,4));}
    if(mode==='progressive'){const audio=syntheticMp3();res.writeHead(200,{'Content-Type':'audio/mpeg'});res.write(audio.subarray(0,Math.ceil(audio.length/2)));}
    await new Promise(resolve=>{const timer=setTimeout(resolve,240000);res.once('close',()=>{clearTimeout(timer);resolve();});const check=setInterval(()=>{const setting=controls.get(mode);if(setting?.release||Number.isSafeInteger(setting?.releaseThrough)&&call<=setting.releaseThrough){clearInterval(check);if(!res.destroyed){if(!res.headersSent)res.writeHead(200,{'Content-Type':'audio/mpeg'});const audio=syntheticMp3();res.end(mode==='progressive'?audio.subarray(Math.ceil(audio.length/2)):audio);}clearTimeout(timer);resolve();}},50);res.once('close',()=>clearInterval(check));});return true;
  }
  if(mode==='large-header'){res.writeHead(200,{'Content-Type':'audio/mpeg','Content-Length':20*1024*1024});res.end();return true;}
  if(path.endsWith('speech')){res.writeHead(200,{'Content-Type':'audio/mpeg'});res.end(mode==='bad-audio'?Buffer.from('not an audio file'):syntheticMp3());return true;}
  if(mode==='bad-json'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"text":');return true;}
  json(res,{text:mode==='empty'?'':mode==='blocked'?'qgauss-voice-block-word':'这是一段本地合成转写，请确认后使用。'});return true;
}
