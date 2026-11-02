export const VOICES = [
  { id: 'alloy', name: '晴空', label: 'Alloy', mood: '均衡 · 清晰', color: '#66a8f6', note: '日常问答，听起来轻松自然' },
  { id: 'echo', name: '回声', label: 'Echo', mood: '深邃 · 从容', color: '#9c87ed', note: '慢一点，把重点讲清楚' },
  { id: 'fable', name: '暖叙', label: 'Fable', mood: '温暖 · 叙事', color: '#eeac70', note: '适合故事，也适合长一点的灵感' },
  { id: 'nova', name: '晨星', label: 'Nova', mood: '明亮 · 活力', color: '#f287ab', note: '让每一个好点子闪闪发光' },
  { id: 'onyx', name: '曜石', label: 'Onyx', mood: '低沉 · 稳定', color: '#76a89d', note: '沉稳表达，陪你专注思考' },
  { id: 'shimmer', name: '微光', label: 'Shimmer', mood: '轻盈 · 柔和', color: '#8cb9dc', note: '柔和的陪伴，给思绪一点空间' },
];
export const voiceName = id => VOICES.find(voice => voice.id === id)?.name || '暖叙';
export const voiceDuration = seconds => `${Math.floor(Math.max(0, seconds) / 60).toString().padStart(2, '0')}:${Math.floor(Math.max(0, seconds) % 60).toString().padStart(2, '0')}`;
export const voiceTerminal = task => ['COMPLETED', 'FAILED', 'CANCELED'].includes(task?.status);
export function voiceCharge(quote) {
  const labels = { model3: '低价模型', model4: '高价模型', agent: '智能体', drawMj: '绘图' };
  return quote?.cost > 0 ? `本次 ${quote.cost} 次${labels[quote.pool] || ''}额度` : '本次不扣站点次数';
}
export function voiceTaskLabel(task) {
  return ({ QUEUED: '已提交，准备中', RUNNING: task?.kind === 'transcription' ? '正在认真听…' : '正在把文字变成声音…', SETTLING: '结果已收到，正在保存', COMPLETED: task?.kind === 'transcription' ? '文字已转好，请确认后使用' : '声音已就绪', FAILED: '这次没有完成', CANCELED: '已停止生成' })[task?.status] || '';
}
