import { defineStore } from 'pinia';
import { useTheme } from './theme.js';

export const DESIGN_VARIANTS = Object.freeze([
  { id: 'studio', label: '光屿工作室', english: 'STUDIO OF IDEAS', letter: 'A', description: '漂浮软胶伙伴、拼贴工作台和柔光玻璃。', mode: 'light' },
  { id: 'play', label: '青柠游乐场', english: 'MAKE SOMETHING GOOD', letter: 'B', description: '大字、异形页签、轻快撞色和横向创作桌。', mode: 'light' },
  { id: 'orbit', label: '星际液态', english: 'YOUR NEXT UNIVERSE', letter: 'C', description: '环绕星轨、流动极光和半透明指挥舱。', mode: 'dark' },
]);
const KEY = 'qg:appearance-v1';
function read() {
  const defaults={variant:'studio',motion:true,glass:78,saved:false,saveFailed:false};let raw;
  try{raw=localStorage.getItem(KEY);}catch{return{...defaults,saveFailed:true};}
  try{const data=JSON.parse(raw||'null');if(data&&DESIGN_VARIANTS.some(item=>item.id===data.variant))return{variant:data.variant,motion:data.motion!==false,glass:Math.max(55,Math.min(95,Number(data.glass)||78)),saved:true,saveFailed:false};}catch{}
  return defaults;
}
export const useAppearance = defineStore('appearance', {
  state: () => ({ ...read(), open: false, initialized: false }),
  getters: { design: state => DESIGN_VARIANTS.find(item => item.id === state.variant) || DESIGN_VARIANTS[0] },
  actions: {
    initialize() { if (this.initialized) return; this.initialized = true; if (!this.saved) useTheme().set(this.design.mode); this.apply(); },
    apply() { const root = document.documentElement; root.dataset.qgDesign = this.variant; root.dataset.qgMotion = this.motion ? 'full' : 'quiet'; root.style.setProperty('--qgd-glass-opacity', String(this.glass / 100)); },
    save() { this.apply(); try { localStorage.setItem(KEY, JSON.stringify({ variant: this.variant, motion: this.motion, glass: this.glass })); this.saved=true;this.saveFailed=false; } catch { this.saveFailed=true; } },
    choose(variant) { if (!DESIGN_VARIANTS.some(item => item.id === variant)) return; this.variant = variant; useTheme().set(this.design.mode); this.save(); },
    setMotion(value) { this.motion = !!value; this.save(); },
    setGlass(value) { this.glass = Math.max(55, Math.min(95, Number(value) || 78)); this.save(); },
  },
});
