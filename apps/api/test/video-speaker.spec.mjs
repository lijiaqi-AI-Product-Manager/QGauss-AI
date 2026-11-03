import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {ValidationPipe} from '@nestjs/common';
import {normalizeVideoSpeaker,validateVideoSpeaker,videoFrameTimeline} from '../dist/modules/video/video-speaker.js';
import {videoToolIntent} from '../dist/modules/video/video-tools-intent.js';
import {VideoQuoteDto} from '../dist/modules/video/video.dto.js';
import {VideoService} from '../dist/modules/video/video.service.js';
const reference=readFileSync(new URL('./fixtures/qgauss-reference-video.mp4',import.meta.url)),variable=readFileSync(new URL('./fixtures/qgauss-speaker-frames.mp4',import.meta.url)),independent=JSON.parse(readFileSync(new URL('./fixtures/qgauss-speaker-frames.json',import.meta.url),'utf8'));
const selected={videoId:'owned-video',frameNumber:24,x:420,y:210},body={presetId:'p',mode:'lipsync',prompt:'',ratio:'source',videoIds:['owned-video'],audioIds:['owned-audio'],speakerSelection:selected};
test('人物选帧：真实恒定帧率视频保留全部画面次序，采样落在各帧内部',()=>{const result=videoFrameTimeline(reference);assert.equal(result.width,640);assert.equal(result.height,640);assert.equal(result.frames.length,144);for(let i=0;i<144;i++)assert.ok(Math.abs(result.frames[i]-(i+.5)/24)<1e-8);});
test('人物选帧：真实变帧率及重排视频与独立解码的画面时间一致',()=>{const result=videoFrameTimeline(variable);assert.equal(result.frames.length,independent.presentationTimes.length);for(let i=0;i<result.frames.length;i++){const start=independent.presentationTimes[i],end=independent.presentationTimes[i+1]??start+.09;assert.ok(result.frames[i]>start-1e-5&&result.frames[i]<end+1e-5,`frame ${i}`);}assert.equal(result.width,independent.width);assert.equal(result.height,independent.height);});
test('人物选帧：截断、损坏的偏移与未覆盖所有画面的时间表均被拒绝',()=>{
  assert.throws(()=>videoFrameTimeline(reference.subarray(0,reference.length-1)));
  const ctts=variable.indexOf(Buffer.from('ctts'));assert.ok(ctts>0);const bad=Buffer.from(variable);bad.writeUInt32BE(999999,ctts+12);assert.throws(()=>videoFrameTimeline(bad));
  const version=Buffer.from(variable);version[ctts+4]=2;assert.throws(()=>videoFrameTimeline(version));
});
test('说话人物：只接收完整原始类型和整数，不接受自动检测配置或远程框选地址',()=>{
  assert.deepEqual(normalizeVideoSpeaker(selected),selected);assert.equal(normalizeVideoSpeaker(undefined),undefined);
  for(const value of [null,[],true,'face',{}, {...selected,x:'420'},{...selected,y:true},{...selected,frameNumber:-1},{...selected,x:1.5},{...selected,x:NaN},{...selected,bounding_boxes_url:'https://qgauss.test/private'}])assert.throws(()=>normalizeVideoSpeaker(value));
});
test('说话人物：类型转换开启时，嵌套数字与额外字段仍须严格验证',async()=>{
  const pipe=new ValidationPipe({transform:true,transformOptions:{enableImplicitConversion:true},whitelist:true,forbidNonWhitelisted:false});
  const valid=await pipe.transform(structuredClone(body),{type:'body',metatype:VideoQuoteDto});assert.equal(valid.speakerSelection.x,420);
  for(const speakerSelection of [{...selected,x:'420'},{...selected,y:true},{...selected,frameNumber:null},{...selected,extra:'no'},[],null])await assert.rejects(pipe.transform({...body,speakerSelection},{type:'body',metatype:VideoQuoteDto}));
});
test('说话人物：原视频、画面与坐标同时核对，选择不串入其他处理方式',()=>{
  const material={id:'owned-video',kind:'video',width:640,height:640};assert.doesNotThrow(()=>validateVideoSpeaker(selected,material,144));
  for(const change of [{videoId:'other'},{x:640},{y:640},{frameNumber:144}])assert.throws(()=>validateVideoSpeaker({...selected,...change},material,144));
  assert.deepEqual(videoToolIntent(body,'FAL_LIPSYNC','p').speakerSelection,selected);
  assert.throws(()=>videoToolIntent({...body,videoIds:['different']},'FAL_LIPSYNC','p'));
  assert.throws(()=>videoToolIntent({...body,mode:'upscale',audioIds:undefined},'FAL_UPSCALE','p'));
  const legacy=videoToolIntent({...body,speakerSelection:undefined},'FAL_LIPSYNC','p');assert.equal(Object.hasOwn(legacy,'speakerSelection'),false);
});
test('说话人物：本人历史可复用位置，公开和管理回执不泄露原片定位',()=>{
  const service=Object.create(VideoService.prototype),task={id:'task',userId:'owner',profile:'FAL_LIPSYNC',intentJson:JSON.stringify({...body,seconds:0,resolution:''}),inputJson:'{}',resultJson:null,status:'SUCCESS'};
  assert.deepEqual(service.view(task,'owner').params.speakerSelection,selected);
  for(const admin of [false,true])assert.equal(service.view(task,'other',admin).params.speakerSelection,undefined);
});
