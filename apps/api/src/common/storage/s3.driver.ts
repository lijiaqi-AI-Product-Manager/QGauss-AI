import { createHash, createHmac } from 'node:crypto';
import { Readable } from 'node:stream';
import { assertSafeKey, LocalStorageDriver, StorageDriver } from './storage.driver';

/**
 * S3 兼容对象存储驱动（AWS Signature V4）。
 *
 * 为什么手写签名而不是引 @aws-sdk/client-s3：
 *   - 依赖体积（SDK 单一客户端就是几十兆）与这个项目「自己实现算法」的定位不符；
 *   - 我们只需要 PUT/GET/HEAD/DELETE 四个动作，SigV4 的算法是公开且稳定的。
 *
 * 已验证范围（务必如实理解）：
 *   - ✔ 签名算法按 AWS 文档实现，并有独立实现的校验端在本地 fake S3 上比对签名；
 *   - ✔ 载荷哈希、canonical request 结构、RFC3986 编码都有单测锁定；
 *   - ✗ 没有对真实 AWS / MinIO 做过联调（当前环境无网络与凭据）。
 */

export interface S3Config {
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  /** true = path-style（MinIO、部分私有云需要），false = virtual-host */
  forcePathStyle: boolean;
  timeoutMs: number;
  retries: number;
}

const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');
const ALGORITHM = 'AWS4-HMAC-SHA256';

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf8').digest();
}

/** RFC3986：除了 A-Za-z0-9-_.~ 全部百分号编码；'/' 单独保留（路径分隔） */
export function uriEncode(value: string, keepSlash = false): string {
  const encoded = encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return keepSlash ? encoded.replace(/%2F/g, '/') : encoded;
}

/** 2024-01-02T03:04:05.000Z → 20240102T030405Z */
export function amzDate(at: Date): string {
  const iso = at.toISOString(); // 2024-01-02T03:04:05.678Z
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

export function scopeOf(amzDateStr: string, region: string): string {
  return `${amzDateStr.slice(0, 8)}/${region}/s3/aws4_request`;
}

/** 按 AWS 文档派生签名密钥：kDate → kRegion → kService → kSigning */
export function signingKey(secretKey: string, dateStamp: string, region: string): Buffer {
  const kDate = hmac(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

export interface SignedRequest {
  url: string;
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

/**
 * 生成一个 SigV4 签名的请求（纯函数，便于单测）。
 * headers 里会带上 host / x-amz-date / x-amz-content-sha256 / authorization。
 */
export function signS3Request(input: {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  url: string;
  body?: Buffer;
  cfg: Pick<S3Config, 'region' | 'accessKey' | 'secretKey'>;
  at?: Date;
  extraHeaders?: Record<string, string>;
}): SignedRequest {
  const at = input.at ?? new Date();
  const date = amzDate(at);
  const payloadHash = input.body ? sha256Hex(input.body) : EMPTY_SHA256;
  const url = new URL(input.url);

  const headers: Record<string, string> = {
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': date,
    ...(input.extraHeaders ?? {}),
  };

  const signedHeaders = Object.keys(headers)
    .map((h) => h.toLowerCase())
    .sort()
    .join(';');
  const canonicalHeaders = Object.keys(headers)
    .map((h) => [h.toLowerCase(), String(headers[h]).trim()] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k}:${v}\n`)
    .join('');

  const canonicalRequest = [
    input.method,
    uriEncode(url.pathname, true),
    // 本项目不用预签名 URL，查询串为空
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = scopeOf(date, input.cfg.region);
  const stringToSign = [ALGORITHM, date, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = createHmac('sha256', signingKey(input.cfg.secretKey, date.slice(0, 8), input.cfg.region))
    .update(stringToSign, 'utf8')
    .digest('hex');

  headers.authorization =
    `${ALGORITHM} Credential=${input.cfg.accessKey}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return { url: url.toString(), headers, canonicalRequest, stringToSign, signature };
}

export class S3StorageDriver implements StorageDriver {
  readonly name = 's3';
  private readonly base: string;

  constructor(private readonly cfg: S3Config) {
    const endpoint = cfg.endpoint.replace(/\/+$/, '');
    const u = new URL(endpoint);
    if (cfg.forcePathStyle) {
      this.base = `${u.origin}/${cfg.bucket}`;
    } else {
      this.base = `${u.protocol}//${cfg.bucket}.${u.host}`;
    }
  }

  private urlOf(key: string): string {
    assertSafeKey(key);
    return `${this.base}/${uriEncode(key, true)}`;
  }

  /** 带退避的重试：只重试网络错误与 5xx（4xx 是确定性失败，重试没意义） */
  private async send(
    method: 'GET' | 'PUT' | 'HEAD' | 'DELETE',
    key: string,
    body?: Buffer,
  ): Promise<Response> {
    const url = this.urlOf(key);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.cfg.retries; attempt += 1) {
      // 只签 host / x-amz-content-sha256 / x-amz-date 三个头：
      // 签更多头（如 content-length）会让 Node fetch 的隐式改写导致签名不匹配
      const signed = signS3Request({ method, url, body, cfg: this.cfg });
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.cfg.timeoutMs);
      try {
        const res = await fetch(url, {
          method,
          headers: signed.headers,
          body: body && method !== 'HEAD' ? new Uint8Array(body) : undefined,
          signal: ac.signal,
        });
        if (res.status < 500) return res;
        lastErr = new Error(`S3 ${method} ${res.status}`);
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timer);
      }
      if (attempt < this.cfg.retries) {
        await new Promise((r) => setTimeout(r, 120 * (attempt + 1)));
      }
    }
    throw new Error(`S3 ${method} ${key} 失败: ${(lastErr as Error)?.message ?? lastErr}`);
  }

  async put(key: string, data: Buffer): Promise<void> {
    const res = await this.send('PUT', key, data);
    if (!res.ok) {
      throw new Error(`S3 PUT 失败 ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.send('GET', key);
    if (res.status === 404) throw new Error(`对象不存在: ${key}`);
    if (!res.ok) throw new Error(`S3 GET 失败 ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  }

  async openRange(key: string, start: number, end: number, total: number): Promise<Readable> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end >= total) throw Error('对象读取范围无效');
    const url = this.urlOf(key), signed = signS3Request({ method: 'GET', url, cfg: this.cfg, extraHeaders: { range: `bytes=${start}-${end}` } });
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), Math.max(this.cfg.timeoutMs, 300000));
    try {
      const response = await fetch(url, { method: 'GET', headers: signed.headers, signal: controller.signal, redirect: 'manual' });
      if (response.status !== 206 || response.headers.get('content-range') !== `bytes ${start}-${end}/${total}` || Number(response.headers.get('content-length')) !== end - start + 1 || !response.body) { await response.body?.cancel().catch(() => {}); throw Error('S3 对象范围读取未完成'); }
      const stream = Readable.fromWeb(response.body as any); stream.once('close', () => { clearTimeout(timer); controller.abort(); }); return stream;
    } catch (error) { clearTimeout(timer); controller.abort(); throw error; }
  }

  async remove(key: string): Promise<void> {
    const res = await this.send('DELETE', key);
    // S3 的 DELETE 是幂等的：删不存在的对象也返回 2xx/404
    if (!res.ok && res.status !== 404) throw new Error(`S3 DELETE 失败 ${res.status}`);
  }

  async exists(key: string): Promise<boolean> {
    const res = await this.send('HEAD', key);
    return res.ok;
  }
}

/**
 * 依环境变量选择驱动。写错了就启动失败，不做「悄悄退回本地盘」——
 * 那会让生产环境的上传悄悄散落在容器临时目录里，是最难查的一类事故。
 */
export function createStorageDriver(): StorageDriver {
  const kind = String(process.env.STORAGE_DRIVER ?? 'local').trim().toLowerCase();
  if (kind === 'local' || kind === '') {
    const root = process.env.STORAGE_DIR ?? `${process.cwd()}/storage/uploads`;
    return new LocalStorageDriver(root);
  }
  if (kind !== 's3') {
    throw new Error(`未知的 STORAGE_DRIVER=${kind}（只支持 local / s3）`);
  }

  const need = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY', 'S3_SECRET_KEY'] as const;
  const missing = need.filter((k) => !String(process.env[k] ?? '').trim());
  if (missing.length > 0) {
    throw new Error(`STORAGE_DRIVER=s3 但缺少环境变量: ${missing.join(', ')}`);
  }

  return new S3StorageDriver({
    endpoint: String(process.env.S3_ENDPOINT),
    region: String(process.env.S3_REGION ?? 'us-east-1'),
    bucket: String(process.env.S3_BUCKET),
    accessKey: String(process.env.S3_ACCESS_KEY),
    secretKey: String(process.env.S3_SECRET_KEY),
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
    timeoutMs: Number(process.env.S3_TIMEOUT_MS ?? 30_000),
    retries: Number(process.env.S3_RETRIES ?? 2),
  });
}
