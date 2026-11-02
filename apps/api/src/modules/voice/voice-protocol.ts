export const MAX_RECORDING_SECONDS = 300;
export const MAX_RECORDING_BYTES = 44 + 16000 * 2 * MAX_RECORDING_SECONDS;
export const VOICE_PREVIEW_TEXT = '你好，我是 QGauss。让灵感被听见，让每一个好答案，都有自己的声音。';

export function voiceEndpoint(baseUrl:string, kind:'speech'|'transcription') {
  let url:URL; try{url=new URL(baseUrl);}catch{throw new Error('语音渠道地址无效');}
  if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw new Error('语音渠道需要不带账号、查询或片段的 API 根地址');
  const root=url.pathname.replace(/\/+$/,'');url.pathname=(root||'/v1')+(kind==='speech'?'/audio/speech':'/audio/transcriptions');return url.href;
}

/** The recorder produces exactly mono, 16 kHz, signed PCM16 WAV. No remote URLs are accepted. */
export function inspectVoiceWav(buffer:Buffer) {
  if(buffer.length<44||buffer.length>MAX_RECORDING_BYTES||buffer.toString('ascii',0,4)!=='RIFF'||buffer.toString('ascii',8,12)!=='WAVE'||buffer.readUInt32LE(4)!==buffer.length-8)throw new Error('请使用本页录制的有效 WAV 音频');
  let format=false,bytes=0,dataSeen=false,offset=12;
  while(offset+8<=buffer.length){const type=buffer.toString('ascii',offset,offset+4),size=buffer.readUInt32LE(offset+4),start=offset+8,end=start+size;if(end>buffer.length)throw new Error('录音文件不完整');
    if(type==='fmt '){if(format||size!==16||buffer.readUInt16LE(start)!==1||buffer.readUInt16LE(start+2)!==1||buffer.readUInt32LE(start+4)!==16000||buffer.readUInt32LE(start+8)!==32000||buffer.readUInt16LE(start+12)!==2||buffer.readUInt16LE(start+14)!==16)throw new Error('录音格式需要为单声道 16kHz PCM16');format=true;}
    if(type==='data'){if(dataSeen||!format||size%2)throw new Error('录音数据无效');dataSeen=true;bytes=size;}
    offset=end+(size%2);
  }
  const seconds=bytes/32000;if(offset!==buffer.length||!format||!dataSeen||seconds<.5||seconds>MAX_RECORDING_SECONDS)throw new Error('请录制半秒至五分钟的音频');return{seconds,bytes};
}

/** Split at punctuation where possible; never split UTF-16 surrogate pairs. */
export function splitVoiceText(text:string,limit=4096) {
  if(!Number.isSafeInteger(limit)||limit<2||limit>4096)throw new Error('语音分段上限无效');
  const points=[...text],segments:string[]=[];
  for(let start=0;start<points.length;){let end=start,units=0;while(end<points.length&&units+points[end].length<=limit){units+=points[end].length;end++;}if(end<points.length){for(let index=end-1;index>start+Math.floor((end-start)*.65);index--)if(/[。！？.!?\n；;]/.test(points[index])){end=index+1;break;}}
    segments.push(points.slice(start,end).join(''));start=end;}
  return segments;
}

export function validMp3(buffer:Buffer) {
  let at=0;if(buffer.length>=10&&buffer.toString('ascii',0,3)==='ID3'){if(buffer.subarray(6,10).some(byte=>byte>127))return false;at=10+(buffer[6]<<21)+(buffer[7]<<14)+(buffer[8]<<7)+buffer[9]+((buffer[5]&16)?10:0);}
  if(at+4>buffer.length)return false;
  const header=buffer.readUInt32BE(at),version=(header>>>19)&3,layer=(header>>>17)&3,rate=(header>>>12)&15,sample=(header>>>10)&3;
  if((header>>>21)!==2047||version===1||layer!==1||rate===0||rate===15||sample===3)return false;
  const bitrates=version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160],hz=[44100,48000,32000][sample]/(version===3?1:version===2?2:4),length=Math.floor((version===3?144000:72000)*bitrates[rate]/hz)+((header>>>9)&1);
  return length>=4&&at+length<=buffer.length;
}

/** One total deadline is shared with fetch and body reads. Errors never include provider bodies. */
export async function readVoiceBody(response:Response,maxBytes:number,signal:AbortSignal) {
  if(!response.ok||!response.body){await response.body?.cancel().catch(()=>{});throw new Error([401,403].includes(response.status)?'语音服务授权未通过，请联系管理员核对渠道':response.status===429?'语音服务繁忙，请稍后明确重试':'语音服务没有完成本次请求，请稍后明确重试');}
  const announced=response.headers.get('content-length');if(announced&&(!/^\d+$/.test(announced)||Number(announced)>maxBytes)){await response.body.cancel().catch(()=>{});throw new Error('语音服务返回内容过大');}
  const reader=response.body.getReader(),chunks:Buffer[]=[];let size=0;const abort=()=>{void reader.cancel().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
  try{while(true){signal.throwIfAborted();const part=await reader.read();signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>maxBytes)throw new Error('语音服务返回内容过大');chunks.push(Buffer.from(part.value));}if(!size)throw new Error('语音服务没有返回内容');return Buffer.concat(chunks,size);}
  finally{signal.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}
