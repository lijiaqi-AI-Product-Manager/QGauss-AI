import { creationIntent } from './creation-intent.js';
export const mjIntent = (owner, storage) => creationIntent('mj', owner, p => p && typeof p === 'object' && !Array.isArray(p) && typeof p.presetId === 'string' && ['imagine', 'blend', 'describe', 'shorten', 'swap', 'action', 'video'].includes(p.kind), storage);
export const mjActive = task => ['QUEUED','SUBMITTING','MODAL_QUEUED','MODAL_SUBMITTING','WAITING_INPUT','POLLING','SAVING','SETTLING'].includes(task?.status);
export const mjStatus = status => ({ QUEUED:'等待灵感显影', SUBMITTING:'正在送往创作室', MODAL_QUEUED:'等待补充参数提交', MODAL_SUBMITTING:'正在确认这一处改动', WAITING_INPUT:'等待你补充想法', POLLING:'画面正在长出来', SAVING:'正在珍藏这一份作品', SETTLING:'正在完成本次结算', SUCCESS:'灵感已经成形', FAILED:'这次没有完成', CANCELED:'已停止等待' }[status] || '准备中');
export const mjKinds = [
  { key:'imagine', name:'文字成画', icon:'✦', hint:'一句话，打开四种可能' },
  { key:'blend', name:'灵感融合', icon:'◒', hint:'把不同画面的气质放在一起' },
  { key:'describe', name:'读懂画面', icon:'◌', hint:'从一张图片，找回创作语言' },
  { key:'shorten', name:'精简描述', icon:'≋', hint:'留下重要的，让想法更清晰' },
  { key:'swap', name:'人物合成', icon:'◇', hint:'分别选择来源图和目标图' },
  { key:'video', name:'让画面动起来', icon:'▶', hint:'让一帧画面，拥有自己的时间' },
];
export const mjRoles = { image:'画面参考', style:'风格参考', character:'主体参考', first:'视频首帧', last:'视频尾帧', faceSource:'人物来源', faceTarget:'合成目标' };
export const mjPools = { drawMj:'绘画次数', model3:'基础次数', model4:'高级次数', agent:'应用次数' };
export function mjResultKind(task) { return task?.results?.some(r => r.kind === 'video') ? 'video' : task?.text ? 'text' : 'image'; }
export function mjActionGroups(actions = []) {
  const groups = new Map();
  for (const action of actions) { const group = action.group || '继续创作'; if (!groups.has(group)) groups.set(group, []); groups.get(group).push(action); }
  return [...groups].map(([name, items]) => ({ name, items }));
}

export function mjModalIntent(owner, storage = sessionStorage) { return creationIntent('mj-modal', owner, p => p && typeof p.taskId === 'string' && p.taskId.length > 0 && typeof p.prompt === 'string' && p.prompt.trim().length > 0 && p.prompt.length <= 4000, storage, false); }
