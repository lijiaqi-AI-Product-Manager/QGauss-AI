import { ProtocolUsage,UpstreamError } from './chat-protocol';
import { AgentActivity,safeAgentActivity } from './agent-activity';
import { safeWebSource } from './web-search';
import {AgentStepTracker} from './agent-steps';
export type CozeInput = {role:'user'|'assistant';content:string;attachments?:string[]};
export type CozeRemote = {conversationId:string;chatId:string};
const identifier=(value:unknown)=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(value)?value:null;
const integer=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=2147483647;

export function cozeEndpoint(baseUrl:string,path:string,query?:Record<string,string>) {
  let base:URL;try{base=new URL(baseUrl);}catch{throw new UpstreamError(400,'invalid agent endpoint','智能体服务根地址无效');}if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.hash||base.search)throw new UpstreamError(400,'invalid agent endpoint','智能体服务地址应为不含账号、参数或片段的根地址');
  base.pathname=base.pathname.replace(/\/+$/,'')+path;for(const[key,value]of Object.entries(query||{}))base.searchParams.set(key,value);return base.href;
}
export function cozeChatBody(botId:string,userId:string,messages:Array<{role:'user'|'assistant';content:string;files?:Array<{id:string;kind:'image'|'file'}>}>) {
  if(!/^\d{1,64}$/.test(botId)||!identifier(userId)||!messages.length||messages.length>100||messages.at(-1)?.role!=='user')throw new UpstreamError(400,'invalid agent request','智能体请求缺少有效的搭档、用户或当前问题');
  return {bot_id:botId,user_id:userId,stream:true,auto_save_history:true,enable_card:false,publish_status:'published_online',additional_messages:messages.map(message=>({role:message.role,type:message.role==='assistant'?'answer':'question',content_type:message.files?.length?'object_string':'text',content:message.files?.length?JSON.stringify([...(message.content?[{type:'text',text:message.content}]:[]),...message.files.map(file=>({type:file.kind,file_id:file.id}))]):message.content}))};
}

/** Native server-managed agent events only. Tool arguments, raw outputs and private IDs never enter activity. */
export class CozeStreamDecoder {
  private closed=false;private completed=false;private text='';private reasoning='';private usage:ProtocolUsage|null=null;
  private remote:Partial<CozeRemote>={};private answers=new Map<string,string>();
  private report:AgentActivity;private steps:AgentStepTracker;
  constructor(private readonly botId:string,context:'fresh'|'continued',private readonly callbacks:{emit:(event:'delta'|'reasoning',value:string)=>void;activity:(value:AgentActivity)=>void;remote:(value:CozeRemote)=>void}) {this.report={kind:'agent',status:'waiting',context,steps:[],suggestions:[],artifacts:[]};this.steps=new AgentStepTracker(this.report.steps);}
  get ended(){return this.closed;}
  private changed(){this.callbacks.activity(safeAgentActivity(this.report)!);}
  private identities(json:any,isChat:boolean){
    if(json.bot_id!==undefined&&String(json.bot_id)!==this.botId)throw new UpstreamError(502,'agent identity mismatch','智能体服务返回的搭档身份不一致');
    const conversationId=identifier(json.conversation_id),chatId=identifier(isChat?json.id||json.chat_id:json.chat_id);
    let changed=false;
    for(const[key,value]of Object.entries({conversationId,chatId})){if(!value)continue;if(this.remote[key]&&this.remote[key]!==value)throw new UpstreamError(502,'agent run mismatch','智能体服务返回了不一致的会话');if(this.remote[key]!==value)changed=true;this.remote[key]=value;}
    if(changed&&this.remote.conversationId&&this.remote.chatId)this.callbacks.remote({...this.remote} as CozeRemote);
  }
  private answer(json:any,complete:boolean){
    const id=identifier(json.id);if(!id)throw new UpstreamError(502,'missing agent message identity');
    let content=typeof json.content==='string'?json.content:'';
    if(json.content_type&&json.content_type!=='text'){
      if(json.content_type!=='object_string')throw new UpstreamError(400,'unsupported agent content','智能体返回了暂不支持的交互内容');
      if(!complete)return;
      let parts:any;try{parts=JSON.parse(content);}catch{throw new UpstreamError(502,'invalid agent multimodal answer');}
      if(!Array.isArray(parts))throw new UpstreamError(502,'invalid agent multimodal answer');
      const texts:string[]=[];for(const part of parts.slice(0,30)){if(part?.type==='text'&&typeof part.text==='string')texts.push(part.text);else if(['image','file'].includes(part?.type)){const source=safeWebSource({url:part.file_url||part.url,title:part.file_name||part.name||(part.type==='image'?'智能体返回的图片':'智能体返回的文件')});if(source&&!this.report.artifacts.some(row=>row.url===source.url)&&this.report.artifacts.length<12)this.report.artifacts.push({...source,kind:part.type});}}
      content=texts.join('\n\n');this.changed();
    }
    const previous=this.answers.get(id)||'';
    if(complete){if(!content.startsWith(previous))throw new UpstreamError(502,'inconsistent agent completion','智能体的完整回复与已返回片段不一致');this.answers.set(id,content);}
    else this.answers.set(id,previous+content);
    const next=[...this.answers.values()].filter(Boolean).join('\n\n');if(next.length>1_000_000)throw new UpstreamError(502,'agent output too large','智能体本轮回复超过本站可保存的长度');
    if(!next.startsWith(this.text))throw new UpstreamError(502,'out of order agent answer');
    const delta=next.slice(this.text.length);this.text=next;if(delta)this.callbacks.emit('delta',delta);
  }
  consume(data:string,event=''){
    if(this.closed||!data.trim())return;
    if(data==='[DONE]'){if(!this.completed)throw new UpstreamError(502,'agent ended before completion');this.closed=true;return;}
    let json:any;try{json=JSON.parse(data);}catch{throw new UpstreamError(502,'invalid agent SSE JSON');}
    if(!json||typeof json!=='object'||Array.isArray(json))throw new UpstreamError(502,'invalid agent SSE payload');
    if(event==='error'||event==='conversation.chat.failed'||json.error)throw new UpstreamError(502,'agent provider error','智能体服务未能完成本轮协作');
    if(event==='conversation.chat.requires_action')throw new UpstreamError(400,'agent action required','智能体要求额外操作，当前会话无法自动执行；请联系管理员核对搭档配置');
    if(event==='done'){if(!this.completed)throw new UpstreamError(502,'agent ended before completion');this.closed=true;return;}
    if(event.startsWith('conversation.chat.')){
      this.identities(json,true);if(json.last_error?.code)throw new UpstreamError(502,'agent terminal error','智能体服务未能完成本轮协作');
      if(event==='conversation.chat.canceled')throw new UpstreamError(502,'agent canceled','服务方取消了本轮协作');
      if(event==='conversation.chat.completed'){
        if(json.status&&json.status!=='completed')throw new UpstreamError(502,'inconsistent agent status');
        const prompt=json.usage?.input_count??json.usage?.input_tokens,completion=json.usage?.output_count??json.usage?.output_tokens;
        this.usage=integer(prompt)&&integer(completion)?{promptTokens:prompt,completionTokens:completion}:null;this.completed=true;this.closed=true;return;
      }
      this.report.status='running';this.changed();return;
    }
    if(!event.startsWith('conversation.message.'))return;
    this.identities(json,false);if(json.role!=='assistant')return;this.report.status='running';
    if(json.type==='answer'){
      this.answer(json,event==='conversation.message.completed');
      if(typeof json.reasoning_content==='string'&&event==='conversation.message.delta'){this.reasoning+=json.reasoning_content;this.callbacks.emit('reasoning',json.reasoning_content);}
    }else if(json.type==='follow_up'&&event==='conversation.message.completed'&&typeof json.content==='string'){
      const question=json.content.trim().slice(0,400);if(question&&!this.report.suggestions.includes(question)&&this.report.suggestions.length<6)this.report.suggestions.push(question);
    }else if(['function_call','tool_response','tool_output'].includes(json.type)&&event==='conversation.message.completed'){
      if(!this.steps.consume(json.type,json))return;
      if(this.steps.truncated)this.report.stepsTruncated=true;
    }
    this.changed();
  }
  result(){
    if(!this.completed||(!this.text.trim()&&!this.report.artifacts.length)||!this.remote.chatId||!this.remote.conversationId)throw new UpstreamError(502,'incomplete agent reply','智能体连接已结束，但没有返回完整结果');
    if(!this.text.trim()){this.text='智能体返回了附件，请查看下方结果。';this.callbacks.emit('delta',this.text);}
    this.report.status='completed';this.changed();return {text:this.text,reasoning:this.reasoning,usage:this.usage,finishReason:'stop',activity:safeAgentActivity(this.report)!,remote:this.remote as CozeRemote};
  }
}
