import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {inspectVideoMaterial,type VideoMaterial} from './video-materials';
import {VideoFormatError} from './video-protocol';

export interface VideoSpeakerSelection {videoId:string;frameNumber:number;x:number;y:number}
function bad(message:string):never{throw new BusinessException(ErrorCode.PARAM_INVALID,message,400);}
export function normalizeVideoSpeaker(value:unknown):VideoSpeakerSelection|undefined{
  if(value===undefined)return;
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['videoId','frameNumber','x','y'].includes(k)))bad('人物选择不完整，请重新点选');
  const item=value as VideoSpeakerSelection;
  if(typeof item.videoId!=='string'||!item.videoId.length||item.videoId.length>128||item.videoId.trim()!==item.videoId||![item.frameNumber,item.x,item.y].every(Number.isSafeInteger)||item.frameNumber<0||item.frameNumber>=100000||item.x<0||item.x>16383||item.y<0||item.y>16383)bad('人物位置或参考帧无效，请重新点选');
  return{videoId:item.videoId,frameNumber:item.frameNumber,x:item.x,y:item.y};
}
export function validateVideoSpeaker(selection:VideoSpeakerSelection,material:VideoMaterial,frames:number){
  if(selection.videoId!==material.id||material.kind!=='video'||!material.width||!material.height||selection.x>=material.width||selection.y>=material.height||selection.frameNumber>=frames)bad('人物选择与原视频不符，请重新点选');
}

/** Presentation order, composition offsets and a normal trim are honored before the user chooses a frame. */
export function videoFrameTimeline(buffer:Buffer){
  const info=inspectVideoMaterial(buffer);
  function invalid():never{throw new VideoFormatError('这条视频的时间记录暂不支持人物选帧，请重新保存后再试');}
  type Box={type:string;data:number;end:number};let budget=10000;
  function boxes(from:number,end:number):Box[]{const result:Box[]=[];while(from<end){if(--budget<0||from+8>end)invalid();let size=buffer.readUInt32BE(from),header=8;if(size===1){if(from+16>end)invalid();const wide=buffer.readBigUInt64BE(from+8);if(wide>BigInt(end-from))invalid();size=Number(wide);header=16;}else if(!size)size=end-from;if(size<header||from+size>end)invalid();result.push({type:buffer.toString('ascii',from+4,from+8),data:from+header,end:from+size});from+=size;}return result;}
  const moov=boxes(0,buffer.length).find(b=>b.type==='moov');if(!moov)invalid();const movie=boxes(moov.data,moov.end),mvhd=movie.find(b=>b.type==='mvhd');if(!mvhd)invalid();
  const movieScaleAt=mvhd.data+(buffer[mvhd.data]===0?12:buffer[mvhd.data]===1?20:invalid());if(movieScaleAt+4>mvhd.end)invalid();const movieScale=buffer.readUInt32BE(movieScaleAt);if(!movieScale)invalid();
  for(const track of movie.filter(b=>b.type==='trak')){
    const children=boxes(track.data,track.end),mdia=children.find(b=>b.type==='mdia');if(!mdia)continue;const media=boxes(mdia.data,mdia.end),handler=media.find(b=>b.type==='hdlr');if(!handler||handler.end-handler.data<12||buffer.toString('ascii',handler.data+8,handler.data+12)!=='vide')continue;
    const mdhd=media.find(b=>b.type==='mdhd'),minf=media.find(b=>b.type==='minf');if(!mdhd||!minf)invalid();const scaleAt=mdhd.data+(buffer[mdhd.data]===0?12:buffer[mdhd.data]===1?20:invalid());if(scaleAt+4>mdhd.end)invalid();const scale=buffer.readUInt32BE(scaleAt);if(!scale)invalid();
    const stbl=boxes(minf.data,minf.end).find(b=>b.type==='stbl');if(!stbl)invalid();const tables=boxes(stbl.data,stbl.end),stts=tables.find(b=>b.type==='stts');if(!stts||stts.end-stts.data<8)invalid();const rows=buffer.readUInt32BE(stts.data+4);if(rows>20000||stts.data+8+rows*8!==stts.end)invalid();
    const samples:{pts:number;duration:number}[]=[];let ticks=0;
    for(let row=0;row<rows;row++){const at=stts.data+8+row*8,n=buffer.readUInt32BE(at),delta=buffer.readUInt32BE(at+4);if(!n||!delta||samples.length+n>100000)invalid();for(let j=0;j<n;j++){samples.push({pts:ticks,duration:delta});ticks+=delta;if(!Number.isSafeInteger(ticks))invalid();}}
    const ctts=tables.find(b=>b.type==='ctts');if(ctts){if(ctts.end-ctts.data<8||![0,1].includes(buffer[ctts.data]))invalid();const count=buffer.readUInt32BE(ctts.data+4);if(count>100000||ctts.data+8+count*8!==ctts.end)invalid();let index=0;for(let row=0;row<count;row++){const at=ctts.data+8+row*8,n=buffer.readUInt32BE(at),offset=buffer[ctts.data]===1?buffer.readInt32BE(at+4):buffer.readUInt32BE(at+4);if(!n||index+n>samples.length)invalid();for(let j=0;j<n;j++)samples[index++].pts+=offset;}if(index!==samples.length)invalid();}
    let mediaStart=0,mediaEnd=Infinity,lead=0;const edts=children.find(b=>b.type==='edts'),elst=edts&&boxes(edts.data,edts.end).find(b=>b.type==='elst');
    if(elst){if(elst.end-elst.data<8||![0,1].includes(buffer[elst.data]))invalid();const wide=buffer[elst.data]===1,count=buffer.readUInt32BE(elst.data+4),size=wide?20:12;if(!count||count>32||elst.data+8+count*size!==elst.end)invalid();let playing=false;
      for(let row=0;row<count;row++){const at=elst.data+8+row*size,duration=wide?Number(buffer.readBigUInt64BE(at)):buffer.readUInt32BE(at),start=wide?Number(buffer.readBigInt64BE(at+8)):buffer.readInt32BE(at+4),rateAt=at+(wide?16:8);if(!Number.isSafeInteger(duration)||!duration||!Number.isSafeInteger(start)||buffer.readInt16BE(rateAt)!==1||buffer.readInt16BE(rateAt+2)!==0)invalid();if(start===-1&&!playing){lead+=duration/movieScale;continue;}if(start<0||playing)invalid();playing=true;mediaStart=start;mediaEnd=start+duration*scale/movieScale;}if(!playing)invalid();
    }
    samples.sort((a,b)=>a.pts-b.pts);if(samples.some((x,i)=>i>0&&x.pts<=samples[i-1].pts))invalid();
    const frames=samples.flatMap((sample,index)=>{const start=Math.max(mediaStart,sample.pts),end=Math.min(mediaEnd,index+1<samples.length?samples[index+1].pts:sample.pts+sample.duration);if(end<=start)return[];return[lead+((start+end)/2-mediaStart)/scale];});
    if(!frames.length||frames.some((x,i)=>!Number.isFinite(x)||x<0||x>302||i>0&&x<=frames[i-1]))invalid();
    return{width:info.width,height:info.height,frames};
  }
  return invalid();
}
