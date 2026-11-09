import { safeWebSource } from './web-search';
export const AGENT_STEP_LABELS={toolCall:'工具协作',workflowCall:'工作流协作',toolReturn:'工具返回',workflowReturn:'工作流返回'} as const;
export type AgentActivity = {
  kind:'agent';status:'waiting'|'running'|'completed'|'interrupted'|'failed';context:'fresh'|'continued';
  steps:Array<{kind:'tool'|'workflow';label:string;state:'requested'|'returned';labelCode?:keyof typeof AGENT_STEP_LABELS}>;
  stepsTruncated?:true;
  suggestions:string[];artifacts:Array<{url:string;title:string;kind:'image'|'file'}>;
  cancellation?:'requested'|'accepted'|'unknown';
};
const text=(value:unknown,length:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,length):'';
export function safeAgentActivity(value:unknown):AgentActivity|null {
  if(typeof value==='string'){try{value=JSON.parse(value);}catch{return null;}}
  const raw=value as Partial<AgentActivity>|null;
  if(!raw||raw.kind!=='agent'||!['waiting','running','completed','interrupted','failed'].includes(raw.status||''))return null;
  const steps=(Array.isArray(raw.steps)?raw.steps:[]).slice(0,24).filter(row=>row&&['tool','workflow'].includes(row.kind)).map(row=>{const label=text(row.label,100),code=row.labelCode,owned=typeof code==='string'&&Object.hasOwn(AGENT_STEP_LABELS,code)&&AGENT_STEP_LABELS[code]===label&&code.startsWith(row.kind==='tool'?'tool':'workflow');return{kind:row.kind,label,state:row.state==='returned'?'returned' as const:'requested' as const,...(owned?{labelCode:code}:{})};}).filter(row=>row.label);
  const suggestions=[...new Set((Array.isArray(raw.suggestions)?raw.suggestions:[]).map(row=>text(row,400)).filter(Boolean))].slice(0,6);
  const artifacts:AgentActivity['artifacts']=[],seen=new Set<string>();
  for(const item of Array.isArray(raw.artifacts)?raw.artifacts:[]){const source=safeWebSource(item);if(source&&!seen.has(source.url)&&artifacts.length<12){seen.add(source.url);artifacts.push({...source,kind:item.kind==='image'?'image':'file'});}}
  return {kind:'agent',status:raw.status!,context:raw.context==='continued'?'continued':'fresh',steps,...(raw.stepsTruncated===true||Array.isArray(raw.steps)&&raw.steps.length>24?{stepsTruncated:true as const}:{}),suggestions,artifacts,...(['requested','accepted','unknown'].includes(raw.cancellation||'')?{cancellation:raw.cancellation}:{})};
}

/** The durable cancel receipt can arrive after the saved reply; expose only its public state. */
export function publicAgentActivity(value:unknown,run?:{cancelState:string}|null){
  const activity=safeAgentActivity(value);if(!activity)return null;
  const state=run?.cancelState;
  if(state==='accepted'||state==='unknown')activity.cancellation=state;
  else if(state==='requested'||state==='sending')activity.cancellation='requested';
  return activity;
}
