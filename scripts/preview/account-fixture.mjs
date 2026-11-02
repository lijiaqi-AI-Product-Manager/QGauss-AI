/** Explicit synthetic identity and activity; no actual person, credential or geographic claim. */
export function accountFixtures(mode='account') {
  const profile={id:'qgauss-reference-only',username:'QGauss 观察员',displayName:mode==='account-long'?'每一个大胆的好点子都值得拥有自己的名字和充满想象力的创作空间':'把灵感写成诗',email:mode==='account-long'?'a-long-creative-identity-for-layout-observation@qgauss.test':'creator@qgauss.test',avatar:'qgauss:coral',role:'USER',createdAt:'2026-10-30T08:00:00Z'};
  const items=Array.from({length:9},(_,index)=>({id:'qgauss-account-login-'+index,success:index!==2,ip:'192.0.2.'+(index+11),userAgent:index%2?'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile Safari/604.1':'Mozilla/5.0 (Windows NT 10.0) Chrome/130.0',createdAt:new Date(Date.UTC(2026,10,1,6-index)).toISOString()}));
  return {'/api/users/profile':profile,'/api/users/logins':{items:mode==='account-empty'?[]:items,total:mode==='account-empty'?0:items.length,page:1,pageSize:4}};
}
export function accountLogPage(data,url) {
  const page=Number(url.searchParams.get('page')||1),pageSize=Number(url.searchParams.get('pageSize')||4);
  return {...data,page,pageSize,items:data.items.slice((page-1)*pageSize,page*pageSize)};
}
