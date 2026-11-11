import sharp from 'sharp';
import {crc32} from 'node:zlib';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {IncomingFile} from '../storage/storage.service';

export const AVATAR_SCOPE='user-avatar';
export const AVATAR_PREFIX='qgauss:avatar:';
export const AVATAR_MAX_BYTES=12*1024*1024;
export const AVATAR_MAX_PIXELS=64*1024*1024;
const ANIMATION_PIXELS=128*1024*1024;
const invalid=(message:string,status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
export const avatarId=(value:unknown)=>typeof value==='string'&&/^qgauss:avatar:av_[a-f\d]{48}$/.test(value)?value.slice(AVATAR_PREFIX.length):null;
type Crop={x:number;y:number;size:number;width:number;height:number};
export function avatarCrop(value:unknown):Crop{
 let crop:any;try{crop=JSON.parse(typeof value==='string'?value:'');}catch{throw invalid('请重新确认头像裁切范围。');}
 const keys=['x','y','size','width','height'];
 if(!crop||Array.isArray(crop)||Object.keys(crop).length!==5||!keys.every(key=>Number.isSafeInteger(crop[key]))||crop.x<0||crop.y<0||crop.size<1||crop.width<1||crop.height<1||crop.width*crop.height>AVATAR_MAX_PIXELS||crop.x+crop.size>crop.width||crop.y+crop.size>crop.height)throw invalid('请重新确认头像裁切范围。');
 return crop;
}
const chunk=(name:string,data:Buffer)=>{const type=Buffer.from(name),length=Buffer.alloc(4),check=Buffer.alloc(4);length.writeUInt32BE(data.length);check.writeUInt32BE(crc32(Buffer.concat([type,data]))>>>0);return Buffer.concat([length,type,data,check]);};
type PngFrame={width:number;height:number;x:number;y:number;delay:number;dispose:number;blend:number;data:Buffer[]};
/** APNG frame rectangles are composited before cropping, including previous/background disposal. */
async function animatedPng(input:Buffer,crop:Crop):Promise<Buffer|null>{
 if(input.length<8||!input.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return null;
 const signature=input.subarray(0,8),shared:Buffer[]=[],frames:PngFrame[]=[];let ihdr:Buffer|undefined,expected=0,loops=0,current:PngFrame|undefined,sequence=0,animated=false,sawIdat=false,ended=false;
 for(let pos=8;pos+12<=input.length;){
  const size=input.readUInt32BE(pos);if(size>input.length-pos-12)throw invalid('图片无法完整读取，请换一张图片。');
  const type=input.toString('ascii',pos+4,pos+8),data=input.subarray(pos+8,pos+8+size);
  if((crc32(input.subarray(pos+4,pos+8+size))>>>0)!==input.readUInt32BE(pos+8+size))throw invalid('图片无法完整读取，请换一张图片。');
  if(type==='IHDR'){if(size!==13||ihdr)throw invalid('图片无法完整读取，请换一张图片。');ihdr=Buffer.from(data);}
  else if(type==='acTL'){if(animated||size!==8||sawIdat)throw invalid('图片无法完整读取，请换一张图片。');animated=true;expected=data.readUInt32BE(0);loops=data.readUInt32BE(4);if(!expected||expected>500||crop.width*crop.height*expected>ANIMATION_PIXELS)throw invalid('动画较长或像素过大，请选择更轻巧的图片。');}
  else if(type==='fcTL'&&animated){
   if(size!==26||data.readUInt32BE(0)!==sequence++)throw invalid('图片无法完整读取，请换一张图片。');
   current={width:data.readUInt32BE(4),height:data.readUInt32BE(8),x:data.readUInt32BE(12),y:data.readUInt32BE(16),delay:Math.max(10,Math.round(data.readUInt16BE(20)*1000/(data.readUInt16BE(22)||100))),dispose:data[24],blend:data[25],data:[]};
   if(!current.width||!current.height||current.x+current.width>crop.width||current.y+current.height>crop.height||current.dispose>2||current.blend>1||frames.length>=expected)throw invalid('图片无法完整读取，请换一张图片。');
   frames.push(current);
  }else if(type==='IDAT'){sawIdat=true;if(current)current.data.push(data);}
  else if(type==='fdAT'&&animated){if(size<5||!current||data.readUInt32BE(0)!==sequence++)throw invalid('图片无法完整读取，请换一张图片。');current.data.push(data.subarray(4));}
  else if(type==='IEND'){ended=true;break;}
  else if(['PLTE','tRNS'].includes(type))shared.push(chunk(type,data));
  pos+=size+12;
 }
 if(!animated)return null;
 if(!ihdr||!ended||frames.length!==expected||ihdr.readUInt32BE(0)!==crop.width||ihdr.readUInt32BE(4)!==crop.height||frames.some(frame=>!frame.data.length))throw invalid('图片无法完整读取，请换一张图片。');
 let canvas=Buffer.alloc(crop.width*crop.height*4);const output:Buffer[]=[],delays:number[]=[];
 for(const frame of frames){
  const header=Buffer.from(ihdr);header.writeUInt32BE(frame.width,0);header.writeUInt32BE(frame.height,4);
  const png=Buffer.concat([signature,chunk('IHDR',header),...shared,...frame.data.map(bytes=>chunk('IDAT',bytes)),chunk('IEND',Buffer.alloc(0))]);
  const pixels=await sharp(png,{limitInputPixels:AVATAR_MAX_PIXELS,failOn:'warning'}).ensureAlpha().raw().toBuffer(),before=frame.dispose===2?Buffer.from(canvas):null;
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
   const src=(y*frame.width+x)*4,dst=((y+frame.y)*crop.width+x+frame.x)*4;
   if(frame.blend===0){pixels.copy(canvas,dst,src,src+4);continue;}
   const alpha=pixels[src+3]/255,old=canvas[dst+3]/255,total=alpha+old*(1-alpha);
   for(let c=0;c<3;c++)canvas[dst+c]=total?Math.round((pixels[src+c]*alpha+canvas[dst+c]*old*(1-alpha))/total):0;
   canvas[dst+3]=Math.round(total*255);
  }
  output.push(await sharp(canvas,{raw:{width:crop.width,height:crop.height,channels:4}}).extract({left:crop.x,top:crop.y,width:crop.size,height:crop.size}).resize(512,512).raw().toBuffer());delays.push(frame.delay);
  if(frame.dispose===2&&before)canvas=before;
  else if(frame.dispose===1)for(let y=0;y<frame.height;y++)canvas.fill(0,((frame.y+y)*crop.width+frame.x)*4,((frame.y+y)*crop.width+frame.x+frame.width)*4);
 }
 return sharp(Buffer.concat(output),{raw:{width:512,height:512*frames.length,channels:4,pageHeight:512}}).webp({lossless:true,loop:Math.min(65535,loops),delay:delays}).toBuffer();
}
export async function normalizeAvatar(file:IncomingFile,crop:Crop){
 if(!file?.buffer?.length||file.buffer.length>AVATAR_MAX_BYTES)throw invalid('头像图片不能超过 12MB。',413);
 try{
  const apng=await animatedPng(file.buffer,crop);if(apng)return{buffer:apng,mime:'image/webp',extension:'webp'};
  const image=sharp(file.buffer,{animated:true,limitInputPixels:ANIMATION_PIXELS,failOn:'warning'}),metadata=await image.metadata(),pages=metadata.pages||1;
  if(!['jpeg','png','webp','gif'].includes(metadata.format||''))throw invalid('请使用 PNG、JPEG、WebP、GIF 或 BMP 图片。');
  const swap=[5,6,7,8].includes(metadata.orientation||1),rawHeight=metadata.pageHeight||metadata.height||0,width=swap?rawHeight:metadata.width||0,height=swap?metadata.width||0:rawHeight;
  if(width!==crop.width||height!==crop.height)throw invalid('图片尺寸已变化，请重新选择裁切范围。');
  if(width*height>AVATAR_MAX_PIXELS||pages>500||width*height*pages>ANIMATION_PIXELS)throw invalid('动画较长或像素过大，请选择更轻巧的图片。');
  const cropped=image.autoOrient().extract({left:crop.x,top:crop.y,width:crop.size,height:crop.size}).resize(512,512,{fit:'fill'});
  if(pages>1)return{buffer:await cropped.webp({lossless:true,loop:metadata.loop??0,delay:metadata.delay}).toBuffer(),mime:'image/webp',extension:'webp'};
  return{buffer:await cropped.png({compressionLevel:8}).toBuffer(),mime:'image/png',extension:'png'};
 }catch(error){if(error instanceof BusinessException)throw error;throw invalid('图片无法完整读取，请换一张图片。');}
}
