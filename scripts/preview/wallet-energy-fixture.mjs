/** Synthetic, readonly wallet; no real balance, card code, reward or payment provider. */
export function walletEnergyFixtures() {
  const balance = { currency: 'CNY', balanceCents: 12850, balanceYuan: '128.50', isMember: true, expirationTime: '2026-12-01T00:00:00Z', counts: { model3: 138, model4: 32, drawMj: 18, agent: 15 }, paid: { model3: 120, model4: 24, drawMj: 12, agent: 10 }, member: { model3: 18, model4: 8, drawMj: 6, agent: 5 }, daily: { model3: 30, model4: 10, drawMj: 8, agent: 5 }, reserved: { model3: 0, model4: 0, drawMj: 4, agent: 0 }, used: { model3: 32, model4: 12, drawMj: 14, agent: 2 } };
  const records = Array.from({ length: 18 }, (_, i) => ({ id: 'qg-demo-ledger-' + (18 - i), uid: 'QGAUSS-DEMO-RECEIPT-' + (18 - i), direction: [1, 5, 4, 1, 2, 3][i % 6], sourceLogId: i % 6 < 2 ? 'qg-demo-reservation' : null, deductionType: i < 3 ? 'drawMj' : ['model3', 'model4', 'drawMj', 'agent'][i % 4], amount: [3, 1, 4, 1, 1, 0][i % 6], modelName: i < 3 ? 'QGauss 图像样例' : 'QGauss 灵感模型', remark: '只读合成记录，用于观察用量动作与详情。', refId: 'qg-demo-work-' + i, createdAt: new Date(Date.UTC(2026, 9, 31, 7, 45 - i * 15)).toISOString() }));
  const recharge = [{ id: 'qg-demo-signin', uid: 'QGAUSS-DEMO-GRANT-1', rechargeType: 'signin', model3Count: 3, amountCents: 0, remark: '合成签到奖励记录', createdAt: '2026-10-30T01:00:00Z' }, { id: 'qg-demo-order', uid: 'QGAUSS-DEMO-GRANT-2', rechargeType: 'order', pkgName: '合成创作体验包', model3Count: 120, model4Count: 24, drawMjCount: 12, agentCount: 10, days: 30, amountCents: 2900, remark: '合成到账快照，不代表真实售卖套餐', createdAt: '2026-10-29T03:00:00Z' }];
  return {
    '/api/settings/public': { 'commerce.enabled': true, 'site.name': 'QGauss AI' },
    '/api/balance/query': balance,
    '/api/signin/signinLog': { enabled: true, today: '2026-10-31', signedToday: false, streak: 0, reward: 3, rewardPool: 'model3', items: [{ signInDate: '2026-10-29' }, { signInDate: '2026-10-30' }] },
    '/api/balance/consumeLog': records,
    '/api/balance/rechargeLog': recharge,
    '/api/crami/myLog': [{ id: 'qg-demo-exchange', cramiCode: 'DEMO-QGAU-SSAI', model3Count: 20, drawMjCount: 5, days: 0, accountLogId: 'qg-demo-exchange-grant', createdAt: '2026-10-28T05:00:00Z' }],
  };
}
export function walletFixturePage(rows, url) {
  let items = rows;
  if (url.searchParams.get('deductionType')) items = items.filter(row => row.deductionType === url.searchParams.get('deductionType'));
  if (url.searchParams.get('direction')) items = items.filter(row => row.direction === Number(url.searchParams.get('direction')));
  const keyword = url.searchParams.get('keyword')?.trim().toLowerCase();
  if (keyword) items = items.filter(row => [row.modelName, row.remark, row.refId, row.uid].some(value => String(value || '').toLowerCase().includes(keyword)));
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1), pageSize = Math.min(100, Number(url.searchParams.get('pageSize')) || 10);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
