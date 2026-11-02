/** Component tests exercise transport and editing; native SVG layout is checked in a browser. */
export class Markmap{
 constructor(svg){this.element=svg;this.group=document.createElementNS('http://www.w3.org/2000/svg','g');this.group.getBBox=()=>({x:0,y:0,width:640,height:400});svg.appendChild(this.group);this.state={data:null};const group=this.group,selection={attr(){return selection;},on(){return selection;},select(){return selection;},selectAll(){return selection;}};this.svg={selectAll:()=>selection};this.g={node:()=>group,attr(name,value){if(value!==undefined){group.setAttribute(name,value);return this;}return group.getAttribute(name);}};this.scale=1;}
 async setData(data){this.state.data=data;this.group.replaceChildren();const walk=node=>{const text=document.createElementNS('http://www.w3.org/2000/svg','text'),host=document.createElement('div');host.innerHTML=node.content;text.textContent=host.textContent;this.group.appendChild(text);for(const child of node.children||[])walk(child);};walk(data);}
 async fit(){this.scale=1;this.group.setAttribute('transform','translate(0,0) scale(1)');}
 async rescale(factor){this.scale*=factor;this.group.setAttribute('transform','translate(0,0) scale('+this.scale+')');}
 setOptions(){}
 async renderData(){}
 async toggleNode(node){node.payload.fold=node.payload.fold?0:1;}
 destroy(){this.group.remove();}
}
