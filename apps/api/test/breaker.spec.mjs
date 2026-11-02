import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CircuitBreaker } from '../dist/common/llm/breaker.js';

function make(opts = {}) {
  let t = 1_000_000;
  const clock = { advance: (ms) => (t += ms), now: () => t };
  const breaker = new CircuitBreaker('ch-1', {
    windowSize: 5,
    failureRateThreshold: 0.5,
    minSamples: 3,
    consecutiveFailureLimit: 3,
    baseCooldownMs: 1000,
    maxCooldownMs: 8000,
    ...opts,
  }, clock.now);
  return { breaker, clock };
}

test('初始为 CLOSED 且放行', () => {
  const { breaker } = make();
  assert.equal(breaker.snapshot().state, 'CLOSED');
  assert.equal(breaker.tryAcquire(), true);
});

test('连续失败达上限 → OPEN，拒绝请求', () => {
  const { breaker } = make();
  breaker.onFailure('e1');
  breaker.onFailure('e2');
  breaker.onFailure('e3');
  assert.equal(breaker.snapshot().state, 'OPEN');
  assert.equal(breaker.tryAcquire(), false);
});

test('冷却结束后进入 HALF_OPEN，只放行一个探针', () => {
  const { breaker, clock } = make();
  breaker.onFailure('e1');
  breaker.onFailure('e2');
  breaker.onFailure('e3');
  assert.equal(breaker.tryAcquire(), false);

  clock.advance(1001);
  assert.equal(breaker.tryAcquire(), true, '第一个探针放行');
  assert.equal(breaker.tryAcquire(), false, '第二个探针被拒');
});

test('探针成功 → 回到 CLOSED', () => {
  const { breaker, clock } = make();
  breaker.onFailure('e1');
  breaker.onFailure('e2');
  breaker.onFailure('e3');
  clock.advance(1001);
  breaker.tryAcquire();
  breaker.onSuccess();
  assert.equal(breaker.snapshot().state, 'CLOSED');
  assert.equal(breaker.tryAcquire(), true);
});

test('探针失败 → 回 OPEN 且冷却翻倍', () => {
  const { breaker, clock } = make();
  breaker.onFailure('e1');
  breaker.onFailure('e2');
  breaker.onFailure('e3');
  clock.advance(1001);
  breaker.tryAcquire();
  breaker.onFailure('probe failed');
  const s = breaker.snapshot();
  assert.equal(s.state, 'OPEN');
  assert.equal(s.cooldownMs, 2000, '首次翻倍');
});

test('冷却时间有上限', () => {
  const { breaker, clock } = make();
  for (let i = 0; i < 10; i += 1) {
    breaker.onFailure('x');
    clock.advance(100_000);
    breaker.tryAcquire();
  }
  assert.ok(breaker.snapshot().cooldownMs <= 8000);
});

test('显式冷却时间优先（如 401 需要长冷却）', () => {
  const { breaker } = make({ maxCooldownMs: 600_000 });
  breaker.onFailure('auth', 60_000);
  assert.equal(breaker.snapshot().state, 'OPEN');
  assert.ok(breaker.snapshot().cooldownMs >= 60_000);
});

test('窗口内失败率达标也会熔断（不需要连续失败）', () => {
  const { breaker } = make({ consecutiveFailureLimit: 99, minSamples: 3 });
  breaker.onSuccess();
  breaker.onFailure('a');
  breaker.onSuccess();
  breaker.onFailure('b');
  // 样本 4，失败 2 → 50% 达标
  assert.equal(breaker.snapshot().state, 'OPEN');
});

test('成功会重置连续失败计数', () => {
  // 把失败率阈值调高，只让"连续失败"这一条生效
  const { breaker } = make({ consecutiveFailureLimit: 3, failureRateThreshold: 0.99 });
  breaker.onFailure('a');
  breaker.onFailure('b');
  breaker.onSuccess();
  breaker.onFailure('c');
  assert.equal(breaker.snapshot().state, 'CLOSED');
});
