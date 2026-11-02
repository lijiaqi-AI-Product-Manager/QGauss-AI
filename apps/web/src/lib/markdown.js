import { Marked } from 'marked';
import { mathExtensions } from './math-tokens.js';
export { escapeHtml } from './markdown-escape.js';

/**
 * Markdown 渲染。
 *
 * 模型输出属于**不可信输入**：提示注入可以让它吐出带 onerror 的 img、
 * javascript: 链接、甚至 iframe。所以这里的约定是：
 *   渲染 → 必须过 sanitize → 才允许进 DOM
 *
 * sanitize 由调用方注入：
 *   - 浏览器：DOMPurify.sanitize
 *   - 测试：jsdom + DOMPurify
 * 这样 markdown.js 本身不依赖 DOM，可以在任何环境跑。
 */
const markdown = new Marked({ gfm: true, breaks: true });
markdown.use({ extensions: mathExtensions });

export function renderMarkdown(text, sanitize) {
  const raw = markdown.parse(text ?? '', { async: false });
  return typeof sanitize === 'function' ? sanitize(raw) : raw;
}

/** HTML 转义：流式过程中先按纯文本显示，避免半截 Markdown 抖动 */
