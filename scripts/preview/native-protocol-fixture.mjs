/** Clearly synthetic data for native-protocol settings and usage-source presentation. */
export function nativeProtocolChannels() {
  return [
    ['OPENAI', 'Chat 兼容观察渠道', 'https://api.openai.com/v1'],
    ['OPENAI_RESPONSES', 'Responses 观察渠道', 'https://api.openai.com/v1'],
    ['ANTHROPIC', 'Messages 观察渠道', 'https://api.anthropic.com/v1'],
    ['GEMINI', 'Gemini 观察渠道', 'https://generativelanguage.googleapis.com/v1beta'],
  ].map(([type, name, baseUrl], index) => ({ id: 'qg-protocol-' + index, name: 'QGauss ' + name, type, baseUrl, hasApiKey: false, apiKeyMasked: '', priority: index, weight: 1, timeoutMs: 60000, status: 'ENABLED', poolKeys: 0, poolKeysEnabled: 0, modelCount: 1 }));
}
export function nativeProtocolMessages() {
  return [
    { id: 'native-u1', role: 'USER', status: 'COMPLETED', content: '这轮对话用了多少？' },
    { id: 'native-a1', parentId: 'native-u1', role: 'ASSISTANT', status: 'COMPLETED', content: '这是**本地演示样例**，没有调用真实模型。\n\n模型服务报送了用量时，回复下方会保留该来源；没有报送时，明确显示估算，不把两个口径混在一起。', promptTokens: 19, completionTokens: 11, usageEstimated: false },
    { id: 'native-u2', role: 'USER', status: 'COMPLETED', content: '如果服务没有返回用量呢？' },
    { id: 'native-a2', parentId: 'native-u2', role: 'ASSISTANT', status: 'COMPLETED', content: '这也是**合成观察样例**。没有服务方报送信息时，平台沿用估算，并在这里注明。次数结算仍按接受时的规则执行。', promptTokens: 7, completionTokens: 4, usageEstimated: true },
    { id: 'native-u3', role: 'USER', status: 'COMPLETED', content: '到输出上限后，还能继续吗？' },
    { id: 'native-a3', parentId: 'native-u3', role: 'ASSISTANT', status: 'COMPLETED', finishReason: 'length', content: '这段合成文字用于观察**输出上限提示**。已有内容会保留，是否继续由你决定。', promptTokens: 23, completionTokens: 12, usageEstimated: false },
  ];
}
