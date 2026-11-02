<template>
  <Teleport to="body"><dialog ref="dialog" class="qme-dialog" aria-labelledby="qme-title" @cancel.prevent="close" @click="backdrop">
    <header><div><span class="qp-eyebrow">QGAUSS / MAGIC BRUSH</span><h2 id="qme-title">留住喜欢的，<em>重画一点。</em></h2><p>粉色区域将被重新想象，其他部分作为保留参考。</p></div><button type="button" class="qp-icon-action" aria-label="关闭区域编辑" :disabled="saving" @click="close"><ClientIcon name="close" /></button></header>
    <div class="qme-layout">
      <section class="qme-stage" aria-label="重绘区域画布">
        <div v-if="error" class="qme-message" role="alert">{{ error }}</div>
        <BrandLoader v-else-if="!ready" text="正在展开画布…" />
        <div class="qme-image" :style="{ aspectRatio: width + '/' + height, '--qme-ratio': width / height }" v-show="ready"><img :src="source" alt="局部重绘的主参考图" @load="loaded" @error="error = '主图未能打开，请关闭后重新选择图片。'" /><canvas ref="canvas" :width="width" :height="height" aria-label="涂抹重绘区域，方向键移动，空格涂抹" tabindex="0" @pointerdown="down" @pointermove="move" @pointerup="up" @pointercancel="cancelStroke" @lostpointercapture="up" @keydown="keyboard" /><span v-if="keyboardMode" class="qme-cursor" :style="{ left: cursor.x * 100 + '%', top: cursor.y * 100 + '%', width: size + '%', aspectRatio: '1' }"></span></div>
        <span v-if="ready" class="qme-size">{{ width }} × {{ height }} · 拖动涂抹 / 方向键移动，空格涂抹</span>
      </section>
      <aside class="qme-tools"><span class="qme-tool-eyebrow">给画面一点新可能</span><div class="qme-tool-switch"><button type="button" :aria-pressed="!erase" @click="erase = false">涂抹选区</button><button type="button" :aria-pressed="erase" @click="erase = true">擦除选区</button></div><label for="qme-brush">画笔大小 <b>{{ size }}%</b></label><input id="qme-brush" v-model.number="size" aria-label="画笔大小" type="range" min="2" max="24" /><div class="qme-brush-preview" aria-hidden="true"><i :style="{ width: 20 + size * 2 + 'px', height: 20 + size * 2 + 'px' }"></i><span>✦</span></div><div class="qme-history"><button type="button" :disabled="!strokes.length" @click="undo">撤销一步</button><button type="button" :disabled="!strokes.length" @click="clear">清空选区</button></div><p class="qme-tip">先选区域，再描述你想换成的内容。保留范围是给模型的指引，最终效果由所选模型决定。</p><p class="qme-tip">关闭只放弃本次编辑；确认选区后会保存为你的私有文件。</p><button type="button" class="qme-apply" :disabled="!ready || saving || !strokes.some(s => !s.erase)" @click="apply">{{ saving ? '正在保存…' : '确认这片想象' }} <span>↗</span></button></aside>
    </div>
  </dialog></Teleport>
</template>

<script setup>
import { nextTick, onBeforeUnmount, ref } from 'vue';
import ClientIcon from '../reference/ClientIcon.vue';
import BrandLoader from './BrandLoader.vue';
import { maskBlob, maskPoint, paintMask } from '../../lib/image-mask.js';
import './image-edit.css';
const props = defineProps({ source: String });
const emit = defineEmits(['apply']);
const dialog = ref(null), canvas = ref(null), width = ref(1), height = ref(1), ready = ref(false), saving = ref(false), error = ref(''), size = ref(10), erase = ref(false), strokes = ref([]);
const keyboardMode = ref(false), cursor = ref({ x: .5, y: .5 });
let activePointer = null, draft, alive = true, opener, paintFrame = 0;
function redraw() { if (paintFrame) return; paintFrame = requestAnimationFrame(() => { paintFrame = 0; const context = canvas.value?.getContext('2d'); if (context && alive) paintMask(context, width.value, height.value, strokes.value, true); }); }
async function open(saved = []) { opener = document.activeElement; ready.value = false; error.value = ''; strokes.value = JSON.parse(JSON.stringify(saved)); dialog.value?.showModal(); await nextTick(); const image = dialog.value?.querySelector('img'); if (image?.complete && image.naturalWidth) loaded({ target: image }); }
async function loaded(event) { const image = event.target; if (!image.naturalWidth || image.naturalWidth * image.naturalHeight > 8_388_608) { error.value = '局部重绘主图最多 800 万像素，请先缩小图片。'; return; } width.value = image.naturalWidth; height.value = image.naturalHeight; ready.value = true; await nextTick(); if (alive) redraw(); }
function down(event) { if (!ready.value || saving.value || activePointer !== null || event.button !== 0) return; if (strokes.value.length >= 100) { error.value = '笔画已达上限，请撤销或确认当前选区。'; return; } const p = maskPoint(event, canvas.value.getBoundingClientRect()); if (!p) return; activePointer = event.pointerId; draft = { erase: erase.value, size: size.value / 100, points: [p] }; strokes.value.push(draft); canvas.value.setPointerCapture(event.pointerId); redraw(); }
function move(event) { if (activePointer !== event.pointerId || !draft) return; const p = maskPoint(event, canvas.value.getBoundingClientRect()), prev = draft.points.at(-1); if (p && draft.points.length < 2000 && Math.hypot((p.x - prev.x) * width.value, (p.y - prev.y) * height.value) >= 1) { draft.points.push(p); redraw(); } }
function up(event) { if (event && activePointer !== event.pointerId) return; const pointer = activePointer; activePointer = null; draft = null; if (pointer !== null && canvas.value?.hasPointerCapture(pointer)) canvas.value.releasePointerCapture(pointer); }
function cancelStroke(event) { if (activePointer !== event.pointerId) return; strokes.value.pop(); up(event); redraw(); }
function undo() { up(); strokes.value.pop(); error.value = ''; redraw(); }
function clear() { up(); strokes.value = []; error.value = ''; redraw(); }
function keyboard(event) { if (!ready.value || saving.value || !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', 'Enter'].includes(event.key)) return; event.preventDefault(); up(); keyboardMode.value = true; const step = event.shiftKey ? .01 : .05; if (event.key.startsWith('Arrow')) { const axis = ['ArrowUp', 'ArrowDown'].includes(event.key) ? 'y' : 'x', direction = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1; cursor.value[axis] = Math.max(0, Math.min(1, cursor.value[axis] + direction * step)); } else if (strokes.value.length < 100) { strokes.value.push({ size: size.value / 100, erase: erase.value, points: [{ ...cursor.value }] }); redraw(); } }
async function apply() { if (saving.value || !ready.value) return; up(); saving.value = true; error.value = ''; try { const target = document.createElement('canvas'); target.width = width.value; target.height = height.value; const context = target.getContext('2d'); paintMask(context, width.value, height.value, strokes.value); const pixels = context.getImageData(0, 0, width.value, height.value).data; let selected = false, retained = false; for (let i = 3; i < pixels.length && !(selected && retained); i += 4) { selected ||= pixels[i] === 0; retained ||= pixels[i] === 255; } if (!selected || !retained) throw new Error(selected ? '请保留一部分画面；若要全部重画，可移除选区直接生成。' : '请先涂出需要重画的区域。'); const blob = await maskBlob(target); target.width = target.height = 1; if (blob.size > 4 * 1024 * 1024) throw new Error('选区文件过大，请简化选区或缩小主图。'); if (!alive) return; emit('apply', { blob, strokes: JSON.parse(JSON.stringify(strokes.value)), width: width.value, height: height.value }); dialog.value.close(); } catch (reason) { if (alive) error.value = reason.message || '选区未能保存'; } finally { if (alive) saving.value = false; } }
function close() { if (saving.value) return; up(); dialog.value?.close(); opener?.focus?.({ preventScroll: true }); }
function backdrop(event) { if (event.target !== dialog.value) return; const r = dialog.value.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) close(); }
onBeforeUnmount(() => { alive = false; cancelAnimationFrame(paintFrame); up(); dialog.value?.close(); });
defineExpose({ open });
</script>
