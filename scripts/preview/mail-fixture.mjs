/** Explicit synthetic GET-only mail centre states. No transport and no real recipients. */
export function mailFixtures(state = 'mail-ready') {
  const enabled = state !== 'mail-empty', states = ['sent','failed','unknown','skipped','suppressed','queued','sending'];
  const rows = state === 'mail-empty' ? [] : Array.from({ length: 12 }, (_, index) => ({
    id: 'mail-example-' + index, template: index % 3 === 0 ? 'deliveryProbe' : index % 3 === 1 ? 'welcome' : 'resetPassword',
    subject: index % 3 === 0 ? 'QGauss AI · 一声你好' : index % 3 === 1 ? '欢迎加入 QGauss AI' : 'QGauss AI · 重置密码',
    to: 'q***@qgauss.test', status: states[index % states.length], attempts: index % 3,
    createdAt: '2026-11-01T08:' + String(40 - index).padStart(2,'0') + ':00Z', sentAt: index % states.length === 0 ? '2026-11-01T08:41:00Z' : null,
    lastTriedAt: '2026-11-01T08:40:00Z', confirmedAt: null, explanation: '这是明确标注的本地展示回执，不代表真实邮件已经发送。',
  }));
  let recent = null;
  if (['mail-accepted','mail-confirmed','mail-unknown','mail-sending'].includes(state)) {
    const status = state === 'mail-unknown' ? 'unknown' : state === 'mail-sending' ? 'sending' : 'sent';
    recent = { ...rows[0], status, canConfirm: status === 'sent' || status === 'unknown', retryScheduled: false, confirmedAt: state === 'mail-confirmed' ? '2026-11-01T08:45:00Z' : null };
  }
  return {
    '/api/mail/status': { operatorMailbox: 'q***@qgauss.test', counts: Object.fromEntries(states.map(status => [status, rows.filter(row => row.status === status).length])), recentProbe: recent, transport: { canTest: enabled, checks: [
      { id:'sender',title:'发件账户与地址',ready:enabled,description:enabled?'本地已加载设置的示意，仍需实际验证收信。':'尚未启用发件，请由部署负责人准备发件账户。' },
      { id:'encryption',title:'邮件连接方式',ready:enabled,description:enabled?'已要求加密连接；仍需验证实际连接。':'等待部署负责人准备加密连接。' },
      { id:'origin',title:'站点与返回地址',ready:true,description:'站点地址已填写，还需验证重置链接能否正确返回。' },
    ] } },
    '/api/mail/outbox': rows,
    '/api/mail/templates': ['欢迎信','找回密码','体验信'].map((title,index) => ({id:['welcome','resetPassword','deliveryProbe'][index],title,html:'<!doctype html><html lang="zh-CN"><body style="padding:24px;background:#f0eef9;color:#29273e;font:14px/1.8 sans-serif"><div style="padding:20px;background:linear-gradient(120deg,#4c3cbd,#b190e6);color:white;border-radius:16px 16px 0 0">QGauss AI ✦</div><div style="background:white;padding:25px;border-radius:0 0 16px 16px"><h2>'+title+'</h2><p>你好，灵感朋友：</p><p>愿下一次灵感，也能顺利抵达。</p><p>这是本地示意模板，不含真实资料或链接，也不会发送邮件。</p></div></body></html>',text:title+'：你好，灵感朋友。这是本地示意模板，不含真实链接，也不会发送。'})),
  };
}
export function mailFixturePage(rows, url) {
  const filtered = rows.filter(row => (!url.searchParams.get('status') || row.status === url.searchParams.get('status')) && (!url.searchParams.get('template') || row.template === url.searchParams.get('template')) && (!url.searchParams.get('keyword') || row.to.includes(url.searchParams.get('keyword'))));
  const page = Number(url.searchParams.get('page') || 1), pageSize = Number(url.searchParams.get('pageSize') || 8);
  return { items: filtered.slice((page-1)*pageSize, page*pageSize), page, pageSize, total: filtered.length };
}
