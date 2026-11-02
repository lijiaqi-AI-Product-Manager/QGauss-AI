import {inspectMp4,VideoFormatError} from './video-protocol';
export const MAX_MATERIAL_AUDIO_BYTES=20*1024*1024;
export interface VideoMaterial {id:string;kind:'image'|'video'|'audio';mime:string;size:number;sha256:string;filename:string;duration?:number;width?:number;height?:number;fps?:number;codec?:string;sourceTaskId?:string}
function invalid(message='素材结构不完整，请重新保存为 MP4、MP3 或 WAV'):never{throw new VideoFormatError(message);}
interface Box{type:string;data:number;end:number}
/** Bounded ISO-BMFF metadata traversal. This checks structure, not decoded visual quality. */
export function inspectVideoMaterial(buffer:Buffer){
  const container=inspectMp4(buffer);let budget=10000;
  function boxes(from:number,end:number):Box[]{const result:Box[]=[];while(from<end){if(--budget<0||from+8>end)invalid();let size=buffer.readUInt32BE(from),header=8;if(size===1){if(from+16>end)invalid();const wide=buffer.readBigUInt64BE(from+8);if(wide>BigInt(end-from))invalid();size=Number(wide);header=16;}else if(!size)size=end-from;if(size<header||from+size>end)invalid();result.push({type:buffer.toString('ascii',from+4,from+8),data:from+header,end:from+size});from+=size;}return result;}
  const root=boxes(0,buffer.length),moov=root.find(x=>x.type==='moov');if(!moov)invalid();
  let found:{width:number;height:number;fps:number;codec:string;duration:number}|undefined,hasAudio=false;
  for(const track of boxes(moov.data,moov.end).filter(x=>x.type==='trak')){
    const children=boxes(track.data,track.end),header=children.find(x=>x.type==='tkhd'),mdia=children.find(x=>x.type==='mdia');if(!header||!mdia)continue;
    const media=boxes(mdia.data,mdia.end),handler=media.find(x=>x.type==='hdlr');if(!handler||handler.end-handler.data<12)continue;const mediaKind=buffer.toString('ascii',handler.data+8,handler.data+12);if(mediaKind==='soun'){hasAudio=true;continue;}if(mediaKind!=='vide')continue;
    if(found)invalid('暂不支持包含多条视频轨的素材');
    const version=buffer[header.data],widthAt=header.data+(version===0?76:version===1?88:invalid());if(widthAt+8>header.end)invalid();
    let width=buffer.readUInt32BE(widthAt)/65536,height=buffer.readUInt32BE(widthAt+4)/65536;const matrix=header.data+(version===0?40:52);if(buffer.readInt32BE(matrix)===0&&buffer.readInt32BE(matrix+16)===0&&Math.abs(buffer.readInt32BE(matrix+4))===65536&&Math.abs(buffer.readInt32BE(matrix+12))===65536)[width,height]=[height,width];const mdhd=media.find(x=>x.type==='mdhd'),minf=media.find(x=>x.type==='minf');if(!mdhd||!minf)invalid();
    const v=buffer[mdhd.data],scaleAt=mdhd.data+(v===0?12:v===1?20:invalid());if(scaleAt+(v===0?8:12)>mdhd.end)invalid();const scale=buffer.readUInt32BE(scaleAt),durationTicks=v===0?buffer.readUInt32BE(scaleAt+4):Number(buffer.readBigUInt64BE(scaleAt+4));
    if(!scale||!Number.isSafeInteger(durationTicks)||durationTicks<=0)invalid();const duration=durationTicks/scale;
    const stbl=boxes(minf.data,minf.end).find(x=>x.type==='stbl');if(!stbl)invalid();const samples=boxes(stbl.data,stbl.end),stsd=samples.find(x=>x.type==='stsd'),stts=samples.find(x=>x.type==='stts');if(!stsd||!stts||stsd.end-stsd.data<24||stts.end-stts.data<16)invalid();
    const descriptions=buffer.readUInt32BE(stsd.data+4),entries=boxes(stsd.data+8,stsd.end);if(descriptions!==entries.length||entries.length!==1)invalid('暂不支持切换编码的视频素材');const codec=entries[0].type;if(!['avc1','avc3','hvc1','hev1','av01','vp09'].includes(codec))invalid('请使用 H.264、H.265、AV1 或 VP9 编码的 MP4');
    const count=buffer.readUInt32BE(stts.data+4);if(count>20000||stts.data+8+count*8!==stts.end)invalid();let frames=0,ticks=0;for(let n=0;n<count;n++){const pos=stts.data+8+n*8,amount=buffer.readUInt32BE(pos),delta=buffer.readUInt32BE(pos+4);if(!amount||!delta)invalid();frames+=amount;ticks+=amount*delta;if(!Number.isSafeInteger(ticks)||frames>1_000_000)invalid();}
    const fps=frames*scale/ticks;if(!Number.isFinite(fps)||fps<1||fps>240||!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>16384||height>16384||duration<.5||duration>300.05)invalid('视频须为半秒至五分钟，尺寸和帧率需要可读取');
    if(Math.abs(ticks-durationTicks)>Math.max(scale,.02*durationTicks))invalid('视频时间记录不一致，请重新保存');
    found={width,height,fps,codec,duration};
  }
  if(!found)invalid('素材没有可读取的视频轨');return{...container,...found,hasAudio};
}
export function inspectAudioMaterial(buffer:Buffer){
  if(!buffer.length||buffer.length>MAX_MATERIAL_AUDIO_BYTES)invalid('声音素材每段最多 20 MB');
  if(buffer.toString('ascii',0,4)==='RIFF'){
    if(buffer.length<44||buffer.toString('ascii',8,12)!=='WAVE'||buffer.readUInt32LE(4)+8!==buffer.length)invalid();let at=12,format=false,bytes:number|undefined,rate=0,align=0;
    while(at<buffer.length){if(at+8>buffer.length)invalid();const kind=buffer.toString('ascii',at,at+4),length=buffer.readUInt32LE(at+4),data=at+8;if(data+length>buffer.length)invalid();
      if(kind==='fmt '){if(format||length<16)invalid();let codec=buffer.readUInt16LE(data);const channels=buffer.readUInt16LE(data+2),sampleRate=buffer.readUInt32LE(data+4),bits=buffer.readUInt16LE(data+14);align=buffer.readUInt16LE(data+12);rate=buffer.readUInt32LE(data+8);
        if(codec===65534){if(length<40||buffer.readUInt16LE(data+16)<22||buffer.toString('hex',data+26,data+40)!=='000000001000800000aa00389b71')invalid();codec=buffer.readUInt16LE(data+24);}
        if(![1,3].includes(codec)||![1,2].includes(channels)||sampleRate<8000||sampleRate>192000||![8,16,24,32].includes(bits)||codec===3&&bits!==32||align!==channels*bits/8||rate!==sampleRate*align)invalid('请使用单声道或双声道 PCM / 浮点 WAV');format=true;
      }else if(kind==='data'){if(bytes!==undefined)invalid();bytes=length;}
      at=data+length+(length%2);if(at>buffer.length)invalid();
    }
    if(!format||!bytes||bytes%align||at!==buffer.length)invalid();const duration=bytes/rate;if(duration<.5||duration>300)invalid('声音长度须为半秒至五分钟');return{mime:'audio/wav',duration};
  }
  let at=0,seconds=0,frames=0,sampleRate=0,versionSeen=-1;
  if(buffer.toString('ascii',0,3)==='ID3'){
    if(buffer.length<10||![2,3,4].includes(buffer[3])||[6,7,8,9].some(i=>buffer[i]&128))invalid();const size=buffer[6]*2097152+buffer[7]*16384+buffer[8]*128+buffer[9];at=10+size+(buffer[3]===4&&(buffer[5]&16)?10:0);if(at>=buffer.length)invalid();
  }
  let end=buffer.length;if(end-at>=128&&buffer.toString('ascii',end-128,end-125)==='TAG')end-=128;
  while(at<end){if(at+4>end||buffer[at]!==255||(buffer[at+1]&224)!==224)invalid('MP3 帧不完整，请重新保存为 MP3 或 WAV');const version=(buffer[at+1]>>3)&3,layer=(buffer[at+1]>>1)&3,index=(buffer[at+2]>>4)&15,sampling=(buffer[at+2]>>2)&3;if(version===1||layer!==1||index===0||index===15||sampling===3)invalid();
    const rate=[44100,48000,32000][sampling]/(version===3?1:version===2?2:4),bitrate=(version===3?[0,32,40,48,56,64,80,96,112,128,160,192,224,256,320]:[0,8,16,24,32,40,48,56,64,80,96,112,128,144,160])[index],length=Math.floor((version===3?144:72)*bitrate*1000/rate)+((buffer[at+2]>>1)&1);
    if(length<4||at+length>end||sampleRate&&sampleRate!==rate||versionSeen>=0&&versionSeen!==version)invalid();sampleRate=rate;versionSeen=version;seconds+=(version===3?1152:576)/rate;frames++;if(frames>60000||seconds>300.1)invalid('声音素材最长五分钟');at+=length;
  }
  if(at!==end||frames<2||seconds<.5||seconds>300.1)invalid('声音素材须为半秒至五分钟的完整 MP3 或 WAV');return{mime:'audio/mpeg',duration:seconds};
}
