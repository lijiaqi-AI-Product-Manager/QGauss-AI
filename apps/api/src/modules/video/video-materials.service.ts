import {Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import sharp from 'sharp';
import {PrismaService} from '../../common/prisma/prisma.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {StorageService,decodeFilename,type IncomingFile} from '../storage/storage.service';
import {prepareImageInputs} from '../image/image-inputs';
import {inspectAudioMaterial,inspectVideoMaterial,type VideoMaterial} from './video-materials';
import {videoFiles} from './video-accounting.service';
import {videoFrameTimeline,validateVideoSpeaker,type VideoSpeakerSelection} from './video-speaker';
const bad=(message:string,status=400)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
@Injectable()
export class VideoMaterialsService{
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService){}
 private async image(bytes:Buffer){try{const options={limitInputPixels:8388608,failOn:'warning' as const},meta=await sharp(bytes,options).metadata();if(bytes.length>10*1024*1024||!['png','jpeg','webp','gif'].includes(meta.format||'')||(meta.pages||1)>1||!meta.width||!meta.height)throw Error();await sharp(bytes,options).stats();return{mime:meta.format==='jpeg'?'image/jpeg':'image/'+meta.format,width:(meta.orientation||1)>=5?meta.height:meta.width,height:(meta.orientation||1)>=5?meta.width:meta.height};}catch{throw bad('请使用不超过 10 MB / 800 万像素的完整静态图片');}}
 async upload(userId:string,kind:string,file:IncomingFile){
  if(!['image','video','audio'].includes(kind)||!file?.buffer?.length)throw bad('没有收到有效素材');
  let info:any;try{info=kind==='image'?await this.image(file.buffer):kind==='video'?inspectVideoMaterial(file.buffer):inspectAudioMaterial(file.buffer);}catch(e){if(e instanceof BusinessException)throw e;throw bad((e as Error).message);}
  const result=await this.storage.saveBuffer(userId,file.buffer,{mime:info.mime,filename:decodeFilename(file.originalname)?.slice(0,200)||'QGauss-material',scope:'video-input'});
  return{id:result.id,kind,filename:result.filename,mime:info.mime,size:file.buffer.length,...(['width','height','duration','fps','codec'].reduce((out,key)=>{if(info[key]!==undefined)out[key]=info[key];return out;},{} as any))};
 }
 async fromTask(userId:string,id:string){const parent=await this.prisma.videoTask.findFirst({where:{id,userId,status:'SUCCESS',deletedAt:null}}),files=videoFiles(parent?.resultJson);if(!parent||!files)throw bad('只能选择自己的已完成成片');return this.prepareOne(userId,files.videoFileId,'video');}
 async frames(userId:string,id:string){const material=await this.prepareOne(userId,id,'video');return this.frameTimeline(userId,material);}
 private async frameTimeline(userId:string,material:VideoMaterial){const file=await this.readExpected(userId,material);try{return videoFrameTimeline(file.buffer);}catch(e){throw bad((e as Error).message);}}
 async validateSpeaker(userId:string,selection:VideoSpeakerSelection,materials:VideoMaterial[]){const material=materials.find(x=>x.kind==='video'&&x.id===selection.videoId);if(!material)throw bad('人物选择与原视频不符，请重新点选');const timeline=await this.frameTimeline(userId,material);validateVideoSpeaker(selection,material,timeline.frames.length);}
 async prepareOne(userId:string,id:string,kind:VideoMaterial['kind'],expected?:VideoMaterial){
  let file:Awaited<ReturnType<StorageService['read']>>;try{file=await this.storage.read(id,userId,'USER');}catch{throw bad('素材不存在、已移除或不属于当前账户');}
  const meta=await this.storage.detail(id,userId,'USER');let sourceTaskId:string|undefined;if(kind==='video'&&meta.scope==='video'){const parent=await this.prisma.videoTask.findFirst({where:{userId,status:'SUCCESS',deletedAt:null,resultJson:{contains:id}},select:{id:true,resultJson:true}});if(!parent||videoFiles(parent.resultJson)?.videoFileId!==id)throw bad('来源成片已经回收或移除');sourceTaskId=parent.id;}
  if(kind!=='image'&&!['video-input','video','voice-recording','voice-result'].includes(meta.scope))throw bad('请选择已保存的视频或声音素材');
  let info:any;try{if(kind==='image'){if(!file.mime.startsWith('image/'))throw bad('画面轨只能放入图片');const data=await prepareImageInputs({read:async()=>file},userId,[id]);info={mime:file.mime,...data.snapshot.references[0]};}else info=kind==='video'?inspectVideoMaterial(file.buffer):inspectAudioMaterial(file.buffer);}catch(e){if(e instanceof BusinessException)throw e;throw bad((e as Error).message);}
  if(kind!=='image'&&info.mime!==file.mime)throw bad('素材类型与内容不一致');const snapshot:VideoMaterial={id,kind,mime:info.mime,size:file.buffer.length,sha256:sha(file.buffer),filename:file.filename,...(sourceTaskId?{sourceTaskId}:{}),...Object.fromEntries(['width','height','duration','fps','codec'].filter(k=>info[k]!==undefined).map(k=>[k,info[k]]))};
  if(expected&&(snapshot.sha256!==expected.sha256||snapshot.id!==expected.id||snapshot.kind!==expected.kind||snapshot.size!==expected.size||snapshot.sourceTaskId!==expected.sourceTaskId))throw bad('素材或来源作品已变化，请重新选择');return snapshot;
 }
 async selection(userId:string,ids:{imageIds?:string[];videoIds?:string[];audioIds?:string[]},expected?:VideoMaterial[]){
  const chosen=(['image','video','audio'] as const).flatMap(kind=>(ids[kind+'Ids']||[]).map((id:string)=>({id,kind})));if(chosen.length>50||new Set(chosen.map(x=>x.id)).size!==chosen.length||expected&&expected.length!==chosen.length)throw bad('素材数量不正确或重复');
  const result:VideoMaterial[]=[];let bytes=0;for(let i=0;i<chosen.length;i++){const item=await this.prepareOne(userId,chosen[i].id,chosen[i].kind,expected?.[i]);bytes+=item.size;if(bytes>256*1024*1024)throw bad('这次创作的素材合计最多 256 MB');result.push(item);}return result;
 }
 async readExpected(userId:string,expected:VideoMaterial){await this.prepareOne(userId,expected.id,expected.kind,expected);return this.storage.read(expected.id,userId,'USER');}
}
