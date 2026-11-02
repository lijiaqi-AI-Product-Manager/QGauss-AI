import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { decodeEncryptionKey } from '../config/env.check';

const VERSION = 'v1';
const ALGO = 'aes-256-gcm';

/**
 * 上游 apiKey 的对称加密。
 *
 * 密文格式：v1:<base64(iv(12) | tag(16) | ciphertext)>
 * 版本前缀用于将来轮换密钥（v2: 用新 key，读时按前缀选择）。
 */
export class SecretBox {
  private readonly logger = new Logger(SecretBox.name);
  private readonly key: Buffer;

  constructor(rawKey?: string, fallbackSeed?: string) {
    let key: Buffer | null = null;

    if (rawKey) {
      key = decodeEncryptionKey(rawKey);
    }

    if (!key) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error('生产环境必须显式设置 APP_ENCRYPTION_KEY');
      }
      // 开发兜底：由 JWT_SECRET 派生。生产必须显式配置 APP_ENCRYPTION_KEY。
      key = createHash('sha256')
        .update(fallbackSeed ?? 'insecure-dev-seed')
        .digest();
      this.logger.warn('使用派生密钥加密 apiKey，请在生产环境设置 APP_ENCRYPTION_KEY');
    }
    this.key = key;
  }

  encrypt(plain: string): string {
    if (!plain) return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGO, this.key, iv);
    const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${VERSION}:${Buffer.concat([iv, tag, ct]).toString('base64')}`;
  }

  decrypt(enc: string): string {
    if (!enc) return '';
    const [version, payload] = enc.split(':');
    if (version !== VERSION || !payload) {
      throw new Error('无法识别的密钥密文版本');
    }
    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ct = raw.subarray(28);
    const decipher = createDecipheriv(ALGO, this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /** 只用于展示：sk-****abcd */
  static mask(plain: string): string {
    if (!plain) return '';
    const tail = plain.slice(-4);
    const head = plain.startsWith('sk-') ? 'sk-' : '';
    return `${head}****${tail}`;
  }
}
