import {validMp3} from './voice-protocol';

type Segment={chunks:Buffer[];bytes:number;ready:boolean;file:string|null};
const MAX_SEGMENT=16*1024*1024,MAX_TOTAL=32*1024*1024,CHUNK=64*1024;

/** Live bytes are temporary. Committed segments are replayed from private storage. */
export class VoiceStreamSession {
  private readonly segments:Segment[]=[];
  private readonly waiters=new Set<()=>void>();
  private ended=false;
  private failed=false;
  private bytes=0;
  private parts=0;
  readers=0;

  append(index:number,chunk:Buffer){
    if(this.ended||!chunk.length)return;
    if(!Number.isSafeInteger(index)||index<0||index>this.segments.length)throw Error('声音片段顺序无效');
    const part=this.segments[index]||(this.segments[index]={chunks:[],bytes:0,ready:false,file:null});
    if(part.file||part.bytes+chunk.length>MAX_SEGMENT||this.bytes+chunk.length>MAX_TOTAL||++this.parts>8192)throw Error('声音结果超过本次接收上限');
    part.chunks.push(chunk);part.bytes+=chunk.length;this.bytes+=chunk.length;
    // Large metadata waits for validation of the completed file instead of repeated copies.
    if(!part.ready)part.ready=validMp3(part.chunks.length===1?part.chunks[0].subarray(0,CHUNK):Buffer.concat(part.chunks,Math.min(part.bytes,CHUNK)));
    if(part.ready)this.wake();
  }
  commit(index:number,file:string){
    const part=this.segments[index];if(this.ended||!part||part.file||!file)throw Error('声音片段回执无效');
    part.file=file;part.ready=true;part.chunks=[];this.wake();
  }
  finish(success:boolean){this.ended=true;this.failed=!success;if(!success)for(const part of this.segments)part.chunks=[];this.wake();}
  private wake(){for(const resolve of this.waiters)resolve();}
  private wait(signal:AbortSignal){return new Promise<void>((resolve,reject)=>{
    const done=()=>{clearTimeout(timer);this.waiters.delete(done);signal.removeEventListener('abort',abort);resolve();},abort=()=>{clearTimeout(timer);this.waiters.delete(done);signal.removeEventListener('abort',abort);reject(signal.reason||Error('声音播放已停止'));},timer=setTimeout(done,250);
    this.waiters.add(done);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });}
  async *read(load:(file:string)=>Promise<Buffer>,validate:()=>Promise<void>,signal:AbortSignal):AsyncGenerator<Buffer>{
    if(this.readers>=4)throw Error('声音播放连接过多，请先关闭其他播放');this.readers++;let index=0,offset=0;
    try{while(true){signal.throwIfAborted();if(this.failed)throw Error('本次声音已停止，请核对原任务');await validate();signal.throwIfAborted();if(this.failed)throw Error('本次声音已停止，请核对原任务');const part=this.segments[index];
      if(part?.file){const buffer=await load(part.file);await validate();signal.throwIfAborted();if(this.failed)throw Error('本次声音已停止，请核对原任务');if(buffer.length!==part.bytes)throw Error('已保存的声音片段不完整');while(offset<buffer.length){await validate();signal.throwIfAborted();if(this.failed)throw Error('本次声音已停止，请核对原任务');const end=Math.min(buffer.length,offset+CHUNK);yield buffer.subarray(offset,end);offset=end;}index++;offset=0;continue;}
      if(part?.ready&&offset<part.bytes){let skipped=0;for(const chunk of part.chunks){if(skipped+chunk.length>offset){const start=Math.max(0,offset-skipped),end=Math.min(chunk.length,start+CHUNK);yield chunk.subarray(start,end);offset=skipped+end;break;}skipped+=chunk.length;}continue;}
      if(this.ended&&!part)return;await this.wait(signal);
    }}finally{this.readers--;}
  }
}
