export const MATH_OPTIONS = Object.freeze({ trust: false, throwOnError: true, strict: 'ignore', output: 'htmlAndMathml', maxExpand: 500, maxSize: 20 });
export const MAX_MATH_LENGTH = 16000;
export const MAX_DIAGRAM_LENGTH = 20000;

export function mathHtml(engine, source, display, purify) {
  if (source.length > MAX_MATH_LENGTH) throw new Error('公式过长，已保留源码');
  const html = engine.renderToString(source, { ...MATH_OPTIONS, displayMode: display, macros: {} });
  return purify.sanitize(html, { USE_PROFILES: { html: true, mathMl: true }, ADD_TAGS: ['annotation'], ADD_ATTR: ['encoding'], FORBID_TAGS: ['style'] });
}

export function diagramSource(source) {
  if (source.length > MAX_DIAGRAM_LENGTH) throw new Error('图表过长，请下载源码查看');
  const cleaned = source.replace(/^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/, '').replace(/%%\{[\s\S]*?\}%%/g, '')
    .replace(/^[ \t]*(?:classDef|style|linkStyle)\b[^\r\n]*(?:\r?\n|$)/gm, '');
  if (cleaned.includes('%%{')) throw new Error('图表配置未闭合，请检查源码');
  if (/url\s*\(|@import|!\[|@\{[^}]*\b(?:img|icon)\s*:|(?:^|;)\s*(?:classDef|style|linkStyle)\s/i.test(cleaned)) throw new Error('图表包含外部资源或内嵌样式，请查看源码');
  return cleaned.trim();
}

/** Only self-contained, static SVG reaches the live page or downloaded file. */
export function diagramSvg(svg, purify, prefix) {
  const fragment = purify.sanitize(svg, {
    USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM_FRAGMENT: true,
    FORBID_TAGS: ['style', 'foreignObject', 'image', 'a', 'script', 'animate', 'animateMotion', 'animateTransform', 'set'],
    FORBID_ATTR: ['style', 'href', 'xlink:href'],
  });
  const root = fragment.querySelector('svg');
  if (!root || !root.querySelector('path,rect,circle,ellipse,polygon,line,text')) throw new Error('图表没有可显示的内容');
  const ids = new Map();
  for (const element of [root, ...root.querySelectorAll('*')]) {
    if (element.id) { const old = element.id; const next = prefix + '-' + ids.size; ids.set(old, next); element.id = next; }
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(), value = attribute.value;
      if (/url\s*\(/i.test(value)) {
        const reference = /^url\(\s*["']?#([^"')\s]+)["']?\s*\)$/.exec(value);
        if (reference && ids.has(reference[1])) element.setAttribute(attribute.name, 'url(#' + ids.get(reference[1]) + ')');
        else element.removeAttribute(attribute.name);
      } else if (name === 'aria-labelledby' || name === 'aria-describedby') {
        const references = value.split(/\s+/).map(id => ids.get(id)).filter(Boolean).join(' ');
        if (references) element.setAttribute(attribute.name, references); else element.removeAttribute(attribute.name);
      } else if (/^(?:fill|stroke|color)$/.test(name) && !/^(?:none|currentColor|transparent|[a-z]+|#[\da-f]{3,8}|rgba?\([\d.,% ]+\)|hsla?\([\d.,% ]+\))$/i.test(value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  root.removeAttribute('width'); root.removeAttribute('height');
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  root.setAttribute('role', 'img');
  root.setAttribute('aria-label', 'QGauss 生成的图表');
  if (!root.id) root.id = prefix + '-root';
  const scope = '#' + root.id;
  const style = root.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'style');
  style.textContent = scope + '{font:14px system-ui,sans-serif;color:var(--qg-text,#28304a)}' +
    scope + ' text{fill:var(--qg-text,#28304a);font-family:system-ui,sans-serif}' +
    scope + ' rect,' + scope + ' circle,' + scope + ' ellipse,' + scope + ' polygon,' + scope + ' .node path{fill:var(--qg-brand-soft,#eee9ff);stroke:var(--qg-brand,#7354e9);stroke-width:1.2px}' +
    scope + ' .flowchart-link,' + scope + ' .edgePath path,' + scope + ' .edgePaths path,' + scope + ' .messageLine0,' + scope + ' .messageLine1,' + scope + ' .mindmap-edges path{fill:none;stroke:var(--qg-sub,#6c748c);stroke-width:1.5px}' +
    scope + ' marker path,' + scope + ' .arrowheadPath{fill:var(--qg-sub,#6c748c);stroke:var(--qg-sub,#6c748c)}' +
    scope + ' .edgeLabel rect,' + scope + ' .labelBox{fill:var(--qg-panel,#fff);stroke:none}' +
    scope + ' .label rect,' + scope + ' .label .background{fill:none;stroke:none}' +
    scope + ' .actor-line{stroke:var(--qg-border,#ced1de)}';
  root.prepend(style);
  return root.outerHTML;
}

const EXTENSIONS = { javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts', python: 'py', py: 'py', html: 'html', css: 'css', json: 'json', yaml: 'yml', yml: 'yml', shell: 'sh', bash: 'sh', sh: 'sh', sql: 'sql', java: 'java', c: 'c', cpp: 'cpp', rust: 'rs', go: 'go', vue: 'vue', markdown: 'md', md: 'md', mermaid: 'mmd', svg: 'svg', xml: 'xml', text: 'txt', plaintext: 'txt' };
export function codeFileName(language) {
  return 'qgauss-code.' + (EXTENSIONS[String(language).toLowerCase()] || 'txt');
}
