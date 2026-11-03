import test from 'node:test';
import assert from 'node:assert/strict';
import {createRouter,createMemoryHistory} from 'vue-router';
import {legacyRoutes,systemStatusRoutes,safeReturnTarget,isImplementedRoute,isPageAssetError,installRouteRecovery} from '../src/lib/route-recovery.js';
const page={render:()=>null};
const routerFor=(extra=[],status=page)=>createRouter({history:createMemoryHistory(),routes:[...['chat','apps','account','recharge','sales','mindmap','painting'].map(name=>({path:'/'+name,name,component:page})),...extra,...legacyRoutes,...systemStatusRoutes(status)]});
const settle=()=>new Promise(done=>setImmediate(done));

test('legacy product links preserve all query values and the document position',async()=>{
 const router=routerFor();for(const [from,to]of [['/image','/painting'],['/app-store','/apps'],['/user-center','/account'],['/pay','/recharge'],['/share','/sales'],['/mind','/mindmap']]){await router.push(from+'?id=work-1&filter=a&filter=b#chapter-2');assert.equal(router.currentRoute.value.path,to);assert.deepEqual(router.currentRoute.value.query,{id:'work-1',filter:['a','b']});assert.equal(router.currentRoute.value.hash,'#chapter-2');}
});
test('unknown addresses render a public missing-page state without changing their address',async()=>{
 const router=routerFor();await router.push('/lost/old-bookmark?draft=keep#part');assert.equal(router.currentRoute.value.name,'notFound');assert.equal(router.currentRoute.value.fullPath,'/lost/old-bookmark?draft=keep#part');assert.equal(router.currentRoute.value.meta.systemStatus,'404');assert.equal(router.currentRoute.value.meta.public,true);for(const path of ['/404','/500','/unauthorized','/update-expired'])assert.equal(router.resolve(path).meta.authSurface,true);
});
test('navigation menus exclude error destinations, missing routes, external addresses and redirect cycles',()=>{
 const router=routerFor([{path:'/cycle-a',redirect:'/cycle-b'},{path:'/cycle-b',redirect:'/cycle-a'},{path:'/unnamed',component:page}]);for(const path of ['/chat','/mind','/image','/unnamed'])assert.equal(isImplementedRoute(router,path),true,path);for(const path of ['/missing','/404','/500','/update-expired','/cycle-a','https://qgauss.test/chat','//qgauss.test/chat'])assert.equal(isImplementedRoute(router,path),false,path);
});
test('recovery targets remain in the product and preserve only valid local destinations',()=>{
 const router=routerFor();for(const value of [null,undefined,['/chat'],'https://qgauss.test','//outside.test','/\\outside.test','/chat\n','/500?return=/chat','/not-real','/%2f%2foutside.test','/'.repeat(5000)])assert.equal(safeReturnTarget(router,value),'/chat');assert.equal(safeReturnTarget(router,'/mindmap?id=map-1#node-2'),'/mindmap?id=map-1#node-2');assert.equal(safeReturnTarget(router,'/login','/apps'),'/apps');
});
test('a failed page asset offers a fresh page without retrying the original operation',async()=>{
 let loads=0;const router=routerFor([{path:'/broken',name:'broken',component:()=>{loads++;return Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/old-page.js'));}}]);installRouteRecovery(router);await router.push('/chat');await assert.rejects(router.push('/broken?document=map-1#node-2'));await settle();assert.equal(router.currentRoute.value.path,'/update-expired');assert.equal(router.currentRoute.value.query.return,'/broken?document=map-1#node-2');assert.equal(loads,1);
});
test('other page failures use a distinct recovery state and do not repeat loading',async()=>{
 let loads=0;const router=routerFor([{path:'/broken',name:'broken',component:()=>{loads++;return Promise.reject(Error('page initialization interrupted'));}}]);installRouteRecovery(router);await router.push('/chat');await assert.rejects(router.push('/broken'));await settle();assert.equal(router.currentRoute.value.path,'/500');assert.equal(loads,1);assert.equal(isPageAssetError(Error('business operation failed')),false);for(const message of ['Importing a module script failed.','error loading dynamically imported module','Loading chunk 12 failed.','Unable to preload CSS for /assets/page.css'])assert.equal(isPageAssetError(Error(message)),true);
});
test('a recovery page failure is terminal for the handler and cannot make a redirect loop',async()=>{
 let loads=0;const router=routerFor([],()=>{loads++;return Promise.reject(Error('Failed to fetch dynamically imported module'));});installRouteRecovery(router);await router.push('/chat');await assert.rejects(router.push('/500'));await settle();assert.equal(loads,1);assert.equal(router.currentRoute.value.path,'/chat');
});
