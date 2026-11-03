import{test}from'node:test';
import assert from'node:assert/strict';
import{VOICE_MESSAGES,voiceText}from'../src/i18n/voice-messages.js';
import{voiceBilling,voiceCharge,VOICES,voiceName}from'../src/lib/voice-presentation.js';
const en=(text,values)=>voiceText('en',text,values),tw=(text,values)=>voiceText('zh-TW',text,values);

test('声音文案保留插入内容的原文、花括号和特殊字符，不递归翻译或替换',()=>{
 const title='声音已就绪 {title} $& <strong>我的名字</strong>';
 assert.equal(en('打开声音记录：{title}',{title}),'Open sound record: '+title);
 assert.equal(voiceText('en','自定义服务说明：保留原文'),'自定义服务说明：保留原文');
 assert.equal(voiceText('en',null),'');
 assert.equal(tw('保存完整配音'),'儲存完整配音');
 assert.equal(en('打开声音记录：{title}'),'Open sound record: {title}');
});

test('确认次数区分未知、零和已确认数量，技术标识保持不变',()=>{
 for(const value of [null,undefined,{cost:'2'},{cost:NaN},{cost:Infinity}])assert.equal(voiceCharge(value,en),'Credit cost is confirmed before generation');
 assert.equal(voiceCharge({cost:0,pool:'model3'},en),'No site credits used for this task');
 assert.equal(voiceCharge({cost:2,pool:'model3'},en),'Credits for this task: 2 (Basic models)');
 assert.equal(voiceCharge({cost:2,pool:'model3'}),'本次 2 次低价模型额度');
 assert.deepEqual(VOICES.map(row=>row.id),['alloy','echo','fable','nova','onyx','shimmer']);
 assert.equal(voiceName('fable'),'暖叙');
});

test('失败退回与过期预留分别展示，既不遗漏过期次数也不把不完整回执说成免费',()=>{
 const receipt=Object.freeze({reserved:0,charged:0,returned:1,expired:2});
 assert.equal(voiceBilling(receipt,en),'Returned 1 credit; 2 reserved credits expired');
 assert.equal(voiceBilling(receipt),'已退回 1 次；预留中有 2 次已过期');
 assert.equal(voiceBilling({reserved:2,charged:0,returned:0,expired:0},en),'Reserved 2 credits, settled on completion');
 for(const value of [null,{}, {reserved:0,charged:0,returned:0}, {reserved:0,charged:0,returned:0,expired:-1}])assert.equal(voiceBilling(value,en),'Credit receipt not confirmed');
 assert.equal(voiceBilling({reserved:0,charged:0,returned:0,expired:0},en),'No site credits used for this task');
});

test('英文数量在单个片段、天数和记录时正确使用单数，数值本身不变',()=>{
 assert.equal(en('新作品默认保留 {days} 天',{days:1}),'New sounds are kept for 1 day by default');
 assert.equal(en('{voice} · {count} 段声音',{voice:'Story',count:1}),'Story · 1 sound segment');
 assert.equal(en('{p0} 段足迹 · 第 {p1} 页',{p0:1,p1:2}),'1 record · Page 2');
 assert.equal(en('预留中有 {count} 次已过期',{count:1}),'1 reserved credit expired');
});

test('声音文案的繁体和英文保留所有动态参数及可操作提示',()=>{
 const params=text=>[...text.matchAll(/\{(\w+)\}/g)].map(row=>row[1]).sort();
 for(const [original,pair]of Object.entries(VOICE_MESSAGES))for(const translation of pair){assert.ok(translation.trim(),original);assert.deepEqual(params(translation),params(original),original);}
 for(const key of ['暂停这段配音','请求停止生成','重新连接播放','确认清理这条记录','次数回执待核对','站点尚未开启语音服务'])assert.notEqual(en(key),key);
});
