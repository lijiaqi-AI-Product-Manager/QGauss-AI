import { walletEnergyFixtures } from './wallet-energy-fixture.mjs';
export function referralFixtures() {
  const userId = 'qgauss-reference-only';
  const commissions = Array.from({ length: 9 }, (_, i) => ({ id: 'qg-commission-' + i, inviterUserId: userId, orderId: 'qg-invited-order-' + i, orderCents: [2990, 19900, 1990][i % 3], commissionCents: [299, 1990, 199][i % 3], commissionBps: 1000, createdAt: '2026-10-' + String(31 - i).padStart(2, '0') + 'T03:15:00Z' }));
  const statuses = [[0, 0], [1, 0], [1, 1], [2, 0], [0, 0], [1, 1], [2, 0], [0, 0]];
  const withdrawals = statuses.map(([orderStatus, paymentStatus], i) => ({ id: 'qg-withdraw-' + i, userId, amountCents: 1000 + i * 50, channels: i % 3 + 1, contact: '本地合成收款样例-' + (1234 + i), orderStatus, paymentStatus, createdAt: '2026-10-' + String(31 - i).padStart(2, '0') + 'T04:00:00Z', auditedAt: orderStatus ? '2026-10-31T05:00:00Z' : null, remark: orderStatus === 2 ? '明确的本地驳回说明样例，金额已退回。' : '只读合成申请，不连接真实收款账户。' }));
  const sum = (status, paid) => withdrawals.filter(x => x.orderStatus === status && (paid === undefined || x.paymentStatus === paid)).reduce((n, x) => n + x.amountCents, 0);
  const totalCents = commissions.reduce((n, x) => n + x.commissionCents, 0), withdrawalCents = sum(0) + sum(1);
  const info = { enabled: true, inviteCode: 'QGTEAM26', performanceBps: 1000, performancePct: '10%', salesOutletName: '合成灵感接力', totalCents, distributionCents: totalCents - withdrawalCents, withdrawalCents, orderCount: commissions.length, inviteeCount: 12, recordCount: commissions.length, recordSumCents: totalCents, withdrawalPolicy: { minCents: 1000, maxCents: 100000000 }, withdrawalSummary: { pendingCents: sum(0), approvedUnpaidCents: sum(1, 0), paidCents: sum(1, 1), rejectedCents: sum(2) } };
  // Fixtures represent multiple historical referral purchases; keep balances nonnegative and exactly conserved.
  info.totalCents += 5000; info.distributionCents += 5000; info.recordSumCents = info.totalCents;
  commissions[0].commissionCents += 5000; commissions[0].orderCents += 50000;
  return { '/api/settings/public': { 'commerce.enabled': true, 'security.registerEnabled': true, 'site.name': 'QGauss AI' }, '/api/balance/query': walletEnergyFixtures()['/api/balance/query'], '/api/sales/info': info, '/api/sales/records': commissions, '/api/sales/withdrawals': withdrawals };
}
export function referralPage(rows, url) {
  let items = rows;
  const stage = url.searchParams.get('stage'), id = url.searchParams.get('id'), keyword = url.searchParams.get('keyword');
  if (stage) items = items.filter(row => stage === 'pending' ? row.orderStatus === 0 : stage === 'rejected' ? row.orderStatus === 2 : row.orderStatus === 1 && row.paymentStatus === (stage === 'paid' ? 1 : 0));
  if (id) items = items.filter(row => row.id === id);
  if (keyword) items = items.filter(row => row.orderId?.includes(keyword));
  if (url.searchParams.has('requestKey')) items = [];
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1), pageSize = Math.min(100, Number(url.searchParams.get('pageSize')) || 6);
  return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
}
