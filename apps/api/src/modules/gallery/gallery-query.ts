import {Prisma} from '@prisma/client';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';

export type GalleryKind='image'|'mj'|'video';
export type GalleryFilters={kind:GalleryKind|'all';sort:'featured'|'newest'|'saved';page:number;pageSize:number;catId:string;q:string;favorites:boolean};
const bad=()=>new BusinessException(ErrorCode.PARAM_INVALID,'作品筛选或分页条件不正确',400);
export function galleryKind(value:unknown):GalleryKind{if(!['image','mj','video'].includes(value as string))throw bad();return value as GalleryKind;}
export function galleryId(value:unknown):string{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,128}$/.test(value))throw bad();return value;}
function scalar(value:unknown,fallback:string){if(value===undefined)return fallback;if(typeof value!=='string')throw bad();return value;}
function positive(value:unknown,fallback:number,max:number){const text=scalar(value,String(fallback));if(!/^[1-9][0-9]{0,5}$/.test(text)||Number(text)>max)throw bad();return Number(text);}
export function galleryFilters(query:Record<string,unknown>):GalleryFilters{
 const kind=scalar(query.kind,'all'),sort=scalar(query.sort,'featured'),flag=scalar(query.favorites,'0'),catId=scalar(query.catId,''),q=scalar(query.q,'').trim();
 if(kind!=='all')galleryKind(kind);if(!['featured','newest','saved'].includes(sort)||!['0','1'].includes(flag)||sort==='saved'&&flag!=='1'||catId&&!/^[A-Za-z0-9_-]{1,128}$/.test(catId)||q.length>100)throw bad();
 return{kind:kind as GalleryFilters['kind'],sort:sort as GalleryFilters['sort'],favorites:flag==='1',catId,q,page:positive(query.page,1,100000),pageSize:positive(query.pageSize,18,30)};
}
/** Normalize both legacy SQLite UTC text and current millisecond timestamps. */
const ms=(column:string)=>`CASE WHEN typeof(${column}) IN ('integer','real') THEN CAST(${column} AS INTEGER) ELSE CAST(round((julianday(${column})-2440587.5)*86400000) AS INTEGER) END`;
const normalized=(column:string,type:'array'|'object',fallback:string)=>`CASE WHEN json_valid(${column}) THEN CASE WHEN json_type(${column})='${type}' THEN ${column} ELSE '${fallback}' END ELSE '${fallback}' END`;
function activeFile(now:number){return Prisma.sql`f."deletedAt" IS NULL AND f."purgedAt" IS NULL AND (f."expiresAt" IS NULL OR ${Prisma.raw(ms('f."expiresAt"'))}>${now})`;}
function common(kind:GalleryKind,prompt:string){return Prisma.raw(`'${kind}' AS kind,t."id",t."userId",${prompt} AS prompt,t."catId",t."recommended",${ms('t."createdAt"')} AS createdMs,${ms('t."publishedAt"')} AS publishedMs,u."username" AS author`);}
function owner(){return Prisma.raw(`JOIN "users" u ON u."id"=t."userId" AND u."status"='ACTIVE' AND u."deletedAt" IS NULL`);}
const published=Prisma.raw(`t."published"=1 AND t."deletedAt" IS NULL AND t."status"='SUCCESS'`);

/** The same candidates define paging, counts, details and every later media read. */
export function gallerySource(userId:string,now=new Date()):Prisma.Sql{
 const time=now.getTime();if(!Number.isFinite(time))throw bad();
 const images=normalized('t."resultJson"','array','[]'),mj=normalized('t."resultJson"','object','{}'),videos=normalized('t."resultJson"','object','{}');
 const mjItems=`CASE WHEN json_type(${mj},'$.items')='array' THEN json_extract(${mj},'$.items') ELSE '[]' END`;
 const intent=normalized('t."intentJson"','object','{}');
 const intentPrompt=`CASE WHEN json_type(${intent},'$.prompt')='text' THEN json_extract(${intent},'$.prompt') ELSE '' END`;
 const preset=normalized('t."presetJson"','object','{}'),source=`CASE WHEN json_type(${preset},'$.sourceParams')='object' THEN json_extract(${preset},'$.sourceParams') ELSE ${intent} END`;
 const mjPrompt=`CASE WHEN json_type(${source},'$.prompt')='text' THEN json_extract(${source},'$.prompt') ELSE '' END`;
 const optionalText=(json:string,key:string)=>`(json_type(${json},'$.${key}') IS NULL OR json_type(${json},'$.${key}') IN ('null','text','false') OR (json_type(${json},'$.${key}') IN ('integer','real') AND json_extract(${json},'$.${key}')=0))`;
 const item=`CASE WHEN r.type='object' THEN r.value ELSE '{}' END`;
 const candidate=Prisma.sql`
  SELECT ${common('image','t."prompt"')} FROM "image_tasks" t ${owner()}
  WHERE ${published} AND json_array_length(${Prisma.raw(images)}) BETWEEN 1 AND 4
   AND NOT EXISTS(SELECT 1 FROM json_each(${Prisma.raw(images)}) r
    LEFT JOIN "upload_files" f ON f."id"=json_extract(${Prisma.raw(item)},'$.fileId')
    WHERE COALESCE(r.type='object' AND json_type(${Prisma.raw(item)},'$.fileId')='text' AND f."userId"=t."userId" AND f."scope"='image' AND f."mime" IN ('image/png','image/jpeg','image/webp','image/gif','image/svg+xml') AND f."size">0 AND ${activeFile(time)},0)=0)
  UNION ALL
  SELECT ${common('mj',mjPrompt)} FROM "mj_tasks" t ${owner()}
  WHERE ${published} AND json_array_length(${Prisma.raw(mjItems)}) BETWEEN 1 AND 4 AND ${Prisma.raw(optionalText(mj,'text'))}
   AND NOT EXISTS(SELECT 1 FROM json_each(${Prisma.raw(mjItems)}) r
    LEFT JOIN "upload_files" f ON f."id"=json_extract(${Prisma.raw(item)},'$.fileId')
    WHERE COALESCE(r.type='object' AND json_type(${Prisma.raw(item)},'$.fileId')='text' AND f."userId"=t."userId" AND f."mime"=json_extract(${Prisma.raw(item)},'$.mime') AND f."size"=json_extract(${Prisma.raw(item)},'$.size') AND f."size" BETWEEN 1 AND 9007199254740991 AND f."sha256"=json_extract(${Prisma.raw(item)},'$.sha256') AND length(f."sha256")=64 AND f."sha256" NOT GLOB '*[^a-f0-9]*' AND ((json_extract(${Prisma.raw(item)},'$.kind')='image' AND f."scope"='mj-image' AND f."mime" IN ('image/png','image/jpeg','image/webp')) OR (json_extract(${Prisma.raw(item)},'$.kind')='video' AND f."scope"='video' AND f."mime"='video/mp4')) AND ${activeFile(time)},0)=0)
  UNION ALL
  SELECT ${common('video',intentPrompt)} FROM "video_tasks" t ${owner()}
  WHERE ${published} AND json_type(${Prisma.raw(videos)},'$.videoFileId')='text' AND ${Prisma.raw(optionalText(videos,'posterFileId'))} AND EXISTS(SELECT 1 FROM "upload_files" f
   WHERE f."id"=json_extract(${Prisma.raw(videos)},'$.videoFileId') AND f."userId"=t."userId" AND f."scope"='video' AND f."mime"='video/mp4' AND f."size">0 AND ${activeFile(time)})`;
 return Prisma.sql`WITH public_works AS (${candidate}),scoped AS (
  SELECT p.*,
   (SELECT COALESCE(${Prisma.raw(ms('g."createdAt"'))},0) FROM "gallery_favorites" g WHERE g."userId"=${userId} AND g."kind"=p.kind AND g."taskId"=p."id") AS savedMs,
   (SELECT count(*) FROM "gallery_favorites" g JOIN "users" a ON a."id"=g."userId" AND a."status"='ACTIVE' AND a."deletedAt" IS NULL WHERE g."kind"=p.kind AND g."taskId"=p."id") AS favoriteCount
  FROM public_works p)`;
}
export function galleryWhere(filter:GalleryFilters):Prisma.Sql{
 const parts:Prisma.Sql[]=[];
 if(filter.kind!=='all')parts.push(Prisma.sql`kind=${filter.kind}`);
 if(filter.catId)parts.push(Prisma.sql`"catId"=${filter.catId}`);
 if(filter.q)parts.push(Prisma.sql`instr(lower(prompt),lower(${filter.q}))>0`);
 if(filter.favorites)parts.push(Prisma.sql`savedMs IS NOT NULL`);
 return parts.length?Prisma.sql`WHERE ${Prisma.join(parts,' AND ')}`:Prisma.empty;
}
export function galleryOrder(sort:GalleryFilters['sort']):Prisma.Sql{return Prisma.raw((sort==='featured'?'"recommended" DESC,':sort==='saved'?'savedMs DESC,':'')+'COALESCE(publishedMs,createdMs) DESC,kind ASC,"id" DESC');}

/** Legacy workbenches share the public visibility rules without relying on absent ORM relations. */
export async function galleryPublicPage(tx:Prisma.TransactionClient,kind:GalleryKind,page:number,size:number,catId?:string,featured=false){
 if(catId!==undefined&&typeof catId!=='string')throw bad();
 const source=gallerySource(''),where=Prisma.sql`WHERE kind=${kind}${catId?Prisma.sql` AND "catId"=${catId}`:Prisma.empty}`;
 const counts=await tx.$queryRaw<Array<{total:number|bigint}>>(Prisma.sql`${source} SELECT count(*) AS total FROM scoped ${where}`);
 const rows=await tx.$queryRaw<Array<{id:string}>>(Prisma.sql`${source} SELECT "id" FROM scoped ${where} ORDER BY ${Prisma.raw((featured?'"recommended" DESC,':'')+'createdMs DESC,"id" DESC')} LIMIT ${size} OFFSET ${(page-1)*size}`);
 return{ids:rows.map(row=>row.id),total:Number(counts[0]?.total||0)};
}

export type GalleryPublicRow={kind:GalleryKind;id:string;userId:string;prompt:string;catId:string|null;recommended:number|boolean;createdMs:number|bigint|null;publishedMs:number|bigint|null;savedMs:number|bigint|null;author:string;favoriteCount:number|bigint};
