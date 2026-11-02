import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ledgerActivity } from '../src/lib/ledger-activity.js';

test('预留和最终结算不会在可用变动中重复计算', () => {
  const hold = ledgerActivity({ direction: 4, amount: 6 });
  const settled = ledgerActivity({ direction: 1, sourceLogId: 'hold-log', amount: 4 });
  const released = ledgerActivity({ direction: 5, amount: 2 });
  assert.deepEqual([hold.label, settled.label, released.label], ['预留', '结算', '释放']);
  assert.equal(hold.delta + settled.delta + released.delta, -4);
  assert.equal(settled.change, '无变动'); assert.equal(settled.quantity, '4 次');
});

test('普通消费和退款保留方向，免扣与到期不伪造可用增加', () => {
  assert.equal(ledgerActivity({ direction: 1, amount: 3 }).delta, -3);
  assert.equal(ledgerActivity({ direction: 2, amount: 3 }).change, '+3 次');
  assert.equal(ledgerActivity({ direction: 3, amount: 3 }).delta, 0);
  assert.equal(ledgerActivity({ direction: 6, amount: 3 }).delta, 0);
});

test('金额按分转元显示，未知或损坏记录不编造扣费', () => {
  assert.equal(ledgerActivity({ direction: 1, amount: 123, deductionType: 'money' }).change, '−¥1.23');
  assert.equal(ledgerActivity({ direction: 999, amount: 5 }).change, '无变动');
  assert.equal(ledgerActivity({ direction: 1, amount: NaN }).quantity, '0 次');
});
