export const RECORD_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const RECORD_FILTERS = Object.freeze({ keyword: '', user: '', modelName: '', conversationId: '', status: '', role: '', billingState: '', kind: 'all', scope: 'all', from: '', to: '' });
export function recordQuery(filters) {
  const query = {};
  for (const key of Object.keys(RECORD_FILTERS)) {
    const value = String(filters[key] || '').trim();
    if (!value || value === 'all') continue;
    if (key === 'from' || key === 'to') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('请选择有效日期');
      const date = new Date(`${value}T${key === 'from' ? '00:00:00.000' : '23:59:59.999'}`);
      if (!Number.isFinite(date.getTime()) || [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')].join('-') !== value) throw new Error('请选择有效日期');
      query[key] = date.toISOString();
    } else query[key] = value;
  }
  if (query.from && query.to && query.from > query.to) throw new Error('开始时间不能晚于结束时间');
  return query;
}
export function recordPath(query, { page = 1, pageSize = 20, exportFile = false } = {}) {
  const params = new URLSearchParams(query);
  if (!exportFile) { params.set('page', String(page)); params.set('pageSize', String(pageSize)); }
  return `/chat-logs${exportFile ? '/export' : ''}?${params}`;
}
export function readRecordPage(data, expectedPage, pageSize) {
  if (!data || !Array.isArray(data.items) || !Number.isSafeInteger(data.total) || data.total < 0 || data.page !== expectedPage || data.pageSize !== pageSize || typeof data.asOf !== 'string' || !Number.isFinite(Date.parse(data.asOf)) || data.items.length > pageSize || data.items.length > data.total) throw new Error('记录暂未读取完整，请重试');
  const ids = new Set();
  for (const row of data.items) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id) || typeof row.content !== 'string' || typeof row.status !== 'string' || typeof row.role !== 'string') throw new Error('记录暂未读取完整，请重试');
    ids.add(row.id);
  }
  return data;
}
export async function checkWorkbook(blob) {
  if (!blob || blob.type.split(';')[0].trim() !== RECORD_MIME || blob.size < 100 || blob.size > 512 * 1024 * 1024) throw new Error('文件暂未完整下载，请重试或缩小筛选范围');
  const header = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  if (header[0] !== 80 || header[1] !== 75 || header[2] !== 3 || header[3] !== 4) throw new Error('文件暂未完整下载，请重试或缩小筛选范围');
  return blob;
}
export function saveRecordWorkbook(blob) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = `QGauss-records-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export const recordStatus = value => ({ PENDING: '等待回复', STREAMING: '正在生成', SETTLING: '保存与结算中', COMPLETED: '已完成', FAILED: '失败', ABORTED: '已停止' }[value] || '未知状态');
export const recordRole = value => ({ USER: '用户', ASSISTANT: '助手', SYSTEM: '系统' }[value] || '其他角色');
export const billingStatus = value => ({ FREE: '无需扣次', RESERVED: '已预留', SETTLING: '结算中', SETTLED: '已结算', RELEASED: '已释放' }[value] || '历史未记录');
export const recordUsage = value => Number.isSafeInteger(value) && value >= 0 ? String(value) : '—';
