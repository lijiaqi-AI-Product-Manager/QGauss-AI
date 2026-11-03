const legacyTargets={
 '/image':'/painting','/app-store':'/apps','/user-center':'/account',
 '/pay':'/recharge','/share':'/sales','/mind':'/mindmap',
};
export const legacyRoutes=Object.entries(legacyTargets).map(([path,target])=>({path,redirect:to=>({path:target,query:to.query,hash:to.hash})}));

export function systemStatusRoutes(component){
 return[
  ...[['/404','notFoundPage','404'],['/500','serverError','500'],['/unauthorized','unauthorized','403'],['/update-expired','updateRequired','update']].map(([path,name,systemStatus])=>({path,name,component,meta:{public:true,authSurface:true,systemStatus}})),
  {path:'/:pathMatch(.*)*',name:'notFound',component,meta:{public:true,authSurface:true,systemStatus:'404'}},
 ];
}

/** Navigation destinations stay in this application, including after a failed import. */
export function safeReturnTarget(router,value,fallback='/chat'){
 if(typeof value!=='string'||value.length>4096||!value.startsWith('/')||value.startsWith('//')||/[\\\u0000-\u0020\u007f]/.test(value))return fallback;
 try{const target=router.resolve(value);if(!target.matched.length||target.meta.systemStatus||target.path.startsWith('//'))return fallback;return target.fullPath;}catch{return fallback;}
}

export function isImplementedRoute(router,path,seen=new Set()){
 if(typeof path!=='string'||seen.has(path)||seen.size>=6||!path.startsWith('/')||path.startsWith('//'))return false;seen.add(path);
 try{const target=router.resolve(path);if(target.meta.systemStatus||!target.matched.length)return false;const record=target.matched.at(-1);if(!record.redirect)return!!record.components;
  const redirect=typeof record.redirect==='function'?record.redirect(target):record.redirect;
  return typeof redirect==='string'?isImplementedRoute(router,redirect,seen):redirect&&typeof redirect.path==='string'?isImplementedRoute(router,redirect.path,seen):false;
 }catch{return false;}
}

export function isPageAssetError(error){return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Loading (?:CSS )?chunk [^\n]+ failed|Unable to preload CSS/i.test(String(error?.message||error||''));}

export function installRouteRecovery(router){
 let recovering=false;
 return router.onError((error,to)=>{
  if(recovering||to?.meta?.systemStatus)return;
  recovering=true;
  const path=isPageAssetError(error)?'/update-expired':'/500',target=safeReturnTarget(router,to?.fullPath);
  Promise.resolve(router.replace({path,query:{return:target}})).catch(()=>{}).finally(()=>{recovering=false;});
 });
}
