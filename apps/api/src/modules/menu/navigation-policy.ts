import {createHash} from 'node:crypto';
import catalog from '../../common/navigation/navigation-catalog.json';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';

export const NAV_CATALOG=catalog;
export const NAV_STATE='navigation.state';
export const NAV_FIELDS=['parentId','title','titleEn','titleTw','hint','hintEn','hintTw','path','icon','activeIcon','iconMode','iconUrl','activeIconUrl','sort','visible','roles','standardKey','kind','surface','platform','targetUrl','openInNewTab','requireLogin'] as const;
export const navBad=(message='这份导航调整不完整，请重新核对。',status=422)=>new BusinessException(ErrorCode.PARAM_INVALID,message,status);
export const navMissing=()=>new BusinessException(ErrorCode.NOT_FOUND,'这个导航入口暂时不可用。',404);
export const navHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const navOrder=(a:any,b:any)=>a.sort-b.sort||(a.id<b.id?-1:a.id>b.id?1:0);
export const navRoles=(value:string)=>{const values=String(value||'').split(',').map(x=>x.trim().toUpperCase()).filter(Boolean);return values.every(x=>['ALL','ADMIN','USER'].includes(x))?[...new Set(values)]:[];};
export const navId=(value:unknown)=>{if(typeof value!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(value))throw navBad();return value;};
export const navKey=(value:unknown)=>{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value))throw navBad();return value;};
export const navObject=(value:unknown,keys:readonly string[])=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(key=>!keys.includes(key)))throw navBad();return value as Record<string,any>;};
const routes=new Map(catalog.routes.map(row=>[row.path,row])),standards=new Map([...catalog.routes,...catalog.groups].map(row=>[row.key,row]));
const samePath=(value:string)=>{try{const path=new URL(value,'https://qgauss.invalid').pathname;return (catalog.aliases as Record<string,string>)[path]||path;}catch{return'';}};
export function navRoute(value:string){return routes.get(samePath(value));}
export function navInternal(value:string){if(typeof value!=='string'||!value.startsWith('/')||value.startsWith('//')||/[\\\x00-\x20\x7f]/.test(value)||value.length>2048)return false;try{return new URL(value,'https://qgauss.invalid').origin==='https://qgauss.invalid'&&!!navRoute(value);}catch{return false;}}
export function navWeb(value:string){
 if(typeof value!=='string'||value.length>2048||/[\\\x00-\x20\x7f]/.test(value))return false;
 try{const url=new URL(value),host=url.hostname.toLowerCase();if(url.protocol!=='https:'||url.username||url.password||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.startsWith('['))return false;
  if(/^\d+(?:\.\d+){3}$/.test(host)){const [a,b]=host.split('.').map(Number);if([0,10,127].includes(a)||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168)return false;}return true;
 }catch{return false;}
}
export function navFrame(value:string){return navWeb(value)||typeof value==='string'&&/^\/extensions\/[A-Za-z0-9_/-]+\.html(?:[?#][^\\\x00-\x20\x7f]*)?$/.test(value)&&!value.includes('..');}
export function navImage(value:string){
 if(!value)return true;if(navWeb(value))return true;if(/^\/(?:art|brand|extensions)\/[A-Za-z0-9_./%-]+(?:[?#][^\\\x00-\x20\x7f]*)?$/.test(value)&&!value.includes('..'))return true;
 if(!value.startsWith('data:image/png;base64,')||value.length>98304||!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))return false;
 try{const bytes=Buffer.from(value.slice(22),'base64');return bytes.length>=33&&bytes.subarray(0,8).toString('hex')==='89504e470d0a1a0a'&&bytes.subarray(12,16).toString()==='IHDR'&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(16)<=512&&bytes.readUInt32BE(20)>0&&bytes.readUInt32BE(20)<=512;}catch{return false;}
}
export function navDraft(row:any={}){
 return{parentId:row.parentId??null,title:row.title??'',titleEn:row.titleEn??'',titleTw:row.titleTw??'',hint:row.hint??'',hintEn:row.hintEn??'',hintTw:row.hintTw??'',path:row.path??'',icon:row.icon??'apps',activeIcon:row.activeIcon??'',iconMode:row.iconMode??'symbol',iconUrl:row.iconUrl??'',activeIconUrl:row.activeIconUrl??'',sort:row.sort??0,visible:row.visible??true,roles:row.roles??'ADMIN',standardKey:row.standardKey??'',kind:row.kind??'internal',surface:row.surface??'manage',platform:row.platform??'all',targetUrl:row.targetUrl??'',openInNewTab:row.openInNewTab??false,requireLogin:row.requireLogin??true};
}
export function navFields(row:any){return{id:row.id,...navDraft(row),version:row.version??1,deletedAt:row.deletedAt?new Date(row.deletedAt).toISOString():null,archiveBatchId:row.archiveBatchId??null};}
export const navRowRevision=(row:any)=>navHash(navFields(row));
export const navRevision=(rows:any[],initialized:boolean)=>navHash({catalog:catalog.version,initialized,rows:[...rows].sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0).map(navFields)});
export function navLabels(row:any){const standard=standards.get(row.standardKey);const builtin=standard&&row.title===standard.title&&(row.kind==='group'||samePath(row.path)===standard.path);return{title:row.title,titleEn:row.titleEn||(builtin?standard.titleEn:row.title),titleTw:row.titleTw||(builtin?standard.titleTw:row.title),hint:row.hint||'',hintEn:row.hintEn||row.hint||'',hintTw:row.hintTw||row.hint||''};}

export function navInitial(stored:any[],initialized:boolean){
 const rows=stored.map(row=>({...row,...navDraft(row),virtual:false}));if(initialized)return rows;
 for(const group of catalog.groups){
  let parent=rows.find(row=>!row.parentId&&row.path===group.path&&row.surface===group.surface&&!row.deletedAt);
  if(!parent){parent={id:'qg-nav-'+group.key,...navDraft({title:group.title,path:group.path,kind:'group',surface:group.surface,icon:group.icon,standardKey:group.key,sort:catalog.groups.indexOf(group)*10,roles:group.surface==='client'?'ALL':'ADMIN',requireLogin:group.surface!=='client'}),version:1,deletedAt:null,archiveBatchId:null,virtual:true};rows.push(parent);}
  const keys=(catalog.defaults as Record<string,string[]>)[group.key]||[];
  keys.forEach((key,index)=>{const route=catalog.routes.find(row=>row.key===key)!;if(rows.some(row=>row.surface===group.surface&&row.path===route.path))return;
   rows.push({id:'qg-nav-'+group.surface+'-'+key,...navDraft({parentId:parent!.id,title:route.title,path:route.path,standardKey:key,icon:route.icon,sort:(index+1)*10,surface:group.surface,roles:route.admin?'ADMIN':'ALL',requireLogin:!route.public}),version:1,deletedAt:null,archiveBatchId:null,virtual:true});
  });
 }
 return rows;
}

export function navPatch(raw:unknown){
 const patch=navObject(raw,NAV_FIELDS);if(!Object.keys(patch).length)throw navBad();
 for(const[key,value]of Object.entries(patch)){
  if(key==='parentId'){if(value!==null)navId(value);continue;}
  if(key==='sort'){if(!Number.isSafeInteger(value)||Math.abs(value)>1000000)throw navBad('排序请填写 -1000000 至 1000000 的整数。');continue;}
  if(['visible','openInNewTab','requireLogin'].includes(key)){if(typeof value!=='boolean')throw navBad();continue;}
  if(key==='icon'&&value===null)continue;if(typeof value!=='string')throw navBad();
  const max=['iconUrl','activeIconUrl'].includes(key)?98304:['hint','hintEn','hintTw'].includes(key)?500:['path','targetUrl'].includes(key)?2048:['title','titleEn','titleTw'].includes(key)?80:100;
  if(value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))throw navBad('这项内容过长或包含无法使用的字符。');
  if(key==='title'&&!value.trim())throw navBad('请填写导航名称。');
  if(['icon','activeIcon'].includes(key)&&value&&!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(value))throw navBad('请选择可用的图标。');
  if(['iconUrl','activeIconUrl'].includes(key)&&!navImage(value))throw navBad('请使用可公开访问的图片地址，或上传较小的 PNG 图标。');
  if(key==='roles'&&(!navRoles(value).length||value.length>40))throw navBad('请选择明确的可见范围。');
  if(key==='standardKey'&&value&&!standards.has(value))throw navBad();
  if(key==='kind'&&!['group','internal','embed','external'].includes(value)||key==='surface'&&!['client','manage','both'].includes(value)||key==='platform'&&!['all','desktop','mobile'].includes(value)||key==='iconMode'&&!['symbol','image'].includes(value))throw navBad();
 }
 return patch;
}
export function navValidateEntry(row:any,touched:Set<string>,fresh=false){
 if(fresh&&!row.title.trim())throw navBad('请填写导航名称。');
 if(fresh||['kind','path','targetUrl'].some(key=>touched.has(key))){
  if(row.kind==='internal'&&!navInternal(row.path))throw navBad('请选择已提供的站内页面。');
  if(row.kind==='external'&&!navWeb(row.targetUrl)||row.kind==='embed'&&!navFrame(row.targetUrl))throw navBad('请填写可用的 HTTPS 地址，或使用站内扩展画布。');
 }
 if((fresh||['iconMode','iconUrl'].some(key=>touched.has(key)))&&row.iconMode==='image'&&!row.iconUrl)throw navBad('请先选择一张图标图片。');
 if((fresh||['roles','path','kind'].some(key=>touched.has(key)))&&row.kind==='internal'&&navRoute(row.path)?.admin&&navRoles(row.roles).some(role=>role!=='ADMIN'))throw navBad('管理页面只可向管理员开放。');
}
export function navValidateTree(rows:any[],changed:Set<string>,before:any[]){
 const all=new Map(rows.map(row=>[row.id,row])),prior=new Map(before.map(row=>[row.id,row]));
 for(const row of rows)if(row.deletedAt&&changed.has(row.id)&&!prior.get(row.id)?.deletedAt&&rows.some(child=>child.parentId===row.id&&!child.deletedAt))throw navBad('请一并收起这个分组中的入口。');
 for(const row of rows){
  if(row.deletedAt)continue;
  if(row.parentId){const parent=all.get(row.parentId);if(changed.has(row.id)||parent&&changed.has(parent.id)){
   if(!parent||parent.deletedAt)throw navBad('请先恢复父分组，或把入口移到可用分组。');
   if(parent.kind!=='group')throw navBad('父项需要是导航分组。');
   if(parent.surface!=='both'&&parent.surface!==row.surface)throw navBad('入口与父分组的展示区域需要一致。');
   if(parent.platform!=='all'&&row.platform!==parent.platform)throw navBad('入口与父分组的设备范围需要一致。');
  }}
  if(changed.has(row.id)){const seen=new Set([row.id]);let parent=row.parentId,depth=0;while(parent){if(seen.has(parent)||++depth>6)throw navBad('分组不能循环引用，最多使用六层。');seen.add(parent);parent=all.get(parent)?.parentId;}}
 }

}
export function navAvailable(row:any){return row.kind==='group'||row.kind==='internal'?row.kind==='group'||navInternal(row.path):row.kind==='external'?navWeb(row.targetUrl):row.kind==='embed'&&navFrame(row.targetUrl);}
export function navTree(rows:any[],role:string|null,platform:string,commerce=true){
 const can=(row:any)=>{const roles=row.roles.trim()?navRoles(row.roles):['ALL'],r=role||'USER';return !row.deletedAt&&row.visible&&(row.platform==='all'||row.platform===platform)&&(roles.includes('ALL')||roles.includes(r))&&(!navRoute(row.path)?.admin||role==='ADMIN')&&(commerce||row.standardKey!=='commerce'&&!navRoute(row.path)?.commerce);};
 const children=new Map<string,any[]>();for(const row of rows){const key=row.parentId||'';if(!children.has(key))children.set(key,[]);children.get(key)!.push(row);}
 const visit=(parent:string,seen:Set<string>,depth:number):any[]=>{if(depth>6)return[];return(children.get(parent)||[]).sort(navOrder).flatMap(row=>{if(seen.has(row.id)||!can(row))return[];const branch=visit(row.id,new Set([...seen,row.id]),depth+1);const locked=!role&&row.requireLogin&&row.kind!=='group';const destination=row.kind==='internal'||row.kind==='group'?row.path:'/navigation/entry/'+row.id;
  return[{id:row.id,...navLabels(row),path:locked?'/login?redirect='+encodeURIComponent(destination):destination,kind:row.kind,surface:row.surface,platform:row.platform,sort:row.sort,icon:row.icon,activeIcon:row.activeIcon,iconMode:row.iconMode,iconUrl:navImage(row.iconUrl)?row.iconUrl:'',activeIconUrl:navImage(row.activeIconUrl)?row.activeIconUrl:'',openInNewTab:row.openInNewTab,requireLogin:row.requireLogin,loginRequired:locked,available:navAvailable(row),admin:!!navRoute(row.path)?.admin,commerce:row.standardKey==='commerce'||!!navRoute(row.path)?.commerce,url:row.kind==='external'&&!locked&&navWeb(row.targetUrl)?row.targetUrl:null,children:branch}];
 });};return visit('',new Set(),0);
}
