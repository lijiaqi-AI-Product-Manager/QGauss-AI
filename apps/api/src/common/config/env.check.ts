import { isIP } from 'node:net';
import { passwordProblem } from '../security/password-policy';

type Environment = Record<string, string | undefined>;

function isPlaceholder(value: string) {
  return /change[-_ ]?(me|this)|dev[-_ ]?secret|please[-_ ]?change|your[-_ ].*(secret|key)|replace[-_ ]?(me|this)|insecure/i.test(value)
    || /^(.)\1+$/.test(value);
}

/** 只允许明确的反代地址或网段，禁止 true 和跳数形式扩大信任边界。 */
export function parseTrustProxy(value?: string): false | string[] {
  if (!value?.trim() || ['false', '0'].includes(value.trim().toLowerCase())) return false;
  const proxies = value.split(',').map((entry) => entry.trim());
  for (const proxy of proxies) {
    if (proxy === 'loopback') continue;
    const [address, prefix, ...extra] = proxy.split('/');
    const version = isIP(address);
    if (!version || extra.length || (prefix !== undefined && (
      !/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)
    ))) {
      throw new Error('TRUST_PROXY 只能包含明确的代理 IP、CIDR 或 loopback，不能使用 true 或跳数');
    }
  }
  return proxies;
}

/** 空白名单表示仅同源；开发环境额外允许本机的前端开发服务器。 */
export function corsOrigins(value?: string, production = false): string[] {
  if (!value?.trim()) return production ? [] : ['http://localhost:5173', 'http://127.0.0.1:5173'];
  return value.split(',').map((entry) => {
    const origin = entry.trim();
    let url: URL;
    try {
      url = new URL(origin);
    } catch {
      throw new Error('CORS_ORIGINS 必须是逗号分隔的完整 http/https 来源，不能使用通配符');
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('CORS_ORIGINS 只接受来源（协议、主机和可选端口），不能含路径或凭据');
    }
    return origin;
  });
}

export function decodeEncryptionKey(rawKey: string): Buffer {
  const key = Buffer.from(rawKey, 'base64');
  if (key.length !== 32 || key.toString('base64') !== rawKey || key.every((byte) => byte === key[0])) {
    throw new Error('APP_ENCRYPTION_KEY 必须是随机生成的 32 字节标准 base64');
  }
  return key;
}

export function validateSeedAdminPassword(password?: string, mode = process.env.NODE_ENV) {
  if (mode !== 'production') return;
  if (passwordProblem(password, true)) {
    throw new Error('生产环境 SEED_ADMIN_PASSWORD 必须为 12–32 位，包含字母和数字，且不能使用默认密码');
  }
}

/** ConfigModule 在实例化鉴权和加密服务之前调用；错误信息只含字段名，不含密钥。 */
export function validateEnvironment(env: Environment): Environment {
  if (!env.JWT_SECRET?.trim()) throw new Error('必须设置 JWT_SECRET');
  const production = env.NODE_ENV === 'production';
  if (env.QGAUSS_SETUP_TOKEN !== undefined && (!/^[A-Za-z0-9_-]{32,128}$/.test(env.QGAUSS_SETUP_TOKEN)
    || isPlaceholder(env.QGAUSS_SETUP_TOKEN) || env.QGAUSS_SETUP_TOKEN === env.JWT_SECRET || env.QGAUSS_SETUP_TOKEN === env.APP_ENCRYPTION_KEY)) {
    throw new Error('QGAUSS_SETUP_TOKEN 必须为独立随机生成的 32–128 字符安装凭证');
  }
  if (production) {
    if (env.JWT_SECRET.length < 32 || env.JWT_SECRET.trim() !== env.JWT_SECRET || isPlaceholder(env.JWT_SECRET)) {
      throw new Error('生产环境 JWT_SECRET 必须是至少 32 字符的随机密钥，不能使用示例值');
    }
    if (!env.APP_ENCRYPTION_KEY) throw new Error('生产环境必须显式设置 APP_ENCRYPTION_KEY');
    decodeEncryptionKey(env.APP_ENCRYPTION_KEY);
    if (env.APP_ENCRYPTION_KEY === env.JWT_SECRET) {
      throw new Error('JWT_SECRET 与 APP_ENCRYPTION_KEY 必须使用独立密钥');
    }
    if (env.SEED_ADMIN_PASSWORD !== undefined) validateSeedAdminPassword(env.SEED_ADMIN_PASSWORD, env.NODE_ENV);
  }
  parseTrustProxy(env.TRUST_PROXY);
  corsOrigins(env.CORS_ORIGINS, production);
  return env;
}
