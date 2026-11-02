import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * 唯一出网口。所有面向用户可配置地址的请求都必须经过这里。
 *
 * 防的是 SSRF：管理员把 baseUrl 填成 http://169.254.169.254/ 或内网地址，
 * 服务端就会替攻击者访问内网。
 *
 * 校验顺序：
 *   1. 协议白名单（默认仅 https，ALLOW_HTTP_UPSTREAM=1 可放开）
 *   2. 禁止 userinfo（user:pass@host）
 *   3. 端口白名单
 *   4. 主机白名单（可选，UPSTREAM_HOST_ALLOWLIST，逗号分隔）
 *   5. DNS 解析后逐个 IP 检查，命中私网/保留段即拒绝
 *   6. 禁止自动跟随重定向
 *
 * 残留风险：DNS rebinding（解析校验与实际连接之间的 TOCTOU）。
 * 彻底解决需要自定义 undici connect.lookup 固定 IP；个人项目建议直接用第 4 条主机白名单。
 */

const BLOCKED_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];

function ipv4ToInt(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function isBlockedV4(ip: string): boolean {
  const value = ipv4ToInt(ip);
  return BLOCKED_V4.some(([net, bits]) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (value & mask) === (ipv4ToInt(net) & mask);
  });
}

function isBlockedV6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === '::1' || lower === '::') return true;
  if (lower.startsWith('fe80')) return true; // link-local
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // unique local
  // ::ffff:a.b.c.d 映射到 IPv4
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
  if (mapped) return isBlockedV4(mapped[1]);
  return false;
}

export interface SafeFetchOptions {
  allowHttp?: boolean;
  hostAllowlist?: string[];
  privateAllowlist?: string[];
  timeoutMs?: number;
  signal?: AbortSignal;
}

/** 私网白名单条目：host:port 或 host（任意端口） */
function matchPrivateAllowlist(host: string, port: number, entries: string[]): boolean {
  const target = `${host}:${port}`.toLowerCase();
  return entries.some((raw) => {
    const entry = raw.trim().toLowerCase();
    if (!entry) return false;
    return entry.includes(':') ? entry === target : entry === host;
  });
}

class SsrfBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

async function assertSafeUrl(rawUrl: string, opts: SafeFetchOptions = {}): Promise<URL> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError(`非法 URL: ${rawUrl}`);
  }

  const allowHttp = opts.allowHttp ?? process.env.ALLOW_HTTP_UPSTREAM === '1';
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) {
    throw new SsrfBlockedError(`不允许的协议: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new SsrfBlockedError('URL 不允许携带账号信息');
  }

  const port = url.port ? Number(url.port) : url.protocol === 'https:' ? 443 : 80;
  const allowlistPorts = (process.env.UPSTREAM_PORT_ALLOWLIST ?? '443,80,11434')
    .split(',')
    .map((p) => Number(p.trim()));
  if (!allowlistPorts.includes(port)) {
    throw new SsrfBlockedError(`端口不在白名单: ${port}`);
  }

  const host = url.hostname.toLowerCase();
  const hostAllowlist = (opts.hostAllowlist ?? (process.env.UPSTREAM_HOST_ALLOWLIST ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean));
  if (hostAllowlist.length > 0) {
    const ok = hostAllowlist.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
    if (!ok) throw new SsrfBlockedError(`主机不在白名单: ${host}`);
  }

  if (host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal')) {
    const priv = (opts.privateAllowlist ?? (process.env.UPSTREAM_PRIVATE_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean));
    if (!matchPrivateAllowlist(host, port, priv)) {
      throw new SsrfBlockedError(`禁止访问内部主机: ${host}`);
    }
  }

  // 显式私网白名单：只放行指定的 host:port，不放开整段私网
  const privateEntries = (opts.privateAllowlist ?? (process.env.UPSTREAM_PRIVATE_ALLOWLIST ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean));
  if (matchPrivateAllowlist(host, port, privateEntries)) {
    return url;
  }

  if (isIP(host)) {
    const blocked = isIP(host) === 4 ? isBlockedV4(host) : isBlockedV6(host);
    if (blocked) throw new SsrfBlockedError(`禁止访问内网地址: ${host}`);
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new SsrfBlockedError(`无法解析主机: ${host}`);
  }
  if (addresses.length === 0) throw new SsrfBlockedError(`主机无解析结果: ${host}`);

  for (const { address, family } of addresses) {
    const blocked = family === 4 ? isBlockedV4(address) : isBlockedV6(address);
    if (blocked) throw new SsrfBlockedError(`主机 ${host} 解析到内网地址 ${address}`);
  }

  return url;
}

/** 带超时与 SSRF 校验的 fetch */
export async function safeFetch(
  rawUrl: string,
  init: RequestInit = {},
  opts: SafeFetchOptions = {},
): Promise<Response> {
  const url = await assertSafeUrl(rawUrl, opts);

  const timeoutMs = opts.timeoutMs ?? 60_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('upstream timeout')), timeoutMs);

  const outerSignal = opts.signal ?? init.signal;
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort(outerSignal.reason);
    else outerSignal.addEventListener('abort', () => controller.abort(outerSignal.reason), { once: true });
  }

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      redirect: 'manual', // 3xx 一律视为异常，避免被重定向到内网
    });
  } finally {
    clearTimeout(timer);
  }
}
