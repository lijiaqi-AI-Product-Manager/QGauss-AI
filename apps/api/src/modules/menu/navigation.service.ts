import {Injectable} from '@nestjs/common';
import {MenuOperation,Prisma} from '@prisma/client';
import {PrismaService} from '../../common/prisma/prisma.service';
import {AuthUser,authSession} from '../../common/decorators/current-user.decorator';
import {SecretBox} from '../../common/crypto/secret-box';
import {RateLimitService} from '../../common/ratelimit/rate-limit.service';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';
import {CONFIG_MAP} from '../../common/config/config.registry';
import {NAV_CATALOG,NAV_FIELDS,NAV_STATE,navAvailable,navBad,navDraft,navFields,navHash,navId,navInitial,navKey,navLabels,navMissing,navObject,navPatch,navRevision,navRowRevision,navTree,navValidateEntry,navValidateTree} from './navigation-policy';
type Db=Prisma.TransactionClient;
type Input={action:'save'|'archive'|'restore';expectedRevision:string;changes?:{id:string;expectedRevision:string|null;patch:Record<string,any>}[];ids?:string[]};
const revision=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))throw navBad();return value;};
const version=(value:unknown)=>{if(!Number.isSafeInteger(value)||Number(value)<0)throw navBad();return Number(value);};
function input(value:unknown):Input{
 const body=navObject(value,['action','expectedVersion','expectedRevision','changes','ids']);if(version(body.expectedVersion)!==0||!['save','archive','restore'].includes(body.action)||Buffer.byteLength(JSON.stringify(body))>524288)throw navBad();
 const base={action:body.action,expectedRevision:revision(body.expectedRevision)};
 if(body.action==='save'){
  if(body.ids!==undefined||!Array.isArray(body.changes)||!body.changes.length||body.changes.length>200)throw navBad();const seen=new Set<string>();
  const changes=body.changes.map(raw=>{const row=navObject(raw,['id','expectedRevision','patch']),id=navId(row.id);if(seen.has(id))throw navBad();seen.add(id);const patch=navPatch(row.patch);return{id,expectedRevision:row.expectedRevision===null?null:revision(row.expectedRevision),patch:Object.fromEntries(NAV_FIELDS.filter(key=>Object.hasOwn(patch,key)).map(key=>[key,patch[key]]))};}).sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0);return{...base,changes};
 }
 if(body.changes!==undefined||!Array.isArray(body.ids)||!body.ids.length||body.ids.length>500)throw navBad();const ids=body.ids.map(navId).sort();if(new Set(ids).size!==ids.length)throw navBad();return{...base,ids};
}
@Injectable()
export class NavigationService{
 constructor(private readonly prisma:PrismaService,private readonly box:SecretBox,private readonly rate:RateLimitService){}
 private limit(actor:AuthUser,kind:string,max=60){if(!this.rate.tryConsume('navigation:'+kind+':'+actor.id,max,60000))throw new BusinessException(ErrorCode.RATE_LIMITED,'导航核对有些频繁，请稍后再试。',429);}
 private async actor(db:Db,actor:AuthUser,admin=true){
  if(!actor?.id)throw new BusinessException(ErrorCode.UNAUTHORIZED,'当前登录已变化，请重新登录',401);
  await db.$executeRaw`UPDATE "users" SET "id"="id" WHERE "id"=${actor.id}`;
  const context=authSession(actor),now=new Date(),user=await db.user.findFirst({where:{id:actor.id,status:'ACTIVE',deletedAt:null}});
  if(!context||!user||context.tokenVersion!==user.tokenVersion||context.expiresAt!==null&&context.expiresAt<=now.getTime()||!await db.refreshToken.findFirst({where:{userId:actor.id,familyId:context.familyId,revokedAt:null,expiresAt:{gt:now}},select:{id:true}}))throw new BusinessException(ErrorCode.UNAUTHORIZED,'当前登录已变化，请重新登录',401);
  if(admin&&(actor.role!=='ADMIN'||user.role!=='ADMIN'))throw new BusinessException(ErrorCode.FORBIDDEN,'当前账号没有管理权限。',403);return{user,context};
 }
 private async state(db:Db){
  const [stored,config]=await Promise.all([db.menu.findMany({orderBy:{id:'asc'}}),db.globalConfig.findUnique({where:{key:NAV_STATE}})]);if(stored.length>2000)throw navBad('导航内容暂时过多，请联系维护人员整理。',503);
  let initialized=false;try{const value=JSON.parse(config?.value||'null');initialized=value?.version===1&&value.initialized===true;}catch{}
  const rows=navInitial(stored,initialized);return{rows,initialized,revision:navRevision(rows,initialized)};
 }
 private async materialize(db:Db,state:Awaited<ReturnType<NavigationService['state']>>){
  for(const row of state.rows.filter(row=>row.virtual))await db.menu.create({data:{id:row.id,...navDraft(row),version:row.version}});
  if(!state.initialized)await db.globalConfig.upsert({where:{key:NAV_STATE},create:{key:NAV_STATE,value:JSON.stringify({version:1,initialized:true})},update:{value:JSON.stringify({version:1,initialized:true})}});
 }
 private view(row:any){return{...navFields(row),labels:navLabels(row),revision:navRowRevision(row),available:navAvailable(row),virtual:!!row.virtual};}
 private async commerce(db:Db){const row=await db.globalConfig.findUnique({where:{key:'commerce.enabled'}});try{return row?JSON.parse(row.value)===true:CONFIG_MAP.get('commerce.enabled')?.default===true;}catch{return false;}}
 async workspace(actor:AuthUser){this.limit(actor,'workspace',90);return this.prisma.$transaction(async db=>{await this.actor(db,actor);const state=await this.state(db);return{userId:actor.id,readAt:new Date().toISOString(),revision:state.revision,initialized:state.initialized,items:state.rows.map(row=>this.view(row)),catalog:NAV_CATALOG};});}
 async navigation(actor?:AuthUser,platform='desktop'){
  if(!['desktop','mobile'].includes(platform))throw navBad();return this.prisma.$transaction(async db=>{const user=actor?(await this.actor(db,actor,false)).user:null,state=await this.state(db);return{userId:user?.id||null,role:user?.role||'GUEST',readAt:new Date().toISOString(),revision:state.revision,initialized:state.initialized,items:navTree(state.rows,user?.role||null,platform,await this.commerce(db))};});
 }
 async treeFor(role:string){const state=await this.state(this.prisma);return navTree(state.rows,role,'desktop',await this.commerce(this.prisma));}
 async all(actor:AuthUser){const value=await this.workspace(actor);return value.items.filter(row=>!row.deletedAt);}
 async entry(id:string,actor?:AuthUser,platform='desktop'){
  navId(id);if(!['desktop','mobile'].includes(platform))throw navBad();return this.prisma.$transaction(async db=>{
   const user=actor?(await this.actor(db,actor,false)).user:null,state=await this.state(db),row=state.rows.find(item=>item.id===id);if(!row||row.deletedAt)throw navMissing();
   const find=(items:any[]):any=>{for(const item of items){if(item.id===id)return item;const child=find(item.children||[]);if(child)return child;}return null;},node=find(navTree(state.rows,user?.role||null,platform,await this.commerce(db)));
   if(!node||!node.available||row.kind==='group')throw navMissing();if(row.requireLogin&&!user)throw new BusinessException(ErrorCode.UNAUTHORIZED,'请先登录，再打开这个入口。',401);
   return{id,revision:navRowRevision(row),...navLabels(row),kind:row.kind,path:row.kind==='internal'?row.path:null,url:['embed','external'].includes(row.kind)?row.targetUrl:null,openInNewTab:row.openInNewTab,serverNow:new Date().toISOString()};
  });
 }
 private receipt(row:MenuOperation){
  let items:unknown[]=[];if(row.status==='APPLIED'){try{if(!row.payloadEnc)throw Error();const payload=JSON.parse(this.box.decrypt(row.payloadEnc));if(!Array.isArray(payload))throw Error();items=payload;}catch{throw navBad('导航结果尚未核对完整，请继续核对原申请。',503);}}
  return{id:row.id,ownerId:row.ownerId,action:row.action,status:row.status.toLowerCase(),version:row.version,reason:row.reason,detail:row.detail,items,serverNow:new Date().toISOString(),createdAt:row.createdAt.toISOString(),...(row.appliedAt?{appliedAt:row.appliedAt.toISOString()}:{}),...(row.closedAt?{closedAt:row.closedAt.toISOString()}:{} )};
 }
 async read(key:string,actor:AuthUser){navKey(key);this.limit(actor,'read',180);return this.prisma.$transaction(async db=>{await this.actor(db,actor);const row=await db.menuOperation.findUnique({where:{id:key}});if(!row||row.ownerId!==actor.id)throw navMissing();return this.receipt(row);});}
 async apply(key:string,raw:unknown,actor:AuthUser){
  navKey(key);const body=input(raw),hash=navHash(body);this.limit(actor,'apply',30);const result=await this.prisma.$transaction(async db=>{
   const {context}=await this.actor(db,actor),prior=await db.menuOperation.findUnique({where:{id:key}});if(prior){if(prior.ownerId!==actor.id)throw navMissing();if(prior.status==='CLOSED')return prior;if(prior.inputHash!==hash)throw navBad('这次导航申请已有变化，请核对原结果。',409);return prior;}
   const base={id:key,ownerId:actor.id,familyId:context.familyId,tokenVersion:context.tokenVersion,inputHash:hash,action:body.action},state=await this.state(db),reject=(reason:string,detail='')=>db.menuOperation.create({data:{...base,status:'REJECTED',reason,detail}});if(state.revision!==body.expectedRevision)return reject('changed');
   const before=new Map(state.rows.map(row=>[row.id,row])),after=new Map(state.rows.map(row=>[row.id,{...row}])),structure=new Set<string>(),ids:string[]=[];
   try{
    if(body.action==='save')for(const change of body.changes!){
     const row=before.get(change.id);if(row){if(change.expectedRevision!==navRowRevision(row))return reject('changed');if(row.deletedAt)throw navBad('请先恢复这个入口。');}else{if(change.expectedRevision!==null)return reject('changed');navKey(change.id);if(state.rows.length+body.changes!.filter(item=>!before.has(item.id)).length>2000)throw navBad('导航内容暂时过多，请先整理已有入口。');}
     const proposed={...(row||{id:change.id,...navDraft(),version:1,deletedAt:null,archiveBatchId:null,virtual:false}),...change.patch};navValidateEntry(proposed,new Set(Object.keys(change.patch)),!row);after.set(change.id,proposed);ids.push(change.id);if(!row||['parentId','kind','surface','platform'].some(field=>Object.hasOwn(change.patch,field)))structure.add(change.id);
    }
    else for(const id of body.ids!){const row=before.get(id);if(!row)throw navMissing();if(body.action==='archive'&&row.deletedAt||body.action==='restore'&&!row.deletedAt)throw navBad('这个入口的整理状态已有变化。');after.set(id,{...row,deletedAt:body.action==='archive'?new Date():null,archiveBatchId:body.action==='archive'?key:null});structure.add(id);ids.push(id);}
    navValidateTree([...after.values()],structure,state.rows);
   }catch(error){if(error instanceof BusinessException)return reject(error.getStatus()===404?'missing':'invalid',typeof error.getResponse()==='object'?String((error.getResponse() as any).message||''):error.message);throw error;}
   await this.materialize(db,state);
   if(body.action==='save')for(const change of body.changes!){if(before.has(change.id))await db.menu.update({where:{id:change.id},data:change.patch});else await db.menu.create({data:{id:change.id,...navDraft(after.get(change.id))}});}
   else for(const id of ids){const proposed=after.get(id)!;await db.menu.update({where:{id},data:{deletedAt:proposed.deletedAt,archiveBatchId:proposed.archiveBatchId}});}
   const final=await db.menu.findMany({where:{id:{in:ids}}}),byId=new Map(final.map(row=>[row.id,row])),items=ids.map(id=>({id,title:after.get(id)!.title,before:before.has(id)?navFields(before.get(id)):null,after:navFields(byId.get(id))}));return db.menuOperation.create({data:{...base,status:'APPLIED',payloadEnc:this.box.encrypt(JSON.stringify(items)),appliedAt:new Date()}});
  });return this.receipt(result);
 }
 async close(key:string,raw:unknown,actor:AuthUser){
  navKey(key);const expected=version(navObject(raw,['expectedVersion']).expectedVersion);this.limit(actor,'close',30);return this.prisma.$transaction(async db=>{const{context}=await this.actor(db,actor),prior=await db.menuOperation.findUnique({where:{id:key}});if(prior){if(prior.ownerId!==actor.id)throw navMissing();if(expected>prior.version)throw navBad('这次导航申请已有变化，请核对原结果。',409);return this.receipt(prior);}if(expected!==0)throw navBad();return this.receipt(await db.menuOperation.create({data:{id:key,ownerId:actor.id,familyId:context.familyId,tokenVersion:context.tokenVersion,status:'CLOSED',closedAt:new Date()}}));});
 }
 async create(raw:unknown,actor:AuthUser){
  const input=raw&&typeof raw==='object'&&!Array.isArray(raw)?{...raw as Record<string,unknown>}:raw;if(input&&typeof input==='object'&&(input as any).roles==='')(input as any).roles='ALL';const patch=navPatch(input);if(Object.keys(patch).length>20)throw navBad('请到导航工作台预览后保存。',409);this.limit(actor,'legacy',30);return this.prisma.$transaction(async db=>{await this.actor(db,actor);const state=await this.state(db),value=navDraft(patch);if(!patch.kind&&!patch.parentId&&value.path&&!NAV_CATALOG.routes.some(item=>item.path===value.path)){if(!/^\/[A-Za-z0-9_/-]*$/.test(value.path))throw navBad('请选择已提供的站内页面。');value.kind='group';}navValidateEntry(value,new Set(Object.keys(patch)),true);navValidateTree([...state.rows,{id:'new-menu',...value}],new Set(['new-menu']),state.rows);await this.materialize(db,state);return db.menu.create({data:value});});
 }
 async update(id:string,raw:unknown,actor:AuthUser){
  navId(id);const patch=navPatch(raw);if(Object.keys(patch).length>20)throw navBad('请到导航工作台预览后保存。',409);this.limit(actor,'legacy',30);return this.prisma.$transaction(async db=>{await this.actor(db,actor);const state=await this.state(db),row=state.rows.find(item=>item.id===id);if(!row||row.deletedAt)throw navMissing();const after={...row,...patch};navValidateEntry(after,new Set(Object.keys(patch)));navValidateTree(state.rows.map(item=>item.id===id?after:item),new Set(['parentId','kind','surface','platform'].some(field=>Object.hasOwn(patch,field))?[id]:[]),state.rows);await this.materialize(db,state);return db.menu.update({where:{id},data:patch});});
 }
 async remove(id:string,actor:AuthUser){
  navId(id);this.limit(actor,'legacy',30);return this.prisma.$transaction(async db=>{await this.actor(db,actor);const state=await this.state(db),row=state.rows.find(item=>item.id===id);if(!row)throw navMissing();if(row.deletedAt)return{ok:true};const selected=new Set([id]);let changed=true;while(changed){changed=false;for(const item of state.rows)if(!item.deletedAt&&item.parentId&&selected.has(item.parentId)&&!selected.has(item.id)){selected.add(item.id);changed=true;}}await this.materialize(db,state);for(const target of selected)await db.menu.update({where:{id:target},data:{deletedAt:new Date(),archiveBatchId:'legacy-'+id}});return{ok:true};});
 }
}
