/** Record visible text in graph coordinates before removing viewport transforms. */
export function captureMindmapLabels(svg,group){
 const matrix=group.getScreenCTM()?.inverse();if(!matrix)throw Error('画布位置尚未准备好，请稍后再导出。');
 const point=(x,y)=>{const p=svg.createSVGPoint();p.x=x;p.y=y;return p.matrixTransform(matrix);};
 const box=rect=>{const p=point(rect.left,rect.top),end=point(rect.right,rect.bottom);return{x:p.x,y:p.y,width:end.x-p.x,height:end.y-p.y};};
 const labels=[];
 for(const foreign of group.querySelectorAll('foreignObject')){
  const label=foreign.firstElementChild?.firstElementChild;if(!label)continue;
  const frame=box(label.getBoundingClientRect()),style=getComputedStyle(label),runs=[],shapes=[];
  for(const element of label.querySelectorAll('*')){
   if(element.closest('.katex-mathml')||element.closest('svg')!==svg)continue;
   const css=getComputedStyle(element),rect=element.getBoundingClientRect();if(!rect.width||!rect.height||css.visibility==='hidden'||css.display==='none')continue;const bounds=box(rect);
   if(css.backgroundColor&&!['transparent','rgba(0, 0, 0, 0)'].includes(css.backgroundColor))shapes.push({type:'rect',...bounds,color:css.backgroundColor,radius:parseFloat(css.borderRadius)||0});
   for(const side of ['Top','Bottom','Left','Right']){const width=parseFloat(css['border'+side+'Width']);if(!width||css['border'+side+'Style']==='none')continue;const x=bounds.x,y=bounds.y,w=bounds.width,h=bounds.height;shapes.push({type:'line',x1:side==='Right'?x+w:x,y1:side==='Bottom'?y+h:y,x2:side==='Left'?x:side==='Right'?x+w:x+w,y2:side==='Top'?y:side==='Bottom'?y+h:y+h,width,color:'#273249'});}
  }
  for(const image of label.querySelectorAll('svg')){const rect=image.getBoundingClientRect();if(!rect.width||!rect.height)continue;let clip=null;for(let parent=image.parentElement;parent&&parent!==label;parent=parent.parentElement){const css=getComputedStyle(parent);if(!/(hidden|clip)/.test(css.overflow+css.overflowX+css.overflowY))continue;const bounds=box(parent.getBoundingClientRect());if(!clip)clip=bounds;else{const right=Math.min(clip.x+clip.width,bounds.x+bounds.width),bottom=Math.min(clip.y+clip.height,bounds.y+bounds.height);clip={x:Math.max(clip.x,bounds.x),y:Math.max(clip.y,bounds.y),width:0,height:0};clip.width=Math.max(0,right-clip.x);clip.height=Math.max(0,bottom-clip.y);}}shapes.push({type:'svg',...box(rect),clip,markup:image.outerHTML});}
  const walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);let node;
  while((node=walker.nextNode())){
   if(node.parentElement.closest('.katex-mathml'))continue;
   const css=getComputedStyle(node.parentElement);if(css.visibility==='hidden'||css.display==='none')continue;
   const range=document.createRange();let cursor=0;
   for(const char of node.data){const start=cursor;cursor+=char.length;range.setStart(node,start);range.setEnd(node,cursor);const rect=range.getBoundingClientRect();if(!rect.width||!rect.height||!char.trim())continue;
    const position=box(rect),fontSize=parseFloat(css.fontSize)||13;
    runs.push({text:char,...position,fontSize,fontFamily:css.fontFamily,fontStyle:css.fontStyle,fontWeight:css.fontWeight,color:css.color});
   }
  }
  labels.push({...frame,radius:parseFloat(style.borderRadius)||0,fontSize:style.fontSize,lineHeight:style.lineHeight,fontWeight:style.fontWeight,padding:style.padding,depth:Number(foreign.closest('[data-depth]')?.getAttribute('data-depth'))||0,runs,shapes});
 }
 return labels;
}

const ns='http://www.w3.org/2000/svg';
export function vectorMindmapLabels(svg,labels,fontFor){
 if(!Array.isArray(labels)||!labels.length)throw Error('文字排版尚未准备好，可以先导出清晰图像 PDF。');
 const foreign=[...svg.querySelectorAll('foreignObject')];
 if(foreign.length!==labels.length)throw Error('图谱文字与画布不一致，请重新绘制后导出。');
 const root=svg.querySelector('[data-qg-root]');
 for(const [index,label] of labels.entries()){
  foreign[index].remove();const group=document.createElementNS(ns,'g'),rect=document.createElementNS(ns,'rect');group.setAttribute('data-qg-label','');
  for(const prop of ['x','y','width','height'])rect.setAttribute(prop,String(label[prop]));
  rect.setAttribute('rx',String(label.radius));rect.setAttribute('fill',label.depth===0?'#f0ebfb':'#fff');rect.setAttribute('stroke','#ddd7eb');rect.setAttribute('stroke-width','.8');group.append(rect);
  for(const shape of label.shapes||[]){let part;if(shape.type==='svg'){const template=document.createElement('template');template.innerHTML=shape.markup;part=template.content.firstElementChild;for(const key of ['x','y','width','height'])part.setAttribute(key,String(shape[key]));part.style.cssText='color:#273249;fill:#273249;';if(shape.clip){const id='qg-map-clip-'+crypto.randomUUID(),defs=document.createElementNS(ns,'defs'),clip=document.createElementNS(ns,'clipPath'),bounds=document.createElementNS(ns,'rect'),wrapper=document.createElementNS(ns,'g');clip.setAttribute('id',id);clip.setAttribute('clipPathUnits','userSpaceOnUse');for(const key of ['x','y','width','height'])bounds.setAttribute(key,String(shape.clip[key]));clip.append(bounds);defs.append(clip);group.append(defs);wrapper.setAttribute('clip-path','url(#'+id+')');wrapper.append(part);part=wrapper;}}else{part=document.createElementNS(ns,shape.type);for(const key of shape.type==='line'?['x1','x2','y1','y2']:['x','y','width','height'])part.setAttribute(key,String(shape[key]));if(shape.type==='line'){part.setAttribute('stroke',shape.color);part.setAttribute('stroke-width',String(shape.width));}else{part.setAttribute('fill',shape.color);part.setAttribute('rx',String(shape.radius));}}group.append(part);}
  for(const run of label.runs){const text=document.createElementNS(ns,'text'),font=fontFor(run);text.textContent=run.text;text.setAttribute('x',String(run.x));text.setAttribute('y',String(run.y+run.height*.8));text.setAttribute('font-family',font.family);text.setAttribute('font-style',font.style||'normal');text.setAttribute('font-weight',font.weight||'normal');text.setAttribute('font-size',String(run.fontSize));text.setAttribute('fill','#273249');group.append(text);}
  root.append(group);
 }
 return svg;
}
