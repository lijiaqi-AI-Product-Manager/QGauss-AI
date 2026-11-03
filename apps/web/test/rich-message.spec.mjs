/** Actual Vue lifecycle and controls. Diagram layout is checked in the native browser. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { JSDOM } from 'jsdom';
import { rollup } from 'rollup';
import vuePlugin from 'rollup-plugin-vue';
import postcss from 'rollup-plugin-postcss';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const dom = new JSDOM('<!doctype html><html><body><div id="mount"></div><div id="scroll"></div></body></html>', { url: 'http://qgauss.test', pretendToBeVisual: true });
for (const name of ['window', 'document', 'Element', 'HTMLElement', 'SVGElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'navigator']) Object.defineProperty(globalThis, name, { value: dom.window[name], configurable: true, writable: true });
globalThis.requestAnimationFrame = fn => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = clearTimeout;
window.matchMedia = () => ({ matches: false });
const downloads = [], blobs = new Map(), copied = [];
URL.createObjectURL = blob => { const url = 'blob:qgauss-' + blobs.size; blobs.set(url, blob); return url; };
URL.revokeObjectURL = url => blobs.delete(url);
dom.window.HTMLAnchorElement.prototype.click = function () { downloads.push({ href: this.href, name: this.download, blob: blobs.get(this.href) }); };
Object.defineProperty(navigator, 'clipboard', { value: { async writeText(text) { copied.push(text); } }, configurable: true });

const webRoot = fileURLToPath(new URL('..', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'qgauss-rich-test-'));
assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep + 'qgauss-rich-test-'));
const bundle = await rollup({
  input: 'qgauss-rich-test',
  external: id => ['vue', 'dompurify', 'highlight.js'].some(name => id === name || id.startsWith(name + '/')),
  plugins: [
    {
      name: 'rich-test-entry',
      resolveId(id) {
        if (id === 'qgauss-rich-test') return '\0qgauss-rich-test';
        if (id.endsWith('/rich-renderers.js')) return '\0qgauss-test-renderers';
      },
      load(id) {
        if (id === '\0qgauss-rich-test') return 'export {setLang} from '+JSON.stringify(join(webRoot,'src/i18n/index.js'))+';export {default as MarkdownMessage} from ' + JSON.stringify(join(webRoot, 'src/components/MarkdownMessage.vue')) + ';export {default as ConversationOutline} from ' + JSON.stringify(join(webRoot, 'src/components/ConversationOutline.vue')) + ';';
        if (id === '\0qgauss-test-renderers') return 'export const renderMath=(...args)=>globalThis.qgaussRichHandlers.math(...args);export const renderDiagram=(...args)=>globalThis.qgaussRichHandlers.diagram(...args);';
      },
    },
    vuePlugin({ css: false }), postcss({ inject: false }), nodeResolve({ extensions: ['.js', '.vue', '.mjs'] }),
  ],
});
const generated = await bundle.generate({ format: 'es', inlineDynamicImports: true });
const entry = generated.output.find(item => item.type === 'chunk' && item.isEntry);
let compiled = entry.code;
for (const name of entry.imports) compiled = compiled.replaceAll("from '" + name + "'", "from '" + import.meta.resolve(name) + "'");
const modulePath = join(temp, 'components.mjs');
await writeFile(modulePath, compiled);
await bundle.close();
after(async () => { assert.ok(resolve(temp).startsWith(resolve(tmpdir()) + sep + 'qgauss-rich-test-')); await rm(temp, { recursive: true, force: true }); dom.window.close(); });
const { createApp, h, reactive, nextTick } = await import('vue');
const { MarkdownMessage, ConversationOutline, setLang } = await import(pathToFileURL(modulePath).href);
const tick = String.fromCharCode(96), fence = tick.repeat(3);
const block = (language, code) => fence + language + '\n' + code + '\n' + fence;
const settle = async () => { for (let i = 0; i < 3; i += 1) { await nextTick(); await new Promise(resolve => setImmediate(resolve)); } };
async function mount(content = '', options = {}) {
  setLang('zh');
  copied.length = 0; downloads.length = 0;
  const calls = [], errors = [], state = reactive({ content, streaming: false, ...options });
  globalThis.qgaussRichHandlers = {
    math: async source => { calls.push(['math', source]); return '<span class="katex">' + source + '</span>'; },
    diagram: async source => { calls.push(['diagram', source]); return '<svg viewBox="0 0 100 100"><rect width="90" height="90"/></svg>'; },
  };
  const app = createApp({ render: () => h(MarkdownMessage, state) });
  app.config.errorHandler = error => errors.push(error);
  app.mount('#mount'); await settle();
  return { app, state, calls, errors, close: async () => { app.unmount(); await settle(); assert.deepEqual(errors, []); } };
}
const control = label => document.querySelector('button[aria-label="' + label + '"]');

test('代码复制和下载保留原始文本，模型伪造按钮没有控制权限', async () => {
  const fixture = await mount(block('typescript', 'const title = "<b>QGauss</b>";') + '\n\n<button class="qg-code-action">伪造复制</button>');
  try {
    control('复制代码').click(); await settle();
    assert.deepEqual(copied, ['const title = "<b>QGauss</b>";\n']);
    control('下载代码').click(); await settle();
    assert.equal(downloads[0].name, 'qgauss-code.ts');
    assert.equal(await downloads[0].blob.text(), copied[0]);
    [...document.querySelectorAll('button')].find(node => node.textContent === '伪造复制').click(); await settle();
    assert.equal(copied.length, 1);
  } finally { await fixture.close(); }
});
test('流式阶段不解析公式或代码，完成后再创建工具栏与公式', async () => {
  const fixture = await mount('$x$\n\n' + block('js', 'a()'), { streaming: true });
  try {
    assert.equal(document.querySelector('.qg-code-card'), null);
    assert.equal(fixture.calls.length, 0);
    fixture.state.streaming = false; await settle();
    assert.ok(document.querySelector('.qg-code-card'));
    assert.ok(document.querySelector('.katex'));
  } finally { await fixture.close(); }
});
test('图表与源码可切换，SVG 与 Mermaid 源文件可分别下载', async () => {
  const source = 'flowchart LR\nA-->B', fixture = await mount(block('mermaid', source));
  try {
    assert.ok(document.querySelector('.qg-diagram-canvas svg'));
    control('切换图表缩放').click(); await settle();
    assert.equal(control('切换图表缩放').getAttribute('aria-pressed'), 'true');
    assert.equal(fixture.calls.filter(call => call[0] === 'diagram').length, 1);
    control('切换图表与源码').click(); await settle();
    assert.equal(document.querySelector('.qg-diagram-card pre').hidden, false);
    assert.equal(document.querySelector('.qg-diagram-canvas').hidden, true);
    control('下载代码').click(); control('下载 SVG 图表').click(); await settle();
    assert.deepEqual(downloads.map(item => item.name), ['qgauss-code.mmd', 'qgauss-diagram.svg']);
    assert.equal(await downloads[0].blob.text(), source + '\n');
    assert.match(await downloads[1].blob.text(), /<svg/);
    control('切换图表与源码').click(); await settle();
    assert.equal(document.querySelector('.qg-diagram-canvas').hidden, false);
  } finally { await fixture.close(); }
});
test('图表引擎失败保留源码，重试后恢复而不重新发送问题', async () => {
  const fixture = await mount('');
  try {
    let attempts = 0;
    globalThis.qgaussRichHandlers.diagram = async () => { attempts += 1; if (attempts === 1) throw Error('load failed'); return '<svg><rect/></svg>'; };
    fixture.state.content = block('mermaid', 'flowchart LR\nA-->B'); await settle();
    assert.match(document.querySelector('.qg-diagram-status').textContent, /源码已保留/);
    assert.equal(document.querySelector('.qg-diagram-card pre').hidden, false);
    control('切换图表与源码').click(); await settle();
    assert.equal(attempts, 2);
    assert.equal(document.querySelector('.qg-diagram-status').hidden, true);
  } finally { await fixture.close(); }
});
test('异步公式的迟到结果不能覆盖新回复', async () => {
  const fixture = await mount('');
  try {
    const pending = new Map();
    globalThis.qgaussRichHandlers.math = source => new Promise(resolve => pending.set(source, resolve));
    fixture.state.content = '$old$'; await settle();
    fixture.state.content = '$new$'; await settle();
    pending.get('new')('<span class="katex">new output</span>'); await settle();
    pending.get('old')('<span class="katex">old output</span>'); await settle();
    assert.match(document.querySelector('.qg-md').textContent, /new output/);
    assert.ok(!document.querySelector('.qg-md').textContent.includes('old output'));
  } finally { await fixture.close(); }
});
test('卸载后图表迟到不挂回页面，也不产生未处理异常', async () => {
  const fixture = await mount('');
  let finish;
  globalThis.qgaussRichHandlers.diagram = () => new Promise(resolve => { finish = resolve; });
  fixture.state.content = block('mermaid', 'mindmap\n  root\n    child'); await settle();
  await fixture.close();
  finish('<svg><rect/></svg>'); await settle();
  assert.equal(document.querySelector('.qg-diagram-card'), null);
});

async function mountOutline() {
  setLang('zh');
  const scroller = document.querySelector('#scroll'); scroller.innerHTML = '<article data-qg-turn="0" tabindex="-1">第一个问题</article><article data-qg-turn="2" tabindex="-1">第二个问题</article>';
  scroller.getBoundingClientRect = () => ({ top: 100 }); scroller.scrollTop = 30;
  [...scroller.children].forEach((node, index) => { node.getBoundingClientRect = () => ({ top: 130 + index * 300 }); });
  const positions = []; scroller.scrollTo = position => positions.push(position);
  const state = reactive({ entries: [{ index: 0, label: '第一个问题' }, { index: 2, label: '第二个问题' }], scroller, threadKey: 'one' });
  let navigations = 0;
  const app = createApp({ render: () => h(ConversationOutline, { ...state, onNavigate: () => { navigations += 1; } }) });
  app.mount('#mount'); await settle();
  return { app, state, scroller, positions, navigations: () => navigations, close: () => app.unmount() };
}
test('阅读语言原位更新，图表缩放、源码视图、滚动和渲染结果沿用原内容', async () => {
  const source='flowchart LR\n  A[费用待确认]-->B[自己的文字]';
  const fixture=await mount(block('mermaid',source));
  try {
    const graphic=document.querySelector('.qg-diagram-canvas svg'),pre=document.querySelector('.qg-code-card pre');
    control('切换图表缩放').click();await settle();pre.scrollLeft=51;
    setLang('en');await settle();
    assert.equal(document.querySelector('.qg-diagram-canvas svg'),graphic);
    assert.equal(graphic.style.minWidth,'0');
    assert.equal(pre.scrollLeft,51);
    assert.equal(control('Change diagram scale').textContent,'Actual size');
    const toggle=control('Switch between diagram and source');toggle.click();await settle();
    assert.equal(pre.hidden,false);
    setLang('zh-TW');await settle();
    assert.equal(document.querySelector('.qg-diagram-canvas svg'),graphic);
    assert.equal(pre.hidden,false);
    assert.equal(pre.scrollLeft,51);
    assert.equal(toggle.getAttribute('aria-pressed'),'true');
    assert.match(toggle.textContent,/圖表/);
    assert.equal(document.querySelector('.qg-code-card code').textContent,source+'\n');
    assert.equal(fixture.calls.filter(row=>row[0]==='diagram').length,1);
  } finally {await fixture.close();setLang('zh');}
});

test('对话目录定位到问题，并让焦点跟随目标消息', async () => {
  const fixture = await mountOutline();
  try {
    control('打开对话目录').click(); await settle();
    document.querySelectorAll('.qg-outline-panel ol button')[1].click(); await settle();
    assert.equal(fixture.positions[0].top, 340);
    assert.equal(fixture.navigations(), 1);
    assert.equal(document.activeElement, fixture.scroller.children[1]);
    assert.equal(document.querySelector('.qg-outline-panel'), null);
  } finally { fixture.close(); }
});
test('目录 Esc 不冒泡到生成停止逻辑，外部点击与会话切换都会关闭目录', async () => {
  const fixture = await mountOutline();
  let stops = 0;
  const parentEscape = event => { if (event.key === 'Escape') stops += 1; };
  document.addEventListener('keydown', parentEscape);
  try {
    control('打开对话目录').click(); await settle();
    document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); await settle();
    assert.equal(stops, 0);
    assert.equal(document.activeElement, control('打开对话目录'));
    control('打开对话目录').click(); await settle();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); await settle();
    assert.equal(document.querySelector('.qg-outline-panel'), null);
    control('打开对话目录').click(); await settle();
    fixture.state.threadKey = 'two'; await settle();
    assert.equal(document.querySelector('.qg-outline-panel'), null);
  } finally { document.removeEventListener('keydown', parentEscape); fixture.close(); }
});
