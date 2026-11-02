import {Transformer} from 'markmap-lib/no-plugins';
import {escapeHtml} from './markdown-escape.js';
import {readMath} from './math-tokens.js';

export const mindmapLimits=Object.freeze({characters:60000,nodes:1000,depth:32});
export const mindmapSamples=Object.freeze([
 {id:'launch',name:'把一个新想法，变成产品',tag:'产品与创作',title:'下一次，做点不一样的。',outline:'# 下一次，做点不一样的。\n\n## 先听见一个真实需要\n- 谁会用它\n  - 一个具体的人\n  - 一个日常的时刻\n- 现在的困扰\n  - 想完成什么\n  - 什么让人停下来\n\n## 给想法一个形状\n- 一句清楚的价值\n- 一条完整的体验\n  - 从哪里开始\n  - 如何获得结果\n- 一个值得记住的小细节\n\n## 把第一步做出来\n- 画出关键画面\n- 让核心操作跑通\n- 邀请几位真实使用者\n\n## 让下一次更好\n- 留下反馈\n- 找到最值得改的一件事\n- 再试一次'},
 {id:'learning',name:'给新知识，搭一座桥',tag:'学习与研究',title:'把复杂的事，慢慢想清楚。',outline:'# 把复杂的事，慢慢想清楚。\n\n## 我想弄懂什么\n- 写下一个具体问题\n- 说说已经知道的部分\n\n## 把线索放在一起\n- 三个核心概念\n- 它们如何连接\n- 一个有用的例子\n\n## 用自己的话解释\n- 给刚接触的人听\n- 哪一段还说不清\n- 回去补上一块拼图\n\n## 真的用一次\n- 做一个小练习\n- 看看结果\n- 留下新的问题'},
 {id:'story',name:'让故事，从一个瞬间长出来',tag:'写作与想象',title:'故事开始的那个下午。',outline:'# 故事开始的那个下午。\n\n## 一个不同寻常的人\n- 想要什么\n- 害怕什么\n- 一个只有他知道的秘密\n\n## 一件打破日常的事\n- 原本平静的生活\n- 突然出现的邀请\n- 无法回头的选择\n\n## 一路上的变化\n- 第一次尝试\n- 意料之外的同伴\n- 必须付出的代价\n\n## 留下一个回响\n- 最重要的决定\n- 和开始时不同的自己\n- 一幅让人记住的画面'},
]);

let parser;
function transformer(){
 if(parser)return parser;
 parser=new Transformer();parser.md.set({html:false,linkify:false,maxNesting:32});
 parser.md.renderer.rules.image=(tokens,index)=>'<span class="qgm-image-label">图：'+escapeHtml(tokens[index].content||'图片说明')+'</span>';
 parser.md.inline.ruler.before('escape','qgauss_math',(state,silent)=>{
  const found=readMath(state.src.slice(state.pos));if(!found||found.math.length>2000)return false;
  if(!silent){const token=state.push('qgauss_math','span',0);token.content=found.math;token.meta=found;}
  state.pos+=found.raw.length;return true;
 });
 parser.md.renderer.rules.qgauss_math=(tokens,index)=>{const token=tokens[index];return'<span data-qg-math="'+escapeHtml(token.content)+'" data-display="'+Number(token.meta.display)+'">'+escapeHtml(token.meta.raw)+'</span>';};
 return parser;
}

export function normalizeMindmap(source){
 if(typeof source!=='string'||source.includes('\0'))throw Error('请使用有效的文字大纲。');
 const text=source.replace(/\r\n?/g,'\n');if(text.length>mindmapLimits.characters)throw Error('大纲最多支持 '+mindmapLimits.characters.toLocaleString('zh-CN')+' 个字符，请拆成几份文档。');
 return text;
}
export function parseMindmap(source,sanitize=value=>escapeHtml(value)){
 const text=normalizeMindmap(source);if(!text.trim())return{root:null,nodes:0,depth:0,title:'未命名的想法',source:text};
 // Frontmatter remains in the document but never changes executable assets or renderer options.
 const clean=text.replace(/^---\n[\s\S]*?\n---(?:\n|$)/,block=>'\n'.repeat((block.match(/\n/g)||[]).length));
 const {root}=transformer().transform(clean);let nodes=0,depth=0;
 function walk(node,level=0,branch=0){
  if(++nodes>mindmapLimits.nodes)throw Error('节点超过 '+mindmapLimits.nodes+' 个，请把大纲拆分后再展开。');
  if(level>mindmapLimits.depth)throw Error('层级过深，请整理为 '+mindmapLimits.depth+' 层以内的大纲。');depth=Math.max(depth,level);
  node.content=sanitize(String(node.content||''));node.payload={...node.payload,qgDepth:level,qgBranch:branch,qgKey:(node.payload?.lines||[]).join(':')+':'+node.content.slice(0,120)};
  for(const [index,child]of(node.children||[]).entries())walk(child,level+1,level===0?index:branch);
 }
 walk(root);return{root,nodes,depth,title:clean.split('\n').map(line=>line.replace(/^\s*#+\s*|^\s*[-*+]\s*/g,'').trim()).find(Boolean)?.slice(0,100)||'未命名的想法',source:text};
}

export async function decorateMindmapMath(root,render,current=()=>true){
 if(!root||!render)return;let formulas=0;
 async function walk(node){if(!current())return;const host=document.createElement('template');host.innerHTML=node.content;
  for(const part of host.content.querySelectorAll('[data-qg-math]')){if(!current())return;if(++formulas>60){part.removeAttribute('data-qg-math');continue;}try{const html=await render(part.dataset.qgMath,part.dataset.display==='1');if(!current())return;part.innerHTML=html;}catch{part.title='这条公式保留了原文，可继续编辑。';}part.removeAttribute('data-qg-math');part.removeAttribute('data-display');}
  node.content=host.innerHTML;for(const child of node.children||[])await walk(child);
 }
 await walk(root);
}

export function portableMindmap(root){return root?{content:root.content,payload:{fold:root.payload?.fold?1:0,qgDepth:root.payload?.qgDepth||0,qgBranch:root.payload?.qgBranch||0},children:(root.children||[]).map(portableMindmap)}:null;}
