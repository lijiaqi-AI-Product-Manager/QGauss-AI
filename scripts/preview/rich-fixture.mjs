/** Synthetic content for observing real reply components; no provider or writable API. */
const fence = String.fromCharCode(96).repeat(3);
const code = (language, source) => fence + language + '\n' + source + '\n' + fence;
const turns = [
  ['请用一个公式和一段代码，把创作目标变得清晰可衡量。',
    '## 让想法，有一个落点\n\n把大目标拆成今天能完成的一小步。进展可以用 $p=\\frac{d}{n}\\times100\\%$ 表示。\n\n\\[\\text{今日进展}=\\frac{3}{5}\\times100\\%=60\\%\\]\n\n' + code('javascript', 'const plan = { product: "QGauss AI", completed: 3, total: 5 };\nconst progress = Math.round(plan.completed / plan.total * 100);\nconsole.log("今天的进展：" + progress + "%");') + '\n\n这是本地观察样例，复制与下载使用卡片中的原始代码。'],
  ['把创作过程画成流程图，让每一步都有反馈。',
    '## 从灵感，到作品\n\n先做一个小版本，再让反馈带来下一次迭代。\n\n' + code('mermaid', 'flowchart LR\n  A[捕捉灵感] --> B[做个小版本]\n  B --> C{收集反馈}\n  C -->|继续完善| B\n  C -->|已经清晰| D[发布作品]') + '\n\n图表与源码可以切换，也可以分别下载。'],
  ['再给我一张思维导图，梳理这次创作的三个重点。',
    '## 为想法，留一点生长空间\n\n' + code('mermaid', 'mindmap\n  root((创作计划))\n    好点子\n      观察日常\n      记录灵感\n    小行动\n      快速尝试\n      每日一小步\n    有反馈\n      分享作品\n      持续完善') + '\n\n三个分支一起推进，让计划保持轻盈，也有方向。'],
];
export function richMessages(error = false) {
  return turns.flatMap(([question, answer], index) => {
    const userId = 'qgauss-rich-user-' + index;
    const content = error && index === turns.length - 1 ? '公式或图表暂时无法呈现时，保留原内容，方便继续修改。\n\n$\\qgaussUnknownCommand{x}$\n\n' + code('mermaid', 'qgauss-not-a-diagram\nA -> B') : answer;
    return [{ id: userId, role: 'USER', content: question }, { id: 'qgauss-rich-assistant-' + index, role: 'ASSISTANT', parentId: userId, content, status: 'COMPLETED' }];
  });
}
