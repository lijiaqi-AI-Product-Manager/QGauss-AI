import { test } from 'node:test';
import assert from 'node:assert/strict';
import { signinDays, walletDate, membershipLabel, grantSummary } from '../src/lib/wallet-presentation.js';
test('calendar uses the server Shanghai date across month boundaries, without inventing missing history', () => {
  const days = signinDays('2026-11-01', [{ signInDate: '2026-10-31' }]);
  assert.equal(days[0].key, '2026-10-26'); assert.equal(days.at(-1).key, '2026-11-01');
  assert.equal(days.filter(day => day.signed).length, 1); assert.equal(days.at(-1).signed, false);
  assert.deepEqual(signinDays(undefined), []); assert.deepEqual(signinDays('2026-02-31'), []);
});
test('wallet time uses Beijing and perpetual membership is separate from no membership', () => {
  assert.match(walletDate('2026-10-31T16:30:00Z'), /2026\/11\/01 00:30/);
  assert.equal(walletDate(null), '—'); assert.equal(membershipLabel({ isMember: false }), '创作者账户');
  assert.equal(membershipLabel({ isMember: true, expirationTime: '9999-12-31T00:00:00Z' }), '会员长期有效');
});
test('grant receipt distinguishes paid amount, counts and membership without combining unlike units', () => {
  assert.equal(grantSummary({ model3Count: 10, drawMjCount: 2, days: 30, amountCents: 109 }), '低价模型 10 次 · 绘画 2 次 · 会员 30 天 · 余额 ¥1.09');
  assert.equal(grantSummary({ days: -1 }), '长期会员');
});
