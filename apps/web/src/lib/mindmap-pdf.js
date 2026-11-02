import fonts from 'qgauss:mindmap-fonts';
import {vectorMindmapLabels} from './mindmap-labels.js';
import {loadMindmapPdf} from './mindmap-pdf-runtime.js';
const check=signal=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};
function fontFor(run){const family=/KaTeX_[\w]+/.exec(run.fontFamily)?.[0];if(!family)return{family:'QGaussMap',style:'normal',weight:'normal',pdfStyle:'normal',key:'QGaussMap'};const italic=run.fontStyle==='italic',bold=Number(run.fontWeight)>=600,pdfStyle=(bold?'bold':'')+(italic?'italic':'')||'normal',key=family+':'+pdfStyle;if(!fonts[key])throw Error('这条公式的字体暂不支持矢量导出，请选择清晰图像 PDF。');return{family,style:italic?'italic':'normal',weight:bold?'bold':'normal',pdfStyle,key};}
function binary(bytes){let value='';for(let at=0;at<bytes.length;at+=16384)value+=String.fromCharCode(...bytes.subarray(at,at+16384));return value;}
export async function vectorMindmapPdf(snapshot,graphic,{title,signal,onProgress=()=>{}}={}){
 check(signal);onProgress('正在准备本地文字与矢量组件…');
 const jsPDF=await loadMindmapPdf({signal,svg:true});check(signal);
 const ratio=Math.min(.75,14400/graphic.width,14400/graphic.height),width=graphic.width*ratio,height=graphic.height*ratio,pdf=new jsPDF({orientation:width>height?'landscape':'portrait',unit:'pt',format:[width,height],compress:true,putOnlyUsedFonts:true});
 const needed=new Map();for(const label of snapshot.labels||[])for(const run of label.runs){const font=fontFor(run);if(!needed.has(font.key))needed.set(font.key,{...font,characters:new Set()});needed.get(font.key).characters.add(run.text);}
 for(const font of needed.values()){
  check(signal);onProgress('正在准备中文和公式字体…');const response=await fetch(fonts[font.key],{signal,credentials:'same-origin'});if(!response.ok)throw Error('文字组件暂未准备好，请重试或选择清晰图像 PDF。');const bytes=new Uint8Array(await response.arrayBuffer());check(signal);
  const name=font.key.replace(/[^a-z0-9]/gi,'')+'.ttf';pdf.addFileToVFS(name,binary(bytes));pdf.addFont(name,font.family,font.pdfStyle);const installed=pdf.getFont(font.family,font.pdfStyle),map=installed.metadata?.cmap?.unicode?.codeMap;
  if(!map)throw Error('文字组件尚未核对完整，请选择清晰图像 PDF。');
  for(const character of font.characters)if(!map[character.codePointAt(0)])throw Error('大纲包含矢量字体尚未收录的文字或符号，请选择清晰图像 PDF，保留完整画面。');
 }
 const svg=vectorMindmapLabels(graphic.svg,snapshot.labels,fontFor);check(signal);onProgress('正在装好可放大的线条与文字…');
 const mount=document.createElement('div');mount.style.cssText='position:fixed;left:-100000px;top:0;pointer-events:none;';mount.append(svg);document.body.append(mount);
 try{await pdf.svg(svg,{x:0,y:0,width,height});check(signal);pdf.setProperties({title,creator:'QGauss',author:'QGauss'});return pdf.output('blob');}finally{mount.remove();}
}
