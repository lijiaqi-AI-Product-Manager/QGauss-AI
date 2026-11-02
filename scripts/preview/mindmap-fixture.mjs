/** Explicit local preview data. These documents never enter a running product database. */
import {mindmapSamples,parseMindmap} from '../../apps/web/src/lib/mindmap-outline.js';
const clone=value=>JSON.parse(JSON.stringify(value));
export function mindmapFixtures(state='mindmap-ready'){
 const documents=mindmapSamples.map((sample,index)=>({id:'qg-map-'+(index+1),title:sample.title,outline:sample.outline,version:index+1,nodeCount:parseMindmap(sample.outline,value=>value).nodes,createdAt:'2026-11-01T08:00:00.000Z',updatedAt:'2026-11-03T0'+index+':00:00.000Z',archivedAt:null}));
 documents.push({...documents[1],id:'qg-map-archived',title:'留给下一次的小想法',version:4,archivedAt:'2026-11-03T05:00:00.000Z'});
 if(state==='mindmap-empty')documents.splice(0,documents.length);
 const history=state==='mindmap-empty'?[]:[{id:'qg-map-generation-1',requestKey:'qg-map-request-1',title:'下一次发布的灵感',prompt:'整理一次小型创意项目的发布计划',modelName:'QGauss 灵感模型',status:'COMPLETED',outline:mindmapSamples[0].outline,message:'本地演示记录，不代表真实生成或费用。',createdAt:'2026-11-03T04:00:00.000Z',billing:{reserved:0,charged:2,returned:0}}];
 return{state,documents,history,receipts:{},generationRequests:{},reads:{},serial:10,models:[{id:'qg-map-model',name:'QGauss 灵感模型',ready:state!=='mindmap-offline'},{id:'qg-map-unready',name:'QGauss 研究搭档',ready:false}]};
}
export function mindmapFixtureReply(data,url,method='GET',body={}){
 const path=url.pathname;if(!path.startsWith('/api/mindmap/'))return null;
 const ok=value=>({status:200,data:clone(value)}),fail=(status,message)=>({status,error:message});
 if(path==='/api/mindmap/options')return ok({models:data.models});
 if(data.state==='mindmap-error'&&path==='/api/mindmap/documents')return fail(503,'文档暂时没有打开，这是本地异常场景。');
 if(path==='/api/mindmap/documents'&&method==='GET'){const page=Math.max(1,Number(url.searchParams.get('page'))||1),size=Number(url.searchParams.get('pageSize'))||6,q=url.searchParams.get('q')||'',trash=url.searchParams.get('view')==='trash',rows=data.documents.filter(doc=>!!doc.archivedAt===trash&&doc.title.includes(q)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));return ok({items:rows.slice((page-1)*size,page*size).map(({outline,...doc})=>doc),total:rows.length,page,pageSize:size});}
 const docId=/^\/api\/mindmap\/documents\/([^/]+)$/.exec(path)?.[1];if(docId&&method==='GET'){const doc=data.documents.find(doc=>doc.id===docId);return doc?ok(doc):fail(404,'文档不存在或当前不可用');}
 if(path==='/api/mindmap/mutations'&&method==='POST'){
  if(data.receipts[body.requestKey])return data.receipts[body.requestKey].state==='APPLIED'?ok(data.receipts[body.requestKey]):fail(409,'这次操作已经结束');
  let doc=body.documentId?data.documents.find(doc=>doc.id===body.documentId):null;if(body.kind!=='create'&&(!doc||doc.version!==body.expectedVersion))return fail(doc?409:404,'文档已经变化，请重新核对');
  if(body.kind==='create'){doc={id:'qg-map-created-'+(++data.serial),version:1,archivedAt:null,createdAt:new Date().toISOString()};data.documents.unshift(doc);}else doc.version++;
  if(['create','edit'].includes(body.kind)){Object.assign(doc,{title:body.title,outline:body.outline,nodeCount:parseMindmap(body.outline,value=>value).nodes});}else doc.archivedAt=body.kind==='archive'?new Date().toISOString():null;
  doc.updatedAt=new Date().toISOString();const receipt={requestKey:body.requestKey,kind:body.kind,state:'APPLIED',documentId:doc.id,version:doc.version,document:clone(doc)};data.receipts[body.requestKey]=receipt;return ok(receipt);
 }
 const mutation=/^\/api\/mindmap\/mutations\/([^/]+)(\/end)?$/.exec(path);if(mutation){const receipt=data.receipts[mutation[1]];if(receipt)return ok(receipt);if(mutation[2]&&method==='POST'){data.receipts[mutation[1]]={requestKey:mutation[1],kind:body.kind,state:'ENDED'};return ok(data.receipts[mutation[1]]);}return fail(404,'原操作尚未确认');}
 if(path==='/api/mindmap/generations/quote'&&method==='POST')return ok({revision:'qgauss-local-mindmap-quote',cost:2,pool:'model3',modelName:'QGauss 灵感模型'});
 if(path==='/api/mindmap/generations'&&method==='GET')return ok({items:data.history,total:data.history.length,page:1,pageSize:5});
 if(path==='/api/mindmap/generations'&&method==='POST'){const prior=data.history.find(task=>task.requestKey===body.requestKey);if(prior)return ok(prior);if(data.generationRequests[body.requestKey]?.state==='ENDED')return fail(409,'这次生成已经结束');const task={id:'qg-map-generation-'+(++data.serial),requestKey:body.requestKey,title:'由本地样例展开的新思路',prompt:body.prompt,modelName:'QGauss 灵感模型',status:'QUEUED',outline:'',message:'本地演示正在整理，不调用真实服务。',createdAt:new Date().toISOString(),billing:{reserved:2,charged:0,returned:0}};data.history.unshift(task);return{status:201,data:clone(task)};}
 const recovery=/^\/api\/mindmap\/generations\/by-request\/([^/]+)$/.exec(path);if(recovery){const task=data.history.find(task=>task.requestKey===recovery[1]);return task?ok(task):fail(404,'尚未找到这次生成');}
 const end=/^\/api\/mindmap\/generations\/requests\/([^/]+)\/end$/.exec(path);if(end&&method==='POST'){const task=data.history.find(task=>task.requestKey===end[1]);if(task)return ok({state:'APPLIED',task});data.generationRequests[end[1]]={state:'ENDED'};return ok({state:'ENDED'});}
 const taskMatch=/^\/api\/mindmap\/generations\/([^/]+)(\/cancel)?$/.exec(path);if(taskMatch){const task=data.history.find(task=>task.id===taskMatch[1]);if(!task)return fail(404,'生成记录不存在');if(taskMatch[2]&&method==='POST'){task.status='CANCELED';task.message='本地演示已停止。';task.billing={reserved:0,charged:0,returned:2};}else if(['QUEUED','RUNNING'].includes(task.status)){const count=data.reads[task.id]=(data.reads[task.id]||0)+1;task.status=count>=2?'COMPLETED':'RUNNING';if(task.status==='COMPLETED'){task.outline=mindmapSamples[1].outline;task.message='本地演示结果已准备好，不代表真实生成或费用。';task.billing={reserved:0,charged:2,returned:0};}}return ok(task);}
 return fail(404,'此本地场景没有对应记录');
}
