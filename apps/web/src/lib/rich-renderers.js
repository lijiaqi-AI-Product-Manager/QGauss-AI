import DOMPurify from 'dompurify';
import mathStyleUrl from 'qgauss:math-style';
import { diagramSource, diagramSvg, mathHtml } from './rich-security.js';

let mathStyle, mathEngine, diagramEngine, diagramQueue = Promise.resolve(), diagramId = 0;
function loadMathStyle() {
  if (!mathStyle) mathStyle = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = mathStyleUrl;
    link.onload = resolve;
    link.onerror = () => { link.remove(); mathStyle = null; reject(new Error('公式样式未能加载，请稍后重试')); };
    document.head.appendChild(link);
  });
  return mathStyle;
}

export async function renderMath(source, display) {
  if (!mathEngine) mathEngine = import('katex').then(module => module.default).catch(error => { mathEngine = null; throw error; });
  const [engine] = await Promise.all([mathEngine, loadMathStyle()]);
  return mathHtml(engine, source, display, DOMPurify);
}

export function renderDiagram(source, isCurrent = () => true) {
  const cleaned = diagramSource(source);
  const task = diagramQueue.catch(() => {}).then(async () => {
    if (!isCurrent()) return '';
    if (!diagramEngine) diagramEngine = import('mermaid').then(module => module.default).catch(error => { diagramEngine = null; throw error; });
    const engine = await diagramEngine;
    if (!isCurrent()) return '';
    engine.initialize({
      startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
      maxTextSize: 20000, maxEdges: 300, theme: 'neutral',
      flowchart: { htmlLabels: false }, htmlLabels: false,
      secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'theme', 'themeCSS', 'htmlLabels', 'flowchart'],
    });
    const id = 'qgauss-diagram-' + (++diagramId);
    const stage = document.createElement('div');
    stage.setAttribute('aria-hidden', 'true');
    stage.style.cssText = 'position:fixed;left:-99999px;top:0;width:800px;visibility:hidden;pointer-events:none';
    document.body.appendChild(stage);
    try {
      const result = await engine.render(id, cleaned, stage);
      return diagramSvg(result.svg, DOMPurify, id);
    } finally { stage.remove(); }
  });
  diagramQueue = task;
  return task;
}
