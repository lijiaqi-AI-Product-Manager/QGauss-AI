import {Injectable} from '@nestjs/common';
import {Prisma} from '@prisma/client';
import sharp from 'sharp';
import {PrismaService} from '../../common/prisma/prisma.service';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {StorageService} from '../storage/storage.service';
import {MjMediaService} from '../midjourney/mj-media.service';
import {mjFiles} from '../midjourney/mj-accounting.service';
import {VideoMediaService} from '../video/video-media.service';
import {videoFiles} from '../video/video-accounting.service';
import {galleryFilters,galleryId,galleryKind,galleryOrder,gallerySource,galleryWhere,GalleryKind,GalleryPublicRow} from './gallery-query';

const missing=()=>new BusinessException(ErrorCode.NOT_FOUND,'作品不存在或当前不可用',404);
const invalid=(message:string)=>new BusinessException(ErrorCode.PARAM_INVALID,message,400);
const json=(value:string|null|undefined,fallback:any)=>{try{return JSON.parse(value||'null')??fallback;}catch{return fallback;}};
const keyOf=(kind:GalleryKind,id:string)=>kind+':'+id;
const iso=(value:number|bigint|null)=>{const date=new Date(Number(value));return value!==null&&Number.isFinite(date.getTime())?date.toISOString():null;};
const text=(value:unknown)=>typeof value==='string'?value:'';
const mask=(name:string)=>{const value=Array.from(name.includes('@')?name.split('@')[0]:name);return value.length?value[0]+'***'+(value.length>1?value.at(-1):''):'QGauss 创作者';};
type Tx=Prisma.TransactionClient;
type ImageAsset={index:number;kind:'image'|'video';url:string};
type Prepared={viewerId:string;row:GalleryPublicRow;task:any;intent:any;assets:ImageAsset[];category:{id:string;name:string}|null};
type ImageResponse={buffer:Buffer;mime:string;filename:string};

@Injectable()
export class GalleryService {
 private readonly prefix='/'+(process.env.API_PREFIX||'api').replace(/^\/+|\/+$/g,'');
 private readonly thumbnails=new Map<string,{value:ImageResponse;expires:number}>();
 private readonly rendering=new Map<string,Promise<ImageResponse>>();
 private thumbnailBytes=0;
 constructor(private readonly prisma:PrismaService,private readonly storage:StorageService,private readonly mjMedia:MjMediaService,private readonly videoMedia:VideoMediaService,private readonly rate:RateLimitService){}

 private async actor(tx:Tx,userId:string,admin=false){
  const user=await tx.user.findFirst({where:{id:userId,status:'ACTIVE',deletedAt:null},select:{id:true,role:true}});
  if(!user||admin&&user.role!=='ADMIN')throw new BusinessException(ErrorCode.FORBIDDEN,'当前账户无法执行此操作',403);return user;
 }
 private args(kind:unknown,id:unknown){return{kind:galleryKind(kind),id:galleryId(id)};}
 private async publicRow(tx:Tx,userId:string,kind:GalleryKind,id:string){
  const rows=await tx.$queryRaw<GalleryPublicRow[]>(Prisma.sql`${gallerySource(userId)} SELECT * FROM scoped WHERE kind=${kind} AND "id"=${id} LIMIT 1`);
  if(!rows.length)throw missing();return rows[0];
 }
 private async task(tx:Tx,kind:GalleryKind,id:string){return kind==='image'?tx.imageTask.findUnique({where:{id}}):kind==='mj'?tx.mjTask.findUnique({where:{id}}):tx.videoTask.findUnique({where:{id}});}
 private assets(kind:GalleryKind,task:any):ImageAsset[]{
  const values=kind==='image'?json(task.resultJson,[]):kind==='mj'?mjFiles(task.resultJson)?.items:videoFiles(task.resultJson)?[{kind:'video'}]:[];
  if(!Array.isArray(values)||!values.length)throw missing();
  return values.map((file,index)=>({index,kind:kind==='image'?'image':file.kind,url:this.prefix+'/gallery/works/'+kind+'/'+encodeURIComponent(task.id)+'/assets/'+index}));
 }
 private async prepare(tx:Tx,userId:string,kind:GalleryKind,id:string):Promise<Prepared>{
  const row=await this.publicRow(tx,userId,kind,id),task=await this.task(tx,kind,id);if(!task)throw missing();
  const category=row.catId?await tx.creationCat.findFirst({where:{id:row.catId,status:true},select:{id:true,name:true}}):null;
  let intent:any=kind==='image'?task:json((task as any).intentJson,{});
  if(kind==='mj'){const source=json((task as any).presetJson,{}).sourceParams;if(source&&typeof source==='object'&&!Array.isArray(source))intent=source;}
  return{viewerId:userId,row,task,intent,assets:this.assets(kind,task),category};
 }
 private base(value:Prepared,full=false){
  const {row,task,intent,assets,category}=value,prompt=text(row.prompt),title=prompt.replace(/\s+/g,' ').trim().slice(0,100)||({image:'一份公开的图像灵感',mj:'一份公开的 MJ 灵感',video:'一份公开的流动画面'})[row.kind];
  const ratio=text(intent.ratio)||'1:1',modelLabel=row.kind==='image'?text(task.versionName)||text(task.model)||'图像创作':text(task.presetName)||'公开创作';
  const parameters:Array<{label:string;value:string}>=[];
  const add=(label:string,value:unknown)=>{if(value!==null&&value!==undefined&&value!=='')parameters.push({label,value:String(value)});};
  if(full){add('画面比例',ratio);add('创作模型',modelLabel);if(row.kind==='image'){add('分辨率',task.resolution);add('画质',task.quality);add('随机种子',task.seed);}else if(row.kind==='mj'){add('版本',intent.version);add('画质',intent.quality);add('风格强度',intent.stylize);add('随机种子',intent.seed);}else{add('分辨率',intent.resolution);if(Number.isFinite(intent.seconds))add('时长',intent.seconds===0?'由创作服务确定':intent.seconds+' 秒');add('随机种子',intent.seed);}if(category)add('风格分类',category.name);}
  const reuse={available:!!prompt.trim(),path:({image:'/painting',mj:'/mj',video:'/video'})[row.kind],reason:prompt.trim()?'':'这份作品没有可带入的文字描述，可以先保存公开画面。'};
  return{key:keyOf(row.kind,row.id),kind:row.kind,id:row.id,title,modelLabel,ratio,createdAt:iso(row.createdMs),publishedAt:iso(row.publishedMs),author:mask(row.author),category,featured:!!row.recommended,favorite:row.savedMs!==null,favoriteCount:Number(row.favoriteCount),assetCount:assets.length,assets:full?assets:assets.slice(0,1).map(file=>({...file,url:file.url+'?thumb=1'})),...(full?{prompt,negativePrompt:text(intent.negativePrompt),parameters,reuse,mine:row.userId===value.viewerId}:{})};
 }
 async options(userId:string){return this.prisma.$transaction(async tx=>{
  await this.actor(tx,userId);const rows=await tx.$queryRaw<Array<{kind:GalleryKind;total:number|bigint;favorites:number|bigint}>>(Prisma.sql`${gallerySource(userId)} SELECT kind,count(*) AS total,sum(savedMs IS NOT NULL) AS favorites FROM scoped GROUP BY kind`);
  const counts={all:0,image:0,mj:0,video:0,favorites:0};for(const row of rows){counts[row.kind]=Number(row.total);counts.all+=Number(row.total);counts.favorites+=Number(row.favorites||0);}
  const categories=await tx.creationCat.findMany({where:{status:true},orderBy:[{sort:'asc'},{id:'asc'}],select:{id:true,name:true}});return{categories,counts};
 });}
 async list(userId:string,query:Record<string,unknown>={}){
  const filter=galleryFilters(query);return this.prisma.$transaction(async tx=>{
   await this.actor(tx,userId);const source=gallerySource(userId),where=galleryWhere(filter);
   const rows=await tx.$queryRaw<GalleryPublicRow[]>(Prisma.sql`${source} SELECT * FROM scoped ${where} ORDER BY ${galleryOrder(filter.sort)} LIMIT ${filter.pageSize} OFFSET ${(filter.page-1)*filter.pageSize}`);
   const count=await tx.$queryRaw<Array<{total:number|bigint}>>(Prisma.sql`${source} SELECT count(*) AS total FROM scoped ${where}`),items:ReturnType<GalleryService['base']>[]=[];
   for(const row of rows){const task=await this.task(tx,row.kind,row.id);if(!task)throw missing();const category=row.catId?await tx.creationCat.findFirst({where:{id:row.catId,status:true},select:{id:true,name:true}}):null;items.push(this.base({viewerId:userId,row,task,intent:row.kind==='image'?task:json((task as any).intentJson,{}),assets:this.assets(row.kind,task),category}));}
   return{items,total:Number(count[0]?.total||0),page:filter.page,pageSize:filter.pageSize};
  });
 }
 async detail(userId:string,rawKind:unknown,rawId:unknown){const {kind,id}=this.args(rawKind,rawId);return this.prisma.$transaction(async tx=>{await this.actor(tx,userId);return this.base(await this.prepare(tx,userId,kind,id),true);});}
 async reuse(userId:string,rawKind:unknown,rawId:unknown){const {kind,id}=this.args(rawKind,rawId);return this.prisma.$transaction(async tx=>{
  await this.actor(tx,userId);const value=await this.prepare(tx,userId,kind,id),{row,task,intent}=value,prompt=text(row.prompt).trim();if(!prompt)throw invalid('这份作品没有可带入的文字描述');
  let draft:Record<string,unknown>;
  if(kind==='image')draft={prompt,negativePrompt:text(task.negativePrompt),model:task.model,ratio:task.ratio,resolution:task.resolution,quality:task.quality,seed:task.seed,n:task.n,catId:value.category?.id||''};
  else{const allowed=kind==='mj'?['model','version','ratio','quality','hd','raw','stylize','chaos','seed','negativePrompt']:['ratio','resolution','seconds','seed','style','motion','guidanceScale','frameRate','pan','tilt','rotate','zoom','negativePrompt','sound'];draft={presetId:task.presetId,prompt,...Object.fromEntries(allowed.filter(key=>Object.hasOwn(intent,key)&&['string','number','boolean'].includes(typeof intent[key])).map(key=>[key,intent[key]]))};}
  return{key:keyOf(kind,id),title:this.base(value).title,author:mask(row.author),target:({image:'/painting',mj:'/mj',video:'/video'})[kind],draft,note:'已带入公开的文字与设定，私有参考素材和原来的操作链不会跟随。请核对当前模型和费用，再决定开始。'};
 });}
 async favorite(userId:string,rawKind:unknown,rawId:unknown,favorite:boolean){
  const {kind,id}=this.args(rawKind,rawId);if(typeof favorite!=='boolean')throw invalid('收藏目标状态不正确');
  if(!this.rate.tryConsume('gallery-favorite:'+userId,60))throw new BusinessException(ErrorCode.RATE_LIMITED,'收藏操作过快，请稍后再试',429);
  return this.prisma.$transaction(async tx=>{
   await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;await this.actor(tx,userId);
   if(favorite){await this.publicRow(tx,userId,kind,id);await tx.galleryFavorite.upsert({where:{userId_kind_taskId:{userId,kind,taskId:id}},create:{userId,kind,taskId:id},update:{}});}
   else await tx.galleryFavorite.deleteMany({where:{userId,kind,taskId:id}});
   const rows=await tx.$queryRaw<GalleryPublicRow[]>(Prisma.sql`${gallerySource(userId)} SELECT * FROM scoped WHERE kind=${kind} AND "id"=${id} LIMIT 1`);
   return{key:keyOf(kind,id),favorite,favoriteCount:Number(rows[0]?.favoriteCount||0)};
  });
 }
 async feature(userId:string,rawKind:unknown,rawId:unknown,featured:boolean){const {kind,id}=this.args(rawKind,rawId);if(typeof featured!=='boolean')throw invalid('推荐目标状态不正确');return this.prisma.$transaction(async tx=>{
  await tx.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${userId}`;await this.actor(tx,userId,true);if(featured)await this.publicRow(tx,userId,kind,id);
  const where={id,status:'SUCCESS',deletedAt:null},data={recommended:featured},result=kind==='image'?await tx.imageTask.updateMany({where,data}):kind==='mj'?await tx.mjTask.updateMany({where,data}):await tx.videoTask.updateMany({where,data});if(!result.count)throw missing();return{key:keyOf(kind,id),featured};
 });}
 private index(value:unknown){if(typeof value!=='string'||!/^[0-3]$/.test(value))throw invalid('作品画面编号不正确');return Number(value);}
 private async snapshot(userId:string,kind:GalleryKind,id:string){return this.prisma.$transaction(async tx=>{await this.actor(tx,userId);return this.prepare(tx,userId,kind,id);});}
 private async stillPublished(userId:string,kind:GalleryKind,id:string){await this.publicRow(this.prisma as unknown as Tx,userId,kind,id);}
 private fallback(taskId:string):ImageResponse{return{buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="#dcd4ef"/><stop offset="1" stop-color="#9abbb7"/></linearGradient></defs><rect width="640" height="400" fill="url(#g)"/><circle cx="320" cy="178" r="62" fill="#ffffff55"/><path d="m307 151 41 27-41 27Z" fill="#4f5274"/><text x="320" y="295" text-anchor="middle" fill="#4f5274" font-size="18" font-family="sans-serif">QGauss · 暂无作品封面</text></svg>'),mime:'image/svg+xml',filename:'QGauss-'+taskId+'-preview.svg'};}
 private async mediaFile(userId:string,value:Prepared,index:number,address:string){
  const {row,task,assets}=value,file=assets[index];if(!file)throw missing();
  if(row.kind==='image'){const declared=json(task.resultJson,[])[index];const stored=await this.storage.detail(declared.fileId,task.userId,'USER');if(stored.scope!=='image'||!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(stored.mime))throw missing();return{fileId:stored.id,owner:task.userId,mime:stored.mime,size:stored.size};}
  if(row.kind==='mj')return this.mjMedia.still(userId,task,index,file.kind==='video');
  const links=await this.videoMedia.playback(userId,task);if(!links.posterUrl)throw missing();const parsed=new URL(links.posterUrl,'http://127.0.0.1');return this.videoMedia.access(task.id,'poster',parsed.searchParams.get('ticket'),'playback',address);
 }
 private prune(){const now=Date.now();for(const [key,row]of this.thumbnails)if(row.expires<=now){this.thumbnailBytes-=row.value.buffer.length;this.thumbnails.delete(key);}while(this.thumbnailBytes>32*1024*1024||this.thumbnails.size>128){const key=this.thumbnails.keys().next().value;if(!key)break;this.thumbnailBytes-=this.thumbnails.get(key)!.value.buffer.length;this.thumbnails.delete(key);}}
 async asset(userId:string,rawKind:unknown,rawId:unknown,rawIndex:unknown,thumb:unknown,address:string):Promise<ImageResponse>{
  const {kind,id}=this.args(rawKind,rawId),index=this.index(rawIndex);if(thumb!==undefined&&thumb!=='0'&&thumb!=='1')throw invalid('画面预览参数不正确');
  const value=await this.snapshot(userId,kind,id);if(!value.assets[index])throw missing();let file:Awaited<ReturnType<GalleryService['mediaFile']>>;
  try{file=await this.mediaFile(userId,value,index,address);}catch(error){if(value.assets[index].kind!=='video'||!(error instanceof BusinessException)||error.getStatus()!==404)throw error;await this.stillPublished(userId,kind,id);return this.fallback(id);}
  const metadata=await this.storage.detail(file.fileId,file.owner,'USER'),checksum=await this.prisma.uploadFile.findUnique({where:{id:file.fileId},select:{sha256:true}}),key=file.fileId+':'+checksum?.sha256+':'+metadata.size+':'+metadata.mime;
  const build=async()=>{const stored=await this.storage.read(file.fileId,file.owner,'USER');if(!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(stored.mime))throw missing();if(thumb!=='1'||stored.mime==='image/svg+xml')return{buffer:stored.buffer,mime:stored.mime,filename:'QGauss-'+id+'-'+(index+1)+'.'+(stored.mime==='image/jpeg'?'jpg':stored.mime==='image/svg+xml'?'svg':stored.mime.split('/')[1])};try{return{buffer:await sharp(stored.buffer,{limitInputPixels:36*1000*1000,animated:false}).rotate().resize({width:640,height:640,fit:'inside',withoutEnlargement:true}).webp({quality:78}).toBuffer(),mime:'image/webp',filename:'QGauss-'+id+'-preview.webp'};}catch{throw missing();}};
  let result:ImageResponse;
  if(thumb==='1'){this.prune();const cached=this.thumbnails.get(key);if(cached){this.thumbnails.delete(key);this.thumbnails.set(key,cached);result=cached.value;}else{let pending=this.rendering.get(key);if(!pending){pending=build().then(output=>{this.thumbnails.set(key,{value:output,expires:Date.now()+60000});this.thumbnailBytes+=output.buffer.length;this.prune();return output;}).finally(()=>this.rendering.delete(key));this.rendering.set(key,pending);}result=await pending;}}
  else result=await build();await this.stillPublished(userId,kind,id);return result;
 }
 async playback(userId:string,rawKind:unknown,rawId:unknown,rawIndex:unknown){const {kind,id}=this.args(rawKind,rawId),index=this.index(rawIndex??'0'),value=await this.snapshot(userId,kind,id);if(value.assets[index]?.kind!=='video')throw missing();const result=kind==='mj'?await this.mjMedia.playback(userId,value.task,index):kind==='video'&&index===0?await this.videoMedia.playback(userId,value.task):null;if(!result)throw missing();await this.stillPublished(userId,kind,id);return result;}
}
