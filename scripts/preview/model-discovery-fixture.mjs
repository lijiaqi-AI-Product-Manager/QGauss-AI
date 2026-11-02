/** Synthetic configuration, not provider pricing or measured model performance. All mutations stay disabled. */
export function modelDiscoveryFixtures() {
  const entries = [
    ['qgauss-reference', 'QGauss 灵感模型', 'QGauss Lab', ['chat', 'vision'], 128000, 8192, true, 1, '把模糊的念头聊清楚，也能读懂你带来的图片。', 'NEW'],
    ['qgauss-reason', 'QGauss 深思模型', 'QGauss Lab', ['chat', 'reasoning'], 200000, 16384, true, 3, '陪你拆解复杂问题，把推理和下一步整理得更清楚。', ''],
    ['qgauss-long', 'QGauss 长文搭档', 'QGauss Core', ['chat', 'long'], 1000000, 32768, true, 2, '面对长资料与多轮讨论，让线索和上下文保持连贯。', ''],
    ['qgauss-image-studio', 'QGauss 图像工作室', 'QGauss Vision', ['image', 'vision'], 32768, 8192, true, 0, '从一句描述或一张参考图出发，把想象变成新的画面。', ''],
    ['qgauss-tool', 'QGauss 工具搭档', 'QGauss Core', ['chat', 'tools'], 128000, 8192, true, 2, '为结构化工作流提供文字能力，工具是否可用由当前应用决定。', ''],
    ['qgauss-offline', 'QGauss 视觉探索', 'QGauss Vision', ['chat', 'vision'], 64000, 4096, false, 1, '这是尚未接入的配置样例，可以查看参数并加入对照。', ''],
    ['qgauss-light', 'QGauss 轻快模型', 'QGauss Core', ['chat'], 32000, 4096, true, 0, '日常问答、短文整理和小灵感，轻松开始新的对话。', ''],
    ['qgauss-code', 'QGauss 代码搭档', 'QGauss Lab', ['chat', 'reasoning'], 256000, 16384, true, 3, '一起读代码、梳理思路，再把问题一步步拆开。', ''],
    ['qgauss-notes', 'QGauss 笔记模型', 'QGauss Core', ['chat'], 64000, 8192, true, 1, '整理散落的记录，让零碎的信息变成清楚的脉络。', ''],
    ['qgauss-explore', 'QGauss 创意探索', 'QGauss Lab', ['chat', 'vision'], 131072, 8192, true, 2, '换个角度看问题，为你的创作准备几个新的方向。', ''],
    ['qgauss-research', 'QGauss 研究模型', 'QGauss Core', ['chat', 'reasoning', 'tools'], 200000, 16384, false, 3, '尚未接入的研究配置样例，用于观察维护状态与参数对照。', ''],
  ];
  const models = entries.map(([name, displayName, vendor, capabilities, maxContext, maxOutput, ready, amount, description, badge], index) => ({ id: 'qg-model-' + index, name, displayName, vendor, capabilities, maxContext, maxOutput, ready, description, badge, tags: ['演示配置'], priceInPerM: index === 0 ? 3 : (index + 1) * 100000, priceOutPerM: (index + 1) * 400000, countPool: amount ? 'model4' : '', countCost: amount, billing: amount ? { mode: 'count', pool: 'model4', amount, reason: 'configured' } : { mode: 'none', pool: null, amount: 0, reason: 'no-count-config' } }));
  const vendors = [...new Set(models.map(model => model.vendor))].map(key => ({ key, label: key, count: models.filter(model => model.vendor === key).length }));
  const counts = { model3: 20, model4: 8, drawMj: 12, agent: 5 };
  const channel = { id: 'qg-fixture-channel', name: 'QGauss 模拟接入', type: 'MOCK', baseUrl: 'mock://model-catalog-fixture', status: 'ENABLED', weight: 1, priority: 0, timeoutMs: 60000, hasApiKey: false, apiKeyMasked: '', poolKeys: 0, poolKeysEnabled: 0 };
  return {
    '/api/settings/public': { 'commerce.enabled': true, 'demo.siteEnabled': false, 'site.name': 'QGauss AI' },
    '/api/balance/query': { counts, member: { model3: 0, model4: 0, drawMj: 0, agent: 0 }, paid: counts, used: { model3: 0, model4: 0, drawMj: 0, agent: 0 }, reserved: { model3: 0, model4: 0, drawMj: 0, agent: 0 }, balanceCents: 0, isMember: false },
    '/api/models/plaza': { total: models.length, ready: models.filter(model => model.ready).length, vendors, models },
    '/api/models/available': models,
    '/api/image/options': { cats: [], ratios: [{ key: '1:1', w: 1, h: 1, scene: '方形' }, { key: '3:4', w: 3, h: 4, scene: '肖像' }, { key: '16:9', w: 16, h: 9, scene: '横幅' }], resolutions: [{ key: '1K', label: '1K' }, { key: '2K', label: '2K' }, { key: '4K', label: '4K' }], models: models.filter(model => model.capabilities.includes('image')), billing: { enabled: true, costPerImage: 1, qualityFactors: { auto: 1, low: 1, medium: 1, high: 2 }, reservation: true } },
    '/api/models': models.map(model => ({ ...model, capabilities: model.capabilities, tags: model.tags.join(','), status: 'ENABLED', sort: 0, channels: model.ready ? [{ channelId: channel.id, channelName: channel.name, channelType: channel.type, channelStatus: channel.status, upstreamName: model.name, weight: 1, enabled: true }] : [] })),
    '/api/models/channels': [channel],
  };
}
