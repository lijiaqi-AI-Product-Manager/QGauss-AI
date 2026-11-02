/** Read-only visual data; these are synthetic sources, not an executed search. */
export function webSearchMessage(state = 'web-search') {
  const status = state === 'web-search-progress' ? 'searching' : state === 'web-search-empty' ? 'no_sources' : state === 'web-search-error' ? 'failed' : 'complete';
  const sources = status === 'complete' ? [
    {url:'https://sources.qgauss.test/light',title:'让柔光成为空间里的呼吸'},
    {url:'https://sources.qgauss.test/material',title:'有触感的玻璃与自然材质'},
    {url:'https://sources.qgauss.test/motion',title:'让每一次反馈都轻盈一点'},
  ] : [];
  const content = status === 'searching' ? '' : status === 'failed' ? '这次检索未能完成，保留问题后可以再次尝试。' : '## 把灵感，变成一处会呼吸的空间\n\n从柔和的光线开始，让玻璃、色彩和微小动效一起构成温暖的创作氛围。\n\n- **光影**：用偏暖的漫反射，给内容留出清楚的层次。\n- **材质**：透明玻璃与柔软颗粒相遇，让卡片有轻盈的厚度。\n- **反馈**：悬停、加载与完成，用克制的节奏传递状态。\n\n这是本地视觉样例。下方资料和编号均为合成展示，不代表真实联网结果。';
  const start = content.indexOf('温暖的创作氛围。') + '温暖的创作氛围。'.length;
  return {id:'qg-reference-assistant',role:'ASSISTANT',parentId:'qg-reference-user',status:status==='searching'?'STREAMING':status==='failed'?'FAILED':'COMPLETED',content,webSearch:{requested:true,status,sources,citations:sources.length?[{url:sources[0].url,start,end:start}]:[]}};
}
