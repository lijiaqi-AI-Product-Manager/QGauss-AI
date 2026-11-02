import { Injectable } from '@nestjs/common';

interface Entry {
  code: string;
  expiresAt: number;
}

/**
 * 图形验证码（P1 内存版）。
 * 多实例部署时替换为 Redis 实现即可，接口不变。
 */
@Injectable()
export class CaptchaService {
  private readonly store = new Map<string, Entry>();
  private readonly ttlMs = 5 * 60 * 1000;

  save(id: string, code: string) {
    this.cleanup();
    this.store.set(id, { code: code.toLowerCase(), expiresAt: Date.now() + this.ttlMs });
  }

  /** 校验后立即失效（一次性） */
  verify(id: string | undefined, input: string | undefined): boolean {
    if (!id || !input) return false;
    const hit = this.store.get(id);
    this.store.delete(id);
    if (!hit) return false;
    if (hit.expiresAt < Date.now()) return false;
    return hit.code === input.toLowerCase();
  }

  private cleanup() {
    const now = Date.now();
    for (const [k, v] of this.store) {
      if (v.expiresAt < now) this.store.delete(k);
    }
  }
}
