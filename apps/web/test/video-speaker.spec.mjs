import {test} from 'node:test';
import assert from 'node:assert/strict';
import {speakerPoint,validSpeaker,speakerCaption} from '../src/lib/video-speaker.js';
import {videoIntent} from '../src/lib/video-intent.js';

test('说话人物：原片位置在缩放、手机显示与居中留白下保持一致',()=>{
  assert.deepEqual(speakerPoint(260,180,{left:100,top:100,width:320,height:240},640,480),{x:320,y:160});
  assert.deepEqual(speakerPoint(200,100,{left:0,top:0,width:400,height:400},800,400),{x:400,y:0});
  assert.equal(speakerPoint(200,99,{left:0,top:0,width:400,height:400},800,400),null);
  assert.deepEqual(speakerPoint(330,230,{left:10,top:50,width:320,height:180},1920,1080),{x:1919,y:1079});
  for(const rect of [{left:0,top:0,width:0,height:10},{left:0,top:0,width:NaN,height:10}])assert.equal(speakerPoint(1,1,rect,640,480),null);
});
test('说话人物：帧和位置只能跟随对应的本人素材，边界与真实数字类型不混淆',()=>{
  const material={id:'mine',width:640,height:480},point={videoId:'mine',frameNumber:23,x:639,y:479};
  assert.equal(validSpeaker(point,material,24),true);
  for(const change of [{videoId:'other'},{frameNumber:24},{frameNumber:'23'},{x:640},{y:480},{x:-1},{x:true}])assert.equal(validSpeaker({...point,...change},material,24),false);
  assert.match(speakerCaption(point,material),/第 24 帧/);assert.match(speakerCaption(null,material),/默认人物/);
});
test('说话人物：原提交完整保留人物与帧，窗口存储失败明确阻止持久保存',()=>{
  const values=new Map(),store={getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)},helper=videoIntent('owner',store),intent={requestKey:'qgauss-speaker-request',quoteRevision:'a'.repeat(64),payload:{presetId:'p',mode:'lipsync',prompt:'',speakerSelection:{videoId:'mine',frameNumber:18,x:310,y:240}}};
  assert.equal(helper.save(intent),true);assert.deepEqual(helper.read(),intent);assert.equal(videoIntent('other',store).read(),null);
  assert.equal(videoIntent('owner',{setItem(){throw Error('full');}}).save(intent),false);
});
