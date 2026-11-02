<template>
  <div ref="root" class="qg-md" :class="{ 'qg-md-plain': streaming }" @click="onClick" v-html="html"></div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import DOMPurify from 'dompurify';
import hljs from 'highlight.js/lib/common';
import { escapeHtml, renderMarkdown } from '../lib/markdown.js';
import { readMath } from '../lib/math-tokens.js';
import { codeFileName } from '../lib/rich-security.js';
import { renderMath, renderDiagram } from '../lib/rich-renderers.js';
import './rich-content.css';

const props = defineProps({ content: { type: String, default: '' }, streaming: { type: Boolean, default: false } });
const emit = defineEmits(['rendered']);
const root = ref(null);
const sanitize = html => DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
let revision = 0, actions = new WeakMap();
const timers = new Set();
const html = computed(() => {
  if (!props.streaming) return renderMarkdown(props.content, sanitize);
  const chars = [...props.content], tail = chars.slice(-6);
  return escapeHtml(chars.slice(0, Math.max(0, chars.length - 6)).join('')) +
    tail.map((c, i) => '<span style="opacity:' + (1 - ((i + 1) / (tail.length + 1)) * .8).toFixed(2) + '">' + escapeHtml(c) + '</span>').join('');
});
function clearTimers() { for (const timer of timers) clearTimeout(timer); timers.clear(); }
function button(parent, text, label, action) {
  const node = document.createElement('button');
  node.type = 'button'; node.className = 'qg-code-action'; node.textContent = text; node.setAttribute('aria-label', label);
  actions.set(node, action); parent.appendChild(node); return node;
}
function saveText(text, name, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function copyCode(node, source) {
  try { await navigator.clipboard.writeText(source); node.textContent = '已复制'; }
  catch { node.textContent = '复制失败'; }
  if (!node.isConnected) return;
  const timer = setTimeout(() => { timers.delete(timer); if (node.isConnected) node.textContent = '复制'; }, 1500);
  timers.add(timer);
}
async function onClick(event) {
  const node = event.target.closest?.('button');
  const action = node && actions.get(node);
  if (action) { event.preventDefault(); await action(node); }
}
watch(html, async () => {
  const version = ++revision;
  clearTimers(); actions = new WeakMap();
  await nextTick();
  const host = root.value;
  const current = () => version === revision && root.value === host && host?.isConnected && !props.streaming;
  if (!current()) return;
  const tasks = [];
  for (const [index, node] of [...host.querySelectorAll('.qg-md-math')].entries()) {
    const token = readMath(node.textContent);
    if (!token || index >= 128) { node.title = '公式数量较多，已保留源码'; continue; }
    node.setAttribute('aria-busy', 'true');
    tasks.push(Promise.resolve().then(() => renderMath(token.math, token.display)).then(result => {
      if (current() && host.contains(node)) { node.innerHTML = result; node.classList.add('is-ready'); }
    }).catch(() => {
      if (current() && host.contains(node)) { node.classList.add('is-error'); node.title = '公式未能呈现，已保留源码'; }
    }).finally(() => { if (current() && host.contains(node)) node.removeAttribute('aria-busy'); }));
  }
  let diagrams = 0;
  for (const pre of host.querySelectorAll('pre')) {
    const code = pre.querySelector('code');
    if (!code) continue;
    const source = code.textContent, language = /(?:^|\s)language-([\w+-]+)/.exec(code.className)?.[1]?.toLowerCase() || 'text';
    const isDiagram = language === 'mermaid';
    const card = document.createElement('section'); card.className = 'qg-code-card' + (isDiagram ? ' qg-diagram-card' : '');
    const header = document.createElement('div'); header.className = 'qg-code-head';
    const title = document.createElement('span'); title.className = 'qg-code-language'; title.textContent = isDiagram ? /^\s*mindmap\b/.test(source) ? '思维导图' : 'Mermaid 图表' : language.toUpperCase();
    header.appendChild(title);
    card.appendChild(header); pre.replaceWith(card); card.appendChild(pre);
    button(header, '复制', '复制代码', node => copyCode(node, source));
    button(header, '下载', '下载代码', () => saveText(source, codeFileName(language)));
    if (!isDiagram) {
      try { hljs.highlightElement(code); } catch { /* Unsupported language remains readable. */ }
      continue;
    }
    const canvas = document.createElement('div'); canvas.className = 'qg-diagram-canvas';
    const caption = document.createElement('div'); caption.className = 'qg-diagram-caption'; caption.textContent = '图表较宽时可左右滚动，也可适应宽度查看全貌。'; caption.hidden = true;
    const status = document.createElement('div'); status.className = 'qg-diagram-status'; status.setAttribute('role', 'status');
    card.insertBefore(status, pre); card.insertBefore(canvas, pre); card.insertBefore(caption, pre);
    let svg = '', showingSource = false, fitted = false, naturalWidth = 600;
    const showView = sourceView => {
      showingSource = sourceView; pre.hidden = !sourceView; canvas.hidden = sourceView;
      caption.hidden = sourceView;
      toggle.textContent = sourceView ? '查看图表' : '查看源码'; toggle.setAttribute('aria-pressed', String(sourceView));
    };
    const toggle = button(header, '查看源码', '切换图表与源码', () => showView(!showingSource));
    const fit = button(header, '适应宽度', '切换图表缩放', () => {
      fitted = !fitted;
      canvas.querySelector('svg').style.minWidth = fitted ? '0' : naturalWidth * .85 + 'px';
      fit.textContent = fitted ? '实际大小' : '适应宽度'; fit.setAttribute('aria-pressed', String(fitted));
    });
    fit.hidden = true;
    const downloadSvg = button(header, 'SVG', '下载 SVG 图表', () => saveText(svg, 'qgauss-diagram.svg', 'image/svg+xml;charset=utf-8'));
    downloadSvg.hidden = true;
    const allowed = ++diagrams <= 16;
    const draw = async () => {
      if (!current()) return;
      status.hidden = false; status.textContent = '正在绘制图表…'; status.className = 'qg-diagram-status is-loading';
      toggle.disabled = true; pre.hidden = true;
      try {
        if (!allowed) throw new Error('图表数量较多');
        const result = await renderDiagram(source, current);
        if (!current() || !host.contains(card)) return;
        svg = result; canvas.innerHTML = result; status.hidden = true; downloadSvg.hidden = false; fit.hidden = false;
        const graphic = canvas.querySelector('svg');
        naturalWidth = Math.max(260, Math.min(12000, Number(graphic.getAttribute('viewBox')?.split(/[ ,]+/)[2]) || 600));
        graphic.style.width = naturalWidth + 'px'; graphic.style.minWidth = naturalWidth * .85 + 'px';
        fit.setAttribute('aria-pressed', 'false'); fitted = false;
        actions.set(toggle, () => showView(!showingSource)); showView(false);
      } catch {
        if (!current() || !host.contains(card)) return;
        status.hidden = false; status.textContent = '图表未能呈现，源码已保留，可复制或下载。'; status.className = 'qg-diagram-status is-error';
        pre.hidden = false; canvas.hidden = true; toggle.textContent = '重试图表'; actions.set(toggle, draw);
      } finally { if (current()) toggle.disabled = false; }
    };
    tasks.push(draw());
  }
  emit('rendered');
  await Promise.allSettled(tasks);
  if (current()) emit('rendered');
}, { immediate: true });
onBeforeUnmount(() => { revision += 1; clearTimers(); actions = new WeakMap(); });
</script>
