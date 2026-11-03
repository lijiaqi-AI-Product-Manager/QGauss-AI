import {Transformer} from 'markmap-lib/no-plugins';
import {BusinessException,ErrorCode} from '../../common/exceptions/business.exception';

const parser=new Transformer();
parser.md.set({html:false,linkify:false,maxNesting:32});
const invalid=(message:string)=>new BusinessException(ErrorCode.PARAM_INVALID,message,400);

export function normalizeMindmapText(value:unknown,max=60000):string {
 if(typeof value!=='string'||value.includes('\0'))throw invalid('请使用有效的文字大纲。');
 const text=value.replace(/\r\n?/g,'\n');
 if(text.length>max)throw invalid('这份文字较长，请拆成几份想法后再继续。');
 return text;
}

/** Parsing never loads the assets declared in a document or executes embedded HTML. */
export function mindmapOutline(value:unknown){
 const outline=normalizeMindmapText(value),clean=outline.replace(/^---\n[\s\S]*?\n---(?:\n|$)/,block=>'\n'.repeat((block.match(/\n/g)||[]).length));
 if(!clean.trim())throw invalid('先写下至少一条想法，再把它保存起来。');
 const {root}=parser.transform(clean);let nodeCount=0,depth=0;
 const visit=(node:{children?:unknown[]},level:number)=>{if(++nodeCount>1000)throw invalid('节点超过 1,000 个，请把大纲拆分后再保存。');if(level>32)throw invalid('层级过深，请整理为 32 层以内的大纲。');depth=Math.max(depth,level);for(const child of node.children||[])visit(child as {children?:unknown[]},level+1);};
 visit(root,0);
 const title=clean.split('\n').map(line=>line.replace(/^\s*#+\s*|^\s*[-*+]\s*/g,'').trim()).find(Boolean)?.slice(0,100)||'未命名的想法';
 return{outline,title,nodeCount,depth};
}

export function mindmapGeneratedOutline(value:unknown){
 let outline=normalizeMindmapText(value).trim();
 const fence=/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i.exec(outline);if(fence)outline=fence[1].trim();
 const parsed=mindmapOutline(outline);
 if(parsed.nodeCount<2)throw invalid('这次结果尚未整理为可用的大纲，请调整描述后再试。');
 return parsed;
}
