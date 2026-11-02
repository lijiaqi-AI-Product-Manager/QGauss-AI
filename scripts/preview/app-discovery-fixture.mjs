/** Synthetic application catalog for local, read-only visual review. */
export function appDiscoveryFixtures() {
  const categories = [{ id: 'qg-writing', name: '写作与表达' }, { id: 'qg-learning', name: '学习与研究' }, { id: 'qg-planning', name: '工作与规划' }, { id: 'qg-creative', name: '创意与灵感' }];
  const entries = [
    ['writer', '灵感写手', 0, '把散落的念头，写成让人想读下去的故事。标题、文案、长文，一起慢慢打磨。', '你好，我是灵感写手。\n把你脑海里的一小段想法交给我吧。它不需要完整，我们可以一起找到最有感染力的表达。', true],
    ['planner', '小步规划师', 2, '大目标不用一步走完。把复杂计划拆成今天就能开始的一小步。', '今天，想让哪件事情往前走一点？\n告诉我目标、时间和眼下的困难，我们一起排出一个能做到的计划。', true],
    ['teacher', '知识翻译官', 1, '给复杂知识换一种说法。用日常比喻，把陌生概念聊明白。', '欢迎来到小小知识站。\n有什么概念一直让你困惑？我会试着从一个生活中的例子说起。', false],
    ['idea', '点子碰撞机', 3, '换个角度，看见新的可能。产品创意、活动主题和脑洞，都可以在这里碰面。', '带来一个主题，或者一个还没想清楚的问题吧。\n我们先多想几个方向，再挑一个值得继续探索的点子。', false],
    ['research', '研究笔记员', 1, '整理观点、发现问题、搭建研究提纲。让零散的资料慢慢长出脉络。', '把你正在研究的问题告诉我。\n我们先明确目标，再整理已知的信息和还需要验证的疑问。', false],
    ['editor', '文字修枝师', 0, '删掉绕远的句子，留下清楚的表达。让你的文字，更像你自己。', '有一段想修改的文字吗？\n你可以告诉我读者是谁，希望保留什么语气。我们一起让它更清楚。', false],
    ['weekly', '周报整理员', 2, '把这一周做过的事，整理成有重点、有进展、也有下一步的周报。', '这周完成了哪些事情？\n给我几条零散记录也可以，我们一起梳理成果、问题和下周计划。', true],
    ['design', '创意陪跑员', 3, '从模糊的灵感，到能讨论的设计方向。陪你比较、推敲，再大胆试一点。', '最近在做什么有意思的设计？\n说说目标、使用场景和你喜欢的感觉，我们一起探索几个不同的方向。', false],
    ['study', '学习教练', 1, '把学习变成看得见的小进步。一起定目标、做练习，找到自己的节奏。', '你最近想学会什么？\n先聊聊你的基础和每周能投入的时间，我们再安排合适的节奏。', false],
    ['meeting', '会议梳理员', 2, '从讨论记录里提炼决定、待办和负责人。让会议之后，事情继续前进。', '把会议记录贴给我吧。\n我会先帮你区分讨论、决定和待办，你再核对细节。', false],
    ['story', '故事搭建师', 0, '角色、世界、冲突和转折。陪你把一句“如果”，写成一个新世界。', '我们从一个“如果”开始吧。\n你想写怎样的角色，或一个怎样的世界？', false],
    ['palette', '配色灵感师', 3, '给想法一点颜色。一起讨论色彩情绪、搭配关系和适合的使用场景。', '想用颜色表达什么感觉？\n告诉我项目和使用场景，我们试着比较几种配色方向。', false],
  ];
  const apps = entries.map(([key, name, category, description, greeting, favorited], index) => ({ id: 'qg-' + key,version:1, name, categoryId: categories[category].id, category: categories[category], description, greeting, defaultModel: index % 3 === 1 ? 'qgauss-reason' : 'qgauss-reference', favorited, published: true }));
  return { '/api/apps': apps, '/api/apps/categories': categories, ...Object.fromEntries(apps.map(app => ['/api/apps/' + app.id, app])) };
}
