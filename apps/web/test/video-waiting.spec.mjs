import {videoDraftSnapshot,videoDraftFromIntent} from '../src/lib/video-draft.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {videoRequestOutcome} from '../src/lib/video-waiting.js';
import {videoIntent} from '../src/lib/video-intent.js';
const key='qgauss-waiting-request',task={id:'qgauss-original-task',mine:true,requestKey:key,status:'POLLING'};
test('only a confirmed ended receipt for the original request can finish an unaccepted wait',()=>{
 assert.deepEqual(videoRequestOutcome({requestKey:key,ended:true},key),{ended:true});
 for(const value of[null,{},true,{requestKey:key},{requestKey:key,ended:'true'},{requestKey:'another-request',ended:true},{requestKey:key,ended:true,task}])assert.equal(videoRequestOutcome(value,key),null);
});
test('accepted work must belong to the original request and stays authoritative even without complete billing',()=>{
 const value={requestKey:key,ended:false,task};assert.deepEqual(videoRequestOutcome(value,key),{ended:false,task});
 for(const change of[{id:''},{mine:false},{mine:undefined},{requestKey:'other-request'},{status:'UNKNOWN'}])assert.equal(videoRequestOutcome({...value,task:{...task,...change}},key),null);
 for(const status of['SAVING','SETTLING','SUCCESS','FAILED','CANCELED'])assert.equal(videoRequestOutcome({...value,task:{...task,status}},key).task.status,status);
});
test('a failed storage removal is reported and does not silently destroy the persisted waiting record',()=>{
 const record={requestKey:key,quoteRevision:'a'.repeat(64),payload:{presetId:'qgauss-video',mode:'text',prompt:'Keep this draft.'}},values=new Map(),storage={getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value),removeItem:()=>{throw Error('storage unavailable');}},intent=videoIntent('owner',storage);
 assert.equal(intent.save(record),true);assert.equal(intent.clear(),false);assert.deepEqual(intent.read(),record);storage.removeItem=key=>values.delete(key);assert.equal(intent.clear(),true);assert.equal(intent.read(),null);
});

const defaults={presetId:'',mode:'text',prompt:'',seed:'',ratio:'16:9',seconds:5,resolution:'720p',sound:true,customEnhance:false,compression:0};
const movie={id:'qgauss-original-video',kind:'video',filename:'开始精修 $& {count}.mp4',mime:'video/mp4',size:1000,width:640,height:480,duration:6},picture={id:'qgauss-original-picture',kind:'image',filename:'QGauss 图像.png',mime:'image/png',size:100,width:320,height:240},audio={id:'qgauss-original-audio',kind:'audio',filename:'原始台词.wav',mime:'audio/wav',size:100,duration:4},point={videoId:movie.id,frameNumber:2,x:321,y:240};
test('editable drafts retain raw text, ordered materials and the original frame and point without saving media bytes or temporary links',()=>{
 const form={...defaults,presetId:'qgauss-video',mode:'lipsync',prompt:'  原始草稿 $& {count}  ',seed:0},materials=[picture,movie,audio],draft=videoDraftSnapshot(form,[{id:picture.id,url:'blob:temporary'}],materials.map(value=>({...value,previewUrl:'blob:temporary',buffer:'not-persisted'})),null,point),intent={payload:{prompt:'原提交正文',mode:'lipsync'},draft},before=structuredClone(intent),restored=videoDraftFromIntent(intent,defaults);
 assert.deepEqual(restored.form,form);assert.deepEqual(restored.materials,materials);assert.deepEqual(restored.speakerSelection,point);assert.deepEqual(restored.references,[{id:picture.id}]);assert.equal(restored.incomplete,false);assert.deepEqual(intent,before);assert.equal(JSON.stringify(draft).includes('blob:temporary'),false);assert.equal(JSON.stringify(draft).includes('not-persisted'),false);
});
test('the editable draft stays distinct from the immutable submitted payload',()=>{
 const payload={presetId:'qgauss-video',mode:'text',prompt:'原提交正文'},draft=videoDraftSnapshot({...defaults,prompt:'之后编辑的正文'},[],[],{id:'qgauss-source',prompt:'原片',mine:true},null),intent={payload,draft},restored=videoDraftFromIntent(intent,defaults);assert.equal(restored.form.prompt,'之后编辑的正文');assert.equal(intent.payload.prompt,'原提交正文');assert.deepEqual(restored.sourceTask,{id:'qgauss-source',prompt:'原片',mine:true});
});
test('older waiting records restore known text and parameters while reporting missing tool material details',()=>{
 const payload={presetId:'qgauss-video',mode:'upscale',prompt:'原备注',videoIds:[movie.id],compression:.4},restored=videoDraftFromIntent({payload},defaults);assert.equal(restored.form.prompt,payload.prompt);assert.equal(restored.form.seconds,0);assert.equal(restored.form.resolution,'');assert.equal(restored.form.customEnhance,true);assert.equal(restored.form.compression,.4);assert.equal(restored.incomplete,true);assert.deepEqual(restored.materials,[]);const saved=videoDraftSnapshot(restored.form,[],[],null,null,restored.incomplete);assert.equal(videoDraftFromIntent({payload,draft:saved},defaults).incomplete,true);
});
test('damaged local metadata cannot change the original person or crash recovery',()=>{
 const payload={mode:'lipsync',videoIds:[movie.id]},draft=videoDraftSnapshot({...defaults,mode:'lipsync'},[],[{...movie,mime:{bad:true}}],null,point),restored=videoDraftFromIntent({payload,draft},defaults);assert.deepEqual(restored.materials,[]);assert.equal(restored.speakerSelection,null);assert.equal(restored.incomplete,true);for(const value of[null,{},[],{payload:{mode:'image',imageIds:'damaged'}},{draft:{version:1,form:{prompt:{bad:true},seconds:Infinity},references:{bad:true},materials:'damaged'}}])assert.doesNotThrow(()=>videoDraftFromIntent(value,defaults));
});
