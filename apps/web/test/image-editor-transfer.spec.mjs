import {test} from 'node:test';
import assert from 'node:assert/strict';
import {saveImageEditorTransfer,readImageEditorTransfer,latestImageEditorTransfer,removeImageEditorTransfer,clearImageEditorTransfers} from '../src/lib/image-editor-transfer.js';
function store(){const data=new Map();return new Proxy({getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,String(value)),removeItem:key=>data.delete(key)},{ownKeys:()=>[...data.keys()],getOwnPropertyDescriptor:()=>({enumerable:true,configurable:true})});}
const input={sourceId:'qg-source',maskId:'qg-mask',prompt:'改变一点颜色'};
test('image-editor transfers are owner-scoped, expiring and contain only bounded settings',()=>{
 const storage=store(),record=saveImageEditorTransfer('owner',input,storage);assert.equal(readImageEditorTransfer('owner',record.id,storage).sourceId,'qg-source');assert.equal(latestImageEditorTransfer('owner',storage),record.id);assert.throws(()=>readImageEditorTransfer('other',record.id,storage));assert.throws(()=>saveImageEditorTransfer('owner',{...input,sourceId:'../private'},storage));assert.throws(()=>saveImageEditorTransfer('owner',{...input,prompt:'x'.repeat(4001)},storage));
 const key='qg:image-editor:handoff:owner:'+record.id;storage.setItem(key,JSON.stringify({...record,createdAt:Date.now()-31*60000}));assert.throws(()=>readImageEditorTransfer('owner',record.id,storage));
});
test('painting round trips preserve multiple references, high unsigned seeds and exact chosen settings',()=>{
 const storage=store(),returnDraft={prompt:'原来的描述',negativePrompt:'文字',model:'qgauss-image',ratio:'16:9',resolution:'2K',quality:'high',n:4,seed:4294967295,catId:'qg-style',references:[{id:'qg-source',name:'主图'},{id:'qg-reference-2',name:'第二张参考'}],editOrigin:{taskId:'qg-task',fileId:'qg-source'}},record=saveImageEditorTransfer('owner',{...input,returnDraft},storage),read=readImageEditorTransfer('owner',record.id,storage);assert.deepEqual(read.returnDraft,returnDraft);returnDraft.references[0].name='后来的修改';assert.equal(readImageEditorTransfer('owner',record.id,storage).returnDraft.references[0].name,'主图');
});
test('removing one intent never removes a newer intent and signing out clears only its own temporary records',()=>{
 const storage=store(),one=saveImageEditorTransfer('owner',input,storage),two=saveImageEditorTransfer('owner',input,storage),other=saveImageEditorTransfer('other',input,storage);removeImageEditorTransfer('owner',one.id,storage);assert.equal(latestImageEditorTransfer('owner',storage),two.id);clearImageEditorTransfers('owner',storage);assert.equal(latestImageEditorTransfer('owner',storage),null);assert.throws(()=>readImageEditorTransfer('owner',two.id,storage));assert.equal(readImageEditorTransfer('other',other.id,storage).sourceId,'qg-source');
});
