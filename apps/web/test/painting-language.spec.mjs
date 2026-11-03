import{test}from'node:test';
import assert from'node:assert/strict';
import{PAINTING_MESSAGES,paintingText}from'../src/i18n/painting-messages.js';
import{paintingQuote,paintingReceipt,paintingPriceChanged,paintingRatioLabel,paintingEventLabel}from'../src/lib/painting-presentation.js';

const en=(copy,values)=>paintingText('en',copy,values);
const receipt=(extra={})=>({state:'SETTLED',unitCost:2,reserved:0,charged:2,returned:2,expired:1,...extra});

test('绘画费用：可靠报价沿用实际单价、画质倍率与张数，原始配置不变',()=>{
 const billing={enabled:true,costPerImage:3,qualityFactors:{auto:1,low:1,medium:1,high:2}},original=structuredClone(billing);
 assert.deepEqual(paintingQuote(billing,'high',4),{known:true,unitCost:6,total:24});assert.deepEqual(paintingQuote(billing,'auto',1),{known:true,unitCost:3,total:3});assert.deepEqual(billing,original);
 assert.deepEqual(paintingQuote({...billing,costPerImage:0},'high',2),{known:true,unitCost:0,total:0});assert.deepEqual(paintingQuote({enabled:false},'auto',4),{known:true,unitCost:0,total:0});
});

test('绘画费用：缺失、无效与越界报价不能当成免费或可确认费用',()=>{
 const valid={enabled:true,costPerImage:1,qualityFactors:{high:2}};
 for(const value of [null,{},{enabled:false,ready:false},{...valid,ready:false},{...valid,enabled:0},{...valid,costPerImage:'1'},{...valid,costPerImage:-1},{...valid,costPerImage:NaN},{...valid,costPerImage:536870912},{...valid,qualityFactors:{}},{...valid,qualityFactors:{high:0}},{...valid,qualityFactors:{high:1.5}}])assert.deepEqual(paintingQuote(value,'high',1),{known:false,unitCost:null,total:null});
 for(const images of [0,5,1.5,'1',NaN])assert.equal(paintingQuote(valid,'high',images).known,false);assert.equal(paintingQuote({enabled:false},'unknown',1).known,false);
});

test('绘画费用：已知零值、历史记录和待核对回执分别说明',()=>{
 const free=paintingReceipt(receipt({state:'FREE',unitCost:0,charged:0,returned:0,expired:0}),en);assert.equal(free.known,true);assert.equal(free.charged,0);assert.match(free.title,/No credits/);
 for(const value of [null,{},receipt({charged:undefined}),receipt({returned:'0'}),receipt({unitCost:-1}),receipt({expired:Infinity}),receipt({state:'FREE'}),receipt({state:'UNRECOGNIZED'})]){const shown=paintingReceipt(value,en);assert.equal(shown.state,'UNKNOWN');assert.equal(shown.known,false);assert.doesNotMatch(shown.title,/No credits/);assert.equal(Object.hasOwn(shown,'charged'),false);}
 assert.equal(paintingReceipt({state:'LEGACY'},en).state,'LEGACY');assert.match(paintingReceipt({state:'LEGACY'},en).notes[0],/wallet/);
});

test('绘画费用：预留、结算、释放和会员到期分别呈现，回执原值保留',()=>{
 const original=receipt(),before=structuredClone(original),settled=paintingReceipt(original,en);assert.equal(settled.charged,2);assert.equal(settled.notes.length,2);assert.ok(settled.notes.every(note=>!note.includes('Reserved')));assert.deepEqual(original,before);
 const active=paintingReceipt(receipt({state:'RESERVED',reserved:4,charged:0,returned:0,expired:0}),en);assert.match(active.title,/reserved/);assert.match(active.notes[0],/4 credits/);
 const ended=paintingReceipt(receipt({state:'RELEASED',charged:0}),en);assert.match(ended.title,/No credits charged/);assert.equal(ended.notes.length,2);assert.equal(paintingReceipt(receipt({state:'RELEASED',charged:1}),en).title,'Credits settled');
});

test('绘画语言：所有文案保留参数，用户原文与特殊字符只替换一次',()=>{
 const params=text=>[...text.matchAll(/\{(\w+)\}/g)].map(row=>row[1]).sort();for(const[key,pair]of Object.entries(PAINTING_MESSAGES))for(const text of pair){assert.equal(typeof text,'string');assert.deepEqual(params(text),params(key),key);}
 const raw='开始生成 {p0} $& <image>';assert.equal(en('查看作品：{p0}',{p0:raw}),'View artwork: '+raw);assert.equal(paintingText('zh-TW','查看作品：{p0}',{p0:raw}),'檢視作品：'+raw);assert.equal(en(raw),raw);
});

test('绘画语言：图片、参考图和次数的单数不改写参数或图片编号',()=>{
 assert.equal(en('参考图 {p0}',{p0:2}),'Reference image 2');assert.equal(en('下载第 {p0} 张',{p0:2}),'Download image 2');assert.equal(en('{p0} · {p1} · {p2} 张',{p0:'3:4',p1:'2K',p2:1}),'3:4 · 2K · 1 image');
 assert.equal(en('当前模型最多支持 {p0} 张参考图',{p0:1}),'This model supports up to 1 reference image');assert.equal(en(' 次 / 张',{count:1}),' credit / image');assert.equal(en(' 次 / 张',{count:0}),' credits / image');
});

test('绘画语言：只翻译原有比例标签，自定义标签与模型标识保持原样',()=>{
 assert.equal(paintingRatioLabel({key:'1:1',label:'方形'},en),'Square');assert.equal(paintingRatioLabel({key:'1:1',label:'开始生成'},en),'开始生成');assert.equal(paintingRatioLabel({key:'custom',label:'方形'},en),'方形');assert.equal(paintingRatioLabel({key:'16:9',scene:'我的原始标签'},en),'我的原始标签');
});

test('绘画费用：英文版本冲突可以核对费用，其他错误不冒充涨价',()=>{
 assert.equal(paintingPriceChanged({status:409,code:1001,message:'Invalid parameters'}),true);assert.equal(paintingPriceChanged({status:409,message:'绘画费用已更新，请确认'}),true);
 for(const error of [{status:400,code:1001},{status:409,code:6002,message:'Busy'},{status:404,code:1002},{message:'图像模型不可用'}])assert.equal(paintingPriceChanged(error),false);
});

test('绘画语言：标准创作足迹按实际状态翻译，其他来源的消息保留原文',()=>{
 assert.equal(paintingEventLabel({status:'QUEUED',message:'任务已进入队列，已预留 4 次'},en),'Your creation is in the queue. Reserved 4 credits.');
 assert.equal(paintingEventLabel({status:'SUCCESS',message:'生成完成，共 1 / 2 张'},en),'Complete: 1 / 2 images');
 assert.equal(paintingEventLabel({status:'SUCCESS',message:'生成完成，共 1 / 1 张'},en),'Complete: 1 / 1 image');
 for(const status of ['FAILED','QUEUED','SUCCESS'])assert.equal(paintingEventLabel({status,message:'开始生成'},en),'开始生成');assert.equal(paintingEventLabel({status:'FAILED',message:'保留 {count} $&'},en),'保留 {count} $&');assert.equal(paintingEventLabel({status:'FAILED'},en),'');
});
