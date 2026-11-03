export const MAX_EDITOR_PIXELS=8_388_608;
export const MAX_EDITOR_EDGE=8192;

export function selectionDimensions(width,height){
 if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||width>MAX_EDITOR_EDGE||height>MAX_EDITOR_EDGE||width*height>MAX_EDITOR_PIXELS)throw Error('图片最多 800 万像素，单边不超过 8192 像素，请先缩小图片。');
 return width*height;
}

export function selectionPoint(clientX,clientY,rect,width,height){
 if(!rect||!(rect.width>0&&rect.height>0)||!Number.isFinite(clientX)||!Number.isFinite(clientY))return null;
 return{x:Math.max(0,Math.min(width-1,Math.floor((clientX-rect.left)*width/rect.width))),y:Math.max(0,Math.min(height-1,Math.floor((clientY-rect.top)*height/rect.height)))};
}

const yieldFrame=()=>new Promise(resolve=>setTimeout(resolve,0));
const abort=signal=>{if(signal?.aborted)throw new DOMException('区域选择已停止','AbortError');};

/** Four-connected selection compares every candidate with the original seed colour. */
export async function contiguousSelection(rgba,width,height,x,y,{tolerance=50,signal,onProgress,yieldControl=yieldFrame}={}){
 const count=selectionDimensions(width,height);
 if(!(rgba instanceof Uint8ClampedArray)&&!(rgba instanceof Uint8Array)||rgba.length!==count*4)throw Error('图片像素不完整，请重新打开图片。');
 if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||x>=width||y<0||y>=height)throw Error('请选择图片内的区域。');
 if(!Number.isFinite(tolerance)||tolerance<0||tolerance>1020)throw Error('颜色容差需要在 0–1020 之间。');
 abort(signal);
 const selected=new Uint8Array(count),queue=new Uint32Array(count),seed=(y*width+x)*4,target=[rgba[seed],rgba[seed+1],rgba[seed+2],rgba[seed+3]];
 let head=0,tail=1,last=performance.now();queue[0]=y*width+x;selected[queue[0]]=1;onProgress?.(0);
 const enqueue=index=>{if(selected[index])return;const p=index*4;let distance=0;for(let k=0;k<4;k++)distance+=Math.abs(rgba[p+k]-target[k]);if(distance<=tolerance){selected[index]=1;queue[tail++]=index;}};
 while(head<tail){
  const index=queue[head++],column=index%width;
  if(column)enqueue(index-1);if(column+1<width)enqueue(index+1);if(index>=width)enqueue(index-width);if(index+width<count)enqueue(index+width);
  if((head&4095)===0&&performance.now()-last>=8){abort(signal);onProgress?.(Math.min(99,Math.floor(head/count*100)));await yieldControl();abort(signal);last=performance.now();}
 }
 abort(signal);onProgress?.(100);return selected;
}

export function selectionColour(red=232,green=79,blue=180,alpha=145){
 const probe=new Uint32Array([0x01020304]);return new Uint8Array(probe.buffer)[0]===4?(red|(green<<8)|(blue<<16)|(alpha<<24))>>>0:((red<<24)|(green<<16)|(blue<<8)|alpha)>>>0;
}

export function selectionLayer(width,height){
 const count=selectionDimensions(width,height),rgba=new Uint8ClampedArray(count*4);
 return{width,height,mask:new Uint8Array(count),rgba,words:new Uint32Array(rgba.buffer),colour:selectionColour()};
}

/** Native typed-array spans keep large brushes responsive without per-pixel allocations. */
export function selectionStroke(layer,from,to,diameter=64,erase=false){
 const{width,height,mask,words,colour}=layer;
 if(!from||!to||![from.x,from.y,to.x,to.y,diameter].every(Number.isFinite)||diameter<1||diameter>1024)throw Error('画笔参数无效。');
 from={x:Math.max(0,Math.min(width-1,from.x)),y:Math.max(0,Math.min(height-1,from.y))};to={x:Math.max(0,Math.min(width-1,to.x)),y:Math.max(0,Math.min(height-1,to.y))};
 const radius=diameter/2,distance=Math.hypot(to.x-from.x,to.y-from.y),steps=Math.max(1,Math.ceil(distance/Math.max(1,radius*.35)));
 const left=Math.max(0,Math.floor(Math.min(from.x,to.x)-radius)),top=Math.max(0,Math.floor(Math.min(from.y,to.y)-radius)),right=Math.min(width-1,Math.ceil(Math.max(from.x,to.x)+radius)),bottom=Math.min(height-1,Math.ceil(Math.max(from.y,to.y)+radius));
 for(let step=0;step<=steps;step++){
  const x=from.x+(to.x-from.x)*step/steps,y=from.y+(to.y-from.y)*step/steps;
  for(let row=Math.max(0,Math.ceil(y-radius));row<=Math.min(height-1,Math.floor(y+radius));row++){
   const half=Math.sqrt(Math.max(0,radius*radius-(row-y)*(row-y))),start=Math.max(0,Math.ceil(x-half)),end=Math.min(width-1,Math.floor(x+half));
   if(end<start)continue;const begin=row*width+start,finish=row*width+end+1;mask.fill(erase?0:1,begin,finish);words.fill(erase?0:colour,begin,finish);
  }
 }
 return{x:left,y:top,width:Math.max(0,right-left+1),height:Math.max(0,bottom-top+1)};
}

export function combineSelection(layer,incoming,mode='add'){
 if(!(incoming instanceof Uint8Array)||incoming.length!==layer.mask.length||!['add','subtract','replace'].includes(mode))throw Error('选区不完整，请重新选择。');
 const{mask,words,colour}=layer;let selected=0;
 for(let i=0;i<mask.length;i++){mask[i]=mode==='replace'?Number(incoming[i]>0):mode==='subtract'?Number(mask[i]>0&&!incoming[i]):Number(mask[i]>0||incoming[i]>0);words[i]=mask[i]?colour:0;selected+=mask[i];}return selected;
}

export function selectionCount(mask){let count=0;for(let i=0;i<mask.length;i++)count+=Number(mask[i]>0);return count;}

export function packSelection(mask){
 const packed=new Uint8Array(Math.ceil(mask.length/8));for(let i=0;i<mask.length;i++)if(mask[i])packed[i>>3]|=1<<(i&7);return packed;
}

export function restoreSelection(layer,packed){
 if(!(packed instanceof Uint8Array)||packed.length!==Math.ceil(layer.mask.length/8))throw Error('选区历史不完整。');
 const{mask,words,colour}=layer;let count=0;for(let i=0;i<mask.length;i++){mask[i]=(packed[i>>3]>>(i&7))&1;words[i]=mask[i]?colour:0;count+=mask[i];}return count;
}

export function selectionPixels(mask,transparent=false){
 const pixels=new Uint8ClampedArray(mask.length*4);for(let i=0;i<mask.length;i++){const p=i*4,value=transparent?255:mask[i]?255:0;pixels[p]=pixels[p+1]=pixels[p+2]=value;pixels[p+3]=transparent&&mask[i]?0:255;}return pixels;
}

export function readSelectionAlpha(rgba,width,height){
 const count=selectionDimensions(width,height);if(!rgba||rgba.length!==count*4)throw Error('蒙版尺寸与图片不一致。');
 const mask=new Uint8Array(count);for(let i=0;i<count;i++)mask[i]=rgba[i*4+3]<128?1:0;return mask;
}

export function selectionHistory(length,{maxEntries=24,maxBytes=32*1024*1024}={}){
 const bytes=Math.ceil(length/8),capacity=Math.max(1,Math.min(maxEntries,Math.floor(maxBytes/bytes))),past=[],future=[];
 const pushPacked=packed=>{if(!(packed instanceof Uint8Array)||packed.length!==bytes)throw Error('选区历史不完整。');past.push(packed.slice());future.length=0;while(past.length>capacity)past.shift();};
 return{
  get canUndo(){return past.length>0;},get canRedo(){return future.length>0;},get capacity(){return capacity;},get bytes(){return(past.length+future.length)*bytes;},
  push(mask){pushPacked(packSelection(mask));},pushPacked,
  undo(layer){if(!past.length)return null;future.push(packSelection(layer.mask));return restoreSelection(layer,past.pop());},
  redo(layer){if(!future.length)return null;past.push(packSelection(layer.mask));return restoreSelection(layer,future.pop());},
  cancel(layer){if(!past.length)return null;return restoreSelection(layer,past.pop());},
  clear(){past.length=0;future.length=0;}
 };
}
