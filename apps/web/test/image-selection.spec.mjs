import {test} from 'node:test';
import assert from 'node:assert/strict';
import {selectionDimensions,selectionPoint,contiguousSelection,selectionLayer,selectionStroke,combineSelection,selectionCount,packSelection,restoreSelection,selectionPixels,readSelectionAlpha,selectionHistory} from '../src/lib/image-selection.js';
const pixels=rows=>new Uint8ClampedArray(rows.flat());

test('region selection respects four-connected boundaries and compares every pixel to the seed',async()=>{
 const source=pixels([[10,10,10,255],[25,10,10,255],[40,10,10,255],[25,10,10,255],[250,250,250,255],[40,10,10,255],[10,10,10,255],[250,250,250,255],[10,10,10,255]]),before=source.slice();
 assert.deepEqual([...await contiguousSelection(source,3,3,0,0,{tolerance:20})],[1,1,0,1,0,0,1,0,0]);assert.deepEqual(source,before);
 const diagonal=pixels([[0,0,0,255],[255,255,255,255],[255,255,255,255],[0,0,0,255]]);assert.deepEqual([...await contiguousSelection(diagonal,2,2,0,0,{tolerance:0})],[1,0,0,0]);
});

test('region selection handles transparent pixels, cancellation and malformed input without partial results',async()=>{
 const alpha=pixels([[0,0,0,0],[0,0,0,255]]);assert.deepEqual([...await contiguousSelection(alpha,2,1,0,0,{tolerance:50})],[1,0]);
 const controller=new AbortController();controller.abort();await assert.rejects(contiguousSelection(alpha,2,1,0,0,{signal:controller.signal}),{name:'AbortError'});
 const large=new Uint8ClampedArray(1024*1024*4),active=new AbortController();let yielded=0;await assert.rejects(contiguousSelection(large,1024,1024,0,0,{signal:active.signal,yieldControl:async()=>{yielded++;active.abort();}}),{name:'AbortError'});assert.equal(yielded,1);
 for(const args of [[new Uint8Array(3),1,1,0,0],[alpha,2,1,2,0],[alpha,2,1,0,0,{tolerance:-1}]])await assert.rejects(contiguousSelection(...args));
});

test('scaled and panned canvas coordinates map to original pixels, including right and bottom edges',()=>{
 const rect={left:100,top:50,width:400,height:200};assert.deepEqual(selectionPoint(300,150,rect,1600,800),{x:800,y:400});assert.deepEqual(selectionPoint(500,250,rect,1600,800),{x:1599,y:799});assert.deepEqual(selectionPoint(0,0,rect,1600,800),{x:0,y:0});assert.equal(selectionPoint(1,1,{width:0,height:0},1,1),null);
 for(const dims of [[0,1],[9000,1],[4096,4096],[1.5,2]])assert.throws(()=>selectionDimensions(...dims));
});

test('brush strokes stay continuous across long pointer jumps and erasing changes only its own region',()=>{
 const layer=selectionLayer(100,60);selectionStroke(layer,{x:5,y:30},{x:95,y:30},8);for(let x=5;x<=95;x++)assert.equal(layer.mask[30*100+x],1);assert.equal(layer.mask[0],0);
 const before=selectionCount(layer.mask);selectionStroke(layer,{x:50,y:30},{x:50,y:30},12,true);assert.equal(layer.mask[30*100+50],0);assert.equal(layer.mask[30*100+5],1);assert.ok(selectionCount(layer.mask)<before);for(let i=0;i<layer.mask.length;i++)assert.equal(layer.words[i]>0,layer.mask[i]>0);
});

test('region add, subtract and replace share the same mask and exact overlay',()=>{
 const layer=selectionLayer(3,2);assert.equal(combineSelection(layer,new Uint8Array([1,1,0,0,0,0])),2);assert.equal(combineSelection(layer,new Uint8Array([0,1,1,0,0,0])),3);assert.equal(combineSelection(layer,new Uint8Array([0,1,0,0,0,0]),'subtract'),2);assert.equal(combineSelection(layer,new Uint8Array([0,0,0,0,0,1]),'replace'),1);assert.deepEqual([...layer.mask],[0,0,0,0,0,1]);for(let i=0;i<6;i++)assert.equal(layer.words[i]>0,layer.mask[i]>0);
});

test('bit-packed histories preserve odd-length masks and retain bounded undo and redo states',()=>{
 const layer=selectionLayer(7,3),history=selectionHistory(21,{maxEntries:3,maxBytes:9});for(let i=0;i<5;i++){history.push(layer.mask);layer.mask[i]=1;}assert.equal(history.capacity,3);assert.equal(history.bytes,9);assert.equal(history.undo(layer),4);assert.equal(history.undo(layer),3);assert.equal(history.redo(layer),4);history.push(layer.mask);assert.equal(history.canRedo,false);assert.equal(history.cancel(layer),4);assert.ok(history.bytes<=9);
 const packed=packSelection(new Uint8Array([1,0,1,0,1,0,1,0,1]));const odd=selectionLayer(3,3);assert.equal(restoreSelection(odd,packed),5);assert.deepEqual([...odd.mask],[1,0,1,0,1,0,1,0,1]);
});

test('preview and transparent exports represent the same selected pixels and import without inversion',()=>{
 const mask=new Uint8Array([0,1,0,1]),preview=selectionPixels(mask),transparent=selectionPixels(mask,true);assert.deepEqual([...preview],[0,0,0,255,255,255,255,255,0,0,0,255,255,255,255,255]);assert.deepEqual([...readSelectionAlpha(transparent,2,2)],[...mask]);assert.equal(transparent[3],255);assert.equal(transparent[7],0);
});
