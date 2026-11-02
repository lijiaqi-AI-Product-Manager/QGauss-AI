/**
 * 上游错误分类（纯函数，好测）
 *
 * 输入：HTTP 状态码 / 失败类型
 * 输出：是否换渠道重试、是否记入熔断、错误码
 *
 * 这条规则决定了"什么情况下可以换下一个渠道"，是全系统最容易写错的地方之一。
 */

export type FailureKind = 'http' | 'network' | 'timeout' | 'abort' | 'protocol';

export interface Classified {
  /** retryable = 换渠道再试；fatal = 直接失败 */
  outcome: 'retryable' | 'fatal';
  errorCode: string;
  /** 是否记一次渠道失败（参与熔断统计） */
  tripBreaker: boolean;
  /** 该渠道冷却时间；未指定用默认值 */
  cooldownMs?: number;
  /** 是否值得告警（多半是配置/密钥问题） */
  alert?: boolean;
}

const DEFAULT_COOLDOWN = 30_000;
const AUTH_COOLDOWN = 10 * 60_000;

export function classifyFailure(status: number | null, kind: FailureKind = 'http'): Classified {
  if (kind === 'abort') {
    // 客户端主动断开：不是上游的错，不重试也不熔断
    return { outcome: 'fatal', errorCode: 'client_abort', tripBreaker: false };
  }

  if (kind === 'timeout') {
    return {
      outcome: 'retryable',
      errorCode: 'upstream_timeout',
      tripBreaker: true,
      cooldownMs: DEFAULT_COOLDOWN,
    };
  }

  if (kind === 'network') {
    return {
      outcome: 'retryable',
      errorCode: 'upstream_network',
      tripBreaker: true,
      cooldownMs: DEFAULT_COOLDOWN,
    };
  }

  if (kind === 'protocol') {
    return {
      outcome: 'retryable',
      errorCode: 'upstream_malformed',
      tripBreaker: true,
      cooldownMs: DEFAULT_COOLDOWN,
    };
  }

  const s = status ?? 0;

  if (s === 401 || s === 403) {
    return {
      outcome: 'retryable',
      errorCode: 'upstream_auth',
      tripBreaker: true,
      cooldownMs: AUTH_COOLDOWN,
      alert: true,
    };
  }

  if (s === 404) {
    return {
      outcome: 'retryable',
      errorCode: 'upstream_model_not_found',
      tripBreaker: true,
      cooldownMs: AUTH_COOLDOWN,
      alert: true,
    };
  }

  if (s === 429) {
    // 限流不是渠道坏了，冷却一会儿即可，不计入熔断失败率
    return {
      outcome: 'retryable',
      errorCode: 'upstream_rate_limited',
      tripBreaker: false,
      cooldownMs: DEFAULT_COOLDOWN,
    };
  }

  if (s === 400 || s === 413 || s === 422) {
    // 请求本身的问题，换渠道也没用
    return { outcome: 'fatal', errorCode: 'upstream_bad_request', tripBreaker: false };
  }

  if (s >= 500) {
    return {
      outcome: 'retryable',
      errorCode: 'upstream_error',
      tripBreaker: true,
      cooldownMs: DEFAULT_COOLDOWN,
    };
  }

  return {
    outcome: 'retryable',
    errorCode: 'upstream_error',
    tripBreaker: true,
    cooldownMs: DEFAULT_COOLDOWN,
  };
}
