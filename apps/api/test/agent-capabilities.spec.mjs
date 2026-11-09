import 'reflect-metadata';
import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,copyFileSync,rmSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {agentMetadata,publicAgentCapabilities} from '../dist/modules/agents/agent-capabilities.js';
import {AgentsService} from '../dist/modules/agents/agents.service.js';
import {SqliteClient} from '../dist/common/prisma/sqlite-client.js';
const here=dirname(fileURLToPath(import.meta.url)),folder=mkdtempSync(join(tmpdir(),'qgauss-partner-profile-')),base=join(folder,'base.db');
execFileSync(process.execPath,[join(here,'../prisma/migrate.mjs')],{env:{...process.env,DATABASE_FILE:base},stdio:'pipe'});
after(()=>{assert.ok(resolve(folder).startsWith(resolve(tmpdir())+sep+'qgauss-partner-profile-'));rmSync(folder,{recursive:true,force:true,maxRetries:10,retryDelay:100});});

test('reported empty capability groups differ from missing provider fields',()=>{
 const unknown=publicAgentCapabilities(agentMetadata({})),empty=publicAgentCapabilities(agentMetadata({plugin_info_list:[],workflow_info_list:[],knowledge:{knowledge_infos:[]}}));
 for(const kind of ['tools','workflows','knowledge']){assert.equal(unknown.coverage[kind],false);assert.equal(unknown.counts[kind],null);assert.equal(empty.coverage[kind],true);assert.equal(empty.counts[kind],0);}
});
test('profile metadata preserves named capabilities and model identifiers while excluding private configuration',()=>{
 const raw={bot_id:'private-bot-id',owner_user_id:'private-owner',prompt_info:{prompt:'private-prompt'},variables:[{key:'private-variable'}],model_info:{model_name:'QGauss model / v2',model_id:'private-model-id'},plugin_info_list:[{name:'查找 {count} $&',description:'查找公开资料',plugin_id:'private-plugin-id',api_info_list:[{api_id:'private-api-id'}],icon_url:'https://private-icon.qgauss.test'}],workflow_info_list:[{name:'整理路线',description:'按阶段安排',id:'private-workflow-id'}],knowledge:{knowledge_infos:[{name:'产品资料',id:'private-knowledge-id'}]}};
 const result=publicAgentCapabilities(agentMetadata(raw));assert.equal(result.model,'QGauss model / v2');assert.deepEqual(result.tools,[{name:'查找 {count} $&',description:'查找公开资料'}]);assert.deepEqual(result.knowledge,[{name:'产品资料',description:''}]);assert.equal(result.knowledgeCount,1);assert.equal(result.coverage.knowledge,true);assert.doesNotMatch(JSON.stringify(result),/private-|prompt_info|owner_user_id|api_info_list/);
});
test('bounded profile lists retain their reported totals without claiming that the visible subset is complete',()=>{
 const rows=Array.from({length:35},(_,n)=>({name:'QGauss capability '+n,description:'x'.repeat(600)})),result=publicAgentCapabilities(agentMetadata({plugin_info_list:rows,workflow_info_list:rows,knowledge:{knowledge_infos:rows}}));
 for(const kind of ['tools','workflows','knowledge']){assert.equal(result[kind].length,20);assert.equal(result.counts[kind],35);assert.equal(result.coverage[kind],true);assert.equal(result[kind][0].description.length,500);}assert.equal(result.knowledgeCount,35);
});
test('malformed groups preserve usable names while leaving completeness unconfirmed',()=>{
 const result=publicAgentCapabilities(agentMetadata({plugin_info_list:[null,{name:'QGauss usable'},{name:15}],workflow_info_list:{length:0},knowledge:{knowledge_infos:[{name:''}]}}));assert.deepEqual(result.tools,[{name:'QGauss usable',description:''}]);assert.equal(result.coverage.tools,false);assert.equal(result.counts.tools,null);assert.equal(result.coverage.workflows,false);assert.equal(result.coverage.knowledge,false);assert.equal(result.counts.knowledge,null);
});
test('legacy empty lists and zero knowledge counts never become proof of absence',()=>{
 for(const raw of [{},{tools:[],workflows:[],knowledgeCount:0},{tools:[{name:'已有工具'}],knowledgeCount:3}]){const result=publicAgentCapabilities(raw);assert.equal(result.coverage.tools,false);assert.equal(result.coverage.workflows,false);assert.equal(result.coverage.knowledge,false);assert.deepEqual(result.counts,{tools:null,workflows:null,knowledge:null});}assert.equal(publicAgentCapabilities({knowledgeCount:3}).knowledgeCount,3);
});
test('inconsistent stored reporting markers cannot turn damaged data into a confirmed list',()=>{
 for(const raw of [{tools:[],counts:{tools:4}},{tools:[{name:'QGauss'}],counts:{tools:0}},{tools:[{name:'QGauss'}],counts:{tools:3}},{tools:[{name:'QGauss'},null],counts:{tools:1}},{tools:[],counts:{tools:'0'}}]){const result=publicAgentCapabilities({...raw,coverage:{version:2,tools:true}});assert.equal(result.coverage.tools,false);assert.equal(result.counts.tools,null);}
});
test('imported and refreshed profiles preserve publication, price and favorites; browsing does not contact the provider',async t=>{
 const database=join(folder,randomUUID()+'.db');copyFileSync(base,database);const db=new SqliteClient({datasources:{db:{url:'file:'+database.replaceAll('\\','/')}}});t.after(()=>db.$disconnect());
 const user=await db.user.create({data:{username:'profile-owner',email:'profile-owner@qgauss.test',passwordHash:'synthetic-only'}}),connection=await db.agentConnection.create({data:{name:'QGauss synthetic connection',baseUrl:'https://api.qgauss.test',authMode:'PAT',secretEnc:'private-synthetic-credential'}});let calls=0,raw={bot_id:'123',name:'QGauss profile',plugin_info_list:[{name:'行动工具'}],workflow_info_list:[{name:'行动流程'}],knowledge:{knowledge_infos:[{name:'行动笔记'}]}};
 const coze={json:async(_,path)=>{calls++;assert.equal(path,'/v1/bots/123');return{code:0,data:structuredClone(raw)};}},settings={get:async key=>key==='commerce.enabled'},service=new AgentsService(db,settings,{},coze);
 const imported=await service.importBots(connection.id,['123'],2),id=imported.items[0].id;await db.agent.update({where:{id},data:{published:true,tagsJson:'["已有标签"]'}});await service.favorite(user.id,id,true);
 const profile=await service.detail(user.id,id);assert.equal(calls,1);assert.equal(profile.capabilities.coverage.knowledge,true);assert.equal(profile.capabilities.knowledge[0].name,'行动笔记');assert.equal(profile.billing.amount,2);assert.equal(profile.favorited,true);assert.equal((await service.list(user.id,{})).items[0].id,id);assert.equal(calls,1);assert.doesNotMatch(JSON.stringify(profile),/secretEnc|private-synthetic|connectionId|botId/);
 raw={bot_id:'123',name:'QGauss updated profile',plugin_info_list:[],knowledge:{knowledge_infos:[]}};await service.importBots(connection.id,['123'],9);const refreshed=await service.detail(user.id,id);assert.equal(calls,2);assert.equal(refreshed.billing.amount,2);assert.equal(refreshed.favorited,true);assert.deepEqual(refreshed.tags,['已有标签']);assert.equal(refreshed.capabilities.coverage.tools,true);assert.equal(refreshed.capabilities.counts.tools,0);assert.equal(refreshed.capabilities.coverage.workflows,false);assert.equal(refreshed.capabilities.counts.workflows,null);assert.equal(refreshed.capabilities.knowledgeCount,0);
});
