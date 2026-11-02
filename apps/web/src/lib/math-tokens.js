import { escapeHtml } from './markdown-escape.js';

function escaped(text, at) {
  let count = 0;
  while (at > 0 && text[--at] === '\\') count += 1;
  return count % 2 === 1;
}

/** Tokenize before Markdown consumes TeX backslashes; code spans/fences keep their grammar. */
export function readMath(text, blockOnly = false) {
  const pair = [['$$', '$$', true], ['\\[', '\\]', true], ['\\(', '\\)', false], ['$', '$', false]]
    .find(([left, , display]) => text.startsWith(left) && (!blockOnly || display));
  if (!pair) return;
  const [left, right, display] = pair;
  if (left === '$' && (/\s/.test(text[1] || '') || text[1] === '$')) return;
  let end = text.indexOf(right, left.length);
  while (end !== -1) {
    if (!escaped(text, end)) {
      const body = text.slice(left.length, end);
      const next = text[end + right.length] || '';
      const currency = left === '$' && (/\s$/.test(body) || /\d/.test(next) || body.includes('\n'));
      if (body.trim() && !currency) {
        const raw = text.slice(0, end + right.length);
        if (blockOnly && !/^[ \t]*(?:\r?\n|$)/.test(text.slice(raw.length))) return;
        return { raw, math: body.trim(), display };
      }
    }
    end = text.indexOf(right, end + right.length);
  }
}

const renderer = token => '<span class="qg-md-math' + (token.display ? ' qg-md-math-block' : '') + '">' + escapeHtml(token.raw) + '</span>';
export const mathExtensions = [
  {
    name: 'qgBlockMath', level: 'block',
    start: text => text.search(/(?:^|\n)(?:\$\$|\\\[)/),
    tokenizer(text) { const token = readMath(text, true); if (token) return { type: 'qgBlockMath', ...token }; },
    renderer,
  },
  {
    name: 'qgInlineMath', level: 'inline',
    start: text => text.search(/\$|\\[([]/),
    tokenizer(text) { const token = readMath(text); if (token) return { type: 'qgInlineMath', ...token }; },
    renderer,
  },
];
