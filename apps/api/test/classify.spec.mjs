import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyFailure } from '../dist/common/llm/classify.js';

test('client abort 不重试也不熔断', () => {
  const r = classifyFailure(null, 'abort');
  assert.equal(r.outcome, 'fatal');
  assert.equal(r.errorCode, 'client_abort');
  assert.equal(r.tripBreaker, false);
});

test('超时 → 可重试且熔断', () => {
  const r = classifyFailure(null, 'timeout');
  assert.equal(r.outcome, 'retryable');
  assert.equal(r.errorCode, 'upstream_timeout');
  assert.equal(r.tripBreaker, true);
});

test('401 → 换渠道 + 长冷却 + 告警', () => {
  const r = classifyFailure(401);
  assert.equal(r.outcome, 'retryable');
  assert.equal(r.errorCode, 'upstream_auth');
  assert.equal(r.tripBreaker, true);
  assert.equal(r.alert, true);
  assert.ok((r.cooldownMs ?? 0) >= 60_000);
});

test('404 模型不存在 → 换渠道 + 告警', () => {
  const r = classifyFailure(404);
  assert.equal(r.errorCode, 'upstream_model_not_found');
  assert.equal(r.alert, true);
});

test('429 限流 → 可重试但不计入熔断失败率', () => {
  const r = classifyFailure(429);
  assert.equal(r.outcome, 'retryable');
  assert.equal(r.errorCode, 'upstream_rate_limited');
  assert.equal(r.tripBreaker, false);
});

for (const status of [400, 413, 422]) {
  test(`${status} 请求本身有问题 → 不换渠道`, () => {
    const r = classifyFailure(status);
    assert.equal(r.outcome, 'fatal');
    assert.equal(r.errorCode, 'upstream_bad_request');
    assert.equal(r.tripBreaker, false);
  });
}

for (const status of [500, 502, 503, 504, 529]) {
  test(`${status} 服务端错误 → 换渠道并熔断`, () => {
    const r = classifyFailure(status);
    assert.equal(r.outcome, 'retryable');
    assert.equal(r.tripBreaker, true);
  });
}

test('协议损坏 → 可重试', () => {
  const r = classifyFailure(null, 'protocol');
  assert.equal(r.errorCode, 'upstream_malformed');
  assert.equal(r.outcome, 'retryable');
});
