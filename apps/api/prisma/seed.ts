/**
 * 种子数据（幂等，可重复执行）
 *
 * 开发种子包含管理员和演示内容；首次生产安装请使用 setup:guided。
 * MOCK 渠道不联网、不需要 Key，用于验证整条流式链路。
 */
import { PrismaClient } from '@prisma/client';
import { validateSeedAdminPassword } from '../src/common/config/env.check';
import { seedAdministrator } from '../src/modules/installation/seed-administrator';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

const prisma = new PrismaClient();
let dataLease: { close(): void } | undefined;

async function main() {
  const { sqliteFileFromUrl, acquireDataLease } = require('./data-lease.cjs');
  const file = join(__dirname,'../.env');
  const source = existsSync(file) ? parseEnv(readFileSync(file,'utf8')) : {};
  const database = sqliteFileFromUrl(process.env.DATABASE_URL ?? source.DATABASE_URL ?? 'file:./dev.db');
  if (database) dataLease = acquireDataLease(database);
  // ---------- 管理员 ----------
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@local.dev').toLowerCase();
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'admin123456';
  validateSeedAdminPassword(process.env.SEED_ADMIN_PASSWORD);

  const admin = await seedAdministrator(prisma, { email, username, password });
  console.log(`✔ admin: ${admin.email}（密码不输出到日志；已有账号密码保持不变）`);

  // ---------- 渠道 ----------
  const mockChannel = await prisma.channel.upsert({
    where: { name: '本地模拟' },
    create: {
      name: '本地模拟',
      type: 'MOCK',
      baseUrl: 'mock://local',
      priority: 0,
      weight: 1,
    },
    update: {},
  });

  const openaiChannel = await prisma.channel.upsert({
    where: { name: 'OpenAI 官方' },
    create: {
      name: 'OpenAI 官方',
      type: 'OPENAI',
      baseUrl: 'https://api.openai.com/v1',
      priority: 10,
      weight: 1,
    },
    update: {},
  });

  console.log(`✔ channels: ${mockChannel.name}, ${openaiChannel.name}`);

  // ---------- 模型 + 渠道绑定 ----------
  const specs = [
    {
      name: 'mock-chat',
      displayName: '模拟模型',
      channelId: mockChannel.id,
      upstreamName: 'mock',
      maxContext: 8192,
      maxOutput: 2048,
      sort: 0,
      vendor: '本地',
      description: '无需联网的本地模拟模型，用于演示与回归测试',
      tags: '测试,离线',
      badge: '',
      priceInPerM: 0,
      priceOutPerM: 0,
    },
    {
      name: 'gpt-4o-mini',
      displayName: 'GPT-4o mini',
      channelId: openaiChannel.id,
      upstreamName: 'gpt-4o-mini',
      maxContext: 128000,
      maxOutput: 4096,
      sort: 10,
      vendor: 'OpenAI',
      description: '轻量通用模型，响应快、成本低，适合日常问答与写作',
      tags: '文本,视觉,工具',
      badge: '推荐',
      // 单位：微元 / 百万 token（¥0.15 与 ¥0.60）
      priceInPerM: 150000,
      priceOutPerM: 600000,
    },
    {
      name: 'deepseek-chat',
      displayName: 'DeepSeek Chat',
      channelId: openaiChannel.id,
      upstreamName: 'deepseek-chat',
      maxContext: 64000,
      maxOutput: 4096,
      sort: 20,
      vendor: 'DeepSeek',
      description: '中文长文本与代码能力突出，性价比高',
      tags: '文本,推理,长上下文',
      badge: 'HOT',
      // 单位：微元 / 百万 token（¥1 与 ¥2）
      priceInPerM: 1000000,
      priceOutPerM: 2000000,
    },
  ];

  for (const s of specs) {
    const model = await prisma.aiModel.upsert({
      where: { name: s.name },
      create: {
        name: s.name,
        displayName: s.displayName,
        maxContext: s.maxContext,
        maxOutput: s.maxOutput,
        sort: s.sort,
        capabilities: 'chat',
        vendor: s.vendor,
        description: s.description,
        tags: s.tags,
        badge: s.badge,
        priceInPerM: s.priceInPerM,
        priceOutPerM: s.priceOutPerM,
      },
      update: {
        displayName: s.displayName,
        vendor: s.vendor,
        description: s.description,
        tags: s.tags,
        badge: s.badge,
        priceInPerM: s.priceInPerM,
        priceOutPerM: s.priceOutPerM,
      },
    });

    await prisma.modelChannel.upsert({
      where: { modelId_channelId: { modelId: model.id, channelId: s.channelId } },
      create: {
        modelId: model.id,
        channelId: s.channelId,
        upstreamName: s.upstreamName,
        weight: 1,
      },
      update: { upstreamName: s.upstreamName },
    });
  }
  console.log(`✔ models: ${specs.map((s) => s.name).join(', ')}`);

  // ---------- 预设 ----------
  const presetGroups = [
    { name: '写作', sort: 1 },
    { name: '编程', sort: 2 },
    { name: '效率', sort: 3 },
  ];
  const groupIds: Record<string, string> = {};
  for (const g of presetGroups) {
    const row = await prisma.presetGroup.upsert({
      where: { name: g.name },
      create: g,
      update: { sort: g.sort },
    });
    groupIds[g.name] = row.id;
  }

  const presets = [
    { group: '写作', title: '润色改写', prompt: '请把下面这段文字润色，保持原意，语言更自然、更有说服力：\n\n', sort: 1 },
    { group: '写作', title: '写周报', prompt: '请根据以下要点，帮我写一份结构清晰的周报，分「本周完成 / 问题风险 / 下周计划」三段：\n\n', sort: 2 },
    { group: '写作', title: '摘要提炼', prompt: '请用 5 条要点总结下面这段内容，每条不超过 20 字：\n\n', sort: 3 },
    { group: '编程', title: '解释这段代码', prompt: '请逐段解释下面代码的作用，并指出潜在问题：\n\n', sort: 1 },
    { group: '编程', title: '写单元测试', prompt: '请为下面的函数编写单元测试，覆盖正常路径和边界情况：\n\n', sort: 2 },
    { group: '编程', title: '代码审查', prompt: '请以资深工程师的角度审查下面的代码，指出可读性、性能、安全方面的问题：\n\n', sort: 3 },
    { group: '效率', title: '会议纪要', prompt: '请把下面的会议记录整理成纪要，包含结论、待办事项和负责人：\n\n', sort: 1 },
    { group: '效率', title: '翻译成英文', prompt: '请把下面的内容翻译成地道的英文，保留专业术语：\n\n', sort: 2 },
  ];

  for (const p of presets) {
    const groupId = groupIds[p.group];
    const exists = await prisma.preset.findFirst({ where: { title: p.title, groupId } });
    if (!exists) {
      await prisma.preset.create({
        data: { groupId, title: p.title, prompt: p.prompt, sort: p.sort },
      });
    }
  }
  console.log(`✔ presets: ${presetGroups.length} groups / ${presets.length} items`);

  // ---------- 敏感词（示例，可在后台增删）----------
  const words = [
    { word: '测试敏感词', category: 'test', action: 'block' },
    { word: '违禁示例', category: 'test', action: 'block' },
  ];
  for (const w of words) {
    await prisma.sensitiveWord.upsert({
      where: { word: w.word },
      create: w,
      update: {},
    });
  }
  console.log(`✔ sensitive words: ${words.length}`);

  // ---------- 导航（可配置，不是权限系统）----------
  // roles 决定可见性：'ADMIN' 只给管理端看，'USER,ADMIN' 全员可见。
  // 内容组是普通用户唯一入口，必须对 USER 开放，否则前台侧栏除"对话"外全空。
  const menuGroups: Array<{ title: string; path: string; icon: string; sort: number; roles?: string; children: Array<{ title: string; path: string; icon: string; sort: number; roles?: string }> }> = [
    {
      title: '内容',
      path: '/content',
      icon: 'ChatLineSquare',
      sort: 1,
      roles: 'USER,ADMIN',
      children: [
        { title: '对话', path: '/chat', icon: 'ChatDotRound', sort: 1 },
        { title: '应用', path: '/apps', icon: 'Grid', sort: 2 },
        { title: '图像', path: '/image', icon: 'Picture', sort: 3 },
        { title: '预设', path: '/presets', icon: 'MagicStick', sort: 4 },
      ],
    },
    {
      title: '模型',
      path: '/models',
      icon: 'Cpu',
      sort: 2,
      children: [
        { title: '渠道管理', path: '/models/channels', icon: 'Connection', sort: 1 },
        { title: '模型管理', path: '/models/list', icon: 'Files', sort: 2 },
        { title: '搭档控制室', path: '/agents/manage', icon: 'Connection', sort: 3 },
        { title: '声音控制台', path: '/voice/manage', icon: 'Microphone', sort: 4 },
        { title: '视频控制台', path: '/video/manage', icon: 'VideoCamera', sort: 5 },
      ],
    },
    {
      title: '运营',
      path: '/ops',
      icon: 'DataLine',
      sort: 3,
      children: [
        { title: '统计', path: '/statistic', icon: 'TrendCharts', sort: 1 },
        { title: '聊天记录', path: '/chat-logs', icon: 'Document', sort: 2 },
        { title: '敏感词', path: '/moderation', icon: 'Warning', sort: 3 },
        { title: '文件', path: '/files', icon: 'Folder', sort: 4 },
      ],
    },
    {
      title: '系统',
      path: '/system',
      icon: 'Setting',
      sort: 4,
      children: [
        { title: '用户', path: '/users', icon: 'User', sort: 1 },
        { title: '系统配置', path: '/settings', icon: 'Tools', sort: 2 },
      ],
    },
  ];

  let menuCount = 0;
  for (const group of menuGroups) {
    const groupRoles = group.roles ?? 'ADMIN';
    let parent = await prisma.menu.findFirst({ where: { path: group.path } });
    if (!parent) {
      parent = await prisma.menu.create({
        data: {
          title: group.title,
          path: group.path,
          icon: group.icon,
          sort: group.sort,
          roles: groupRoles,
        },
      });
    } else if (parent.roles !== groupRoles) {
      // 老库里的角色是老值（例如内容组曾写成 ADMIN）：补齐，否则重跑 seed 也修不好前台空导航
      parent = await prisma.menu.update({ where: { id: parent.id }, data: { roles: groupRoles } });
    }
    menuCount += 1;

    for (const child of group.children) {
      const childRoles = child.roles ?? groupRoles;
      const exists = await prisma.menu.findFirst({ where: { path: child.path } });
      if (!exists) {
        await prisma.menu.create({
          data: {
            parentId: parent.id,
            title: child.title,
            path: child.path,
            icon: child.icon,
            sort: child.sort,
            roles: childRoles,
          },
        });
        menuCount += 1;
      } else if (exists.roles !== childRoles) {
        await prisma.menu.update({ where: { id: exists.id }, data: { roles: childRoles } });
      }
    }
  }
  console.log(`✔ menus: ${menuCount}`);

  // ---------- 智能体应用 ----------
  const appCats = [
    { name: '写作助手', sort: 1 },
    { name: '编程助手', sort: 2 },
  ];
  const catIds: Record<string, string> = {};
  for (const c of appCats) {
    const row = await prisma.appCategory.upsert({
      where: { name: c.name },
      create: c,
      update: { sort: c.sort },
    });
    catIds[c.name] = row.id;
  }

  const demoApps = [
    {
      category: '写作助手',
      name: '周报生成器',
      description: '把零散要点整理成结构清晰的周报',
      systemPrompt:
        '你是周报助手。请把用户给的要点整理成「本周完成 / 问题风险 / 下周计划」三段式周报，语言简洁、动词开头。',
      greeting: '把你这周做的事随便列几条，我来整理成周报。',
    },
    {
      category: '写作助手',
      name: '文案润色',
      description: '保持原意，让表达更自然有力',
      systemPrompt:
        '你是中文文案编辑。请在不改变原意的前提下润色用户提供的文字，使其更自然、更有说服力，并简要说明改了什么。',
      greeting: '把需要润色的文字发给我。',
    },
    {
      category: '编程助手',
      name: '代码解释器',
      description: '逐段解释代码并指出潜在问题',
      systemPrompt:
        '你是资深工程师。请逐段解释用户提供的代码的作用，指出可读性、性能、安全方面的潜在问题，并给出改进建议。',
      greeting: '把代码贴给我，我来解释。',
    },
    {
      category: '编程助手',
      name: 'SQL 优化助手',
      description: '分析慢查询并给出改写与索引建议',
      systemPrompt:
        '你是数据库专家。请分析用户提供的 SQL 与表结构，指出性能瓶颈，给出改写方案与索引建议。',
      greeting: '把 SQL 和表结构发给我。',
    },
  ];

  for (const a of demoApps) {
    const exists = await prisma.app.findFirst({ where: { name: a.name, deletedAt: null } });
    if (exists) continue;
    await prisma.app.create({
      data: {
        categoryId: catIds[a.category],
        name: a.name,
        description: a.description,
        systemPrompt: a.systemPrompt,
        greeting: a.greeting,
        defaultModel: 'mock-chat',
        published: true,
      },
    });
  }
  console.log(`✔ apps: ${demoApps.length}`);

  // ---------- 配置（只存覆盖值，默认值在代码里）----------
  const overrides: Array<[string, unknown]> = [
    ['site.name', 'QGauss AI'],
    ['chat.defaultModel', 'mock-chat'],
    // 本地开发方便，默认放开注册；生产请置 false 并设置邀请码
    ['security.registerEnabled', true],
    // 图像生成默认走本地模拟渠道
    ['image.defaultChannel', mockChannel.id],
  ];
  for (const [key, value] of overrides) {
    await prisma.globalConfig.upsert({
      where: { key },
      create: { key, value: JSON.stringify(value) },
      update: {},
    });
  }
  console.log(`✔ config overrides: ${overrides.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    try { await prisma.$disconnect(); } finally { dataLease?.close(); }
  });
