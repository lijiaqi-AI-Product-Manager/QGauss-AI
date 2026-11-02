/** Explicit synthetic artwork data for local visual QA, never included in the production entry. */
export function artworkFixtures() {
  const make = (id, prompt, status, extra = {}) => ({ id, prompt, status, model: 'qgauss-image-demo', versionName: 'QGauss 图像样例', ratio: '3:4', resolution: '1K', quality: 'auto', mode: 'text2img', n: 2, seed: 0, catId: null, size: '768x1024', progress: status === 'SUCCESS' ? 100 : 44, published: false, mine: true, createdAt: '2026-10-31T06:00:00Z', results: [], events: [{ id: id + '-event', status, message: status === 'SUCCESS' ? '生成完成：本地合成观察数据' : '本地合成任务状态', createdAt: '2026-10-31T06:00:20Z' }], ...extra });
  const pair = [
    { fileId: 'qg-art-companion', url: '/art/qgauss-companion.png', mime: 'image/png' },
    { fileId: 'qg-art-play', url: '/art/qgauss-play-sculpture.png', mime: 'image/png' },
  ];
  const mine = [
    make('qg-art-first', '把一个小小的灵感，放进透明玻璃与柔软云层。薰衣草、珍珠白和一点温柔的光。', 'SUCCESS', { results: pair, negativePrompt: '杂乱背景、过强对比' }),
    make('qg-art-running', '一座漂浮的云端工作室，玻璃、淡紫色与清晨的光。', 'RUNNING'),
    make('qg-art-lime', '一颗有光泽的青柠色 Q 形雕塑，软胶质感，带一点出其不意的快乐。', 'SUCCESS', { results: [pair[1]], n: 1, published: true }),
    make('qg-art-failed', '一个安静的几何庭院，米色拱门与柔和的影子。', 'FAILED', { errorMessage: '上游暂时没有返回图片。提示词与参数已保留，可以调整后重试。' }),
    make('qg-art-queued', '把星光收进一颗透明的小行星。', 'QUEUED', { progress: 0 }),
    make('qg-art-canceled', '试一试深蓝宇宙里的青紫色极光。', 'CANCELED'),
  ];
  const square = [make('qg-art-public', '一点青柠色，一点想象力。让日常的形状，长出新的可能。', 'SUCCESS', { results: [pair[1]], n: 1, mine: false, published: true, author: 'Q*观察员' })];
  return { mine, square };
}
