/** One recoverable submit intent per signed-in workspace; never auto-resubmits after reload. */
export function videoIntent(owner, storage = sessionStorage) {
  const key = 'qg:video:intent:' + owner;
  return {
    read() { try { const value = JSON.parse(storage.getItem(key)), p = value?.payload; return value && /^[A-Za-z0-9_-]{8,100}$/.test(value.requestKey) && /^[a-f0-9]{64}$/.test(value.quoteRevision) && p && typeof p === 'object' && !Array.isArray(p) && typeof p.presetId === 'string' && typeof p.prompt === 'string' && p.prompt.length <= 4000 && ['text','image','extend','reference','edit','upscale','lipsync'].includes(p.mode) ? value : null; } catch { return null; } },
    save(value) { try { storage.setItem(key, JSON.stringify(value)); } catch {} },
    clear() { try { storage.removeItem(key); } catch {} },
  };
}
export const videoStatus = status => ({ QUEUED: '等待开机', SUBMITTING: '正在送入片场', POLLING: '镜头正在成形', SAVING: '正在保存成片', SETTLING: '正在完成结算', SUCCESS: '可以开映了', FAILED: '这条没有完成', CANCELED: '已停止等待' }[status] || '准备中');
export const videoActive = status => ['QUEUED', 'SUBMITTING', 'POLLING', 'SAVING', 'SETTLING'].includes(status);
export const videoPools = { model3: '基础次数', model4: '高级次数', drawMj: '绘画次数', agent: '应用次数' };
