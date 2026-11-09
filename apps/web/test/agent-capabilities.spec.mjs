import {test} from 'node:test';
import assert from 'node:assert/strict';
import {agentCapabilities,agentPreparation} from '../src/lib/agent-capabilities.js';
import {PARTNER_MESSAGES,partnerText} from '../src/i18n/partner-messages.js';
import {ROUTE_LANGUAGE_KEYS,INTERFACE_MESSAGES} from '../src/i18n/interface-messages.js';
const profile=(extra={})=>({ready:true,offerRevision:'a'.repeat(64),billing:{mode:'count',pool:'agent',amount:2},...extra});
test('the partner profile header follows the current language instead of falling back to an untranslated overview',()=>{
 const key=ROUTE_LANGUAGE_KEYS['/agent/app'];assert.equal(key,'shell.agentProfile');assert.equal(INTERFACE_MESSAGES.zh[key],'搭档档案');assert.equal(INTERFACE_MESSAGES['zh-TW'][key],'搭檔檔案');assert.equal(INTERFACE_MESSAGES.en[key],'Partner profile');
});
test('unknown capability groups remain unknown while a reported empty list has an explicit zero',()=>{
 const unknown=agentCapabilities({capabilities:{tools:[],workflows:[],knowledgeCount:0}});assert.equal(unknown.complete,false);for(const group of unknown.groups){assert.equal(group.status,'unknown');assert.equal(group.recorded,null);}
 const empty=agentCapabilities({capabilities:{tools:[],workflows:[],knowledge:[],coverage:{version:2,tools:true,workflows:true,knowledge:true},counts:{tools:0,workflows:0,knowledge:0}}});assert.equal(empty.complete,true);for(const group of empty.groups){assert.equal(group.status,'reported');assert.equal(group.recorded,0);}
});
test('legacy positive counts and names remain visible with incomplete reporting',()=>{
 const result=agentCapabilities({capabilities:{model:'QGauss model',tools:[{name:'原工具 {count} $&',description:'原说明'}],knowledgeCount:3}});assert.equal(result.model,'QGauss model');assert.equal(result.groups[0].items[0].name,'原工具 {count} $&');assert.equal(result.groups[0].status,'partial');assert.equal(result.groups[2].status,'partial');assert.equal(result.groups[2].recorded,3);assert.equal(result.groups[2].total,null);
});
test('reported totals accompany bounded visible lists, without silently reducing the total',()=>{
 const rows=Array.from({length:20},(_,i)=>({name:'QGauss item '+i})),group=agentCapabilities({capabilities:{tools:rows,coverage:{version:2,tools:true},counts:{tools:41}}}).groups[0];assert.equal(group.status,'reported');assert.equal(group.total,41);assert.equal(group.items.length,20);assert.equal(group.truncated,true);
});
test('damaged or inconsistent profile data cannot appear as confirmed capabilities',()=>{
 for(const capabilities of [{tools:[],counts:{tools:2}},{tools:[{name:'QGauss'}],counts:{tools:3}},{tools:[null],counts:{tools:0}},{tools:[],counts:{tools:'0'}}]){const group=agentCapabilities({capabilities:{...capabilities,coverage:{version:2,tools:true}}}).groups[0];assert.notEqual(group.status,'reported');assert.equal(group.total,null);}assert.equal(agentCapabilities(null).complete,false);
});
test('starting requires a ready partner, an explicit valid price and a matching profile receipt',()=>{
 assert.equal(agentPreparation(profile()).ready,true);assert.equal(agentPreparation(profile({billing:{mode:'none'}})).ready,true);for(const billing of [null,{}, {mode:'count',pool:'agent',amount:0},{mode:'count',pool:'agent',amount:'2'},{mode:'count',pool:'drawMj',amount:2}])assert.equal(agentPreparation(profile({billing})).reason,'费用待确认');for(const offerRevision of ['',null,'a','a'.repeat(65)])assert.equal(agentPreparation(profile({offerRevision})).ready,false);assert.equal(agentPreparation(profile({ready:false})).ready,false);
});
test('owned partner copy has complete language entries and matching placeholders',()=>{
 const params=value=>[...value.matchAll(/\{(\w+)\}/g)].map(m=>m[1]).sort();for(const[original,values]of Object.entries(PARTNER_MESSAGES)){assert.equal(values.length,2);for(const value of values){assert.ok(value.trim());assert.deepEqual(params(value),params(original));}assert.doesNotMatch(values[1],/[\u3400-\u9fff]/);}
});
test('translation preserves unknown raw names and substitutes known placeholders once',()=>{
 const original='原工具 {count} $&';assert.equal(partnerText('en',original,{count:4}),original);assert.equal(partnerText('en','档案同步于 {time}',{time:'$& {count}'}),'Profile synced $& {count}');assert.equal(partnerText('zh-TW','资料尚未提供'),'資料尚未提供');
});
