import { ChatProtocolDecoder, ChatSseParser, ChatProtocol, UpstreamError } from './chat-protocol';
import { WebSearchReport } from './web-search';

/** Transport owns its reader, deadlines and cancellation; protocol codecs own semantic completion. */
export function readChatResponse(response: Response, type: ChatProtocol, emit: (event: 'delta' | 'reasoning', value: string) => void, signal: AbortSignal, timeoutMs: number, options: {webSearch?:boolean;onSearch?:(report:WebSearchReport)=>void} = {}) {
  return readProtocolResponse(response,new ChatProtocolDecoder(type,emit,options),signal,timeoutMs);
}

/** The optional flush serializes durable native-provider identifiers before the next chunk. */
export async function readProtocolResponse<T>(response:Response,codec:{readonly ended:boolean;consume(data:string,event?:string):void;result():T},signal:AbortSignal,timeoutMs:number,flush?:()=>Promise<void>):Promise<T> {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw new UpstreamError(response.ok ? 502 : response.status || 502, 'HTTP error');
  }
  if (!(response.headers.get('content-type') || '').toLowerCase().includes('text/event-stream')) {
    await response.body.cancel().catch(() => {});
    throw new UpstreamError(502, 'unexpected response type', '模型服务未返回预期的流式回复');
  }
  const reader = response.body.getReader(), text = new TextDecoder('utf-8', { fatal: true });
  const parser = new ChatSseParser((data, event) => codec.consume(data, event));
  const idleMs = Math.max(5_000, Math.min(timeoutMs || 60_000, 180_000));
  let timer: ReturnType<typeof setTimeout> | undefined, timedOut = false;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', abort, { once: true });
  try {
    while (!codec.ended) {
      signal.throwIfAborted();
      timer = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, idleMs);
      const { done, value } = await reader.read();
      clearTimeout(timer); timer = undefined;
      signal.throwIfAborted();
      if (timedOut) throw new UpstreamError(504, 'body idle timeout', '模型服务长时间没有返回内容，请稍后重试');
      if (done) break;
      try { parser.push(text.decode(value, { stream: true })); } finally { await flush?.(); }
    }
    if (!codec.ended) { try { parser.push(text.decode()); parser.finish(); } finally { await flush?.(); } }
    return codec.result();
  } finally {
    if (timer) clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {}); reader.releaseLock();
  }
}
