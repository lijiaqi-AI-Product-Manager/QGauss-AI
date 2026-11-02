import {createRequire} from 'node:module';
import {readFileSync,existsSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {rollup} from 'rollup';
import {nodeResolve} from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
const require=createRequire(import.meta.url),entry=resolve(dirname(fileURLToPath(import.meta.url)),'../../apps/web/src/lib/mindmap-export-runtime.js');
export function mindmapAssets(){return{name:'qgauss-mindmap-export',resolveId(id){if(['qgauss:mindmap-runtime','qgauss:mindmap-fonts','qgauss:mindmap-pdf-runtime'].includes(id))return'\0'+id;},async load(id){
 if(id==='\0qgauss:mindmap-pdf-runtime'){
  const entries=[];
  for(const[name,filename]of [['jspdf','jspdf.umd.min.js'],['svg2pdf.js','svg2pdf.umd.min.js']]){
   const root=dirname(require.resolve(name+'/package.json')),file=join(root,'dist',filename);this.addWatchFile(file);
   const source=readFileSync(file,'utf8').replace(/^\/\/# sourceMappingURL=.*$/gm,''),hash=createHash('sha256').update(source).digest('hex').slice(0,12),ref=this.emitFile({type:'asset',fileName:'mindmap/'+filename.replace('.js','-'+hash+'.js'),source});entries.push(JSON.stringify(name)+':import.meta.ROLLUP_FILE_URL_'+ref);
   this.emitFile({type:'asset',fileName:'mindmap/'+name+'-license.txt',source:readFileSync(join(root,'LICENSE'))});
  }
  return'export default {'+entries.join(',')+'};';
 }
 if(id==='\0qgauss:mindmap-fonts'){
  const project=resolve(dirname(fileURLToPath(import.meta.url)),'../../apps/web/src/assets/fonts'),katex=join(dirname(require.resolve('katex/dist/katex.min.css')),'fonts'),entries=[];
  const emit=(key,file)=>{this.addWatchFile(file);const source=readFileSync(file),hash=createHash('sha256').update(source).digest('hex').slice(0,12),ref=this.emitFile({type:'asset',fileName:'mindmap/fonts/'+key.replace(/[^a-z0-9]/gi,'-')+'-'+hash+'.ttf',source});entries.push(JSON.stringify(key)+':import.meta.ROLLUP_FILE_URL_'+ref);};
  emit('QGaussMap',join(project,'QGaussMap-Regular.ttf'));
  for(const family of ['Main','Math','AMS','Caligraphic','Fraktur','SansSerif','Script','Typewriter','Size1','Size2','Size3','Size4'])for(const [style,suffix]of [['normal','Regular'],['italic','Italic'],['bold','Bold'],['bolditalic','BoldItalic']]){const file=join(katex,'KaTeX_'+family+'-'+suffix+'.ttf');if(existsSync(file))emit('KaTeX_'+family+':'+style,file);}
  for(const name of ['OFL.txt','NOTICE.txt'])this.emitFile({type:'asset',fileName:'mindmap/fonts/'+name,source:readFileSync(join(project,name))});
  return'export default {'+entries.join(',')+'};';
 }
 if(id!=='\0qgauss:mindmap-runtime')return;this.addWatchFile(entry);const bundle=await rollup({input:entry,plugins:[nodeResolve({browser:true,preferBuiltins:false}),commonjs()],onwarn(warning,warn){if(warning.code!=='CIRCULAR_DEPENDENCY')warn(warning);}});let code;try{const output=await bundle.generate({format:'iife',inlineDynamicImports:true,sourcemap:false});code=output.output.find(item=>item.type==='chunk').code;}finally{await bundle.close();}
 const hash=createHash('sha256').update(code).digest('hex').slice(0,12),ref=this.emitFile({type:'asset',fileName:'mindmap/runtime-'+hash+'.js',source:code});
 for(const name of ['markmap-lib','markmap-view']){const root=resolve(dirname(require.resolve(name)),'..'),license=['LICENSE','LICENSE.md','LICENSE.txt'].map(file=>join(root,file)).find(existsSync);if(!license)throw Error('Missing installed library license: '+name);this.emitFile({type:'asset',fileName:'mindmap/'+name+'-license.txt',source:readFileSync(license,'utf8')});}
 return'export default import.meta.ROLLUP_FILE_URL_'+ref+';';}};}
