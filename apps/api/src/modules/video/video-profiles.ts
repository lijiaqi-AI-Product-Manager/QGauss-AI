export const VIDEO_STYLES = [
  { key: 'Anime', label: '动漫' }, { key: 'Moody', label: '氛围电影' }, { key: '3D', label: '立体质感' },
  { key: 'Watercolor', label: '水彩' }, { key: 'Natural', label: '自然写实' }, { key: 'Claymation', label: '黏土动画' }, { key: 'Black & white', label: '黑白' },
];
export const VIDEO_PROFILES = ['PIKA_1', 'ARK_1_0', 'ARK_2_0', 'ARK_2_5', 'FAL_UPSCALE', 'FAL_LIPSYNC'] as const;
export const VIDEO_TOOL_MODES = ['reference','edit','upscale','lipsync'];
export const FAL_VIDEO_MODELS = {FAL_UPSCALE:'topaz/upscale/video/precision',FAL_LIPSYNC:'fal-ai/sync-lipsync/v3'};
export const UPSCALE_MODELS = ['Proteus','Proteus Natural','Iris','Iris Low Quality','Dione DV','Dione TV','Dione Robust','Dione Dehalo','Dione Robust Dehalo','Artemis High Quality','Artemis Medium Quality','Artemis Low Quality','Artemis Strong Halo','Artemis Medium Halo','Artemis Aliasing & Moire','Gaia HQ','Gaia CG','Gaia 2','Rhea','Theia Fine Tune Detail','Theia Fine Tune Fidelity'];
export type VideoProfile = typeof VIDEO_PROFILES[number];
export const VIDEO_ACTIVE = ['QUEUED', 'SUBMITTING', 'POLLING', 'SAVING', 'SETTLING'];
export const MAX_VIDEO_BYTES = 96 * 1024 * 1024;
const integers = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
export function videoFeatures(profile: string) {
  if (profile === 'PIKA_1') return { modes: ['text', 'image', 'extend'], ratios: ['16:9', '9:16', '1:1', '4:3', '3:4'], seconds: [0], resolutions: [] as string[], camera: true, styles: VIDEO_STYLES, sound: false, maxImages: 1, adaptiveImage: false };
  if (!VIDEO_PROFILES.includes(profile as VideoProfile)) throw Error('Unknown video capability profile');
  if(profile.startsWith('FAL_'))return{modes:[profile==='FAL_UPSCALE'?'upscale':'lipsync'],ratios:['source'],seconds:[0],resolutions:[] as string[],camera:false,styles:[] as typeof VIDEO_STYLES,sound:false,maxImages:0,adaptiveImage:false,referenceLimits:{image:0,video:1,audio:profile==='FAL_LIPSYNC'?1:0},audioOnly:false};
  return { modes: profile === 'ARK_2_5' ? ['text', 'image', 'reference','edit','extend'] : profile==='ARK_2_0'?['text','image','reference']:['text', 'image'], ratios: ['adaptive', '16:9', '9:16', '1:1', '4:3', '3:4', '21:9'], seconds: profile === 'ARK_1_0' ? integers(2, 12) : integers(4, profile === 'ARK_2_5' ? 30 : 15), resolutions: profile === 'ARK_2_0' ? ['480p', '720p', '1080p', '4k'] : ['480p', '720p', '1080p'], camera: false, styles: [] as typeof VIDEO_STYLES, sound: profile !== 'ARK_1_0', maxImages: 2, adaptiveImage: profile === 'ARK_2_5',referenceLimits:profile==='ARK_2_5'?{image:30,video:10,audio:10}:profile==='ARK_2_0'?{image:9,video:3,audio:3}:{image:0,video:0,audio:0},audioOnly:profile==='ARK_2_5' };
}
export function videoProfileName(profile: string) { return ({ PIKA_1: 'Pika Web 1.0 协议', ARK_1_0: '方舟 Seedance 1.0 pro', ARK_2_0: '方舟 Seedance 2.0', ARK_2_5: '方舟 Seedance 2.5',FAL_UPSCALE:'fal Topaz 视频精修',FAL_LIPSYNC:'fal Sync 3 口型同步' })[profile] || profile; }
export function videoModeName(mode: string) { return ({ text: '文字成片', image: '参考图成片', extend: '续写成片',reference:'多素材导演',edit:'改写这一幕',upscale:'画面精修',lipsync:'让角色开口' })[mode] || mode; }
