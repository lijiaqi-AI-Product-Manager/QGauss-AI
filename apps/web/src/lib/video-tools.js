export const videoModes = [
  { key: 'text', label: '文字成片' }, { key: 'image', label: '参考图动起来' },
  { key: 'reference', label: '多素材导演' }, { key: 'edit', label: '改写这一幕' },
  { key: 'extend', label: '续写下一幕' }, { key: 'upscale', label: '画面精修' }, { key: 'lipsync', label: '让角色开口' },
];
export const videoToolMode = mode => ['reference','edit','upscale','lipsync'].includes(mode);
export const upscaleModels = ['Proteus','Proteus Natural','Iris','Iris Low Quality','Dione DV','Dione TV','Dione Robust','Dione Dehalo','Dione Robust Dehalo','Artemis High Quality','Artemis Medium Quality','Artemis Low Quality','Artemis Strong Halo','Artemis Medium Halo','Artemis Aliasing & Moire','Gaia HQ','Gaia CG','Gaia 2','Rhea','Theia Fine Tune Detail','Theia Fine Tune Fidelity'];
export const syncModes = [
  {key:'cut_off',label:'保留较短的一段'}, {key:'loop',label:'循环画面，跟随声音'},
  {key:'bounce',label:'往返播放，跟随声音'}, {key:'silence',label:'声音不足时保留静默'}, {key:'remap',label:'调整节奏，贴合声音'},
];
export function materialLimits(mode, features = {}) {
  const limits = features.referenceLimits || { image:0, video:0, audio:0 };
  if(mode==='upscale') return {image:0,video:1,audio:0};
  if(mode==='lipsync') return {image:0,video:1,audio:1};
  if(mode==='edit') return {...limits,video:1};
  return {...limits};
}
export function validateVideoMaterials(mode, items, features) {
  const cap=materialLimits(mode,features), count=kind=>items.filter(x=>x.kind===kind).length;
  if(!items.length)return '先为这一幕加入一点素材';
  if(items.some(x=>!['image','video','audio'].includes(x.kind)||typeof x.id!=='string')||new Set(items.map(x=>x.id)).size!==items.length)return '素材记录不完整或重复，请重新选择';
  for(const kind of ['image','video','audio'])if(count(kind)>cap[kind])return ({image:'图片',video:'视频',audio:'声音'})[kind]+'数量超过当前创作方式的上限，请先移除多余素材';
  if(['edit','upscale','lipsync'].includes(mode)&&count('video')!==1)return '请选择一条要处理的视频';
  if(mode==='lipsync'&&count('audio')!==1)return '再加一段声音，让角色跟着开口';
  if(mode==='reference'&&!features.audioOnly&&!count('image')&&!count('video'))return '这个模型的声音参考还需要搭配图片或视频';
  return '';
}
