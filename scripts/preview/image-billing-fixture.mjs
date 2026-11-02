/** Explicitly synthetic accounting states for visual comparison, never provider output. */
export function imageBillingFixtures(artwork) {
  const charge = (state, unitCost, limit, charged, returned = 0, reserved = 0, expired = 0) => ({ state, unitCost, limit, charged, returned, reserved, expired });
  artwork.mine[0].n = 3;
  artwork.mine[0].billing = charge('SETTLED', 2, 6, 4, 2);
  artwork.mine[0].events = [
    { id: 'bill-queued', status: 'QUEUED', message: '任务已进入队列，已预留 6 次', createdAt: '2026-10-31T06:00:00Z' },
    { id: 'bill-saving', status: 'SETTLING', message: '图片已生成，正在保存作品并完成结算', createdAt: '2026-10-31T06:00:20Z' },
    { id: 'bill-done', status: 'SUCCESS', message: '生成完成，共 2 / 3 张', createdAt: '2026-10-31T06:00:21Z' },
  ];
  artwork.mine[1].status = 'SETTLING'; artwork.mine[1].progress = 95;
  artwork.mine[1].billing = charge('RESERVED', 2, 4, 0, 0, 4);
  artwork.mine[1].errorMessage = '图片已生成，保存与结算暂未完成，系统会自动重试';
  artwork.mine[2].n = 1; artwork.mine[2].billing = charge('SETTLED', 1, 1, 1);
  artwork.mine[3].billing = charge('RELEASED', 1, 2, 0, 2);
  artwork.mine[4].n = 1; artwork.mine[4].billing = charge('RESERVED', 1, 1, 0, 0, 1);
  artwork.mine[5].billing = charge('RELEASED', 1, 2, 0, 1, 0, 1);
  for (const task of artwork.square) { delete task.billing; task.events = []; }
  const createdAt = '2026-10-31T06:00:21Z';
  const row = (id, direction, amount, remark, sourceLogId) => ({ id, direction, amount, remark, sourceLogId, deductionType: 'drawMj', modelName: 'QGauss 图像样例', createdAt });
  return {
    '/api/balance/query': { balanceYuan: '0.00', isMember: false, counts: { model3: 36, model4: 12, drawMj: 18, agent: 8 }, reserved: { model3: 0, model4: 0, drawMj: 5, agent: 0 } },
    '/api/balance/consumeLog': { total: 3, items: [
      row('release', 5, 2, '未使用的预留次数已释放', 'hold'),
      row('settle', 1, 4, '从预留次数结算，不再次减少可用次数', 'hold'),
      row('hold', 4, 6, '任务已接受，预留次数；成功后按实际用量结算'),
    ] },
    '/api/signin/signinLog': { enabled: false, signedToday: false, streak: 0, reward: 0 },
    '/api/balance/rechargeLog': { items: [], total: 0 },
    '/api/crami/myLog': { items: [], total: 0 },
  };
}
