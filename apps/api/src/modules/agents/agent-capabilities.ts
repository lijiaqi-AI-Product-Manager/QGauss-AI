type Entry={name:string;description:string};
type Kind='tools'|'workflows'|'knowledge';
const kinds:Kind[]=['tools','workflows','knowledge'];
const clean=(value:unknown,length:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length):'';
const count=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=100000;
function collection(value:unknown){
 const valid=Array.isArray(value)&&value.length<=100000,rows=valid?value:[],entries:Entry[]=[];let complete=valid;
 for(const row of rows){const name=clean(row?.name,100);if(!name){complete=false;continue;}if(entries.length<20)entries.push({name,description:clean(row?.description,500)});}
 return{entries,complete,total:complete?rows.length:null};
}

/** Persist only the published profile's public capability fields and their reporting coverage. */
export function agentMetadata(raw:any){
 const groups={tools:collection(raw?.plugin_info_list),workflows:collection(raw?.workflow_info_list),knowledge:collection(raw?.knowledge?.knowledge_infos)},model=clean(raw?.model_info?.model_name,100);
 return{model,tools:groups.tools.entries,workflows:groups.workflows.entries,knowledge:groups.knowledge.entries,knowledgeCount:groups.knowledge.total??0,coverage:{version:2,model:!!model,tools:groups.tools.complete,workflows:groups.workflows.complete,knowledge:groups.knowledge.complete},counts:{tools:groups.tools.total,workflows:groups.workflows.total,knowledge:groups.knowledge.total}};
}

/** Legacy zeroes carry no evidence of absence; a newer profile must explicitly report an empty list. */
export function publicAgentCapabilities(raw:any){
 const groups={tools:collection(raw?.tools),workflows:collection(raw?.workflows),knowledge:collection(raw?.knowledge)},coverage={version:2,model:!!clean(raw?.model,100),tools:false,workflows:false,knowledge:false},counts:Record<Kind,number|null>={tools:null,workflows:null,knowledge:null};
 for(const kind of kinds){const group=groups[kind],total=raw?.counts?.[kind];if(raw?.coverage?.version===2&&raw.coverage[kind]===true&&group.complete&&count(total)&&Math.min(total,20)===group.entries.length){coverage[kind]=true;counts[kind]=total;}}
 return{model:clean(raw?.model,100),tools:groups.tools.entries,workflows:groups.workflows.entries,knowledge:groups.knowledge.entries,knowledgeCount:counts.knowledge??(count(raw?.knowledgeCount)?raw.knowledgeCount:0),coverage,counts};
}
