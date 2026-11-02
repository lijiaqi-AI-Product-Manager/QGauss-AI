export const MJ_ACTIVE = ['QUEUED','SUBMITTING','MODAL_QUEUED','MODAL_SUBMITTING','WAITING_INPUT','POLLING','SAVING','SETTLING'];
export const MJ_PRICES = ['imagine','blend','describe','shorten','swap','upscale','variation','reroll','pan','outpaint','inpaint','video','video_extend'] as const;
export const MJ_KINDS = ['imagine','blend','describe','shorten','swap','action','video'] as const;
export const MJ_VERSIONS = ['5.2','6','6.1','7','8.1','8.2'] as const;
export const MJ_ROLES = ['image','style','character','first','last','faceSource','faceTarget'] as const;
export const mjName = (kind: string) => ({imagine:'文字成画',blend:'灵感融合',describe:'读懂画面',shorten:'精简描述',swap:'人物合成',action:'继续创作',upscale:'放大作品',variation:'变化作品',reroll:'重新想象',pan:'平移扩图',outpaint:'画面扩展',inpaint:'局部重绘',video:'让画面动起来',video_extend:'续写片段'})[kind] || '继续创作';
export function mjFeatures(versions: string[], video: boolean, faceSwap: boolean, niji: boolean, blendLimit = 5) {
  const qualities = Object.fromEntries([...new Set([...versions,...(niji?['6']:[])])].map(v => [v,v.startsWith('8.') ? [0] : v === '7' ? [1,2,4] : v === '5.2' ? [.25,.5,1] : [.5,1,2]]));
  const roles = Object.fromEntries(versions.map(v => [v,v.startsWith('8.') ? ['image','style'] : v === '5.2' ? ['image'] : ['image','style','character']]));
  return {kinds:['imagine','blend','describe','shorten',...(faceSwap?['swap']:[]),...(video?['video']:[])],niji,versions:{mj:versions,niji:niji?['6']:[]},qualities,roles,hdVersions:versions.filter(v=>v.startsWith('8.')),blendLimit};
}
export function mjJson<T>(raw: string | null | undefined, fallback: T): T { try { return raw ? JSON.parse(raw) : fallback; } catch { return fallback; } }
