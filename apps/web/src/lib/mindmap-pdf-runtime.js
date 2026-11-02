import assets from 'qgauss:mindmap-pdf-runtime';
let core,vector;
function script(url,ready){return new Promise((resolve,reject)=>{if(ready()){resolve();return;}const tag=document.createElement('script'),finish=error=>{clearTimeout(timer);tag.onload=tag.onerror=null;if(error){tag.remove();reject(error);}else resolve();},timer=setTimeout(()=>finish(Error('文档组件准备超时，请稍后重试。')),20000);tag.src=url;tag.async=true;tag.onload=()=>finish(ready()?null:Error('文档组件尚未核对完整，请重试。'));tag.onerror=()=>finish(Error('文档组件暂未加载，请稍后重试。'));document.head.append(tag);});}
function cancellable(promise,signal){if(!signal)return promise;if(signal.aborted)return Promise.reject(new DOMException('导出已取消','AbortError'));return new Promise((resolve,reject)=>{const abort=()=>{cleanup();reject(new DOMException('导出已取消','AbortError'));},cleanup=()=>signal.removeEventListener('abort',abort);signal.addEventListener('abort',abort,{once:true});promise.then(value=>{cleanup();resolve(value);},error=>{cleanup();reject(error);});});}
/** Official local browser distributions load only when an export needs them. */
export async function loadMindmapPdf({signal,svg=false}={}){
 core??=script(assets.jspdf,()=>typeof window.jspdf?.jsPDF==='function').catch(error=>{core=null;throw error;});await cancellable(core,signal);
 if(svg){vector??=script(assets['svg2pdf.js'],()=>typeof window.jspdf?.jsPDF?.API?.svg==='function').catch(error=>{vector=null;throw error;});await cancellable(vector,signal);}
 return window.jspdf.jsPDF;
}
