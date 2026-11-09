import {AgentActivity,AGENT_STEP_LABELS} from './agent-activity';

type Step=AgentActivity['steps'][number];
type Identity={call?:string;workflow?:string;api?:string;plugin?:string;name?:string;kind?:Step['kind']};
type RecordEntry={step:Step;identity:Identity;callSeen:boolean;returnSeen:boolean;messageId:string};
const clean=(value:unknown,limit:number)=>typeof value==='string'?value.replace(/[\u0000-\u001f\u007f]/g,' ').trim().slice(0,limit):'';
const opaque=(value:unknown)=>typeof value==='string'&&value.length<=256&&!/[\u0000-\u0020\u007f]/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):'';
const messageId=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)?value:'';
function object(value:unknown):any{
  if(typeof value==='string'&&value.length<=65536){try{value=JSON.parse(value,(key,item,...context:Array<{source?:string}>)=>['plugin_id','api_id','workflow_id'].includes(key)&&typeof item==='number'&&!Number.isSafeInteger(item)?context[0]?.source??item:item);}catch{return {};}}
  return value&&typeof value==='object'&&!Array.isArray(value)?value:{};
}
function fields(json:any,isCall:boolean){
  const content=object(json.content),args=object(content.arguments),workflow=opaque(content.workflow_id)||opaque(args.workflow_id),api=opaque(content.api_id)||opaque(args.api_id),plugin=opaque(content.plugin_id)||opaque(args.plugin_id),workflowName=clean(content.workflow_name,100);
  const operation=workflowName||clean(content.api_name,100)||(isCall?clean(content.name,100):''),declared=operation||clean(content.plugin_name,100);
  const identity:Identity={call:opaque(json.tool_call_id)||opaque(json.call_id)||opaque(content.tool_call_id)||opaque(content.call_id)||undefined,workflow:workflow||undefined,api:api||undefined,plugin:plugin||undefined,name:operation||undefined,...(workflow||workflowName?{kind:'workflow' as const}:api||plugin?{kind:'tool' as const}:{})};
  return{identity,label:declared};
}
function compatible(incoming:Identity,stored:Identity,anonymous:boolean){
  if(incoming.kind&&stored.kind&&incoming.kind!==stored.kind)return false;
  for(const key of ['workflow','api','plugin'] as const)if(incoming[key]&&stored[key]&&incoming[key]!==stored[key])return false;
  for(const key of ['call','workflow','api','name','plugin'] as const)if(incoming[key])return incoming[key]===stored[key];
  return anonymous;
}
function callStep(identity:Identity,label:string):Step{
  const kind=identity.kind||'tool',code=kind==='workflow'?'workflowCall':'toolCall';
  return{kind,label:label||AGENT_STEP_LABELS[code],state:'requested',...(!label?{labelCode:code}:{})};
}

/** Match public process records without retaining or publishing tool arguments and outputs. */
export class AgentStepTracker{
  private records:RecordEntry[]=[];
  private seen=new Set<string>();
  truncated=false;
  constructor(private readonly steps:Step[]){}
  private overflow(){const changed=!this.truncated;this.truncated=true;return changed;}
  consume(type:string,json:any){
    const isCall=type==='function_call',id=messageId(json.id),key=id?(isCall?'call:':'return:')+id:'';
    if(key&&this.seen.has(key))return false;
    if(this.seen.size>=256)return this.overflow();
    if(key)this.seen.add(key);
    const {identity,label}=fields(json,isCall);
    if(isCall){
      if(identity.call&&this.records.some(row=>row.callSeen&&row.identity.call===identity.call))return false;
      const earlier=this.records.filter(row=>!row.callSeen&&row.returnSeen&&((identity.call&&identity.call===row.identity.call)||(id&&id===row.messageId))&&compatible(identity,row.identity,false));
      if(earlier.length===1){const row=earlier[0],value=callStep(identity,label);row.callSeen=true;row.identity=identity;row.messageId=id;Object.assign(row.step,value,{state:'returned'});if(!value.labelCode)delete row.step.labelCode;return true;}
      if(this.steps.length>=24)return this.overflow();
      const step=callStep(identity,label);this.steps.push(step);this.records.push({step,identity,callSeen:true,returnSeen:false,messageId:id});return true;
    }
    if(identity.call&&this.records.some(row=>row.returnSeen&&row.identity.call===identity.call))return false;
    const pending=this.truncated&&!identity.call?[]:this.records.filter(row=>row.callSeen&&!row.returnSeen&&compatible(identity,row.identity,true));
    if(pending.length===1){const row=pending[0];row.returnSeen=true;row.step.state='returned';if(identity.kind&&!row.identity.kind){row.identity.kind=identity.kind;row.step.kind=identity.kind;if(row.step.labelCode){const code=identity.kind==='workflow'?'workflowCall':'toolCall';row.step.labelCode=code;row.step.label=AGENT_STEP_LABELS[code];}}return true;}
    if(this.steps.length>=24)return this.overflow();
    const kind=identity.kind||'tool',code=kind==='workflow'?'workflowReturn':'toolReturn',step:Step={kind,label:AGENT_STEP_LABELS[code],labelCode:code,state:'returned'};
    this.steps.push(step);this.records.push({step,identity,callSeen:false,returnSeen:true,messageId:id});return true;
  }
}
