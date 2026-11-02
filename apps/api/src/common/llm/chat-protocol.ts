import { WebSearchCollector, WebSearchMode, WebSearchReport } from './web-search';
export type ChatProtocol = 'OPENAI' | 'OPENAI_RESPONSES' | 'ANTHROPIC' | 'GEMINI' | 'CUSTOM';
export type ProtocolMessage = { role: 'system' | 'user' | 'assistant'; content: string; images?: string[] };
export type ProtocolUsage = { promptTokens: number; completionTokens: number };
type ProtocolChannel = { type: string; baseUrl: string; apiKey: string; upstreamName: string; webSearchMode?: WebSearchMode | null };

export class UpstreamError extends Error {
  constructor(readonly status: number, readonly body: string, message = `上游返回 ${status}`) { super(message); }
}

function protocol(type: string): ChatProtocol {
  if (!['OPENAI', 'OPENAI_RESPONSES', 'ANTHROPIC', 'GEMINI', 'CUSTOM'].includes(type)) throw new UpstreamError(503, 'unsupported protocol', '渠道通信方式尚未支持，请检查后台配置');
  return type as ChatProtocol;
}
function imageData(url: string) {
  const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!match) throw new UpstreamError(400, 'invalid inline image', '此通信方式只接受已上传的有效图片');
  return { mime: match[1], data: match[2] };
}

/** One request definition is shared by actual generation and explicit administrator probes. */
export function buildChatRequest(channel: ProtocolChannel, messages: ProtocolMessage[], options: { maxTokens: number; temperature?: number; stream?: boolean; webSearch?: boolean }) {
  const type = protocol(channel.type), stream = options.stream !== false;
  const base = new URL(channel.baseUrl);
  if (base.hash || base.username || base.password) throw new UpstreamError(400, 'invalid API root', '渠道地址应为不含片段或账号的 API 根地址');
  const endpoint = (path: string, sse = false) => { const url = new URL(base); url.pathname = base.pathname.replace(/\/+$/, '') + path; if (sse) url.searchParams.set('alt', 'sse'); return url.href; };
  const model = channel.upstreamName;
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json' };
  const temperature = options.temperature === undefined ? {} : { temperature: options.temperature };
  if(options.webSearch && !['OPENAI_RESPONSES','ANTHROPIC'].includes(type) && !(type==='CUSTOM'&&channel.webSearchMode==='retrieval'))throw new UpstreamError(400,'web search unsupported','当前渠道尚未接入联网检索');
  let url: string, body: Record<string, unknown>;
  if (type === 'ANTHROPIC') {
    url = endpoint('/messages');
    // Pin the documented compatible version; do not silently upgrade existing parameter semantics.
    headers['anthropic-version'] = '2023-06-01';
    if (channel.apiKey) headers['x-api-key'] = channel.apiKey;
    body = { model, max_tokens: options.maxTokens, stream, ...temperature,
      ...(options.webSearch?{tools:[{type:'web_search_20250305',name:'web_search',max_uses:3}]}:{}),
      ...(messages.some(m => m.role === 'system') ? { system: messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n') } : {}),
      messages: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role, content: [
        ...(m.content ? [{ type: 'text', text: m.content }] : []),
        ...(m.images || []).map(url => { const image = imageData(url); return { type: 'image', source: { type: 'base64', media_type: image.mime, data: image.data } }; }),
      ] })),
    };
  } else if (type === 'GEMINI') {
    const name = model.replace(/^models\//, '');
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/.test(name)) throw new UpstreamError(400, 'invalid model path', 'Gemini 渠道模型名无效');
    url = endpoint('/models/' + encodeURIComponent(name) + (stream ? ':streamGenerateContent' : ':generateContent'), stream);
    if (channel.apiKey) headers['x-goog-api-key'] = channel.apiKey;
    body = { generationConfig: { maxOutputTokens: options.maxTokens, ...temperature },
      ...(messages.some(m => m.role === 'system') ? { systemInstruction: { parts: messages.filter(m => m.role === 'system').map(m => ({ text: m.content })) } } : {}),
      contents: messages.filter(m => m.role !== 'system').map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [
        ...(m.content ? [{ text: m.content }] : []),
        ...(m.images || []).map(url => { const image = imageData(url); return { inlineData: { mimeType: image.mime, data: image.data } }; }),
      ] })),
    };
  } else if (type === 'OPENAI_RESPONSES') {
    url = endpoint('/responses');
    if (channel.apiKey) headers.Authorization = 'Bearer ' + channel.apiKey;
    body = { model, stream, store: false, max_output_tokens: options.maxTokens, ...temperature,
      ...(options.webSearch?{tools:[{type:'web_search'}],tool_choice:'auto',include:['web_search_call.action.sources']}:{}),
      input: messages.map(m => ({ role: m.role, content: [
        { type: m.role === 'assistant' ? 'output_text' : 'input_text', text: m.content },
        ...(m.images || []).map(image_url => ({ type: 'input_image', image_url, detail: 'auto' })),
      ] })),
    };
  } else {
    url = endpoint('/chat/completions');
    if (channel.apiKey) headers.Authorization = 'Bearer ' + channel.apiKey;
    body = { model, stream, max_tokens: options.maxTokens, ...temperature, ...(stream ? { stream_options: { include_usage: true } } : {}),
      ...(options.webSearch?{tools:[{type:'retrieval'}],tool_choice:'auto'}:{}),
      messages: messages.map(m => ({ role: m.role, content: m.images?.length ? [{ type: 'text', text: m.content }, ...m.images.map(url => ({ type: 'image_url', image_url: { url } }))] : m.content })),
    };
  }
  return { type, url, init: { method: 'POST', headers, body: JSON.stringify(body) } };
}

function token(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647; }
function usage(prompt: unknown, completion: unknown): ProtocolUsage | null { return token(prompt) && token(completion) ? { promptTokens: prompt, completionTokens: completion } : null; }
const unsupportedTool = () => new UpstreamError(400, 'tool continuation unsupported', '当前会话尚未启用工具调用，无法继续这种回复');

/** Only provider-managed search is recognized; arbitrary client tools are never executed. */
export class ChatProtocolDecoder {
  private text = ''; private reasoning = ''; private terminal = false;
  private closed = false;
  private finishReason: string | null = null; private reportedUsage: ProtocolUsage | null = null;
  private anthropicInput: Record<string, number> = {}; private anthropicOutput: number | null = null;
  private search?: WebSearchCollector;
  private responseOffsets = new Map<string,number>();
  private searchBlocks = new Set<number>();
  constructor(private readonly type: ChatProtocol, private readonly emit: (event: 'delta' | 'reasoning', value: string) => void, options: { webSearch?: boolean; onSearch?: (report:WebSearchReport)=>void } = {}) { if(options.webSearch)this.search=new WebSearchCollector(options.onSearch); }
  get ended() { return this.closed; }

  private write(event: 'delta' | 'reasoning', value: unknown) {
    if (typeof value !== 'string' || !value) return;
    if (event === 'delta') this.text += value; else this.reasoning += value;
    this.emit(event, value);
  }

  consume(data: string, event = '') {
    if (!data.trim()) return;
    if (this.closed) return;
    if (data === '[DONE]' && ['OPENAI', 'CUSTOM'].includes(this.type)) { this.terminal = this.closed = true; this.finishReason ||= 'stop'; return; }
    let json: any;
    try { json = JSON.parse(data); } catch { throw new UpstreamError(502, 'invalid SSE JSON', '模型服务返回了无法解析的回复'); }
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new UpstreamError(502, 'invalid SSE payload');
    if (json.error || json.type === 'error' || event === 'error') {
      const category = json.error?.type || json.error?.status || json.error?.code || json.code;
      const codes: Record<string, number> = { authentication_error: 401, invalid_api_key: 401, UNAUTHENTICATED: 401, permission_error: 403, PERMISSION_DENIED: 403, rate_limit_error: 429, rate_limit_exceeded: 429, RESOURCE_EXHAUSTED: 429, overloaded_error: 529 };
      const code = typeof category === 'number' && category >= 400 && category <= 599 ? category : codes[String(category)] || 502;
      throw new UpstreamError(code, 'provider stream error', '模型服务中断了本轮回复，请稍后重试');
    }
    if (this.type === 'OPENAI' || this.type === 'CUSTOM') {
      const choice = json.choices?.find((c: any, i: number) => c?.index === 0 || (c?.index === undefined && i === 0));
      if (choice?.delta?.tool_calls || choice?.delta?.function_call || ['tool_calls', 'function_call'].includes(choice?.finish_reason)) throw unsupportedTool();
      this.write('reasoning', choice?.delta?.reasoning_content);
      this.write('delta', choice?.delta?.content); this.write('delta', choice?.delta?.refusal);
      if (choice?.finish_reason) {
        if (!['stop', 'length'].includes(choice.finish_reason)) throw new UpstreamError(400, 'incomplete choice', '模型服务未能完成本轮回复');
        this.finishReason = choice.finish_reason; this.terminal = true;
      }
      if (json.usage) this.reportedUsage = usage(json.usage.prompt_tokens, json.usage.completion_tokens);
      if(this.search){
        for(const item of Array.isArray(json.citations)?json.citations:[])this.search.source(typeof item==='string'?{url:item}:item);
        for(const item of choice?.delta?.annotations || choice?.message?.annotations || []){const cite=item?.type==='url_citation'?(item.url_citation||item):null;if(cite)this.search.source(cite,Number.isSafeInteger(cite.start_index)&&Number.isSafeInteger(cite.end_index)?{start:cite.start_index,end:cite.end_index}:undefined);}
      }
    } else if (this.type === 'OPENAI_RESPONSES') {
      const type = json.type || event;
      if (type === 'response.output_text.delta' || type === 'response.refusal.delta') {const key=String(json.item_id||'')+':'+String(json.content_index??0);if(!this.responseOffsets.has(key))this.responseOffsets.set(key,this.text.length);this.write('delta', json.delta);}
      if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') this.write('reasoning', json.delta);
      if ((type === 'response.output_item.added' || type === 'response.output_item.done') && json.item?.type && !['message', 'reasoning'].includes(json.item.type)) {
        if(!this.search||json.item.type!=='web_search_call')throw unsupportedTool();
        this.search.begin();if(json.item.status==='failed')throw new UpstreamError(400,'web search failed','联网检索未能完成，请稍后明确重试');
        for(const source of json.item.action?.sources || [])this.search.source(source);
      }
      if(type.startsWith('response.web_search_call.')){if(!this.search)throw unsupportedTool();this.search.begin();if(type.endsWith('.failed'))throw new UpstreamError(400,'web search failed','联网检索未能完成，请稍后明确重试');}
      if(type==='response.output_text.annotation.added'&&this.search&&json.annotation?.type==='url_citation'){
        const cite=json.annotation,base=this.responseOffsets.get(String(json.item_id||'')+':'+String(json.content_index??0));
        this.search.source(cite,base!==undefined&&Number.isSafeInteger(cite.start_index)&&Number.isSafeInteger(cite.end_index)?{start:base+cite.start_index,end:base+cite.end_index}:undefined);
      }
      if (type === 'response.failed' || type === 'response.cancelled') throw new UpstreamError(502, 'response failed', '模型服务没有完成本轮回复');
      if (type === 'response.completed' || type === 'response.incomplete') {
        if (json.response?.error) throw new UpstreamError(502, 'response failed');
        if (json.response?.status && json.response.status !== (type === 'response.completed' ? 'completed' : 'incomplete')) throw new UpstreamError(502, 'inconsistent response status');
        if (type === 'response.incomplete' && json.response?.incomplete_details?.reason !== 'max_output_tokens') throw new UpstreamError(400, 'incomplete response', '模型服务未能完成本轮回复');
        let offset=0;
        for(const item of json.response?.output || []){
          if(item.type==='web_search_call'){if(!this.search)throw unsupportedTool();this.search.begin();if(item.status==='failed')throw new UpstreamError(400,'web search failed','联网检索未能完成，请稍后明确重试');for(const source of item.action?.sources||[])this.search.source(source);}
          else if(item.type==='message'){for(const part of item.content||[]){for(const cite of part.annotations||[]){if(cite?.type==='url_citation')this.search?.source(cite,Number.isSafeInteger(cite.start_index)&&Number.isSafeInteger(cite.end_index)?{start:offset+cite.start_index,end:offset+cite.end_index}:undefined);}if(typeof part.text==='string')offset+=part.text.length;}}
          else if(item.type&&item.type!=='reasoning')throw unsupportedTool();
        }
        this.terminal = this.closed = true; this.finishReason = type === 'response.completed' ? 'stop' : 'length';
        this.reportedUsage = usage(json.response?.usage?.input_tokens, json.response?.usage?.output_tokens);
      }
    } else if (this.type === 'ANTHROPIC') {
      const type = json.type || event;
      if (type === 'message_start' || type === 'message_delta') {
        const values = type === 'message_start' ? json.message?.usage : json.usage;
        if (values) {
          for (const key of ['input_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) if (values[key] !== undefined) this.anthropicInput[key] = token(values[key]) ? values[key] : NaN;
          if (type === 'message_delta' && values.output_tokens !== undefined) this.anthropicOutput = token(values.output_tokens) ? values.output_tokens : null;
        }
      }
      if (type === 'content_block_start') {
        if (json.content_block?.type === 'tool_use') throw unsupportedTool();
        if (json.content_block?.type === 'server_tool_use') {if(!this.search||json.content_block.name!=='web_search'||!Number.isSafeInteger(json.index))throw unsupportedTool();this.searchBlocks.add(json.index);this.search.begin();}
        if(json.content_block?.type==='web_search_tool_result'){
          if(!this.search)throw unsupportedTool();this.search.begin();
          if(json.content_block.content?.type==='web_search_tool_result_error')throw new UpstreamError(400,'web search failed','联网检索未能完成，请稍后明确重试');
          for(const item of Array.isArray(json.content_block.content)?json.content_block.content:[])if(item.type==='web_search_result')this.search.source(item);
        }
        if (json.content_block?.type === 'text') this.write('delta', json.content_block.text);
        for(const citation of json.content_block?.citations||[])if(citation?.type==='web_search_result_location')this.search?.source(citation,{start:this.text.length,end:this.text.length});
        if (json.content_block?.type === 'thinking') this.write('reasoning', json.content_block.thinking);
      }
      if (type === 'content_block_delta') {
        if (json.delta?.type === 'text_delta') this.write('delta', json.delta.text);
        if (json.delta?.type === 'thinking_delta') this.write('reasoning', json.delta.thinking);
        if (json.delta?.type === 'input_json_delta' && !this.searchBlocks.has(json.index)) throw unsupportedTool();
        if(json.delta?.type==='citations_delta'&&json.delta.citation?.type==='web_search_result_location')this.search?.source(json.delta.citation,{start:this.text.length,end:this.text.length});
      }
      if (type === 'message_delta' && json.delta?.stop_reason) {
        const reason = json.delta.stop_reason;
        if (['tool_use', 'pause_turn'].includes(reason)) throw unsupportedTool();
        if (!['end_turn', 'max_tokens', 'stop_sequence', 'refusal'].includes(reason)) throw new UpstreamError(502, 'unknown stop reason');
        this.finishReason = reason === 'max_tokens' ? 'length' : 'stop';
      }
      if (type === 'message_stop') {
        this.terminal = this.closed = !!this.finishReason;
        const input = this.anthropicInput;
        this.reportedUsage = usage(input.input_tokens === undefined ? null : input.input_tokens + (input.cache_creation_input_tokens ?? 0) + (input.cache_read_input_tokens ?? 0), this.anthropicOutput);
      }
    } else {
      if (json.promptFeedback?.blockReason && json.promptFeedback.blockReason !== 'BLOCK_REASON_UNSPECIFIED') throw new UpstreamError(400, 'prompt blocked', '模型服务未能处理本轮内容，请调整提问');
      const candidate = json.candidates?.find((c: any, i: number) => c?.index === 0 || (c?.index === undefined && i === 0));
      for (const part of candidate?.content?.parts || []) {
        if (part.functionCall || part.executableCode || part.toolCall) throw unsupportedTool();
        this.write(part.thought ? 'reasoning' : 'delta', part.text);
      }
      if (candidate?.finishReason && candidate.finishReason !== 'FINISH_REASON_UNSPECIFIED') {
        if (!['STOP', 'MAX_TOKENS'].includes(candidate.finishReason)) throw new UpstreamError(400, 'candidate incomplete', '模型服务未能完成本轮内容，请调整提问');
        this.terminal = this.closed = true; this.finishReason = candidate.finishReason === 'MAX_TOKENS' ? 'length' : 'stop';
      }
      if (json.usageMetadata) {
        const values = json.usageMetadata;
        this.reportedUsage = usage(values.promptTokenCount, token(values.candidatesTokenCount) && token(values.thoughtsTokenCount ?? 0) ? values.candidatesTokenCount + (values.thoughtsTokenCount || 0) : null);
      }
    }
  }

  result() {
    if (!this.terminal || (!this.text.trim() && !this.reasoning.trim())) throw new UpstreamError(502, 'incomplete upstream stream', '回复连接已结束，但模型服务没有返回完整结果');
    return { text: this.text, reasoning: this.reasoning, finishReason: this.finishReason || 'stop', usage: this.reportedUsage, ...(this.search?{webSearch:this.search.finish()}: {}) };
  }
}

/** Incremental SSE lines; tolerate legacy data-per-line blocks but bound every event. */
export class ChatSseParser {
  private buffer = ''; private lines: string[] = []; private event = ''; private bytes = 0;
  constructor(private readonly consume: (data: string, event: string) => void, private readonly maxBytes = 1_048_576) {}
  push(text: string) {
    this.buffer += text;
    let offset = 0;
    for (let i = 0; i < this.buffer.length; i++) {
      const value = this.buffer[i];
      if (value !== '\r' && value !== '\n') continue;
      if (value === '\r' && i + 1 === this.buffer.length) break;
      this.line(this.buffer.slice(offset, i));
      if (value === '\r' && this.buffer[i + 1] === '\n') i++;
      offset = i + 1;
    }
    this.buffer = this.buffer.slice(offset);
    if (Buffer.byteLength(this.buffer) + this.bytes > this.maxBytes) throw new UpstreamError(502, 'SSE event too large', '模型服务返回的单段回复过大');
  }
  private line(line: string) {
    if (!line) { this.dispatch(); return; }
    if (Buffer.byteLength(line) + this.bytes > this.maxBytes) throw new UpstreamError(502, 'SSE event too large', '模型服务返回的单段回复过大');
    if (line.startsWith('event:')) this.event = line.slice(6).trimStart();
    if (line.startsWith('data:')) { const data = line.slice(5).replace(/^ /, ''); this.lines.push(data); this.bytes += Buffer.byteLength(data) + 1; }
  }
  private dispatch() {
    const lines = this.lines, event = this.event; this.lines = []; this.event = ''; this.bytes = 0;
    if (!lines.length) return;
    const joined = lines.join('\n');
    if (lines.length === 1) this.consume(joined, event);
    else {
      try { JSON.parse(joined); } catch { for (const line of lines) this.consume(line, event); return; }
      this.consume(joined, event);
    }
  }
  finish() { if (this.buffer) this.line(this.buffer.replace(/\r$/, '')); this.buffer = ''; this.dispatch(); }
}
