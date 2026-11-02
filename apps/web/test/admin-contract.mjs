/**
 * 前后端契约冒烟：后台各页面依赖的接口返回结构是否与页面预期一致。
 * 运行前需要 API 已启动（默认 http://127.0.0.1:9520）。
 *
 * 用法：node test/admin-contract.mjs
 */
const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
const ADMIN = { account: process.env.E2E_ADMIN ?? 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' };

let token = '';
let passed = 0;
let failed = 0;

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${name} ${detail}`);
  }
}

async function call(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body, data: body?.data };
}

async function main() {
  const login = await call('/auth/login', { method: 'POST', body: JSON.stringify(ADMIN) });
  token = login.data?.accessToken;
  if (!token) throw new Error('管理员登录失败');

  console.log('\n[渠道页] /models/channels + /models/channels/health');
  const channels = await call('/models/channels');
  ok('返回数组', Array.isArray(channels.data));
  const ch = channels.data?.[0];
  ok('字段齐全', ch && 'name' in ch && 'baseUrl' in ch && 'apiKeyMasked' in ch && 'hasApiKey' in ch);
  ok('不返回明文密钥', ch && !('apiKey' in ch) && !('apiKeyEnc' in ch));
  const health = await call('/models/channels/health');
  ok('健康度可读', Array.isArray(health.data) && health.data[0]?.breaker?.state);

  console.log('\n[模型页] /models');
  const models = await call('/models');
  const m = models.data?.[0];
  ok('返回数组且带 channels', Array.isArray(models.data) && Array.isArray(m?.channels));
  ok('绑定项含上游模型名', m?.channels?.[0] ? 'upstreamName' in m.channels[0] : true);

  console.log('\n[配置页] /settings');
  const settings = await call('/settings');
  const s = settings.data?.[0];
  ok('返回注册表', Array.isArray(settings.data) && settings.data.length >= 10);
  ok('含类型与默认值', s && 'type' in s && 'defaultValue' in s && 'group' in s && 'description' in s);
  const groups = [...new Set(settings.data.map((x) => x.group))];
  ok('可按组渲染', groups.length >= 4, `groups=${groups.join(',')}`);

  console.log('\n[用户页] /users');
  const users = await call('/users?page=1&pageSize=20');
  ok('分页结构', users.data && Array.isArray(users.data.items) && typeof users.data.total === 'number');
  ok('列表不含密码', users.data?.items?.[0] ? !('passwordHash' in users.data.items[0]) : true);

  console.log('\n[敏感词页] /moderation/words + /moderation/hits');
  const words = await call('/moderation/words');
  ok('词库数组', Array.isArray(words.data));
  const hits = await call('/moderation/hits');
  ok('命中记录分页', hits.data && Array.isArray(hits.data.items) && 'total' in hits.data);

  console.log('\n[预设页] /presets/admin + /presets/groups');
  const presets = await call('/presets/admin');
  ok('预设数组', Array.isArray(presets.data));
  ok('带 group 关联', presets.data?.[0] ? 'group' in presets.data[0] : true);
  const groupsRes = await call('/presets/groups');
  ok('分组数组', Array.isArray(groupsRes.data));

  console.log('\n[应用页] /apps + /apps/categories + /apps/favorites');
  const appCats = await call('/apps/categories');
  ok('分类数组', Array.isArray(appCats.data) && appCats.data.length >= 2);
  const appList = await call('/apps');
  ok('应用数组', Array.isArray(appList.data) && appList.data.length >= 4, `len=${appList.data?.length}`);
  ok('含 favorited 字段', appList.data?.[0] ? 'favorited' in appList.data[0] : true);
  ok('含分类信息', appList.data?.[0] ? 'category' in appList.data[0] : true);
  const favList = await call('/apps/favorites');
  ok('收藏数组', Array.isArray(favList.data));
  const appAdmin = await call('/apps/admin/list');
  ok('后台应用列表', Array.isArray(appAdmin.data));

  console.log('\n[图像页] /image/tasks');
  const imgList = await call('/image/tasks?page=1&pageSize=10');
  ok('任务分页结构', imgList.data && Array.isArray(imgList.data.items));
  const img = imgList.data.items[0];
  ok('任务字段齐全', img ? ['id', 'prompt', 'status', 'progress', 'results'].every((k) => k in img) : true);

  console.log('\n[概览页] /statistic/trend + /settings/public');
  const trend = await call('/statistic/trend?days=7');
  ok('趋势数组长度 7', (trend.data?.length ?? 0) === 7, `len=${trend.data?.length}`);
  ok('趋势项含日期与调用数', trend.data?.[0] ? ['date', 'calls', 'tokens'].every((k) => k in trend.data[0]) : true);
  const pub = await call('/settings/public');
  ok('公告字段存在', pub.data && 'site.announcement' in pub.data);

  console.log('\n[对话页] 消息字段（分支切换依赖 parentId）');
  const convList = await call('/conversations');
  const firstConv = convList.data?.[0];
  if (firstConv) {
    const detail = await call(`/conversations/${firstConv.id}`);
    const msgs = detail.data?.messages ?? [];
    ok('消息带 id 与 parentId', msgs.every((m) => 'id' in m && 'parentId' in m));
    ok('消息带 token 字段', msgs.every((m) => 'promptTokens' in m && 'completionTokens' in m));
  } else {
    ok('消息带 id 与 parentId', true, '(无会话，跳过)');
  }

  console.log('\n[聊天记录页] /chat-logs');
  const chatLogs = await call('/chat-logs?page=1&pageSize=5');
  ok('分页结构', chatLogs.data && Array.isArray(chatLogs.data.items) && 'total' in chatLogs.data);
  const lg = chatLogs.data?.items?.[0];
  ok(
    '字段齐全',
    lg ? ['createdAt', 'user', 'conversationTitle', 'role', 'status', 'modelName', 'content'].every((k) => k in lg) : true,
  );

  console.log('\n[导航] /menus');
  const menus = await call('/menus');
  const flat = (menus.data ?? []).flatMap((g) => g.children ?? []);
  ok('菜单项 >= 8', flat.length >= 8, `count=${flat.length}`);
  ok('路径以 / 开头', flat.every((x) => x.path.startsWith('/')));

  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('契约测试异常:', e);
  process.exit(1);
});
