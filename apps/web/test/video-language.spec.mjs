import {test} from 'node:test';
import assert from 'node:assert/strict';
import {VIDEO_MESSAGES,videoText} from '../src/i18n/video-messages.js';
import {videoEstimate,videoPoolLabel,videoQuoteReady,videoReceipt,videoTaskMessage} from '../src/lib/video-presentation.js';
import {speakerCaption} from '../src/lib/video-speaker.js';

const text=language=>(original,values)=>videoText(language,original,values);
const receipt=extra=>({pool:'drawMj',state:'SETTLED',reserved:0,charged:4,returned:2,expired:2,...extra});
const quote=extra=>({revision:'a'.repeat(64),cost:4,pool:'drawMj',...extra});

test('视频语言：界面提示保留同一组参数，原文和技术标识不被猜测翻译',()=>{
  const params=value=>[...value.matchAll(/\{(\w+)\}/g)].map(row=>row[1]).sort();
  assert.ok(Object.keys(VIDEO_MESSAGES).length>=380);
  for(const[key,values]of Object.entries(VIDEO_MESSAGES))for(const value of values){assert.ok(value.trim(),key);assert.deepEqual(params(value),params(key),key);}
  for(const original of ['QGauss 自选画师','gpt-image-qgauss','Proteus Natural','我的成片 {count} $&'])for(const language of ['zh','zh-TW','en'])assert.equal(videoText(language,original,{count:1}),original);
});

test('视频语言：插入原始标题和数字只进行一次，英文数量不拼接成错误帧号',()=>{
  const title='开始精修 {p0} $&';assert.equal(videoText('en','播放视频：{p0}',{p0:title}),'Play video: '+title);
  assert.equal(videoText('en','{p0} 秒',{p0:1}),'1 second');assert.equal(videoText('en','第 {p0} / {p1} 帧',{p0:2,p1:12}),'Frame 2 / 12');
  assert.equal(videoPoolLabel('drawMj',1,text('en')),'image credit');assert.equal(videoPoolLabel('drawMj',2,text('en')),'image credits');
});

test('视频费用：缺失、错误类型和失效报价均不可确认，可靠零值与原模式可以确认',()=>{
  assert.equal(videoQuoteReady(quote({cost:0,mode:'text'}),{mode:'text'}),true);
  for(const extra of [{cost:null},{cost:undefined},{cost:'0'},{cost:NaN},{cost:-1},{cost:.5},{cost:2147483648},{revision:null},{revision:'a'.repeat(63)},{revision:'x'.repeat(64)},{pool:'unknown'},{mode:'lipsync'},{followsSource:'true'},{followsSource:true,seconds:0,multiplier:1},{followsSource:true,seconds:5,multiplier:0}])assert.equal(videoQuoteReady(quote(extra),{mode:'text'}),false,JSON.stringify(extra));
  assert.equal(videoQuoteReady(quote({mode:'upscale',followsSource:true,seconds:5.2,multiplier:4}),{mode:'upscale'}),true);
});

test('视频费用：未知时长与不可靠估算不显示免费，素材处理在报价时统一核对',()=>{
  for(const pricing of [null,{base:0,perSecond:null,pool:'drawMj'},{base:'0',perSecond:0,pool:'drawMj'},{base:0,perSecond:1,pool:'drawMj'},{base:2147483647,perSecond:2,pool:'drawMj'}])assert.match(videoEstimate(pricing,pricing?.perSecond===1?0:5,'text',text('en')),/need checking/);
  assert.match(videoEstimate({base:0,perSecond:0,pool:'drawMj'},5,'text',text('en')),/Estimated 0 image credits/);
  assert.match(videoEstimate({base:2,perSecond:3,pool:'drawMj'},1.1,'text',text('en')),/Estimated 6 image credits/);
  assert.match(videoEstimate(null,0,'lipsync',text('en')),/only after confirmation/);
});

test('视频回执：结算、释放和到期分别说明，结束后不把原预留显示为仍在等待',()=>{
  const value=videoReceipt(receipt(),text('en'));assert.equal(value.known,true);assert.equal(value.active,false);assert.equal(value.charged,4);assert.equal(value.notes.length,2);assert.match(value.notes[0],/released/i);assert.match(value.notes[1],/expired/);assert.ok(value.notes.every(note=>!note.includes('Reserved')));
  const active=videoReceipt(receipt({state:'RESERVED',reserved:8,charged:0,returned:0,expired:0}),text('en'));assert.equal(active.active,true);assert.match(active.notes[0],/Reserved 8 credits/);
});

test('视频回执：缺失和不一致记录保持待核对，免费和取消不混淆已结算金额',()=>{
  for(const value of [null,{},receipt({expired:undefined}),receipt({charged:'0'}),receipt({pool:'unknown'}),receipt({state:'FREE'}),receipt({limit:-1})]){const result=videoReceipt(value,text('en'));assert.equal(result.known,false);assert.match(result.title,/needs checking/);assert.equal(result.charged,undefined);}
  assert.match(videoReceipt(receipt({state:'RELEASED',charged:0,returned:8,expired:0}),text('en')).title,/No credits charged/);
  assert.equal(videoReceipt(receipt({state:'RELEASED'}),text('en')).title,'Credits settled');
  const free=videoReceipt(receipt({state:'FREE',reserved:0,charged:0,returned:0,expired:0,limit:0}),text('en'));assert.equal(free.known,true);assert.match(free.notes[0],/no credits/);
});

test('视频人物：语言只改变说明，同一原片坐标和原始帧号保持不变',()=>{
  const selection={videoId:'original',frameNumber:1,x:160,y:240},material={id:'original',width:640,height:480},before=JSON.stringify(selection);
  assert.equal(speakerCaption(selection,material,text('en')),'Person selected · Frame 2 · Horizontal 25% · Vertical 50%');
  assert.match(speakerCaption(selection,material,text('zh-TW')),/第 2 幀/);assert.equal(JSON.stringify(selection),before);assert.match(speakerCaption(null,material,text('en')),/default person/);
});

test('视频足迹：只翻译对应状态的标准提示，服务返回的原始消息保留',()=>{
  assert.match(videoTaskMessage({status:'QUEUED',message:'已确认开机，预留 1 次'},text('en')),/Reserved 1 credit$/);
  assert.match(videoTaskMessage({status:'POLLING',message:'外部任务编号已保存，重启后只续查原任务'},text('en')),/same task/);
  for(const row of [{status:'FAILED',message:'开始精修'},{status:'SUCCESS',message:'这一幕已进入片场队列'},{status:'POLLING',message:'provider message {count} $&'}])assert.equal(videoTaskMessage(row,text('en')),row.message);
});
