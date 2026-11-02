import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';
import { renderMarkdown, escapeHtml } from '../src/lib/markdown.js';

const { window } = new JSDOM('<!doctype html><html><body></body></html>');
const purify = createDOMPurify(window);
const sanitize = (html) => purify.sanitize(html, { USE_PROFILES: { html: true } });

const render = (text) => renderMarkdown(text, sanitize);

test('基础语法：标题 / 列表 / 粗体', () => {
  const html = render('# 标题\n\n- 一\n- 二\n\n**粗体**');
  assert.match(html, /<h1[^>]*>标题<\/h1>/);
  assert.match(html, /<li>一<\/li>/);
  assert.match(html, /<strong>粗体<\/strong>/);
});

test('代码块保留语言标记', () => {
  const html = render('```ts\nconst a: number = 1;\n```');
  assert.match(html, /<code class="language-ts"/);
  assert.match(html, /const a: number = 1;/);
});

test('表格（GFM）', () => {
  const html = render('| a | b |\n| - | - |\n| 1 | 2 |');
  assert.match(html, /<table>/);
  assert.match(html, /<td>1<\/td>/);
});

test('XSS：script 标签被移除', () => {
  const html = render('hello <script>alert(1)</script> world');
  assert.ok(!html.includes('<script'), html);
  assert.ok(html.includes('hello'));
});

test('XSS：img onerror 属性被剥离', () => {
  const html = render('<img src="x" onerror="alert(1)">');
  assert.ok(!/onerror/i.test(html), html);
});

test('XSS：javascript: 链接被清理', () => {
  const html = render('[点我](javascript:alert(1))');
  assert.ok(!/javascript:/i.test(html), html);
});

test('XSS：iframe / onload 被移除', () => {
  const html = render('<iframe src="//evil"></iframe><div onload="x()">t</div>');
  assert.ok(!html.includes('<iframe'), html);
  assert.ok(!/onload/i.test(html), html);
});

test('流式阶段用 escapeHtml，不解释标签', () => {
  const html = escapeHtml('<b>还没写完的 markdown');
  assert.equal(html, '&lt;b&gt;还没写完的 markdown');
  assert.ok(!html.includes('<b>'));
});

test('空输入不报错', () => {
  assert.equal(render(''), '');
  assert.equal(render(undefined), '');
});
