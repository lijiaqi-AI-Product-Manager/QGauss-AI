import {request as httpRequest} from 'node:http';
import {request as httpsRequest} from 'node:https';
import {safeDownloadTarget} from './safe-fetch';

export class ArtifactDownloadError extends Error{constructor(readonly code:string){super(code);}}
/** No provider credentials, decompression, reusable connection, or unvalidated redirect. */
export async function downloadArtifact(rawUrl:string,maximum:number,signal?:AbortSignal){
 const deadline=new AbortController(),abort=()=>deadline.abort(signal?.reason),timer=setTimeout(()=>deadline.abort(new ArtifactDownloadError('TIMEOUT')),60000);signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
 const active=()=>deadline.signal.throwIfAborted();
 try{let next=rawUrl;
  for(let hop=0;hop<4;hop++){
   active();const target=await Promise.race([safeDownloadTarget(next),new Promise<never>((_,reject)=>{const fail=()=>reject(deadline.signal.reason);if(deadline.signal.aborted)fail();else deadline.signal.addEventListener('abort',fail,{once:true});})]);active();
   const result=await new Promise<{buffer?:Buffer;location?:string}>((resolve,reject)=>{
    const send=target.url.protocol==='https:'?httpsRequest:httpRequest;
    const req=send(target.url,{agent:false,signal:deadline.signal,headers:{Accept:'*/*','Accept-Encoding':'identity'},lookup:(_host,options,callback)=>{const rows=target.addresses;if((options as any).all)(callback as any)(null,rows);else (callback as any)(null,rows[0].address,rows[0].family);}},res=>{
     if([301,302,303,307,308].includes(res.statusCode||0)){const location=res.headers.location;res.destroy();if(!location)return reject(new ArtifactDownloadError('REMOTE'));return resolve({location:new URL(location,target.url).href});}
     if(res.statusCode!==200){res.destroy();return reject(new ArtifactDownloadError(res.statusCode===404||res.statusCode===410?'EXPIRED':'REMOTE'));}
     const length=res.headers['content-length'];if(length&&(!/^\d+$/.test(length)||Number(length)>maximum)){res.destroy();return reject(new ArtifactDownloadError('TOO_LARGE'));}
     if(res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.destroy();return reject(new ArtifactDownloadError('FORMAT'));}
     const chunks:Buffer[]=[];let size=0;
     res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>maximum){res.destroy();reject(new ArtifactDownloadError('TOO_LARGE'));}else chunks.push(chunk);});
     res.on('error',reject);res.on('end',()=>{if(!size)return reject(new ArtifactDownloadError('EMPTY'));if(length&&size!==Number(length))return reject(new ArtifactDownloadError('REMOTE'));resolve({buffer:Buffer.concat(chunks)});});
    });req.on('error',reject);req.end();
   });if(result.buffer)return result.buffer;next=result.location!;
  }throw new ArtifactDownloadError('REDIRECT');
 }catch(error){if(deadline.signal.aborted)throw new ArtifactDownloadError('TIMEOUT');if((error as Error)?.name==='SsrfBlockedError')throw new ArtifactDownloadError('ADDRESS');throw error;}
 finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
