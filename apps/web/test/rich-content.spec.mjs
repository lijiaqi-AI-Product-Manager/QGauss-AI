import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import katex from 'katex';
import { renderMarkdown } from '../src/lib/markdown.js';
import { readMath } from '../src/lib/math-tokens.js';
import { mathHtml, diagramSource, diagramSvg, codeFileName, MAX_MATH_LENGTH, MAX_DIAGRAM_LENGTH } from '../src/lib/rich-security.js';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
const purify = createDOMPurify(window);
const md = text => renderMarkdown(text, html => purify.sanitize(html, { USE_PROFILES: { html: true } }));
const math = source => mathHtml(katex, source, false, purify);
const parse = html => new JSDOM(html).window.document;

test('四种数学定界符在 Markdown 转义前保留，公式中的星号不变成强调', () => {
  for (const source of ['$x*y$', '$$x^2$$', '\\(x+y\\)', '\\[\\frac{a}{b}\\]']) {
    const node = parse(md(source)).querySelector('.qg-md-math');
    assert.equal(node?.textContent, source);
  }
  assert.equal(parse(md('$x*y$')).querySelector('em'), null);
});
test('行间公式保留换行和 TeX，嵌套列表也能识别', () => {
  const html = md('公式：\n\n$$\n\\sum_{i=1}^{n} i\n$$\n\n- 行内 \\(a+b\\)');
  assert.equal(parse(html).querySelectorAll('.qg-md-math').length, 2);
  assert.ok(parse(html).querySelector('.qg-md-math-block'));
});
test('货币、转义美元、未闭合表达式保持正文', () => {
  for (const source of ['售价 $5 和 $10', '\\$x$', '$ 没有闭合', '\\(未闭合', '$a\nb$']) assert.equal(parse(md(source)).querySelector('.qg-md-math'), null, source);
});
test('行内代码、代码块和链接地址里的定界符不会被公式吞掉', () => {
  const tick = String.fromCharCode(96), fence = tick.repeat(3);
  const html = md(tick + '$x$' + tick + '\n\n' + fence + 'tex\n\\(a\\)\n' + fence + '\n\n[资料](https://qgauss.example/$x$)');
  assert.equal(parse(html).querySelector('.qg-md-math'), null);
  assert.equal(parse(html).querySelector('pre code').textContent, '\\(a\\)\n');
});
test('数学标记中的 HTML 仍先经过转义与消毒', () => {
  const html = md('$<img src=x onerror=alert(1)>$');
  assert.equal(parse(html).querySelector('img'), null);
  assert.match(parse(html).querySelector('.qg-md-math').textContent, /<img/);
});
test('真实 KaTeX 输出视觉 HTML 和可访问 MathML', () => {
  const result = parse(math('\\frac{a}{b}+\\sqrt{x}'));
  assert.ok(result.querySelector('.katex-html'));
  assert.ok(result.querySelector('math mfrac'));
  assert.ok(result.querySelector('annotation'));
  assert.ok(result.querySelector('.katex-html svg path'),'根号图形必须和可访问公式一起保留');
  assert.equal(result.querySelector('svg a,svg image,svg use,svg script,svg animate,[href],[xlink\\:href]'),null);
});
test('公式不允许外链、图片或注入 HTML 属性', () => {
  for (const source of ['\\href{javascript:alert(1)}{点我}', '\\includegraphics{https://bad.example/a.png}', '\\htmlClass{fixed}{x}']) {
    const result = parse(math(source));
    assert.equal(result.querySelector('a,img,script,[onerror],.fixed'), null);
  }
});
test('数学宏不跨表达式共享，循环宏与超长公式不会无限展开', () => {
  math('\\gdef\\qgaussmacro{a}\\qgaussmacro');
  assert.throws(() => math('\\qgaussmacro'));
  assert.throws(() => math('\\def\\loop{\\loop}\\loop'));
  assert.throws(() => math('x'.repeat(MAX_MATH_LENGTH + 1)), /过长/);
});
test('模型指定的 Mermaid 配置被忽略，正常图形语法保留', () => {
  const source = '---\nconfig:\n  securityLevel: loose\n---\n%%{init: {"themeCSS":"bad","maxEdges":9999}}%%\nflowchart LR\nA-->B';
  assert.equal(diagramSource(source), 'flowchart LR\nA-->B');
  assert.throws(() => diagramSource('%%{init: {}\nflowchart LR\nA-->B'), /未闭合/);
  assert.throws(() => diagramSource('x'.repeat(MAX_DIAGRAM_LENGTH + 1)), /过长/);
});
test('SVG 移除外链、可执行节点、模型样式与动画，下载使用同一消毒结果', () => {
  const svg = diagramSvg('<svg viewBox="0 0 100 100"><style>@import url(https://bad.example/);.evil{fill:red}</style><script>alert(1)</script><foreignObject><iframe src="https://bad.example"></iframe></foreignObject><image href="https://bad.example/a.png"/><a href="javascript:alert(1)"><text>链接</text></a><rect width="20" height="20" style="fill:url(https://bad.example)" onload="alert(1)"/><animate attributeName="href" to="javascript:alert(1)"/></svg>', purify, 'qgauss-safe');
  assert.ok(!/bad\.example|javascript:|iframe|foreignObject|onload|animate|\.evil/.test(svg), svg);
  assert.ok(parse(svg).querySelector('rect'));
  assert.match(svg, /QGauss/);
});
test('渲染前移除模型样式指令，图形仍使用自有设计系统', () => {
  assert.equal(diagramSource('flowchart LR\nA-->B\nclassDef custom fill:red;\nstyle A fill:blue\nlinkStyle 0 stroke:red'), 'flowchart LR\nA-->B');
});
test('渲染前拒绝可能请求外部资源的图片与 CSS，不先加载再移除', () => {
  for (const source of ['flowchart LR\nA@{img:"https://bad.example/a.png"}', 'flowchart LR\nA["![图](https://bad.example/a.png)"]', 'flowchart LR;style A fill:url(https://bad.example)']) assert.throws(() => diagramSource(source), /资源|样式/);
});
test('SVG 内部 marker 与 ARIA 引用改为本次图表独有 ID', () => {
  const source = '<svg viewBox="0 0 100 100" aria-labelledby="chart-title"><title id="chart-title">流程</title><defs><marker id="arrow"><path d="M0 0L5 5"/></marker></defs><path id="edge" marker-end="url(#arrow)" d="M0 0L50 50"/></svg>';
  const first = diagramSvg(source, purify, 'qgauss-one'), second = diagramSvg(source, purify, 'qgauss-two');
  assert.match(first, /url\(#qgauss-one-/);
  assert.match(second, /url\(#qgauss-two-/);
  assert.ok(!/id="(?:arrow|title|edge)"/.test(first));
  assert.match(first, /aria-labelledby="qgauss-one-/);
});
test('SVG presentation 属性只允许内部资源引用', () => {
  const svg = diagramSvg('<svg><rect fill="url(https://bad.example/a)" filter="url(//bad.example/b)" width="10" height="10"/></svg>', purify, 'qgauss-local');
  assert.ok(!svg.includes('bad.example'));
});
test('空 SVG 与无图形结果有明确错误，文件扩展名不由模型任意控制', () => {
  assert.throws(() => diagramSvg('<svg/>', purify, 'qgauss-empty'), /内容/);
  assert.equal(codeFileName('typescript'), 'qgauss-code.ts');
  assert.equal(codeFileName('mermaid'), 'qgauss-code.mmd');
  assert.equal(codeFileName('../../run.exe'), 'qgauss-code.txt');
});
