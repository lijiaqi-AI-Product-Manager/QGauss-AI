import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildChatRequest,ChatProtocolDecoder } from '../dist/common/llm/chat-protocol.js';
import { safeWebSearch,webSearchMode,WebSearchCollector } from '../dist/common/llm/web-search.js';
import { ChatCompletionDto } from '../dist/modules/chat/dto/chat.dto.js';
import { ValidationPipe } from '@nestjs/common';
const channel=type=>({type,baseUrl:'https://models.qgauss.test/v1',upstreamName:'synthetic-search-model',apiKey:'synthetic-key'}),messages=[{role:'user',content:'查找资料'}];
function decoder(type,enabled=true){const reports=[],events=[];const value=new ChatProtocolDecoder(type,(event,text)=>events.push({event,text}),{webSearch:enabled,onSearch:report=>reports.push(report)});return{value,reports,events,push:json=>value.consume(JSON.stringify(json))};}
const failure=status=>error=>error.status===status;

test('联网请求显式使用原生或已配置的兼容工具；普通请求不附加工具',()=>{
  for(const type of ['OPENAI','CUSTOM','OPENAI_RESPONSES','ANTHROPIC','GEMINI'])assert.equal(Object.hasOwn(JSON.parse(buildChatRequest(channel(type),messages,{maxTokens:32}).init.body),'tools'),false);
  const responses=JSON.parse(buildChatRequest(channel('OPENAI_RESPONSES'),messages,{maxTokens:32,webSearch:true}).init.body);assert.deepEqual(responses.tools,[{type:'web_search'}]);assert.deepEqual(responses.include,['web_search_call.action.sources']);assert.equal(responses.tool_choice,'auto');
  const anthropic=JSON.parse(buildChatRequest(channel('ANTHROPIC'),messages,{maxTokens:32,webSearch:true}).init.body);assert.deepEqual(anthropic.tools,[{type:'web_search_20250305',name:'web_search',max_uses:3}]);
  const gateway=JSON.parse(buildChatRequest({...channel('CUSTOM'),webSearchMode:'retrieval'},messages,{maxTokens:32,webSearch:true}).init.body);assert.deepEqual(gateway.tools,[{type:'retrieval'}]);
  for(const type of ['OPENAI','CUSTOM','GEMINI'])assert.throws(()=>buildChatRequest(channel(type),messages,{maxTokens:32,webSearch:true}),failure(400));
});

test('渠道模式只认可明确配置，不根据名字或字符串猜测联网能力',()=>{
  assert.equal(webSearchMode('OPENAI_RESPONSES'),'responses');assert.equal(webSearchMode('ANTHROPIC'),'anthropic');assert.equal(webSearchMode('CUSTOM','{"webSearchProtocol":"retrieval"}'),'retrieval');
  for(const extra of [null,'bad json','[]','{"webSearchProtocol":true}','{"webSearchProtocol":"web_search"}'])assert.equal(webSearchMode('CUSTOM',extra),null);
  assert.equal(webSearchMode('GEMINI'),null);assert.equal(webSearchMode('MOCK'),null);
});

test('Responses 联网进度、原文引用与最终来源去重保留，绝不输出原始工具负载',()=>{
  const f=decoder('OPENAI_RESPONSES');f.push({type:'response.output_item.added',item:{type:'web_search_call',status:'in_progress'}});
  f.push({type:'response.output_text.delta',item_id:'answer',content_index:0,delta:'来自资料的回答。'});
  f.push({type:'response.output_text.annotation.added',item_id:'answer',content_index:0,annotation:{type:'url_citation',url:'https://sources.qgauss.test/one',title:'第一条资料',start_index:8,end_index:8,private:'DO_NOT_PROJECT'}});
  f.push({type:'response.output_item.done',item:{type:'web_search_call',status:'completed',action:{sources:[{url:'https://sources.qgauss.test/one',title:'重复来源'},{url:'https://sources.qgauss.test/two',title:'第二条资料',private:'DO_NOT_PROJECT'}]}}});
  f.push({type:'response.completed',response:{status:'completed',usage:{input_tokens:20,output_tokens:8},output:[{type:'message',content:[{type:'output_text',text:'来自资料的回答。',annotations:[{type:'url_citation',url:'https://sources.qgauss.test/one',title:'第一条资料',start_index:8,end_index:8}]}]}]}});
  const result=f.value.result();assert.equal(result.webSearch.status,'complete');assert.equal(result.webSearch.sources.length,2);assert.equal(result.webSearch.citations.length,1);assert.equal(f.reports[0].status,'searching');assert.doesNotMatch(JSON.stringify(result.webSearch),/DO_NOT_PROJECT|private/);assert.equal(result.text,'来自资料的回答。');
});

test('未请求联网时拒绝搜索工具，启用联网也不允许任意函数或代码执行',()=>{
  assert.throws(()=>decoder('OPENAI_RESPONSES',false).push({type:'response.output_item.added',item:{type:'web_search_call'}}),failure(400));
  for(const type of ['function_call','code_interpreter_call','computer_call'])assert.throws(()=>decoder('OPENAI_RESPONSES').push({type:'response.output_item.added',item:{type}}),failure(400));
  assert.throws(()=>decoder('ANTHROPIC').push({type:'content_block_start',index:0,content_block:{type:'tool_use',name:'run_shell'}}),failure(400));
  assert.throws(()=>decoder('ANTHROPIC').push({type:'content_block_start',index:0,content_block:{type:'server_tool_use',name:'code_execution'}}),failure(400));
});

test('Anthropic 只接受服务器管理的搜索，过滤加密内容并恢复逐段引用',()=>{
  const f=decoder('ANTHROPIC');f.push({type:'content_block_start',index:1,content_block:{type:'server_tool_use',name:'web_search'}});f.push({type:'content_block_delta',index:1,delta:{type:'input_json_delta',partial_json:'{"query":"synthetic"}'}});
  f.push({type:'content_block_start',index:2,content_block:{type:'web_search_tool_result',content:[{type:'web_search_result',url:'https://sources.qgauss.test/one',title:'引用资料',encrypted_content:'DO_NOT_PROJECT'}]}});
  f.push({type:'content_block_delta',index:3,delta:{type:'text_delta',text:'查到的回答。'}});f.push({type:'content_block_delta',index:3,delta:{type:'citations_delta',citation:{type:'web_search_result_location',url:'https://sources.qgauss.test/one',title:'引用资料',encrypted_index:'DO_NOT_PROJECT'}}});
  f.push({type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:6}});f.push({type:'message_stop'});const result=f.value.result();assert.equal(result.webSearch.status,'complete');assert.deepEqual(result.webSearch.citations,[{url:'https://sources.qgauss.test/one',start:6,end:6}]);assert.doesNotMatch(JSON.stringify(result.webSearch),/DO_NOT_PROJECT|synthetic/);
});

test('明确搜索失败不会被当作成功；未提供来源则如实保留缺口',()=>{
  assert.throws(()=>decoder('OPENAI_RESPONSES').push({type:'response.output_item.done',item:{type:'web_search_call',status:'failed'}}),failure(400));
  assert.throws(()=>decoder('ANTHROPIC').push({type:'content_block_start',index:0,content_block:{type:'web_search_tool_result',content:{type:'web_search_tool_result_error',error_code:'unavailable'}}}),failure(400));
  const f=decoder('OPENAI_RESPONSES');f.push({type:'response.output_text.delta',delta:'无需检索的回答'});f.push({type:'response.completed',response:{status:'completed'}});assert.equal(f.value.result().webSearch.status,'no_sources');
});

test('兼容网关来源与引用采用白名单字段，非法链接不会进入来源卡片',()=>{
  const f=decoder('CUSTOM');f.push({choices:[{delta:{content:'网关返回的回答',annotations:[{type:'url_citation',url_citation:{url:'https://sources.qgauss.test/gateway',title:'网关来源',start_index:7,end_index:7}}]}}],citations:['javascript:alert(1)','https://user:secret@sources.qgauss.test/private']});f.push({choices:[{delta:{},finish_reason:'stop'}]});const result=f.value.result();assert.equal(result.webSearch.sources.length,1);assert.equal(result.webSearch.status,'complete');
});

test('历史来源重新净化并限制规模，不信任旧 JSON、未知状态或空的成功记录',()=>{
  const value={requested:true,status:'complete',sources:[{url:'javascript:alert(1)',title:'bad'}],citations:[],private:'not public'};assert.equal(safeWebSearch(JSON.stringify(value)).status,'no_sources');assert.equal(safeWebSearch('broken'),null);assert.equal(safeWebSearch({requested:'true'}),null);
  const collector=new WebSearchCollector();for(let index=0;index<60;index++)collector.source({url:'https://sources.qgauss.test/'+index,title:'safe'});assert.equal(collector.finish().sources.length,20);
});

test('联网开关保留原始 JSON 类型，字符串、数字、数组与 null 不会隐式开启',async()=>{
  const pipe=new ValidationPipe({transform:true,transformOptions:{enableImplicitConversion:true},whitelist:true});
  assert.equal((await pipe.transform({messages,webSearch:false},{type:'body',metatype:ChatCompletionDto})).webSearch,false);
  for(const webSearch of ['false','true',1,[],null])await assert.rejects(()=>pipe.transform({messages,webSearch},{type:'body',metatype:ChatCompletionDto}));
});
