/** These workflows use only the isolated database and the local protocol fixture. */
import 'reflect-metadata';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaClient} from '@prisma/client';
import {LedgerService} from '../dist/modules/commerce/ledger.service.js';
if(process.env.DATABASE_URL!=='file:./e2e.db'||!process.env.E2E_API||!/^http:\/\/127\.0\.0\.1:\d+\/v1$/.test(process.env.E2E_FAKE||''))throw Error('Mindmap requires an isolated database and local provider');
const db=new PrismaClient(),root=process.env.E2E_API,tag=randomUUID(),marker='QGauss-map-'+tag,users=[],modelIds=[],channelIds=[];
let admin='',owner='',other='',ownerId='',passed=0;
const check=(name,value)=>{assert.ok(value,name);passed++;console.log('  ✔ '+name);};
async function api(path,method='GET',body,token=owner){const response=await fetch(root+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(15000)});const json=await response.json();return{status:response.status,data:json.data??json,response};}
const flags={'commerce.enabled':true,'demo.siteEnabled':false,'security.registerEnabled':true,'security.registerInviteCode':'','security.captchaEnabled':false,'security.emailVerificationRequired':false,'security.registerRateLimit':1000,'security.loginRateLimit':1000,'upstream.allowHttp':true,'upstream.hostAllowlist':'127.0.0.1'};
let original=[];
const settings=data=>api('/settings','PUT',{settings:Object.entries(data).map(([key,value])=>({key,value}))},admin);
const outline='# '+marker+'\n## 目标\n- 让阳台长出一座小花园\n## 植物\n- 薄荷';
async function wait(id){for(let i=0;i<150;i++){const row=await api('/mindmap/generations/'+id);assert.equal(row.status,200);if(!['QUEUED','RUNNING','SETTLING'].includes(row.data.status))return row.data;await delay(40);}throw Error('Mindmap task did not finish');}
try{
 const login=await api('/auth/login','POST',{account:process.env.E2E_ADMIN||'admin',password:process.env.E2E_PASSWORD||'admin123456'},'');admin=login.data.accessToken;assert.ok(admin);
 original=(await api('/settings','GET',undefined,admin)).data.filter(row=>Object.hasOwn(flags,row.key)).map(({key,value})=>[key,value]);assert.equal((await settings(flags)).status,200);
 for(const[index,label]of ['owner','other'].entries()){const email='mindmap-'+label+'-'+tag+'@qgauss.test',password='qgauss-map-local-123',registered=await api('/auth/register','POST',{email,username:'qgmap'+index+tag.replaceAll('-','').slice(0,10),password},'');assert.equal(registered.status,201);const signed=(await api('/auth/login','POST',{account:email,password},'')).data;users.push(signed.user.id);if(index===0){owner=signed.accessToken;ownerId=signed.user.id;}else other=signed.accessToken;}
 const channel=(await api('/models/channels','POST',{name:marker,type:'OPENAI',baseUrl:process.env.E2E_FAKE,timeoutMs:5000},admin)).data;assert.ok(channel.id);channelIds.push(channel.id);
 const model=(await api('/models','POST',{name:'qg-map-'+tag,displayName:'QGauss 思路搭档',capabilities:'chat',maxContext:16384,maxOutput:2048,countPool:'model3',countCost:2},admin)).data;assert.ok(model.id);modelIds.push(model.id);assert.equal((await api('/models/'+model.id+'/channels','POST',{channelId:channel.id,upstreamName:'qgauss-mindmap-local'},admin)).status,201);
 await new LedgerService(db).grant(ownerId,{model3Count:20,rechargeType:'admin',remark:'QGauss isolated mindmap fixture'});
 check('未登录不能读取文档或任务',(await api('/mindmap/documents','GET',undefined,'')).status===401&&(await api('/mindmap/generations','GET',undefined,'')).status===401);
 const key=randomUUID(),input={requestKey:key,kind:'create',title:marker,outline},saved=await api('/mindmap/mutations','POST',input);assert.equal(saved.status,201);const documentId=saved.data.documentId;
 check('创建文档返回可恢复回执并禁止浏览器缓存',saved.data.state==='APPLIED'&&saved.data.version===1&&saved.data.document.nodeCount>=4&&saved.response.headers.get('cache-control')==='private, no-store');
 const replay=await api('/mindmap/mutations','POST',input);check('重复提交同一个保存只创建一份文档',replay.data.documentId===documentId&&await db.mindmapDocument.count({where:{userId:ownerId}})===1);
 check('其他账号不能打开文档或读取保存回执',(await api('/mindmap/documents/'+documentId,'GET',undefined,other)).status===404&&(await api('/mindmap/mutations/'+key,'GET',undefined,other)).status===404);
 const edited=await api('/mindmap/mutations','POST',{requestKey:randomUUID(),kind:'edit',documentId,expectedVersion:1,title:marker+' 已修改',outline:outline+'\n- 迷迭香'});check('显式保存增加版本并保留编辑内容',edited.status===201&&edited.data.version===2&&edited.data.document.outline.includes('迷迭香'));
 check('旧版本保存提示冲突并保留最新内容',(await api('/mindmap/mutations','POST',{requestKey:randomUUID(),kind:'edit',documentId,expectedVersion:1,title:'旧版本',outline})).status===409&&(await api('/mindmap/documents/'+documentId)).data.version===2);
 check('回执恢复返回原操作版本与当前文档版本',(await api('/mindmap/mutations/'+key)).data.version===1&&(await api('/mindmap/mutations/'+key)).data.document.version===2);
 await api('/mindmap/mutations','POST',{requestKey:randomUUID(),kind:'archive',documentId,expectedVersion:2});check('回收站与正常列表互相独立',(await api('/mindmap/documents?q='+encodeURIComponent(marker))).data.total===0&&(await api('/mindmap/documents?view=trash&q='+encodeURIComponent(marker))).data.total===1);
 const restored=await api('/mindmap/mutations','POST',{requestKey:randomUUID(),kind:'restore',documentId,expectedVersion:3});check('恢复文档保留内容并继续增加版本',restored.data.version===4&&restored.data.document.archivedAt===null&&restored.data.document.outline.includes('迷迭香'));
 const endedKey=randomUUID();await api('/mindmap/mutations/'+endedKey+'/end','POST',{kind:'create'});const ended=await api('/mindmap/mutations','POST',{...input,requestKey:endedKey});check('结束未知保存后，迟到的请求不能新增文档',ended.data.state==='ENDED'&&await db.mindmapDocument.count({where:{userId:ownerId}})===1);
 check('拒绝重复页码、非法版本和路径标识',(await api('/mindmap/documents?page=1&page=2')).status===400&&(await api('/mindmap/mutations','POST',{requestKey:randomUUID(),kind:'archive',documentId,expectedVersion:'4'})).status===400&&(await api('/mindmap/mutations','POST',{requestKey:randomUUID(),kind:'archive',documentId:'../secret',expectedVersion:4})).status===400);
 const options=await api('/mindmap/options');check('模型列表显示可用的文字模型且不暴露渠道',options.data.models.some(row=>row.id===model.id&&row.ready)&&!JSON.stringify(options.data).includes(process.env.E2E_FAKE));
 const intent={modelId:model.id,prompt:'为一个阳台花园整理计划',context:outline},price=await api('/mindmap/generations/quote','POST',intent);check('生成前提供明确次数与模型信息',price.status===201&&price.data.cost===2&&price.data.pool==='model3'&&/^[a-f0-9]{64}$/.test(price.data.revision));
 const requestKey=randomUUID(),payload={...intent,requestKey,quoteRevision:price.data.revision},task=await api('/mindmap/generations','POST',payload);assert.equal(task.status,201);const taskId=task.data.id,repeated=await api('/mindmap/generations','POST',payload);check('重复生成和未知请求恢复返回同一任务',repeated.data.id===taskId&&(await api('/mindmap/generations/by-request/'+requestKey)).data.id===taskId);
 const result=await wait(taskId);check('本地模型通过真实协议返回完整导图且只结算一次',result.status==='COMPLETED'&&result.outline.includes('清晨柔光')&&result.billing.charged===2&&await db.usageRecord.count({where:{userId:ownerId,kind:'mindmap'}})===1&&await db.countReservation.count({where:{userId:ownerId,bizType:'mindmap'}})===1);
 check('生成结果需要用户选择，原文档没有被自动替换',(await api('/mindmap/documents/'+documentId)).data.version===4&&(await api('/mindmap/documents/'+documentId)).data.outline.includes(marker));
 check('其他账号不能查看或停止生成任务',(await api('/mindmap/generations/'+taskId,'GET',undefined,other)).status===404&&(await api('/mindmap/generations/'+taskId+'/cancel','POST',{},other)).status===404&&(await api('/mindmap/generations','GET',undefined,other)).data.total===0);
 check('已接受任务的结束确认保留结果',(await api('/mindmap/generations/requests/'+requestKey+'/end','POST',{})).data.task.id===taskId&&(await api('/mindmap/generations/'+taskId+'/cancel','POST',{})).data.status==='COMPLETED');
 const fence=randomUUID();await api('/mindmap/generations/requests/'+fence+'/end','POST',{});check('结束未知生成后，迟到的请求不能发起扣费',(await api('/mindmap/generations','POST',{...payload,requestKey:fence})).status===409&&await db.mindmapGeneration.count({where:{userId:ownerId}})===1);
 const stale=await api('/mindmap/generations/quote','POST',intent);await api('/models/'+model.id,'PATCH',{countCost:3},admin);check('费用变化后要求重新确认，不能按旧报价生成',(await api('/mindmap/generations','POST',{...payload,requestKey:randomUUID(),quoteRevision:stale.data.revision})).status===409&&await db.countReservation.count({where:{userId:ownerId,bizType:'mindmap'}})===1);
 const serialized=JSON.stringify(result);check('任务响应不包含密钥、上游地址或内部报价快照',!['apiKey','baseUrl','routeRevision','context','PRIVATE-'].some(value=>serialized.includes(value)));
}finally{
 if(admin){if(original.length)await settings(Object.fromEntries(original)).catch(()=>{});for(const id of modelIds)await api('/models/'+id,'DELETE',undefined,admin).catch(()=>{});for(const id of channelIds)await api('/models/channels/'+id,'DELETE',undefined,admin).catch(()=>{});}
 await db.$disconnect();
}
console.log('\n思维导图 HTTP：'+passed+' 通过 / 0 失败');
