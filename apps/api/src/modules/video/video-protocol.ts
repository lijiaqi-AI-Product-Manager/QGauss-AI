import { safeFetch } from '../../common/net/safe-fetch';
import { MAX_VIDEO_BYTES,FAL_VIDEO_MODELS } from './video-profiles';

export class VideoUpstreamError extends Error {
  constructor(public readonly status: number, public readonly phase: string, public readonly uncertain = false) { super(phase === 'submit' && uncertain ? '视频提交结果尚未确认，未自动重发' : `视频服务${phase === 'submit' ? '提交' : '查询'}暂未完成（${status || '连接异常'}）`); }
}
export class VideoFormatError extends Error {}
export async function readVideoBody(response: Response, maximum: number, signal: AbortSignal): Promise<Buffer> {
  if (!response.body) throw Error('视频服务没有返回内容');
  const size = response.headers.get('content-length');
  if (size && (!/^\d+$/.test(size) || Number(size) > maximum)) { await response.body.cancel(); throw Error('视频服务返回内容超过限制'); }
  const reader = response.body.getReader(), chunks: Buffer[] = []; let length = 0;
  const abort = () => { void reader.cancel().catch(() => {}); }; signal.addEventListener('abort', abort, { once: true });
  try { while (true) { signal.throwIfAborted(); const part = await reader.read(); signal.throwIfAborted(); if (part.done) break; length += part.value.byteLength; if (length > maximum) throw Error('视频服务返回内容超过限制'); chunks.push(Buffer.from(part.value)); } if (!length) throw Error('视频服务返回内容为空'); return Buffer.concat(chunks, length); }
  finally { signal.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export function videoEndpoint(base: string, profile: string, action: 'submit' | 'poll' | 'extend' | 'cancel' | 'result', id?: string) {
  const value = new URL(base); if (!['https:', 'http:'].includes(value.protocol) || value.username || value.password || value.search || value.hash) throw Error('视频渠道入口格式无效');
  let path = value.pathname.replace(/\/+$/, '');
  if(profile.startsWith('FAL_')){const model=FAL_VIDEO_MODELS[profile];if(!model)throw Error('未知的视频处理协议');const app=model.split('/').slice(0,2).join('/');for(const suffix of ['/'+model,'/'+app])if(path.endsWith(suffix)){path=path.slice(0,-suffix.length);break;}value.pathname=path+'/'+(action==='submit'?model:app+'/requests/'+encodeURIComponent(videoJobId(id))+(action==='poll'?'/status':action==='cancel'?'/cancel':''));}
  else if (profile === 'PIKA_1') { path = path.replace(/\/web(?:\/(?:generate|extend|jobs))?$/i, ''); value.pathname = path + (action === 'poll' ? '/web/jobs/' + encodeURIComponent(id!) : action === 'extend' ? '/web/extend' : '/web/generate'); }
  else { path = path.replace(/\/contents\/generations\/tasks(?:\/[^/]+)?$/i, ''); value.pathname = path + '/contents/generations/tasks' + (action === 'poll' || action === 'cancel' ? '/' + encodeURIComponent(id!) : ''); }
  return value.href;
}
export function videoJobId(value: unknown): string { if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw Error('视频服务返回的任务编号无效'); return value; }
export function videoResultUrl(value: unknown): string | null { if (typeof value !== 'string' || !value.trim() || value.length > 8000) return null; try { const url = new URL(value.trim()); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; } catch { return null; } }

/** Structural ISO-BMFF validation, not a codec/transcoding or playback-quality claim. */
export function inspectMp4(buffer: Buffer) {
  if (buffer.length < 32 || buffer.length > MAX_VIDEO_BYTES) throw new VideoFormatError('成片文件为空或超过 96 MB');
  let position = 0, boxes = 0, ftyp = false, moov = false, mdat = false, duration: number | undefined;
  while (position < buffer.length) {
    if (++boxes > 10000 || position + 8 > buffer.length) throw new VideoFormatError('成片文件结构不完整');
    let length = buffer.readUInt32BE(position), header = 8; const type = buffer.toString('ascii', position + 4, position + 8);
    if (length === 1) { if (position + 16 > buffer.length) throw new VideoFormatError('成片文件结构不完整'); const wide = buffer.readBigUInt64BE(position + 8); if (wide > BigInt(buffer.length)) throw new VideoFormatError('成片文件结构不完整'); length = Number(wide); header = 16; }
    else if (length === 0) length = buffer.length - position;
    if (length < header || position + length > buffer.length) throw new VideoFormatError('成片文件结构不完整');
    if (type === 'ftyp') { if (position !== 0 || length < 16) throw new VideoFormatError('成片格式不受支持'); const brand = buffer.toString('ascii', position + header, position + header + 4); if (!/^(isom|iso[2-9]|mp4[12]|avc1|M4V |MSNV|dash)$/.test(brand)) throw new VideoFormatError('成片需要 MP4 容器'); ftyp = true; }
    if (type === 'moov' && length > header) {
      moov = true; let child = position + header, count = 0;
      while (child + 8 <= position + length && count++ < 1000) { const n = buffer.readUInt32BE(child); if (n < 8 || child + n > position + length) break; if (buffer.toString('ascii', child + 4, child + 8) === 'mvhd') { const offset = child + 8, version = buffer[offset]; if (version === 0 && n >= 28) { const scale = buffer.readUInt32BE(offset + 12), ticks = buffer.readUInt32BE(offset + 16); if (scale && ticks && ticks !== 0xffffffff) duration = ticks / scale; } else if (version === 1 && n >= 40) { const scale = buffer.readUInt32BE(offset + 20), ticks = buffer.readBigUInt64BE(offset + 24); if (scale && ticks > 0n && ticks < BigInt(Number.MAX_SAFE_INTEGER)) duration = Number(ticks) / scale; } } child += n; }
    }
    if (type === 'mdat' && length > header) mdat = true;
    position += length;
  }
  if (!ftyp || !moov || !mdat) throw new VideoFormatError('成片文件未完整保存');
  return { bytes: buffer.length, mime: 'video/mp4' as const, ...(duration && Number.isFinite(duration) && duration < 86400 ? { duration } : {}) };
}
export function videoByteRange(value: string | undefined, total: number): { start: number; end: number; partial: boolean } | null {
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  if (!value) return { start: 0, end: total - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(value); if (!match || !match[1] && !match[2]) return null;
  const start = match[1] ? Number(match[1]) : Math.max(0, total - Number(match[2])), end = match[1] ? match[2] ? Math.min(Number(match[2]), total - 1) : total - 1 : total - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= total || end < start || !match[1] && Number(match[2]) === 0) return null;
  return { start, end, partial: true };
}
export async function downloadVideoAsset(url: string, maximum: number, timeoutMs: number, outer: AbortSignal) {
  const signal = AbortSignal.any([outer, AbortSignal.timeout(timeoutMs)]); let target = url;
  for (let hops = 0; hops <= 3; hops++) {
    // Asset redirects carry no provider credentials; every hop repeats the SSRF checks.
    const response = await safeFetch(target, { method: 'GET' }, { signal, timeoutMs, allowHttp: process.env.ALLOW_HTTP_UPSTREAM === '1' });
    if ([301, 302, 303, 307, 308].includes(response.status)) { const location = response.headers.get('location'); await response.body?.cancel().catch(() => {}); if (!location || hops === 3) throw Error('成片下载重定向未完成'); const next = videoResultUrl(new URL(location, target).href); if (!next) throw Error('成片下载地址无效'); target = next; continue; }
    if (!response.ok) { await response.body?.cancel().catch(() => {}); throw new VideoUpstreamError(response.status, 'download'); }
    return readVideoBody(response, maximum, signal);
  }
  throw Error('成片下载未完成');
}
