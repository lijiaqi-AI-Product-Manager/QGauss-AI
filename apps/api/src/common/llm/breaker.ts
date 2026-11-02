/**
 * 渠道熔断器（单实例内存版）
 *
 * 三态：CLOSED → OPEN → HALF_OPEN → CLOSED
 *   CLOSED    正常放行；最近窗口失败率超阈值或连续失败达上限 → OPEN
 *   OPEN      拒绝所有请求，冷却期内不探测
 *   HALF_OPEN 冷却结束，只放行 1 个探测请求；成功回 CLOSED，失败回 OPEN（冷却翻倍）
 *
 * 为什么不落库：这是纯运行时状态，写 PG 会造成行锁争用和写放大，重启后也没有意义。
 * 多实例部署时把 registry 换成 Redis 实现即可（接口保持一致）。
 */

export type BreakerState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface BreakerOptions {
  windowSize: number;
  failureRateThreshold: number;
  minSamples: number;
  consecutiveFailureLimit: number;
  baseCooldownMs: number;
  maxCooldownMs: number;
}

const DEFAULT_OPTIONS: BreakerOptions = {
  windowSize: 20,
  failureRateThreshold: 0.5,
  minSamples: 5,
  consecutiveFailureLimit: 5,
  baseCooldownMs: 30_000,
  maxCooldownMs: 300_000,
};

export class CircuitBreaker {
  private state: BreakerState = 'CLOSED';
  private window: boolean[] = [];
  private consecutiveFailures = 0;
  private openedAt = 0;
  private cooldownMs: number;
  private tripCount = 0;
  private probeInFlight = false;
  private lastError: string | null = null;

  constructor(
    public readonly key: string,
    private readonly opts: BreakerOptions = DEFAULT_OPTIONS,
    private readonly now: () => number = Date.now,
  ) {
    this.cooldownMs = opts.baseCooldownMs;
  }

  /** 不消费探针，只判断"是否可能可用" */
  isAvailable(): boolean {
    if (this.state === 'CLOSED') return true;
    if (this.state === 'HALF_OPEN') return !this.probeInFlight;
    return this.now() - this.openedAt >= this.cooldownMs;
  }

  /** 真正要发起请求时调用：HALF_OPEN 下会占用唯一探针 */
  tryAcquire(): boolean {
    const t = this.now();

    if (this.state === 'OPEN') {
      if (t - this.openedAt < this.cooldownMs) return false;
      this.state = 'HALF_OPEN';
      this.probeInFlight = false;
    }

    if (this.state === 'HALF_OPEN') {
      if (this.probeInFlight) return false;
      this.probeInFlight = true;
      return true;
    }

    return true;
  }

  onSuccess(): void {
    this.push(true);
    this.consecutiveFailures = 0;
    this.lastError = null;

    if (this.state !== 'CLOSED') {
      this.state = 'CLOSED';
      this.probeInFlight = false;
      this.tripCount = 0;
      this.cooldownMs = this.opts.baseCooldownMs; // 恢复后重置退避
    }
  }

  onFailure(reason?: string, explicitCooldownMs?: number): void {    this.lastError = reason ?? null;
    this.push(false);
    this.consecutiveFailures += 1;

    if (this.state === 'HALF_OPEN') {
      this.trip(explicitCooldownMs);
      return;
    }

    if (explicitCooldownMs !== undefined) {
      this.trip(explicitCooldownMs);
      return;
    }

    const samples = this.window.length;
    const failures = this.window.filter((ok) => !ok).length;
    const rate = samples === 0 ? 0 : failures / samples;

    if (
      this.consecutiveFailures >= this.opts.consecutiveFailureLimit ||
      (samples >= this.opts.minSamples && rate >= this.opts.failureRateThreshold)
    ) {
      this.trip();
    }
  }

  /** 只冷静一会儿，不计入失败率（如 429 限流） */
  coolDown(ms: number): void {
    this.state = 'OPEN';
    this.probeInFlight = false;
    this.openedAt = this.now();
    this.cooldownMs = Math.min(ms, this.opts.maxCooldownMs);
  }

  private trip(explicitCooldownMs?: number): void {
    this.state = 'OPEN';
    this.probeInFlight = false;
    this.openedAt = this.now();

    if (explicitCooldownMs !== undefined) {
      this.cooldownMs = Math.min(explicitCooldownMs, this.opts.maxCooldownMs);
      return;
    }

    // 指数退避：第 1 次熔断用基准值，之后每次翻倍
    this.tripCount += 1;
    this.cooldownMs = Math.min(
      this.opts.baseCooldownMs * 2 ** (this.tripCount - 1),
      this.opts.maxCooldownMs,
    );
  }

  private push(ok: boolean) {
    this.window.push(ok);
    if (this.window.length > this.opts.windowSize) this.window.shift();
  }

  snapshot() {
    return {
      key: this.key,
      state: this.state,
      cooldownMs: this.cooldownMs,
      consecutiveFailures: this.consecutiveFailures,
      samples: this.window.length,
      failures: this.window.filter((ok) => !ok).length,
      openedAt: this.openedAt ? new Date(this.openedAt).toISOString() : null,
      lastError: this.lastError,
    };
  }

  /** 仅测试用：手动推进状态 */
  forceState(state: BreakerState) {
    this.state = state;
    if (state === 'OPEN') this.openedAt = this.now();
  }
}

/** 全局注册表：一个渠道一个熔断器 */
export class BreakerRegistry {
  private readonly map = new Map<string, CircuitBreaker>();

  constructor(
    private readonly opts?: Partial<BreakerOptions>,
    private readonly now: () => number = Date.now,
  ) {}

  get(channelId: string): CircuitBreaker {
    let b = this.map.get(channelId);
    if (!b) {
      b = new CircuitBreaker(channelId, { ...DEFAULT_OPTIONS, ...this.opts }, this.now);
      this.map.set(channelId, b);
    }
    return b;
  }

  isAvailable(channelId: string): boolean {
    return this.get(channelId).isAvailable();
  }

  tryAcquire(channelId: string): boolean {
    return this.get(channelId).tryAcquire();
  }

  recordSuccess(channelId: string): void {
    this.get(channelId).onSuccess();
  }

  recordFailure(channelId: string, reason?: string, cooldownMs?: number): void {
    this.get(channelId).onFailure(reason, cooldownMs);
  }

  coolDown(channelId: string, ms: number): void {
    this.get(channelId).coolDown(ms);
  }

  snapshot() {
    return [...this.map.values()].map((b) => b.snapshot());
  }

  reset(): void {
    this.map.clear();
  }
}
