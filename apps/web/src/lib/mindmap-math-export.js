import mathStyleUrl from 'qgauss:math-style';
const check=signal=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};
function base64(bytes){let value='';for(let at=0;at<bytes.length;at+=16384)value+=String.fromCharCode(...bytes.subarray(at,at+16384));return btoa(value);}
/** Package formula styles and fonts into the file; opening it needs no connection. */
export async function mindmapMathStyle(snapshot,{signal}={}){
 if(!snapshot.svg.querySelector('.katex'))return'';check(signal);
 const styleUrl=new URL(mathStyleUrl,location.href),response=await fetch(styleUrl,{signal,credentials:'same-origin'});if(!response.ok)throw Error('公式排版组件暂未准备好，请稍后重试。');let css=await response.text();
 const faces=[...css.matchAll(/@font-face\s*\{[^}]*\}/g)];
 await Promise.all(faces.map(async([face])=>{const url=/url\(([^)]*\.woff2)\)/.exec(face)?.[1];if(!url)throw Error('公式字体尚未核对完整。');const reply=await fetch(new URL(url.replace(/["']/g,''),styleUrl),{signal,credentials:'same-origin'});if(!reply.ok)throw Error('公式字体暂未准备好，请重试。');const data=base64(new Uint8Array(await reply.arrayBuffer()));check(signal);css=css.replace(face,face.replace(/src:[^;}]+/,'src:url(data:font/woff2;base64,'+data+') format("woff2")'));}));
 check(signal);return css;
}
