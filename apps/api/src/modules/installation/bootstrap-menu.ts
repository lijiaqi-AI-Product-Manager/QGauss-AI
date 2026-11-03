import type { Prisma } from '@prisma/client';

// Fresh installations get only working routes. This is navigation, not authorization.
export async function bootstrapMenu(tx: Prisma.TransactionClient) {
  const groups = [
    { title: '创作', path: '/content', icon: 'ChatLineSquare', roles: 'USER,ADMIN', children: [
      { title: '对话', path: '/chat', icon: 'ChatDotRound' }, { title: '模型广场', path: '/plaza', icon: 'Shop' },
      { title: '专业绘画', path: '/painting', icon: 'Picture' }, {title:'扩展工作台',path:'/extend',icon:'Grid'}, {title:'声音工作室',path:'/voice/create',icon:'Microphone'}, { title: '应用', path: '/apps', icon: 'Grid' },
    ] },
    { title: '空间管理', path: '/system', icon: 'Setting', roles: 'ADMIN', children: [
      { title: '启航清单', path: '/welcome', icon: 'Position' }, { title: '概览', path: '/statistic', icon: 'TrendCharts' },
      { title: '渠道管理', path: '/models/channels', icon: 'Connection' }, { title: '模型管理', path: '/models/list', icon: 'Files' },
      { title: '用户', path: '/users', icon: 'User' }, { title: '系统配置', path: '/settings', icon: 'Tools' },
      { title: '邮件投递台', path: '/mail', icon: 'Message' },
      { title: '声音控制台', path: '/voice/manage', icon: 'Microphone' },
      { title: '视频控制台', path: '/video/manage', icon: 'VideoCamera' }, {title:'扩展工具箱',path:'/extensions/manage',icon:'Grid'},
      { title: '敏感词', path: '/moderation', icon: 'Warning' }, { title: '聊天记录', path: '/chat-logs', icon: 'Document' },
      { title: '预设', path: '/presets', icon: 'MagicStick' },
    ] },
  ];
  for (const [sort, group] of groups.entries()) {
    const parent = await tx.menu.create({ data: { title: group.title, path: group.path, icon: group.icon, sort, roles: group.roles } });
    for (const [order, child] of group.children.entries()) await tx.menu.create({ data: { ...child, parentId: parent.id, roles: group.roles, sort: order } });
  }
}
