/**
 * money 纯函数单元测试 —— 金额是账本的承重墙，必须锁死边界行为。
 *
 * 运行前提：先 npm run build（从 dist 导入）。
 */
import assert from 'node:assert/strict';
import {
  MICROS_PER_CENT,
  centsToMicros,
  centsToYuan,
  commissionCents,
  formatBps,
  formatCents,
  microsToCents,
  yuanToCents,
} from '../dist/common/money/money.js';

let pass = 0;
const fails = [];
function t(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`  ✔ ${name}`);
  } catch (err) {
    fails.push(name);
    console.log(`  ✘ ${name} :: ${err.message}`);
  }
}

t('MICROS_PER_CENT = 10000', () => assert.equal(MICROS_PER_CENT, 10_000));

t('yuanToCents 整数与两位小数', () => {
  assert.equal(yuanToCents('0'), 0);
  assert.equal(yuanToCents('1'), 100);
  assert.equal(yuanToCents('19.9'), 1990);
  assert.equal(yuanToCents('19.99'), 1999);
  assert.equal(yuanToCents(0.01), 1);
});

t('yuanToCents 拒绝非法输入', () => {
  assert.equal(yuanToCents('1.234'), null, '三位小数应拒绝');
  assert.equal(yuanToCents('-1'), null, '负数应拒绝');
  assert.equal(yuanToCents('abc'), null, '非数字应拒绝');
  assert.equal(yuanToCents(''), null, '空串应拒绝');
  assert.equal(yuanToCents(Number.NaN), null, 'NaN 应拒绝');
  assert.equal(yuanToCents(Number.POSITIVE_INFINITY), null, 'Infinity 应拒绝');
});

t('centsToYuan 返回数字（展示格式化交给 formatCents）', () => {
  assert.equal(centsToYuan(0), 0);
  assert.equal(centsToYuan(1), 0.01);
  assert.equal(centsToYuan(1999), 19.99);
  assert.equal(centsToYuan(100000), 1000);
});

t('yuanToCents → centsToYuan 往返稳定', () => {
  for (const v of ['0.00', '0.01', '0.10', '1.00', '9.99', '123.45']) {
    assert.equal(centsToYuan(yuanToCents(v)), Number(v), `往返失败: ${v}`);
  }
});

t('microsToCents 向上取整（漏收比多收危险）', () => {
  assert.equal(microsToCents(0), 0);
  assert.equal(microsToCents(1), 1, '1 微应进位到 1 分');
  assert.equal(microsToCents(9_999), 1);
  assert.equal(microsToCents(10_000), 1);
  assert.equal(microsToCents(10_001), 2);
});

t('centsToMicros 与 microsToCents 方向一致', () => {
  assert.equal(centsToMicros(1), 10_000);
  assert.equal(centsToMicros(0), 0);
});

t('commissionCents 向下取整（佣金不得超过实收）', () => {
  assert.equal(commissionCents(1000, 1000), 100, '10% of 10.00 = 1.00');
  assert.equal(commissionCents(999, 3333), 332, '333.29 应向下取 332');
  assert.equal(commissionCents(0, 5000), 0);
  assert.equal(commissionCents(1000, 0), 0);
  assert.equal(commissionCents(1000, 10000), 1000, '100% 不超过本金');
});

t('formatCents 补两位小数（不带货币符号）', () => {
  assert.equal(formatCents(0), '0.00');
  assert.equal(formatCents(1), '0.01');
  assert.equal(formatCents(1999), '19.99');
  assert.equal(formatCents(100000), '1000.00');
  assert.equal(formatCents(-5), '-0.05', '负数要保留符号且补位');
});

t('formatBps 万分比 → 百分比字符串', () => {
  assert.equal(formatBps(1000), '10%');
  assert.equal(formatBps(0), '0%');
  assert.equal(formatBps(1250), '12.5%', '非整数百分比去掉尾零');
  assert.equal(formatBps(10000), '100%');
});

console.log(`\nmoney: ${pass} 通过 / ${fails.length} 失败`);
if (fails.length > 0) {
  console.error(`失败项: ${fails.join(', ')}`);
  process.exit(1);
}
