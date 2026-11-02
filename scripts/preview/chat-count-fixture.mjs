/** Explicit local presentation data; never represents an actual model reply or financial account. */
export function chatCountMessages() {
  return [
    { id: 'count-u1', role: 'USER', content: '让每一次灵感，都有清楚的记录。', status: 'COMPLETED' },
    { id: 'count-a1', parentId: 'count-u1', role: 'ASSISTANT', status: 'COMPLETED', content: '这是**本地观察样例**，没有调用模型。\n\n对话开始时先预留本轮次数，完成后才记入实际消耗。你可以在回复下方回看当时的结算，也可以到创作能量舱查看对应记录。', billing: { state: 'SETTLED', pool: 'model3', limit: 2, reserved: 0, charged: 2, returned: 0, expired: 0 } },
    { id: 'count-u2', role: 'USER', content: '如果中途停止，次数会怎么样？', status: 'COMPLETED' },
    { id: 'count-a2', parentId: 'count-u2', role: 'ASSISTANT', status: 'ABORTED', content: '这段文字用于观察**停止后的回执**。未使用的购买次数会释放；已经跨日或到期的会员额度会单独说明，避免误以为它还能转入新一天。', billing: { state: 'RELEASED', pool: 'model3', limit: 3, reserved: 0, charged: 0, returned: 1, expired: 2 } },
    { id: 'count-u3', role: 'USER', content: '旧聊天也能看到费用吗？', status: 'COMPLETED' },
    { id: 'count-a3', parentId: 'count-u3', role: 'ASSISTANT', status: 'COMPLETED', content: '这是没有费用快照的**旧历史样例**。页面保留原回复，不给旧消息补造“免费”或“零消耗”的结论，也不会追补扣次。', billing: null },
  ];
}
