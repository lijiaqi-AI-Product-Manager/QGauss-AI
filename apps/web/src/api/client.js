/** 统一 API 客户端：自动带 token、401 自动刷新一次、统一错误结构 */
import {requestLanguageHeaders} from '../i18n/language-preferences.js';

const BASE = '/api';

let accessToken = '';
let accessIdentity = '';
let refreshHandler = null;

export function setAccessToken(token, identity = token || '') {
  accessToken = token || '';
  accessIdentity = identity;
}

export function getAccessToken() {
  return accessToken;
}

export function setRefreshHandler(fn) {
  refreshHandler = fn;
}

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

async function canRenewCredential(token, identity, signal) {
  if (signal?.aborted || identity !== accessIdentity) return false;
  if (token !== accessToken) return !!accessToken;
  if (!refreshHandler) return false;
  const ok = await refreshHandler();
  return !!ok && !signal?.aborted && identity === accessIdentity;
}

async function request(path, { method = 'GET', body, headers = {}, retry = true, signal } = {}) {
  const requestedToken = accessToken;
  const requestedIdentity = accessIdentity;
  const res = await fetch(`${BASE}${path}`, {
    method,
    signal,
    headers: {
      ...requestLanguageHeaders(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(requestedToken ? { Authorization: `Bearer ${requestedToken}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && retry && await canRenewCredential(requestedToken,requestedIdentity,signal) && requestedIdentity === accessIdentity && !signal?.aborted) {
    void res.body?.cancel().catch(() => {});
    return request(path, { method, body, headers, retry: false, signal });
  }

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new ApiError(json?.code ?? res.status, json?.message ?? `请求失败(${res.status})`, res.status);
  }
  return json?.data ?? json;
}

/** 上传单个文件（multipart），401 时同样静默刷新一次 */
export async function uploadFile(file, { retry = true, signal } = {}) {
  return uploadMultipart('/upload', file, { retry, signal });
}
export async function uploadChatFile(file,requestKey,expectedVersion,{signal}={}){
  return uploadMultipart('/upload/requests/'+encodeURIComponent(requestKey),file,{signal,fields:{expectedVersion:String(expectedVersion)}});
}

export async function uploadVoiceRecording(file, options = {}) {
  return uploadMultipart('/voice/recordings', file, options);
}

export async function uploadVideoMaterial(kind, file, options = {}) {
  if (!['image', 'video', 'audio'].includes(kind)) throw new ApiError(400, '素材类型无效', 400);
  return uploadMultipart('/video/materials/' + kind, file, options);
}

export async function uploadAppImage(file,requestKey,crop,options={}) {
  return uploadMultipart('/apps/icons',file,{...options,retry:false,fields:{requestKey,crop:JSON.stringify(crop)}});
}

async function uploadMultipart(path, file, { retry = true, signal, fields = {} } = {}) {
  const requestedToken = accessToken;
  const requestedIdentity = accessIdentity;
  const fd = new FormData();
  fd.append('file', file, file.name || 'file');
  for(const [key,value] of Object.entries(fields)) fd.append(key,value);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    signal,
    headers: { ...requestLanguageHeaders(),...(requestedToken ? { Authorization: `Bearer ${requestedToken}` } : {}) },
    body: fd,
  });
  if (res.status === 401 && retry && await canRenewCredential(requestedToken,requestedIdentity,signal) && requestedIdentity === accessIdentity && !signal?.aborted) {
    void res.body?.cancel().catch(() => {});
    return uploadMultipart(path, file, { retry: false, signal,fields });
  }
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(json?.code ?? res.status, json?.message ?? `上传失败(${res.status})`, res.status);
  return json?.data ?? json;
}

/** 受鉴权保护的文件（<img> 带不上 Bearer）：取回后转成 blob URL，调用方负责 revoke */
export async function fetchBlobUrl(path) {
  return URL.createObjectURL(await fetchBlob(path));
}

/** Same-origin API files use the same refresh policy as JSON; callers own cancellation and URLs. */
export async function fetchBlob(path, { signal, retry = true } = {}) {
  if (typeof path !== 'string' || !path.startsWith(`${BASE}/`)) throw new ApiError(400, '文件地址无效', 400);
  const requestedToken = accessToken;
  const requestedIdentity = accessIdentity;
  const res = await fetch(path, { signal, headers: {...requestLanguageHeaders(),...(requestedToken ? { Authorization: `Bearer ${requestedToken}` } : {})} });
  if (res.status === 401 && retry && await canRenewCredential(requestedToken,requestedIdentity,signal) && requestedIdentity === accessIdentity && !signal?.aborted) {
    void res.body?.cancel().catch(() => {});
    return fetchBlob(path, { signal, retry: false });
  }
  if (!res.ok) throw new ApiError(res.status, `读取文件失败(${res.status})`, res.status);
  return res.blob();
}

/** A playback connection only reads its accepted task; renewal never submits generation. */
export async function* fetchAudioStream(path,{signal}={}){
  if(typeof path!=='string'||!/^\/api\/voice\/tasks\/[A-Za-z0-9_-]{1,128}\/stream$/.test(path))throw new ApiError(400,'声音连接地址无效',400);
  const identity=accessIdentity,locale=requestLanguageHeaders();let token=accessToken,response;
  const active=()=>{signal?.throwIfAborted();if(identity!==accessIdentity)throw new DOMException('声音播放身份已变化','AbortError');};
  for(let attempt=0;attempt<2;attempt++){active();response=await fetch(path,{signal,headers:{...locale,...(token?{Authorization:'Bearer '+token}:{})}});try{active();}catch(error){await response.body?.cancel().catch(()=>{});throw error;}
    if(response.status===401&&attempt===0){await response.body?.cancel().catch(()=>{});if(await canRenewCredential(token,identity,signal)){active();token=accessToken;continue;}}break;
  }
  if(!response.ok||!response.body||response.headers.get('content-type')?.split(';')[0].trim()!=='audio/mpeg'){await response.body?.cancel().catch(()=>{});throw new ApiError(response.status||502,'声音连接暂未就绪，请核对原任务后继续',response.ok?502:response.status);}
  const reader=response.body.getReader(),abort=()=>{void reader.cancel().catch(()=>{});};let size=0;signal?.addEventListener('abort',abort,{once:true});
  try{while(true){active();const part=await reader.read();active();if(part.done)break;size+=part.value.byteLength;if(size>32*1024*1024)throw new ApiError(502,'声音内容超过本次播放上限',502);if(part.value.byteLength)yield part.value;}if(!size)throw new ApiError(502,'暂未收到声音，可重新连接原任务',502);}
  finally{signal?.removeEventListener('abort',abort);await reader.cancel().catch(()=>{});reader.releaseLock();}
}

export const api = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: 'POST', body }),
  patch: (path, body, options) => request(path, { ...options, method: 'PATCH', body }),
  put: (path, body) => request(path, { method: 'PUT', body }),
  del: (path, options) => request(path, { ...options, method: 'DELETE' }),
};

/** A generation survives transport aborts. Cancel it through the explicit run endpoint. */
export function streamChat(payload, handlers = {}) { return observeChat({ payload }, handlers); }
export function resumeChat(messageId, handlers = {}) { return observeChat({ messageId }, handlers); }

function observeChat({ payload, messageId: initialMessageId }, handlers) {
  const controller = new AbortController();
  let sessionToken = accessToken;
  let refreshed = false;
  let messageId = initialMessageId || null;
  let cursor = null;
  const callbacks = [];
  const localeHeaders=requestLanguageHeaders();
  const alive = () => !controller.signal.aborted && (handlers.isCurrent ? handlers.isCurrent() : accessToken === sessionToken);
  const invoke = (name, ...args) => {
    if (!alive()) return;
    const value = handlers[name]?.(...args);
    if (value?.then) callbacks.push(Promise.resolve(value).catch(() => {}));
  };
  const pause = ms => new Promise(resolve => {
    if (!alive()) return resolve();
    const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    controller.signal.addEventListener('abort', finish, { once: true });
  });
  const finished = (async () => {
    const { createSseParser } = await import('../lib/sse-parser.js');
    let terminal = null;
    let retries = 0;
    while (alive()) {
      let reader;
      try {
        const reconnect = !!messageId;
        const path = reconnect ? '/chat/runs/' + encodeURIComponent(messageId) + '/events' + (cursor !== null ? '?after=' + cursor : '') : '/chat/completions';
        if (handlers.isCurrent) sessionToken = accessToken;
        const response = await fetch(BASE + path, {
          method: reconnect ? 'GET' : 'POST',
          headers: { ...localeHeaders,...(reconnect ? {} : { 'Content-Type': 'application/json' }), ...(sessionToken ? { Authorization: 'Bearer ' + sessionToken } : {}) },
          ...(reconnect ? {} : { body: JSON.stringify(payload) }), signal: controller.signal,
        });
        if (!alive()) { void response.body?.cancel().catch(() => {}); break; }
        if (response.status === 401 && !refreshed && refreshHandler && alive()) {
          refreshed = true;
          const ok = await refreshHandler();
          if (ok && alive()) { sessionToken = accessToken; continue; }
        }
        if (!response.ok) {
          const json = await response.json().catch(() => null);
          throw new ApiError(json?.code ?? response.status, json?.message ?? '请求失败(' + response.status + ')', response.status);
        }
        if (!response.body) throw new Error('回复连接没有返回内容');
        reader = response.body.getReader();
        const decoder = new TextDecoder();
        const parser = createSseParser((event, data, id) => {
          if (!alive()) return;
          const seq = id !== null && /^\d+$/.test(id) && Number.isSafeInteger(Number(id)) ? Number(id) : null;
          // A replacement snapshot is authoritative even when the old process lost its cursor.
          if (event !== 'snapshot' && seq !== null && cursor !== null && seq <= cursor) return;
          if (seq !== null) cursor = seq;
          if (event === 'meta') { messageId = data.messageId || messageId; invoke('onMeta', data); }
          else if (event === 'snapshot') {
            messageId = data.messageId || messageId;
            invoke('onMeta', data); invoke('onSnapshot', data);
            if (!['PENDING', 'STREAMING', 'SETTLING'].includes(data.status)) { terminal = 'done'; invoke('onDone', data); }
            else terminal = null;
          } else if (event === 'delta') { invoke('onConnection', 'connected'); invoke('onDelta', data.v ?? ''); }
          else if (event === 'search') { invoke('onConnection','connected'); invoke('onSearch',data); }
          else if (event === 'agent') { invoke('onConnection','connected'); invoke('onAgent',data); }
          else if (event === 'reasoning') { invoke('onConnection', 'connected'); invoke('onReasoning', data.v ?? ''); }
          else if (event === 'error') { terminal = 'error'; invoke('onError', data); }
          else if (event === 'done') { terminal = 'done'; invoke('onDone', data); }
        });
        while (alive()) {
          const { done, value } = await reader.read();
          if (done) break;
          parser.push(decoder.decode(value, { stream: true }));
        }
        if (!alive()) { void reader.cancel().catch(() => {}); break; }
        parser.push(decoder.decode()); parser.flush();
        if (terminal) { await Promise.allSettled(callbacks); return { ended: terminal }; }
      } catch (error) {
        if (!alive() || error.name === 'AbortError') break;
        if (terminal) { await Promise.allSettled(callbacks); return { ended: terminal }; }
        if (error instanceof ApiError && error.status < 500) throw error;
        if (!messageId) throw error;
      } finally {
        if (reader) { void reader.cancel().catch(() => {}); }
      }
      // Re-subscribe to the accepted run; never POST the original message again.
      if (!messageId || retries >= 4) return { ended: 'interrupted' };
      invoke('onConnection', 'reconnecting');
      await pause(Math.min(2000, 250 * 2 ** retries));
      retries += 1;
    }
    return { ended: 'aborted' };
  })();
  return { abort: () => controller.abort(), finished, signal: controller.signal };
}

/** Fallback for a temporarily unavailable event stream; leaving the view aborts this poll. */
export async function waitMessageSettled(conversationId, messageId, { timeoutMs = 20000, intervalMs = 800, signal } = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline && !signal?.aborted) {
    try {
      last = await api.get('/conversations/' + conversationId + '/messages/' + messageId, { signal });
      if (last && !['PENDING', 'STREAMING', 'SETTLING'].includes(last.status)) return last;
    } catch (e) {
      if (signal?.aborted || e.name === 'AbortError') return null;
      if (e instanceof ApiError && e.status && e.status < 500) return null;
    }
    await new Promise(resolve => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, intervalMs);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
  return signal?.aborted ? null : last;
}
