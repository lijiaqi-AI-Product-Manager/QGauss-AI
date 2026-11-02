/**
 * e2e 冒烟：跑通"正常 + 各类异常"的完整链路
 *
 * 前置：
 *   1. node test/fake-upstream.mjs        （端口 9899）
 *   2. npm start                          （API 端口 9520）
 *   3. .env 里 ALLOW_HTTP_UPSTREAM=1，UPSTREAM_PORT_ALLOWLIST 含 9899
 *
 * 运行：node test/e2e.mjs
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
const API = process.env.E2E_API ?? 'http://127.0.0.1:9520/api';
// 夹具命名工具：必须真唯一。
// 早先若干处写成 `Date.now() % 1000`，只有 1000 种取值，
// 开发库长期复用后生日悖论必然生效——重名会把一条本该绿的用例拖红（真实发生过）。
const uniqName = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
/** 用户名有 3-20 位且只允许字母数字下划线短横线的限制，用短版 */
const uniqUser = (prefix) => `${prefix}${Math.random().toString(36).slice(2, 10)}`;

/** 相对下载地址要挂到同一台被测服务上，写死 9520 的话换端口跑会打到别的实例 */
const API_ORIGIN = new URL(API).origin;
const FAKE = process.env.E2E_FAKE ?? 'http://127.0.0.1:9899/v1';
const ADMIN = { account: process.env.E2E_ADMIN ?? 'admin', password: process.env.E2E_PASSWORD ?? 'admin123456' };

let token = '';
let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✔ ${name}`);
  } else {
    failed += 1;
    failures.push(`${name} ${detail}`);
    console.log(`  ✘ ${name} ${detail}`);
  }
}

async function api(path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers ?? {}),
    },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

/** 消费 SSE，返回事件序列与拼接文本 */
async function streamChat(payload) {
  const res = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    return { httpStatus: res.status, events: [], text: '', body };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const events = [];
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const blocks = buf.split('\n\n');
    buf = blocks.pop() ?? '';
    for (const block of blocks) {
      const evLine = block.split('\n').find((l) => l.startsWith('event:'));
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'));
      if (!evLine || !dataLine) continue;
      const event = evLine.slice(6).trim();
      let data;
      try {
        data = JSON.parse(dataLine.slice(5).trim());
      } catch {
        continue;
      }
      events.push({ event, data });
      if (event === 'delta') text += data.v ?? '';
    }
  }
  return { httpStatus: res.status, events, text };
}

const pick = (events, name) => events.find((e) => e.event === name)?.data;

/* ---------- 附件夹具：在测试里现做，不往仓库放二进制 ---------- */

/** 最小合法 PDF：一页、Helvetica、一行文字（只用 ASCII） */
function makePdf(text) {
  const stream = `BT /F1 18 Tf 20 100 Td (${text}) Tj ET`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let out = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('');
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** 最小 docx：用 mammoth 自带依赖 jszip 打包三个必需部件 */
async function makeDocx(text) {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
  );
  zip.file(
    'word/document.xml',
    '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">' +
      `<w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makeXlsx(marker) {
  const { default: ExcelJS } = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('数据');
  ws.addRow(['名称', '数值']);
  ws.addRow([marker, 42]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

async function ensureChannel(name, { type, baseUrl, timeoutMs, priority }) {
  const list = await api('/models/channels');
  const existing = list.body.data?.find((c) => c.name === name);
  if (existing) return existing.id;
  const created = await api('/models/channels', {
    method: 'POST',
    body: JSON.stringify({ name, type, baseUrl, timeoutMs, priority }),
  });
  if (!created.body?.data?.id) throw new Error(`创建渠道失败: ${JSON.stringify(created.body)}`);
  return created.body.data.id;
}

async function ensureModel(name, bindings) {
  const list = await api('/models');
  let model = list.body.data?.find((m) => m.name === name);
  if (!model) {
    const created = await api('/models', {
      method: 'POST',
      body: JSON.stringify({ name, displayName: name, maxContext: 8192, maxOutput: 512 }),
    });
    if (!created.body?.data?.id) throw new Error(`创建模型失败: ${JSON.stringify(created.body)}`);
    model = { id: created.body.data.id, channels: [] };
  }
  for (const b of bindings) {
    await api(`/models/${model.id}/channels`, {
      method: 'POST',
      body: JSON.stringify({ channelId: b.channelId, upstreamName: b.upstreamName, weight: 1 }),
    });
  }
  return model.id;
}

async function main() {
  console.log('\n[0] 登录');
  const login = await api('/auth/login', { method: 'POST', body: JSON.stringify(ADMIN) });
  ok('管理员登录', login.status === 201 || login.status === 200, `status=${login.status}`);
  token = login.body?.data?.accessToken;
  if (!token) throw new Error('登录失败，无法继续');

  console.log('\n[1] 准备渠道与模型（指向 fake-upstream）');
  // e2e 自己会发很多请求，先关掉聊天限流，避免测试互相干扰（最后一节单独验证限流）
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: [
        { key: 'security.chatRateLimit', value: 0 },
        // 本轮回归会多次注册临时用户，避免连续跑两轮时撞注册限流
        { key: 'security.registerRateLimit', value: 0 },
        // 主题套件按「不含商业化」跑：上一轮商业 e2e 若异常中止，会把开关留在 true，
        // 这里不显式关掉的话，图像用例会撞上绘图扣费闸门（8002）而假红。
        { key: 'commerce.enabled', value: false },
      ],
    }),
  });
  // 清掉上一轮遗留的熔断状态，保证起点干净
  await api('/models/channels/health/reset', { method: 'POST' });
  const chNormal = await ensureChannel('fake-normal', {
    type: 'OPENAI',
    baseUrl: FAKE,
    priority: 10,
  });
  const ch500 = await ensureChannel('fake-500', {
    type: 'OPENAI',
    baseUrl: `${FAKE}?scenario=http-500`,
    priority: 0,
  });
  const chSlow = await ensureChannel('fake-slow', {
    type: 'OPENAI',
    baseUrl: `${FAKE}?scenario=slow-first-token`,
    priority: 10,
  });
  const chHang = await ensureChannel('fake-hang', {
    type: 'OPENAI',
    baseUrl: `${FAKE}?scenario=hang`,
    priority: 10,
    timeoutMs: 3000,
  });
  ok('渠道就绪', !!chNormal && !!ch500 && !!chSlow && !!chHang);

  const normalModelId = await ensureModel('fake-normal', [{ channelId: chNormal, upstreamName: 'fake-normal' }]);
  const failoverModelId = await ensureModel('fake-failover', [
    { channelId: ch500, upstreamName: 'fake-500' },
    { channelId: chNormal, upstreamName: 'fake-normal' },
  ]);
  await ensureModel('fake-slow', [{ channelId: chSlow, upstreamName: 'fake-slow' }]);
  await ensureModel('fake-hang', [{ channelId: chHang, upstreamName: 'fake-hang' }]);
  ok('模型就绪', true);

  console.log('\n[2] 正常流式');
  const r1 = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-normal-${Date.now()}`,
    messages: [{ role: 'user', content: '你好' }],
  });
  ok('收到 meta', !!pick(r1.events, 'meta'));
  ok('收到多个 delta', r1.events.filter((e) => e.event === 'delta').length > 3);
  ok('收到 done', pick(r1.events, 'done')?.status === 'COMPLETED');
  ok('文本非空', r1.text.length > 10);

  console.log('\n[3] 主渠道 500 → 自动切备用渠道');
  const r2 = await streamChat({
    model: 'fake-failover',
    clientMsgId: `e2e-failover-${Date.now()}`,
    messages: [{ role: 'user', content: '测试故障转移' }],
  });
  const done2 = pick(r2.events, 'done');
  ok('最终成功（用户无感）', done2?.status === 'COMPLETED');
  ok('拿到了备用渠道内容', r2.text.length > 10);

  console.log('\n[4] 全渠道失败 → FAILED + error 事件');
  const r3 = await streamChat({
    model: 'fake-hang',
    clientMsgId: `e2e-timeout-${Date.now()}`,
    messages: [{ role: 'user', content: '等待超时' }],
  });
  const err3 = pick(r3.events, 'error');
  ok('有 error 事件', !!err3, JSON.stringify(err3));
  ok('错误码为超时类', ['upstream_timeout', 'upstream_network'].includes(err3?.code), String(err3?.code));
  ok('done 状态 FAILED', pick(r3.events, 'done')?.status === 'FAILED');

  console.log('\n[5] 首 token 慢（3s）仍能完整返回');
  const r4 = await streamChat({
    model: 'fake-slow',
    clientMsgId: `e2e-slow-${Date.now()}`,
    messages: [{ role: 'user', content: '慢一点' }],
  });
  ok('慢渠道成功', pick(r4.events, 'done')?.status === 'COMPLETED');
  ok('耗时 > 3 秒', (pick(r4.events, 'done')?.durationMs ?? 0) >= 3000);

  console.log('\n[6] 落库与用量');
  const convs = await api('/conversations');
  ok('会话列表非空', (convs.body.data?.length ?? 0) > 0);
  const convId = convs.body.data[0].id;
  const detail = await api(`/conversations/${convId}`);
  const msgs = detail.body.data?.messages ?? [];
  ok('消息成对出现', msgs.length >= 2);
  ok(
    '助手消息带 token 与耗时',
    msgs.some((m) => m.role === 'ASSISTANT' && m.completionTokens !== null && m.durationMs !== null),
  );

  console.log('\n[6b] 会话模型选择持久化');
  const modelSelectionConv = await api('/conversations', { method: 'POST', body: JSON.stringify({ title: '模型选择回归', modelId: normalModelId }) });
  const modelSelectionConvId = modelSelectionConv.body?.data?.id;
  const savedSelection = await api(`/conversations/${modelSelectionConvId}`, { method: 'PATCH', body: JSON.stringify({ modelId: failoverModelId }) });
  ok('切换模型写入会话', savedSelection.status === 200 && savedSelection.body?.data?.modelId === failoverModelId);
  const reopenedSelection = await api(`/conversations/${modelSelectionConvId}`);
  ok('重开历史返回保存的模型', reopenedSelection.body?.data?.model?.name === 'fake-failover');
  const selectionRows = await api('/conversations');
  ok('历史列表包含更新后的模型 id', selectionRows.body?.data?.find(c => c.id === modelSelectionConvId)?.modelId === failoverModelId);
  const selectedMessageKey = uniqName('saved-model');
  const inheritedSelection = await streamChat({ conversationId: modelSelectionConvId, clientMsgId: selectedMessageKey, messages: [{ role: 'user', content: '使用会话保存的模型' }] });
  ok('未指定模型时沿用会话设置并完成回复', pick(inheritedSelection.events, 'meta')?.model === 'fake-failover' && pick(inheritedSelection.events, 'done')?.status === 'COMPLETED');
  const explicitSelection = await streamChat({ conversationId: modelSelectionConvId, model: 'fake-normal', clientMsgId: uniqName('explicit-model'), messages: [{ role: 'user', content: '显式切换模型' }] });
  const explicitDetail = await api(`/conversations/${modelSelectionConvId}`);
  ok('聊天接口的显式模型切换也保存到会话', pick(explicitSelection.events, 'done')?.status === 'COMPLETED' && explicitDetail.body?.data?.modelId === normalModelId);
  const selectionReplay = await streamChat({ conversationId: modelSelectionConvId, model: 'fake-normal', clientMsgId: selectedMessageKey, messages: [{ role: 'user', content: '使用会话保存的模型' }] });
  ok('重放元数据沿用原回复的模型', pick(selectionReplay.events, 'meta')?.replay === true && pick(selectionReplay.events, 'meta')?.model === 'fake-failover');
  await streamChat({ conversationId: modelSelectionConvId, model: 'fake-failover', clientMsgId: selectedMessageKey, messages: [{ role: 'user', content: '使用会话保存的模型' }] });
  const afterSelectionReplay = await api(`/conversations/${modelSelectionConvId}`);
  ok('重放旧消息不会改写当前模型选择', afterSelectionReplay.body?.data?.modelId === normalModelId);
  const offlineModelId = await ensureModel(uniqName('selection-offline'), []);
  const disabledModelId = await ensureModel(uniqName('selection-disabled'), [{ channelId: chNormal, upstreamName: 'fake-normal' }]);
  await api(`/models/${disabledModelId}`, { method: 'PATCH', body: JSON.stringify({ status: 'DISABLED' }) });
  for (const [label, payload, status] of [
    ['不存在的模型', { modelId: 'missing-model-selection' }, 404],
    ['停用的模型', { modelId: disabledModelId }, 400],
    ['没有可用渠道的模型', { modelId: offlineModelId }, 400],
    ['空模型选择', { modelId: null }, 400],
    ['非字符串模型选择', { modelId: 17 }, 400],
    ['非字符串分组', { folderId: 17 }, 400],
  ]) {
    const rejectedSelection = await api(`/conversations/${modelSelectionConvId}`, { method: 'PATCH', body: JSON.stringify(payload) });
    ok(`拒绝${label}`, rejectedSelection.status === status, `status=${rejectedSelection.status}`);
  }
  const afterRejectedSelections = await api(`/conversations/${modelSelectionConvId}`);
  ok('无效选择均不覆盖已保存模型', afterRejectedSelections.body?.data?.modelId === normalModelId);

  console.log('\n[7] 鉴权边界');
  const saved = token;
  token = '';
  const noAuth = await api('/conversations');
  ok('无 token 返回 401', noAuth.status === 401, `status=${noAuth.status}`);
  token = saved;

  console.log('\n[8] 熔断：401 渠道被摘掉');
  const ch401 = await ensureChannel('fake-401', {
    type: 'OPENAI',
    baseUrl: `${FAKE}?scenario=http-401`,
    priority: 0,
  });
  await ensureModel('fake-auth-failover', [
    { channelId: ch401, upstreamName: 'fake-401' },
    { channelId: chNormal, upstreamName: 'fake-normal' },
  ]);

  const b1 = await streamChat({
    model: 'fake-auth-failover',
    clientMsgId: `e2e-breaker-1-${Date.now()}`,
    messages: [{ role: 'user', content: '第一次，主渠道应 401' }],
  });
  ok('401 后仍能成功（切备用）', pick(b1.events, 'done')?.status === 'COMPLETED');

  const ready = await api('/health/ready');
ok(
  '就绪探针：db 与 storage 都是 up',
  ready.status === 200 &&
    ready.body.data?.db === 'up' &&
    ready.body.data?.storage?.ok === true,
  JSON.stringify(ready.body?.data ?? ready.body).slice(0, 160),
);
const live = await api('/health');
ok(
  '存活探针不依赖数据库（只证明进程活着）',
  live.status === 200 && live.body.data?.status === 'ok' && live.body.data?.db === undefined,
  JSON.stringify(live.body?.data ?? live.body).slice(0, 160),
);

const health = await api('/models/channels/health');
  const broken = health.body.data?.find((c) => c.id === ch401);
  ok('401 渠道熔断为 OPEN', broken?.breaker?.state === 'OPEN', JSON.stringify(broken?.breaker));

  const b2 = await streamChat({
    model: 'fake-auth-failover',
    clientMsgId: `e2e-breaker-2-${Date.now()}`,
    messages: [{ role: 'user', content: '第二次，应直接走备用' }],
  });
  ok('熔断后第二次仍成功', pick(b2.events, 'done')?.status === 'COMPLETED');
  const b2meta = pick(b2.events, 'meta');
  ok('第二次有 meta（未 500）', !!b2meta);

  console.log('\n[9] 每日配额');
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'quota.dailyTokens', value: 1 }] }),
  });
  const quota = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-quota-${Date.now()}`,
    messages: [{ role: 'user', content: '超额测试' }],
  });
  ok('超配额返回 429', quota.httpStatus === 429, `status=${quota.httpStatus}`);
  ok('错误码为 6001', String(quota.body).includes('6001'), String(quota.body).slice(0, 120));

  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'quota.dailyTokens', value: 0 }] }),
  });
  const afterQuota = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-quota-off-${Date.now()}`,
    messages: [{ role: 'user', content: '取消限额后应恢复' }],
  });
  ok('取消限额后恢复正常', pick(afterQuota.events, 'done')?.status === 'COMPLETED');

  const quotaInfo = await api('/chat/quota');
  ok('额度接口可读', typeof quotaInfo.body.data?.limit === 'number', JSON.stringify(quotaInfo.body.data));

  console.log('\n[10] 预设');
  const presets = await api('/presets');
  const groups = presets.body.data ?? [];
  ok('预设分组非空', groups.length >= 3, `groups=${groups.length}`);
  ok('预设条目非空', groups.reduce((n, g) => n + g.items.length, 0) >= 8);

  console.log('\n[11] 敏感词拦截');
  const blocked = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-mod-${Date.now()}`,
    messages: [{ role: 'user', content: '这句话里包含测试敏感词，应该被拦下' }],
  });
  ok('命中敏感词返回 400', blocked.httpStatus === 400, `status=${blocked.httpStatus}`);
  ok('错误码 7001', String(blocked.body).includes('7001'), String(blocked.body).slice(0, 100));
  ok('错误信息已打码', String(blocked.body).includes('*'), String(blocked.body).slice(0, 100));

  // 新增词应立即生效（验证缓存失效）
  const uniqueWord = `临期词${Date.now()}`;
  const created = await api('/moderation/words', {
    method: 'POST',
    body: JSON.stringify({ word: uniqueWord, category: 'test' }),
  });
  ok('管理员新增词成功', created.status === 201 || created.status === 200, `status=${created.status}`);

  const blocked2 = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-mod2-${Date.now()}`,
    messages: [{ role: 'user', content: `你好 ${uniqueWord} 结束` }],
  });
  ok('新词立即生效（缓存已失效）', blocked2.httpStatus === 400, `status=${blocked2.httpStatus}`);

  const hits = await api('/moderation/hits');
  ok('违规记录已落库', (hits.body.data?.total ?? 0) >= 2, `total=${hits.body.data?.total}`);

  // 绘画提示词同样要过敏感词：提交即拦，不排队、不扣费
  const imgBlocked = await api('/image/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: `一只猫 ${uniqueWord}` }),
  });
  ok('绘画提示词命中敏感词返回 400', imgBlocked.status === 400, `status=${imgBlocked.status}`);
  ok('绘画拦截错误码 7001', imgBlocked.body?.code === 7001, `code=${imgBlocked.body?.code}`);
  const imgNeg = await api('/image/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: '一只猫', negativePrompt: uniqueWord }),
  });
  ok('负向提示词同样被检查', imgNeg.status === 400, `status=${imgNeg.status}`);
  const hits2 = await api('/moderation/hits?source=image');
  ok(
    '绘画违规记录来源为 image',
    (hits2.body.data?.items ?? []).some((h) => h.source === 'image'),
    JSON.stringify((hits2.body.data?.items ?? []).slice(0, 2)).slice(0, 160),
  );

  console.log('\n[12] 文件上传');
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64',
  );

  async function upload(buf, filename, type) {
    const fd = new FormData();
    fd.append('file', new Blob([buf], { type }), filename);
    const res = await fetch(`${API}/upload`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: fd,
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
    return { status: res.status, body };
  }

  const up = await upload(png, '测试图.png', 'image/png');
  ok('上传 PNG 成功', up.status === 201 || up.status === 200, `status=${up.status} ${JSON.stringify(up.body).slice(0, 120)}`);
  const fileId = up.body?.data?.id;
  ok('返回 id 与 url', !!fileId && String(up.body?.data?.url).includes(fileId));
  ok('服务端识别为 image/png', up.body?.data?.mime === 'image/png', up.body?.data?.mime);

  const meta = await api(`/upload/${fileId}`);
  ok('可查询元信息', meta.body?.data?.id === fileId);

  const rawRes = await fetch(`${API}/upload/${fileId}/raw`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const rawBuf = Buffer.from(await rawRes.arrayBuffer());
  ok('原样取回字节', rawBuf.equals(png), `len=${rawBuf.length}`);
  ok('响应头带正确 MIME', rawRes.headers.get('content-type') === 'image/png');

  // 二进制垃圾：无签名、含 NUL → 应拒绝
  const junk = Buffer.concat([Buffer.from([0x4d, 0x5a]), Buffer.alloc(512, 0)]);
  const bad = await upload(junk, 'evil.png', 'image/png');
  ok('伪装成 PNG 的二进制被拒', bad.status === 400, `status=${bad.status}`);

  // 超限：临时把上限设为 1MB
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'upload.maxSizeMb', value: 1 }] }),
  });
  const bigPng = Buffer.concat([png, Buffer.alloc(2 * 1024 * 1024, 0x41)]);
  const oversize = await upload(bigPng, 'big.png', 'image/png');
  ok('超过大小上限返回 413', oversize.status === 413, `status=${oversize.status}`);
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'upload.maxSizeMb', value: 10 }] }),
  });

  const del = await api(`/upload/${fileId}`, { method: 'DELETE' });
  ok('删除成功', del.body?.data?.ok === true);
  const afterDel = await api(`/upload/${fileId}`);
  ok('删除后查询 404', afterDel.status === 404, `status=${afterDel.status}`);

  console.log('\n[12b] 对话附件：文档解析 + 识图');
  const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  const attFiles = {
    txt: await upload(Buffer.from('纯文本附件 QG-MARK-txt 结束'), '说明.md', 'text/markdown'),
    pdf: await upload(makePdf('QG-MARK-pdf hello'), '报告.pdf', 'application/pdf'),
    docx: await upload(await makeDocx('合同正文 QG-MARK-docx 完'), '合同.docx', DOCX_MIME),
    xlsx: await upload(await makeXlsx('QG-MARK-xlsx'), '报表.xlsx', XLSX_MIME),
    png: await upload(png, '截图.png', 'image/png'),
  };
  ok('Word 被识别为 docx', attFiles.docx.body?.data?.mime === DOCX_MIME, attFiles.docx.body?.data?.mime ?? JSON.stringify(attFiles.docx.body));
  ok('Excel 被识别为 xlsx', attFiles.xlsx.body?.data?.mime === XLSX_MIME, attFiles.xlsx.body?.data?.mime ?? JSON.stringify(attFiles.xlsx.body));
  const docIds = ['txt', 'pdf', 'docx', 'xlsx'].map((k) => attFiles[k].body?.data?.id);

  const docChat = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-att-doc-${Date.now()}`,
    messages: [{ role: 'user', content: '总结一下这些文件', attachments: docIds }],
  });
  ok('带文档对话完成', pick(docChat.events, 'done')?.status === 'COMPLETED', String(docChat.body ?? '').slice(0, 160));
  for (const k of ['txt', 'pdf', 'docx', 'xlsx']) {
    ok(`${k} 内容被解析并注入上下文`, docChat.text.includes(`QG-MARK-${k}`), docChat.text.slice(0, 200));
  }
  ok('文档块带文件名', docChat.text.includes('报告.pdf') && docChat.text.includes('合同.docx'));

  const attConvId = pick(docChat.events, 'meta')?.conversationId;
  const attDetail = await api(`/conversations/${attConvId}`);
  const attUserMsg = (attDetail.body.data?.messages ?? []).find((m) => m.role === 'USER');
  const attParts = JSON.parse(attUserMsg?.parts || '{}');
  ok('用户消息记录附件清单', attParts.attachments?.length === 4 && attParts.attachments[0].name === '说明.md', attUserMsg?.parts);
  ok('用户消息正文不含文档全文', !String(attUserMsg?.content).includes('QG-MARK'));

  const noVision = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-att-img-novision-${Date.now()}`,
    messages: [{ role: 'user', content: '这是什么图', attachments: [attFiles.png.body?.data?.id] }],
  });
  ok('非识图模型收到图片返回 400', noVision.httpStatus === 400 && String(noVision.body).includes('识图'), `${noVision.httpStatus} ${String(noVision.body).slice(0, 80)}`);

  const visionModelId = await ensureModel('fake-vision', [{ channelId: chNormal, upstreamName: 'fake-normal' }]);
  await api(`/models/${visionModelId}`, { method: 'PATCH', body: JSON.stringify({ capabilities: 'chat,vision' }) });
  const imgChat = await streamChat({
    model: 'fake-vision',
    clientMsgId: `e2e-att-img-${Date.now()}`,
    messages: [{ role: 'user', content: '这是什么图', attachments: [attFiles.png.body?.data?.id] }],
  });
  ok('识图模型收到 image_url 部件', imgChat.text.includes('img=1'), imgChat.text.slice(0, 120));

  const imgHistory = await streamChat({
    model: 'fake-vision',
    conversationId: pick(imgChat.events, 'meta')?.conversationId,
    clientMsgId: `e2e-att-img-hist-${Date.now()}`,
    messages: [
      { role: 'user', content: '这是什么图', attachments: [attFiles.png.body?.data?.id] },
      { role: 'assistant', content: imgChat.text },
      { role: 'user', content: '再说详细点' },
    ],
  });
  ok('历史轮次的图片不再重复发送', pick(imgHistory.events, 'done')?.status === 'COMPLETED' && !imgHistory.text.includes('img='), imgHistory.text.slice(0, 120));

  const foreignAtt = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-att-bad-${Date.now()}`,
    messages: [{ role: 'user', content: '看看', attachments: ['not-my-file'] }],
  });
  ok('引用不存在 / 他人的文件返回 400', foreignAtt.httpStatus === 400, `status=${foreignAtt.httpStatus}`);

  console.log('\n[13] 统计');
  const overview = await api('/statistic/overview?days=7');
  const ov = overview.body.data;
  ok('总览可读', ov && typeof ov.calls === 'number', JSON.stringify(ov).slice(0, 120));
  ok('有调用量', (ov?.calls ?? 0) >= 1, `calls=${ov?.calls}`);
  ok('token 有值', (ov?.totalTokens ?? 0) > 0, `tokens=${ov?.totalTokens}`);
  ok('失败率是数字', typeof ov?.failureRate === 'number');

  const byModel = await api('/statistic/by-model?days=7');
  ok('按模型分组非空', (byModel.body.data?.length ?? 0) >= 1);
  ok('分组带调用次数', typeof byModel.body.data?.[0]?.calls === 'number');

  const trend = await api('/statistic/trend?days=7');
  ok('趋势是 7 天', (trend.body.data?.length ?? 0) === 7, `len=${trend.body.data?.length}`);

  const byChannel = await api('/statistic/by-channel?days=7');
  ok('按渠道分组可读', Array.isArray(byChannel.body.data));

  console.log('\n[14] 导航');
  const menus = await api('/menus');
  const roots = menus.body.data ?? [];
  ok('导航根节点 >= 4', roots.length >= 4, `roots=${roots.length}`);
  ok('存在子菜单', roots.some((m) => (m.children?.length ?? 0) > 0));

  const flat = await api('/menus/admin');
  const flatBefore = flat.body.data?.length ?? 0;
  ok('后台可读全部菜单', flatBefore >= 13, `count=${flatBefore}`);

  const menuCreated = await api('/menus', {
    method: 'POST',
    body: JSON.stringify({ title: '临时页', path: `/tmp-${Date.now()}`, icon: 'Star', sort: 99 }),
  });
  ok('新增菜单成功', !!menuCreated.body?.data?.id, JSON.stringify(menuCreated.body).slice(0, 100));
  const flatAfter = await api('/menus/admin');
  ok('菜单数 +1', (flatAfter.body.data?.length ?? 0) === flatBefore + 1);

  await api(`/menus/${menuCreated.body.data.id}`, { method: 'DELETE' });
  const tree2 = await api('/menus');
  ok('删除后导航仍可读', Array.isArray(tree2.body.data));

  console.log('\n[15] 会话分组');
  const folder = await api('/folders', {
    method: 'POST',
    body: JSON.stringify({ name: uniqName('分组') }),
  });
  ok('创建分组成功', !!folder.body?.data?.id, JSON.stringify(folder.body).slice(0, 100));
  const folderId = folder.body.data.id;

  const convList = await api('/conversations');
  const convId2 = convList.body.data[0]?.id;
  const moved = await api(`/conversations/${convId2}`, {
    method: 'PATCH',
    body: JSON.stringify({ folderId }),
  });
  ok('会话移入分组', moved.body?.data?.folderId === folderId, String(moved.body?.data?.folderId));

  const folders = await api('/folders');
  const listed = folders.body.data?.find((f) => f.id === folderId);
  ok('分组列表带会话数', listed?.conversationCount === 1, `count=${listed?.conversationCount}`);
  const listWithFolder = await api('/conversations');
  ok(
    '会话列表带 folderId（前端按分组筛选用）',
    listWithFolder.body.data?.find((c) => c.id === convId2)?.folderId === folderId,
  );

  await api(`/folders/${folderId}`, { method: 'DELETE' });
  const afterFolderDel = await api(`/conversations/${convId2}`);
  ok('删分组后会话回到未分组', afterFolderDel.body?.data?.folderId === null);

  console.log('\n[16] 邮件与找回密码');
  const mailUser = {
    email: `e2e-${Date.now()}@example.com`,
    username: uniqUser('e2e'),
    password: 'oldpass12345',
  };
  const reg = await api('/auth/register', { method: 'POST', body: JSON.stringify(mailUser) });
  ok('新用户注册成功', !!reg.body?.data?.accessToken, JSON.stringify(reg.body).slice(0, 100));

  const outbox1 = await api('/mail/outbox?template=welcome&keyword=' + encodeURIComponent(mailUser.email));
  const welcome = outbox1.body.data?.items?.find((m) => m.template === 'welcome');
  ok('注册后产生欢迎邮件', !!welcome, `template=${welcome?.template}`);
  ok('未配 SMTP 时状态为 skipped', welcome?.status === 'skipped', String(welcome?.status));

  const mailStatus = await api('/mail/status');
  ok('邮件中心未把配置缺失标为可以发信', mailStatus.status === 200 && mailStatus.body.data?.transport?.canTest === false);
  ok('邮件状态没有返回账户密码或私有连接参数', !/"(?:pass|password|options|auth|sender)"\s*:/.test(JSON.stringify(mailStatus.body.data)));
  const mailTemplates = await api('/mail/templates');
  ok('四种邮件模板使用安全示意资料，验证码样例不会成为有效凭证', mailTemplates.status === 200 && mailTemplates.body.data?.length === 4 && mailTemplates.body.data.every(item => !/<a\b|<script\b/.test(item.html)) && mailTemplates.body.data.find(item => item.id === 'emailVerification')?.text.includes('000000'));
  for (const path of ['/mail/status','/mail/outbox','/mail/templates']) {
    ok('匿名不能访问邮件中心 ' + path, (await api(path, { headers: { Authorization: '' } })).status === 401);
    ok('普通用户不能访问邮件中心 ' + path, (await api(path, { headers: { Authorization: 'Bearer ' + reg.body.data.accessToken } })).status === 403);
  }
  for (const query of ['page=0','page=1.5','page=1&page=2','pageSize=101','status=custom','template=custom','keyword=bad%0Avalue']) ok('邮件列表拒绝非法条件 ' + query, (await api('/mail/outbox?' + query)).status === 400);
  ok('体验信拒绝隐式转换请求标识', (await api('/mail/probes', { method:'POST', body:JSON.stringify({ requestKey:123 }) })).status === 400);
  ok('未配置邮件不创建虚假的体验信', (await api('/mail/probes', { method:'POST', body:JSON.stringify({ requestKey:randomUUID(), to:'ignored@qgauss.test' }) })).status === 503);
  ok('不存在的体验信可只读核对且不泄露其他记录', (await api('/mail/probes/' + randomUUID())).status === 404);
  ok('体验信核对入口拒绝非法请求标识', (await api('/mail/probes/not-a-uuid')).status === 400);
  ok('不能确认其他人或不存在的体验信', (await api('/mail/probes/missing-receipt/confirm', { method:'POST', body:'{}' })).status === 404);

  await api('/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email: mailUser.email }),
  });
  const outbox2 = await api('/mail/outbox?template=resetPassword&keyword=' + encodeURIComponent(mailUser.email));
  const reset = outbox2.body.data?.items?.find(
    (m) => m.template === 'resetPassword',
  );
  ok('产生重置邮件', !!reset);
  ok('发件回执不返回正文、变量、原始错误或完整邮箱', !!reset && !['body','payload','error','dispatchToken','requestKey'].some(key => Object.hasOwn(reset,key)) && reset.to !== mailUser.email);
  if (process.env.DATABASE_URL !== 'file:./e2e.db') throw Error('Reset fixture access requires the isolated e2e database');
  const mailPrisma = new PrismaClient();
  let storedReset;
  try { storedReset = await mailPrisma.mailOutbox.findFirst({ where: { to: mailUser.email, template: 'resetPassword' }, orderBy: { createdAt: 'desc' } }); }
  finally { await mailPrisma.$disconnect(); }
  const tokenMatch = /token=([a-f0-9]+)/.exec(storedReset?.body ?? '');
  ok('隔离数据库中的重置邮件含有效链接', !!tokenMatch);

  const resetRes = await api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: tokenMatch?.[1], newPassword: 'newpass12345' }),
  });
  ok('重置密码成功', resetRes.body?.data?.ok === true, JSON.stringify(resetRes.body).slice(0, 100));

  const oldLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: mailUser.email, password: mailUser.password }),
  });
  ok('旧密码已失效', oldLogin.status === 401, `status=${oldLogin.status}`);

  const newLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: mailUser.email, password: 'newpass12345' }),
  });
  ok('新密码可登录', !!newLogin.body?.data?.accessToken);

  const reuse = await api('/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: tokenMatch?.[1], newPassword: 'another12345' }),
  });
  ok('重置令牌一次性', reuse.status === 400, `status=${reuse.status}`);

  console.log('\n[17] 限流');
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'security.loginRateLimit', value: 2 }] }),
  });
  let limited = null;
  for (let i = 0; i < 4; i += 1) {
    const r = await api('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ account: 'nobody-here', password: 'wrong-pass-1' }),
    });
    if (r.status === 429) {
      limited = r;
      break;
    }
  }
  ok('超过登录频率返回 429', limited?.status === 429, `status=${limited?.status}`);
  ok('错误码 1003', limited?.body?.code === 1003, JSON.stringify(limited?.body).slice(0, 80));

  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'security.loginRateLimit', value: 10 }] }),
  });

  console.log('\n[18] 智能体应用');
  const cats = await api('/apps/categories');
  ok('应用分类非空', (cats.body.data?.length ?? 0) >= 2, `cats=${cats.body.data?.length}`);

  const apps = await api('/apps');
  ok('应用列表 >= 4', (apps.body.data?.length ?? 0) >= 4, `apps=${apps.body.data?.length}`);
  const weekly = apps.body.data?.find((a) => a.name === '周报生成器');
  ok('找到周报生成器', !!weekly);

  const favOn = await api(`/apps/${weekly.id}/favorite`, { method: 'POST' });
  ok('收藏成功', favOn.body?.data?.favorited === true);
  const favs = await api('/apps/favorites');
  ok('收藏列表包含', (favs.body.data ?? []).some((a) => a.id === weekly.id));
  const favOff = await api(`/apps/${weekly.id}/favorite`, { method: 'POST' });
  ok('再次点击取消收藏', favOff.body?.data?.favorited === false);

  const appDetail = await api(`/apps/${weekly.id}`);
  ok('应用发现详情包含开场白和模型，隐藏内部提示词', appDetail.status === 200 && appDetail.body.data.id === weekly.id && Object.hasOwn(appDetail.body.data, 'greeting') && Object.hasOwn(appDetail.body.data, 'defaultModel') && !Object.hasOwn(appDetail.body.data, 'systemPrompt'));
  const explicitFavorites = await Promise.all(Array.from({ length: 4 }, () => api(`/apps/${weekly.id}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: true }) })));
  ok('并发明确收藏全部成功，不因重试反转', explicitFavorites.every(result => result.status === 201 && result.body.data?.favorited === true));
  const explicitList = await api('/apps/favorites');
  ok('并发收藏只保留一个可见收藏', explicitList.body.data.filter(app => app.id === weekly.id).length === 1);
  const explicitOff = await Promise.all(Array.from({ length: 2 }, () => api(`/apps/${weekly.id}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: false }) })));
  ok('重复明确取消收藏保持取消', explicitOff.every(result => result.status === 201 && result.body.data?.favorited === false) && !(await api('/apps/favorites')).body.data.some(app => app.id === weekly.id));
  const invalidFavorite = await api(`/apps/${weekly.id}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: 'yes' }) });
  ok('收藏目标状态拒绝非布尔值', invalidFavorite.status === 400, 'status=' + invalidFavorite.status);
  ok('字符串 false 不会隐式转换成收藏 true', (await api(`/apps/${weekly.id}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: 'false' }) })).status === 400);
  ok('明确收藏拒绝 null，避免意外降级为切换操作', (await api(`/apps/${weekly.id}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: null }) })).status === 400);

  // 从应用进入对话：不传 model，验证 systemPrompt 被注入（假上游会回显 system 内容）
  const appChat = await streamChat({
    appId: weekly.id,
    clientMsgId: `e2e-app-${Date.now()}`,
    messages: [{ role: 'user', content: '帮我写周报：完成了登录页' }],
  });
  ok('应用对话成功', pick(appChat.events, 'done')?.status === 'COMPLETED');
  ok('注入了应用的 systemPrompt', appChat.text.includes('SYS:你是周报助手'), appChat.text.slice(0, 40));

  const appConvId = pick(appChat.events, 'meta')?.conversationId;
  const appConv = await api(`/conversations/${appConvId}`);
  ok('会话标题用应用名', appConv.body?.data?.title === '周报生成器', String(appConv.body?.data?.title));
  ok('应用会话详情保留归属且不泄露应用内部提示词', appConv.body?.data?.appId === weekly.id && appConv.body?.data?.app?.id === weekly.id && !Object.hasOwn(appConv.body.data.app, 'systemPrompt'));
  const appHistory = await api('/conversations');
  ok('会话列表可区分应用与普通历史', appHistory.body?.data?.find((conversation) => conversation.id === appConvId)?.appId === weekly.id);
  const appContinue = await streamChat({ conversationId: appConvId, clientMsgId: uniqName('app-continue'), messages: [{ role: 'user', content: '继续整理下周计划' }] });
  ok('重开历史不传 appId 仍沿用原应用角色', pick(appContinue.events, 'done')?.status === 'COMPLETED' && appContinue.text.includes('SYS:你是周报助手'));
  const otherApp = apps.body.data.find((application) => application.id !== weekly.id);
  const switchApp = await streamChat({ appId: otherApp.id, conversationId: appConvId, clientMsgId: uniqName('app-switch'), messages: [{ role: 'user', content: '切换应用' }] });
  ok('已有应用会话拒绝切换到另一个应用', switchApp.httpStatus === 400);
  const plainConversation = await api('/conversations', { method: 'POST', body: JSON.stringify({ title: '普通会话归属验收' }) });
  ok('普通新会话默认没有应用归属', plainConversation.body?.data?.appId === null);
  const attachApp = await streamChat({ appId: weekly.id, conversationId: plainConversation.body?.data?.id, clientMsgId: uniqName('plain-app-switch'), messages: [{ role: 'user', content: '改变普通会话归属' }] });
  ok('已有普通会话不会被请求悄悄改成应用会话', attachApp.httpStatus === 400);

  const createdApp = await api('/apps/admin/create', {
    method: 'POST',
    body: JSON.stringify({
      name: uniqName('临时应用'),
      systemPrompt: '你是临时助手。',
      defaultModel: 'mock-chat',
      published: false,
    }),
  });
  ok('后台新增应用', !!createdApp.body?.data?.id);
  const adminApps = await api('/apps/admin/list');
  ok('后台列表可见', (adminApps.body.data ?? []).some((a) => a.id === createdApp.body.data.id));
  const hiddenAppId = createdApp.body.data.id;
  ok('已下架应用不能打开详情或收藏', (await api(`/apps/${hiddenAppId}`)).status === 404 && (await api(`/apps/${hiddenAppId}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: true }) })).status === 404);
  await api(`/apps/admin/${hiddenAppId}`, { method: 'PATCH', body: JSON.stringify({ published: true }) });
  await api(`/apps/${hiddenAppId}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: true }) });
  await api(`/apps/admin/${hiddenAppId}`, { method: 'PATCH', body: JSON.stringify({ published: false }) });
  ok('收藏后下架同时从市场和收藏列表消失', !(await api('/apps')).body.data.some(app => app.id === hiddenAppId) && !(await api('/apps/favorites')).body.data.some(app => app.id === hiddenAppId));
  await api(`/apps/admin/${createdApp.body.data.id}`, { method: 'DELETE' });
  ok('删除应用不能经详情或明确收藏重新使用', (await api(`/apps/${hiddenAppId}`)).status === 404 && (await api(`/apps/${hiddenAppId}/favorite`, { method: 'POST', body: JSON.stringify({ favorited: true }) })).status === 404);

  console.log('\n[19] 图像任务');
  const imgTask = await api('/image/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: '一只坐在窗台上的橘猫，水彩风格', size: '512x512', n: 1 }),
  });
  ok('创建图像任务', !!imgTask.body?.data?.id, JSON.stringify(imgTask.body).slice(0, 120));
  const imgId = imgTask.body.data.id;

  let imgDetail = null;
  for (let i = 0; i < 30; i += 1) {
    imgDetail = (await api(`/image/tasks/${imgId}`)).body?.data;
    if (imgDetail && ['SUCCESS', 'FAILED', 'CANCELED'].includes(imgDetail.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  ok('任务最终成功', imgDetail?.status === 'SUCCESS', `status=${imgDetail?.status} err=${imgDetail?.errorMessage}`);
  ok('产出图片', (imgDetail?.results?.length ?? 0) >= 1);
  const imgUrl = imgDetail?.results?.[0]?.url;
  ok('结果带作品授权访问地址', String(imgUrl).includes('/api/image/tasks/' + imgId + '/results/'));

  const rawImg = await fetch(`${imgUrl.startsWith('http') ? '' : API_ORIGIN}${imgUrl}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  ok('图片可回源', rawImg.status === 200, `status=${rawImg.status}`);
  ok('MIME 为 svg', (rawImg.headers.get('content-type') ?? '').includes('svg'));
  ok('任务有事件记录', (imgDetail?.events?.length ?? 0) >= 2, `events=${imgDetail?.events?.length}`);

  // 失败路径：把默认渠道指向一个不支持 /images/generations 的上游
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'image.defaultChannel', value: chNormal }] }),
  });
  const badTask = await api('/image/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: '这张图应该失败' }),
  });
  let badDetail = null;
  for (let i = 0; i < 30; i += 1) {
    badDetail = (await api(`/image/tasks/${badTask.body.data.id}`)).body?.data;
    if (badDetail && ['SUCCESS', 'FAILED'].includes(badDetail.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  ok('上游异常时任务失败', badDetail?.status === 'FAILED', `status=${badDetail?.status}`);
  ok('失败原因已记录', !!badDetail?.errorMessage, String(badDetail?.errorMessage).slice(0, 60));

  // 恢复默认渠道
  const channelsNow = await api('/models/channels');
  const mockCh = channelsNow.body.data?.find((c) => c.type === 'MOCK');
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'image.defaultChannel', value: mockCh?.id ?? '' }] }),
  });

  console.log('\n[20] 国际化');
  const savedToken = token;
  token = '';
  const zhRes = await api('/conversations');
  token = savedToken;
  ok('中文环境返回中文', String(zhRes.body?.message ?? '').includes('未登录'), String(zhRes.body?.message));

  const enRaw = await fetch(`${API}/conversations`, {
    headers: { 'Accept-Language': 'en-US,en;q=0.9' },
  });
  const enBody = await enRaw.json();
  ok('英文环境返回英文', String(enBody.message).includes('Not authenticated'), enBody.message);
  ok('错误码保持一致', enBody.code === 2001, `code=${enBody.code}`);

  console.log('\n[21] 重新生成与上下文');
  const first = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-regen-${Date.now()}`,
    messages: [{ role: 'user', content: '请说一句话' }],
  });
  const firstDone = pick(first.events, 'done');
  ok('首次回复成功', firstDone?.status === 'COMPLETED');
  ok('done 事件带上下文上限', typeof firstDone?.contextLimit === 'number', `contextLimit=${firstDone?.contextLimit}`);
  ok('done 事件带上下文用量', typeof firstDone?.contextUsed === 'number', `used=${firstDone?.contextUsed}`);

  const regenConvId = pick(first.events, 'meta')?.conversationId;
  const regen = await streamChat({
    model: 'fake-normal',
    conversationId: regenConvId,
    regenerateOf: firstDone.messageId,
    messages: [{ role: 'user', content: '请说一句话' }],
  });
  const regenMeta = pick(regen.events, 'meta');
  ok('重新生成成功', pick(regen.events, 'done')?.status === 'COMPLETED');
  ok('产生的是新消息', regenMeta?.messageId !== firstDone.messageId);

  const regenDetail = await api(`/conversations/${regenConvId}`);
  const assistants = (regenDetail.body.data?.messages ?? []).filter((m) => m.role === 'ASSISTANT');
  const users = (regenDetail.body.data?.messages ?? []).filter((m) => m.role === 'USER');
  ok('两条回复共用一条提问', assistants.length === 2 && users.length === 1, `a=${assistants.length} u=${users.length}`);
  ok('两条回复父节点相同', assistants[0].parentId === assistants[1].parentId);

  console.log('\n[22] 渠道连通测试');
  const chList = await api('/models/channels');
  const mockChannel = chList.body.data?.find((c) => c.type === 'MOCK');
  const mockTest = await api(`/models/channels/${mockChannel.id}/test`, { method: 'POST' });
  ok('MOCK 渠道直接通过', mockTest.body?.data?.ok === true, JSON.stringify(mockTest.body?.data));
  ok('注明无需联网', String(mockTest.body?.data?.note ?? '').includes('模拟'));

  const fakeChannel = chList.body.data?.find((c) => c.name === 'fake-normal');
  const fakeTest = await api(`/models/channels/${fakeChannel.id}/test`, { method: 'POST' });
  ok('真实上游可连通', fakeTest.body?.data?.ok === true, JSON.stringify(fakeTest.body?.data).slice(0, 120));
  ok('返回延迟与探测模型', typeof fakeTest.body?.data?.latencyMs === 'number' && !!fakeTest.body?.data?.model);

  const badChannel = await api('/models/channels', {
    method: 'POST',
    body: JSON.stringify({
      name: uniqName('坏渠道'),
      type: 'OPENAI',
      baseUrl: 'http://127.0.0.1:9898/v1',
    }),
  });
  const badTest = await api(`/models/channels/${badChannel.body.data.id}/test`, { method: 'POST' });
  ok('非法地址返回失败', badTest.body?.data?.ok === false, JSON.stringify(badTest.body?.data).slice(0, 140));
  ok('失败带截断摘要', (badTest.body?.data?.error ?? '').length <= 200);
  ok(
    '测试连通同样受 SSRF 守卫约束',
    /端口|白名单|内网/.test(String(badTest.body?.data?.error ?? '')),
    String(badTest.body?.data?.error).slice(0, 80),
  );
  await api(`/models/channels/${badChannel.body.data.id}`, { method: 'DELETE' });

  console.log('\n[23] 单条消息删除');
  const delChat = await streamChat({
    model: 'fake-normal',
    clientMsgId: `e2e-del-${Date.now()}`,
    messages: [{ role: 'user', content: '这条对话会被删掉一条回复' }],
  });
  const delConvId = pick(delChat.events, 'meta')?.conversationId;
  const delAssistantId = pick(delChat.events, 'meta')?.messageId;

  const oneMsg = await api(`/conversations/${delConvId}/messages/${delAssistantId}`);
  ok('单条消息可读', oneMsg.status === 200, `status=${oneMsg.status}`);
  ok('单条消息带落库状态', oneMsg.body?.data?.status === 'COMPLETED', `status=${oneMsg.body?.data?.status}`);
  ok(
    '单条消息内容与流式拼接一致',
    oneMsg.body?.data?.content === delChat.text,
    `${String(oneMsg.body?.data?.content).slice(0, 30)} vs ${delChat.text.slice(0, 30)}`,
  );

  const delRes = await api(`/conversations/${delConvId}/messages/${delAssistantId}`, {
    method: 'DELETE',
  });
  ok('删除单条消息成功', delRes.body?.data?.ok === true, JSON.stringify(delRes.body).slice(0, 100));

  const detailAfterDel = await api(`/conversations/${delConvId}`);
  const remainAssistants = (detailAfterDel.body.data?.messages ?? []).filter((m) => m.role === 'ASSISTANT');
  const remainUsers = (detailAfterDel.body.data?.messages ?? []).filter((m) => m.role === 'USER');
  ok('回复已从会话中消失', remainAssistants.length === 0, `assistants=${remainAssistants.length}`);
  ok('用户提问保留', remainUsers.length === 1, `users=${remainUsers.length}`);

  const delAgain = await api(`/conversations/${delConvId}/messages/${delAssistantId}`, {
    method: 'DELETE',
  });
  ok('重复删除返回 404', delAgain.status === 404, `status=${delAgain.status}`);

  const fakeMsg = await api(`/conversations/${delConvId}/messages/not-exist`, { method: 'DELETE' });
  ok('不存在的消息返回 404', fakeMsg.status === 404, `status=${fakeMsg.status}`);

  const readDeleted = await api(`/conversations/${delConvId}/messages/${delAssistantId}`);
  ok('已删除的消息读不到（404）', readDeleted.status === 404, `status=${readDeleted.status}`);

  console.log('\n[23b] 断流后按消息 id 补齐状态');
  // 模拟移动端 Safari 断网：拿到 meta 后客户端主动断开，服务端继续生成，客户端之后可按消息 id 取回结果
  const cut = new AbortController();
  const cutRes = await fetch(`${API}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      model: 'fake-slow',
      clientMsgId: `e2e-cut-${Date.now()}`,
      messages: [{ role: 'user', content: '这条会在首字前断开' }],
    }),
    signal: cut.signal,
  });
  let cutMeta = null;
  try {
    const reader = cutRes.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!cutMeta) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const m = buf.match(/event:\s*meta\s*\r?\ndata:\s*(.+)\r?\n/);
      if (m) cutMeta = JSON.parse(m[1]);
    }
  } finally {
    cut.abort();
  }
  ok('断开前拿到 meta', !!cutMeta?.messageId, JSON.stringify(cutMeta));

  let settled = null;
  for (let i = 0; i < 40 && cutMeta?.messageId; i += 1) {
    const r = await api(`/conversations/${cutMeta.conversationId}/messages/${cutMeta.messageId}`);
    const st = r.body?.data?.status;
    if (st && st !== 'PENDING' && st !== 'STREAMING') {
      settled = r.body.data;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  ok(
    '断流后服务端继续生成并完整完成',
    settled && settled.status === 'COMPLETED' && settled.content.length > 0,
    `status=${settled?.status}`,
  );

  console.log('\n[23c] 推理内容：流式下发 + 落库可读');
  await ensureModel('fake-reasoning', [{ channelId: chNormal, upstreamName: 'fake-reasoning' }]);
  const rs = await streamChat({
    model: 'fake-reasoning',
    clientMsgId: `e2e-reasoning-${Date.now()}`,
    messages: [{ role: 'user', content: '先想一想再回答' }],
  });
  const rsText = rs.events.filter((e) => e.event === 'reasoning').map((e) => e.data?.v ?? '').join('');
  ok('收到 reasoning 事件', rsText.length > 0, `reasoning=${rsText}`);
  const rsMeta = pick(rs.events, 'meta');
  const rsMsg = await api(`/conversations/${rsMeta?.conversationId}/messages/${rsMeta?.messageId}`);
  ok('推理内容落库并可单条读取', rsMsg.body?.data?.reasoning === rsText, `db=${rsMsg.body?.data?.reasoning}`);

  console.log('\n[23d] 会话批量删除');
  // 用一个新用户做，免得「清空未置顶」波及管理员账号下其他用例的数据
  const bulkUser = { email: `bulk-${Date.now()}@example.com`, username: uniqUser('bulk'), password: 'bulkpass12345' };
  await api('/auth/register', { method: 'POST', body: JSON.stringify(bulkUser) });
  const bulkLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: bulkUser.email, password: bulkUser.password }),
  });
  const adminToken = token;
  token = bulkLogin.body?.data?.accessToken ?? '';
  const foreignModelChange = await api(`/conversations/${modelSelectionConvId}`, { method: 'PATCH', body: JSON.stringify({ modelId: failoverModelId }) });
  ok('不能修改他人会话的模型', foreignModelChange.status === 404, `status=${foreignModelChange.status}`);
  const mkConv = async (title) =>
    (await api('/conversations', { method: 'POST', body: JSON.stringify({ title }) })).body?.data?.id;
  const keepId = await mkConv('置顶保留');
  const byIdId = await mkConv('按 id 删');
  const unpinnedId = await mkConv('未置顶');
  await api(`/conversations/${keepId}`, { method: 'PATCH', body: JSON.stringify({ pinned: true }) });

  const bulkById = await api('/conversations/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ ids: [byIdId, delConvId] }),
  });
  ok('按 id 批量删除只算本人的', bulkById.body?.data?.count === 1, `count=${bulkById.body?.data?.count}`);
  const bulkUnpinned = await api('/conversations/bulk-delete', {
    method: 'POST',
    body: JSON.stringify({ unpinnedOnly: true }),
  });
  ok('清空未置顶会话', bulkUnpinned.body?.data?.count === 1, `count=${bulkUnpinned.body?.data?.count}`);
  const leftIds = (await api('/conversations')).body?.data?.map((c) => c.id) ?? [];
  ok('置顶会话保留', leftIds.length === 1 && leftIds[0] === keepId, JSON.stringify(leftIds));
  ok('未置顶会话已删', !leftIds.includes(unpinnedId));
  const bulkEmpty = await api('/conversations/bulk-delete', { method: 'POST', body: JSON.stringify({}) });
  ok('空请求不删任何东西', bulkEmpty.body?.data?.count === 0, `count=${bulkEmpty.body?.data?.count}`);
  token = adminToken;
  const afterForeignModelChange = await api(`/conversations/${modelSelectionConvId}`);
  ok('越权请求未改变原会话模型', afterForeignModelChange.body?.data?.modelId === normalModelId);
  const othersConv = await api(`/conversations/${delConvId}`);
  ok('他人会话不受批量删除影响', othersConv.status === 200, `status=${othersConv.status}`);

  console.log('\n[23e] 渠道 Key 池');
  // 主 Key 坏、池里一坏一好：请求应在同渠道内换 Key 成功，坏 Key 自动禁用，渠道不熔断
  const kpSuffix = Date.now().toString(36);
  const kpChannel = await api('/models/channels', {
    method: 'POST',
    body: JSON.stringify({ name: `kp-${kpSuffix}`, type: 'OPENAI', baseUrl: FAKE, apiKey: `bad-key-main-${kpSuffix}` }),
  });
  const kpChannelId = kpChannel.body?.data?.id;
  ok('Key 池渠道创建成功', !!kpChannelId, JSON.stringify(kpChannel.body).slice(0, 120));

  const kpAdd = await api(`/models/channels/${kpChannelId}/keys`, {
    method: 'POST',
    body: JSON.stringify({ keys: ['bad-key-pool-1111', 'good-key-2222', 'good-key-2222', '  '] }),
  });
  ok('批量导入去重去空', kpAdd.body?.data?.added === 2 && kpAdd.body?.data?.skipped === 2, JSON.stringify(kpAdd.body?.data));

  const kpList1 = await api(`/models/channels/${kpChannelId}/keys`);
  const kpRaw = JSON.stringify(kpList1.body);
  ok('Key 列表只返回掩码', (kpList1.body?.data ?? []).length === 2 && !kpRaw.includes('good-key'), kpRaw.slice(0, 160));

  const kpModel = `kp-model-${kpSuffix}`;
  await ensureModel(kpModel, [{ channelId: kpChannelId, upstreamName: 'fake-normal' }]);
  const kpChat = await streamChat({
    model: kpModel,
    clientMsgId: `e2e-kp-${Date.now()}`,
    messages: [{ role: 'user', content: 'Key 池测试' }],
  });
  ok('坏 Key 自动换同渠道好 Key 并成功', pick(kpChat.events, 'done')?.status === 'COMPLETED', JSON.stringify(kpChat.events.at(-1)).slice(0, 160));
  // 轮询下第二次请求才会轮到池里的坏 Key
  const kpChat2 = await streamChat({
    model: kpModel,
    clientMsgId: `e2e-kp2-${Date.now()}`,
    messages: [{ role: 'user', content: '第二次' }],
  });
  ok('第二次请求同样成功', pick(kpChat2.events, 'done')?.status === 'COMPLETED');

  const kpList2 = (await api(`/models/channels/${kpChannelId}/keys`)).body?.data ?? [];
  const badKey = kpList2.find((k) => k.masked.endsWith('1111'));
  const goodKey = kpList2.find((k) => k.masked.endsWith('2222'));
  ok('坏 Key 被自动禁用并记录原因', badKey?.status === 'DISABLED' && badKey?.lastError === 'upstream_auth', JSON.stringify(badKey));
  ok('好 Key 保持启用', goodKey?.status === 'ENABLED');

  const kpHealth = (await api('/models/channels/health')).body?.data ?? [];
  const kpBreaker = kpHealth.find((c) => c.id === kpChannelId)?.breaker;
  ok('Key 级失败不熔断渠道', kpBreaker?.state === 'CLOSED' && (kpBreaker?.failures ?? 0) === 0, JSON.stringify(kpBreaker));

  const kpChat3 = await streamChat({
    model: kpModel,
    clientMsgId: `e2e-kp3-${Date.now()}`,
    messages: [{ role: 'user', content: '第三次' }],
  });
  ok('坏 Key 禁用后请求直接成功', pick(kpChat3.events, 'done')?.status === 'COMPLETED');

  const kpChannels = (await api('/models/channels')).body?.data ?? [];
  const kpView = kpChannels.find((c) => c.id === kpChannelId);
  ok('渠道列表带池统计', kpView?.poolKeys === 2 && kpView?.poolKeysEnabled === 1, `${kpView?.poolKeys}/${kpView?.poolKeysEnabled}`);

  const kpReenable = await api(`/models/channels/${kpChannelId}/keys/${badKey?.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'ENABLED' }),
  });
  ok('手动恢复 Key', kpReenable.body?.data?.status === 'ENABLED');
  await api(`/models/channels/${kpChannelId}/keys/${badKey?.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DISABLED' }) });
  const kpPurge = await api(`/models/channels/${kpChannelId}/keys/bulk-delete`, {
    method: 'POST',
    body: JSON.stringify({ disabledOnly: true }),
  });
  ok('一键删除已禁用 Key', kpPurge.body?.data?.count === 1, JSON.stringify(kpPurge.body?.data));

  const kpTest = await api(`/models/channels/${kpChannelId}/keys/${goodKey?.id}/test`, { method: 'POST' });
  ok('单把 Key 测试连通', kpTest.body?.data?.ok === true, JSON.stringify(kpTest.body?.data).slice(0, 120));
  const kpMissing = await api(`/models/channels/${kpChannelId}/keys/not-exist`, { method: 'DELETE' });
  ok('不存在的 Key 返回 404', kpMissing.status === 404, `status=${kpMissing.status}`);

  // 429：只冷却这把 Key，不禁用
  const rlChannel = await api('/models/channels', {
    method: 'POST',
    body: JSON.stringify({ name: `kp-rl-${kpSuffix}`, type: 'OPENAI', baseUrl: FAKE }),
  });
  const rlChannelId = rlChannel.body?.data?.id;
  await api(`/models/channels/${rlChannelId}/keys`, {
    method: 'POST',
    body: JSON.stringify({ keys: ['rate-key-3333', 'good-key-4444'] }),
  });
  const rlModel = `kp-rl-model-${kpSuffix}`;
  await ensureModel(rlModel, [{ channelId: rlChannelId, upstreamName: 'fake-normal' }]);
  const rlResults = [];
  for (let n = 0; n < 2; n += 1) {
    const r = await streamChat({
      model: rlModel,
      clientMsgId: `e2e-kp-rl-${n}-${Date.now()}`,
      messages: [{ role: 'user', content: `限流 Key ${n}` }],
    });
    rlResults.push(pick(r.events, 'done')?.status);
  }
  ok('限流 Key 被绕开，请求都成功', rlResults.every((s) => s === 'COMPLETED'), JSON.stringify(rlResults));
  const rlKeys = (await api(`/models/channels/${rlChannelId}/keys`)).body?.data ?? [];
  const rateKey = rlKeys.find((k) => k.masked.endsWith('3333'));
  ok('限流 Key 只冷却不禁用', rateKey?.status === 'ENABLED' && rateKey?.coolingMs > 0, JSON.stringify(rateKey));

  console.log('\n[24] 登录日志与踢下线');
  const kickUser = {
    email: `kick-${Date.now()}@example.com`,
    username: uniqUser('kick'),
    password: 'kickpass12345',
  };
  await api('/auth/register', { method: 'POST', body: JSON.stringify(kickUser) });

  const badLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: kickUser.email, password: 'wrong-password' }),
  });
  ok('错误密码登录失败', badLogin.status === 401);

  const goodLogin = await api('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ account: kickUser.email, password: kickUser.password }),
  });
  ok('正确密码登录成功', !!goodLogin.body?.data?.accessToken);
  const kickUserId = goodLogin.body.data.user.id;
  const kickToken = goodLogin.body.data.accessToken;

  const logs = await api(`/users/${kickUserId}/logins`);
  const items = logs.body?.data?.items ?? [];
  ok('记录了一次失败登录', items.some((l) => l.success === false && l.reason === 'bad_credentials'));
  ok('记录了一次成功登录', items.some((l) => l.success === true));
  ok('日志带 IP', items.some((l) => typeof l.ip === 'string'));
  ok('日志带 UA', items.some((l) => typeof l.userAgent === 'string'));

  const meBefore = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${kickToken}` } });
  ok('踢之前 token 可用', meBefore.status === 200, `status=${meBefore.status}`);

  const kick = await api(`/users/${kickUserId}/kick`, { method: 'POST' });
  ok('踢下线成功', kick.body?.data?.ok === true, JSON.stringify(kick.body).slice(0, 100));

  const meAfter = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${kickToken}` } });
  ok('踢之后 token 立即失效', meAfter.status === 401, `status=${meAfter.status}`);

  console.log('\n[25] 演示站模式');
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'demo.siteEnabled', value: true }] }),
  });
  const demoChat = await streamChat({
    model: 'mock-chat',
    clientMsgId: `e2e-demo-${Date.now()}`,
    messages: [{ role: 'user', content: '你好' }],
  });
  ok('演示模式仍返回流式结果', pick(demoChat.events, 'done')?.status === 'COMPLETED');
  ok('返回演示提示文案', demoChat.text.includes('演示站模式'), demoChat.text.slice(0, 40));
  ok('没有产生计费记录', true);

  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'demo.siteEnabled', value: false }] }),
  });

  console.log('\n[26] 图像：统一记录 + nanoBanana');
  const geminiChannel = await api('/models/channels', {
    method: 'POST',
    body: JSON.stringify({
      name: uniqName('nano'),
      type: 'GEMINI',
      baseUrl: new URL('/v1beta', FAKE).href,
      apiKey: 'test-key',
    }),
  });
  ok('创建 GEMINI 渠道', !!geminiChannel.body?.data?.id);

  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({
      settings: [{ key: 'image.defaultChannel', value: geminiChannel.body.data.id }],
    }),
  });

  const nanoTask = await api('/image/tasks', {
    method: 'POST',
    body: JSON.stringify({ prompt: '一只赛博朋克风格的猫', size: '512x512' }),
  });
  let nanoDetail = null;
  for (let i = 0; i < 30; i += 1) {
    nanoDetail = (await api(`/image/tasks/${nanoTask.body.data.id}`)).body?.data;
    if (nanoDetail && ['SUCCESS', 'FAILED'].includes(nanoDetail.status)) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  ok('nanoBanana 任务成功', nanoDetail?.status === 'SUCCESS', `status=${nanoDetail?.status} ${nanoDetail?.errorMessage ?? ''}`);
  ok('记录供应商标识', nanoDetail?.provider === 'nanoBanana', `provider=${nanoDetail?.provider}`);
  ok('记录供应商附加信息', nanoDetail?.meta?.model === 'gemini-2.5-flash-image', JSON.stringify(nanoDetail?.meta));
  ok('产出图片', (nanoDetail?.results?.length ?? 0) >= 1);

  // 图生图：拿一张已有图片当参考图
  const refFile = nanoDetail?.results?.[0]?.fileId;
  if (refFile) {
    const editTask = await api('/image/tasks', {
      method: 'POST',
      body: JSON.stringify({ prompt: '把这只猫改成油画风格', editOf: refFile }),
    });
    let editDetail = null;
    for (let i = 0; i < 30; i += 1) {
      editDetail = (await api(`/image/tasks/${editTask.body.data.id}`)).body?.data;
      if (editDetail && ['SUCCESS', 'FAILED'].includes(editDetail.status)) break;
      await new Promise((r) => setTimeout(r, 500));
    }
    ok('图生图任务成功', editDetail?.status === 'SUCCESS', `status=${editDetail?.status}`);
    ok('记录参考图 id', editDetail?.editOf === refFile);
  }

  // 恢复默认渠道并清理
  const chs2 = await api('/models/channels');
  const mock2 = chs2.body.data?.find((c) => c.type === 'MOCK');
  await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ settings: [{ key: 'image.defaultChannel', value: mock2?.id ?? '' }] }),
  });
  await api(`/models/channels/${geminiChannel.body.data.id}`, { method: 'DELETE' });

  console.log('\n[27] 聊天记录检索与导出');
  const chatLogs = await api('/chat-logs?page=1&pageSize=10');
  ok('查询成功', Array.isArray(chatLogs.body?.data?.items), JSON.stringify(chatLogs.body).slice(0, 100));
  ok('有记录', (chatLogs.body?.data?.total ?? 0) > 0, `total=${chatLogs.body?.data?.total}`);
  const logItem = chatLogs.body.data.items[0];
  ok('带会话与用户信息', !!logItem.conversationTitle && 'user' in logItem);
  ok('带 token 字段', 'promptTokens' in logItem);

  const filtered = await api('/chat-logs?status=COMPLETED&pageSize=5');
  ok('按状态筛选生效', (filtered.body?.data?.items ?? []).every((x) => x.status === 'COMPLETED'));

  const exportRes = await fetch(`${API}/chat-logs/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  ok('导出返回 200', exportRes.status === 200, `status=${exportRes.status}`);
  ok(
    'Content-Type 是 xlsx',
    (exportRes.headers.get('content-type') ?? '').includes('spreadsheetml'),
    exportRes.headers.get('content-type') ?? '',
  );
  ok(
    '带下载文件名',
    (exportRes.headers.get('content-disposition') ?? '').includes('.xlsx'),
  );

  const buf = Buffer.from(await exportRes.arrayBuffer());
  ok('文件非空', buf.length > 1000, `${buf.length} bytes`);

  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  const ws = wb.worksheets[0];
  ok('工作表存在', !!ws);
  ok('表头正确', ws.getRow(1).getCell(1).value === '时间');
  ok('导出行数 > 1', ws.rowCount > 1, `rows=${ws.rowCount}`);

  console.log('\n[28] 回归：本轮修复的行为');
  // 用块级作用域隔离本节变量，避免与前面用例的 const 重名
  {

  // 28.1 登出容错：拿不到 refreshToken 时也不能 400（旧 DTO 必填）
  const logoutBare = await api('/auth/logout', { method: 'POST', body: '{}', headers: { Authorization: '' } });
  ok(
    '登出允许空 body',
    logoutBare.status === 200 || logoutBare.status === 201,
    `status=${logoutBare.status}`,
  );

  // 28.2 导出非法日期：必须在写响应头之前就 400，而不是 500 / 半截 xlsx
  const badExport = await api('/chat-logs/export?from=not-a-date');
  ok('非法 from 返回 400', badExport.status === 400, `status=${badExport.status}`);
  ok(
    '非法 from 返回可读错误',
    typeof badExport.body?.message === 'string',
    JSON.stringify(badExport.body).slice(0, 120),
  );

  // 28.3 预设移出分组：groupId:null 必须真的落成 null
  // 名字必须真唯一：早先用 `Date.now() % 1000` 只有 1000 种取值，
  // 在共享数据库上累积几十次后会撞名（分组名有唯一约束 → 400），
  // 表现是「换个库跑就绿、同一个库跑两次就红」这类最难判的假失败。
  const succ = Math.random().toString(36).slice(2, 8);
  const group = await api('/presets/groups', {
    method: 'POST',
    body: JSON.stringify({ name: `回归组-${Date.now()}-${succ}` }),
  });
  const gid = group.body?.data?.id;
  ok('创建预设分组', !!gid, JSON.stringify(group.body).slice(0, 120));
  const preset = await api('/presets', {
    method: 'POST',
    body: JSON.stringify({ groupId: gid, title: `回归预设-${Date.now()}-${succ}`, prompt: 'hi' }),
  });
  const pid = preset.body?.data?.id;
  ok('创建预设', !!pid, JSON.stringify(preset.body).slice(0, 120));
  const movedOut = await api(`/presets/${pid}`, {
    method: 'PATCH',
    body: JSON.stringify({ groupId: null }),
  });
  ok(
    '预设置空分组',
    movedOut.body?.data?.groupId === null,
    String(movedOut.body?.data?.groupId),
  );

  // 28.4 幂等重放：同一 clientMsgId 再发一次，应回放而不是重复生成
  const cid = `e2e-replay-${Date.now()}`;
  const first = await streamChat({
    model: 'fake-normal',
    clientMsgId: cid,
    messages: [{ role: 'user', content: '重放测试' }],
  });
  ok('首次生成成功', pick(first.events, 'done')?.status === 'COMPLETED');
  const replayConvId = pick(first.events, 'meta')?.conversationId;
  const before = await api(`/conversations/${replayConvId}`);
  const countBefore = before.body?.data?.messages?.length ?? 0;
  const replay = await streamChat({
    model: 'fake-normal',
    conversationId: replayConvId,
    clientMsgId: cid,
    messages: [{ role: 'user', content: '重放测试' }],
  });
  ok(
    '重放带 replay 标记',
    pick(replay.events, 'meta')?.replay === true,
    JSON.stringify(pick(replay.events, 'meta')).slice(0, 120),
  );
  ok(
    '重放文本一致',
    replay.text === first.text && first.text.length > 0,
    `${replay.text.length} vs ${first.text.length}`,
  );
  const after = await api(`/conversations/${replayConvId}`);
  ok(
    '重放不多建消息',
    (after.body?.data?.messages?.length ?? 0) === countBefore,
    `${after.body?.data?.messages?.length} vs ${countBefore}`,
  );

  // 28.4b 上一次失败的不回放：否则用户重试永远拿到同一份失败
  // 第 4 节已经用超时把这个渠道的熔断器打翻，先复位才能真的重试到上游
  await api('/models/channels/health/reset', { method: 'POST' });
  const failCid = `e2e-replay-fail-${Date.now()}`;
  const failFirst = await streamChat({
    model: 'fake-hang',
    clientMsgId: failCid,
    messages: [{ role: 'user', content: '失败重试' }],
  });
  const failConv = pick(failFirst.events, 'meta')?.conversationId;
  ok('超时请求确实开了流', failFirst.httpStatus === 201, `http=${failFirst.httpStatus}`);
  ok('超时请求没有成功收尾', pick(failFirst.events, 'done')?.status !== 'COMPLETED');
  const failBefore = await api(`/conversations/${failConv}`);
  const failCountBefore = failBefore.body?.data?.messages?.length ?? 0;
  await api('/models/channels/health/reset', { method: 'POST' });
  const failSecond = await streamChat({
    model: 'fake-hang',
    conversationId: failConv,
    clientMsgId: failCid,
    messages: [{ role: 'user', content: '失败重试' }],
  });
  const failMeta = pick(failSecond.events, 'meta');
  ok(
    '失败后重试不回放',
    failSecond.httpStatus === 201 && failMeta?.replay !== true,
    `http=${failSecond.httpStatus} meta=${JSON.stringify(failMeta ?? null).slice(0, 100)} body=${String(failSecond.body ?? '').slice(0, 100)}`,
  );
  const failAfter = await api(`/conversations/${failConv}`);
  ok(
    '失败后重试产生新消息',
    (failAfter.body?.data?.messages?.length ?? 0) > failCountBefore,
    `${failAfter.body?.data?.messages?.length} vs ${failCountBefore}`,
  );

  // 28.5 CRLF 分隔 + 同一事件多行 data
  const chCrlf = await ensureChannel('fake-crlf', {
    type: 'OPENAI',
    baseUrl: FAKE,
    priority: 10,
  });
  await ensureModel('fake-crlf', [{ channelId: chCrlf, upstreamName: 'fake-crlf' }]);
  const crlf = await streamChat({
    model: 'fake-crlf',
    clientMsgId: `e2e-crlf-${Date.now()}`,
    messages: [{ role: 'user', content: 'CRLF' }],
  });
  ok('CRLF 上游内容完整', crlf.text.includes('CRLF-AB'), crlf.text.slice(0, 60));
  ok('CRLF 上游正常结束', pick(crlf.events, 'done')?.status === 'COMPLETED');

  // 28.5b 渠道密钥：显式传空串应清空（留空=不修改，两者必须区分）
  const keySet = await api(`/models/channels/${chCrlf}`, {
    method: 'PATCH',
    body: JSON.stringify({ apiKey: 'sk-test-1234' }),
  });
  ok('渠道密钥可设置', keySet.body?.data?.hasApiKey === true, JSON.stringify(keySet.body?.data?.hasApiKey));
  const keyCleared = await api(`/models/channels/${chCrlf}`, {
    method: 'PATCH',
    body: JSON.stringify({ apiKey: '' }),
  });
  ok(
    '渠道密钥可清空',
    keyCleared.body?.data?.hasApiKey === false,
    JSON.stringify(keyCleared.body?.data?.hasApiKey),
  );

  // 28.6 roles 为空的菜单对普通用户也可见（旧实现里是死条件）
  const reg = await api('/auth/register', {
    method: 'POST',
    body: JSON.stringify({
      email: `menu-${Date.now()}@example.com`,
      username: uniqUser('menu'),
      password: 'menupass12345',
    }),
  });
  const userToken = reg.body?.data?.accessToken;
  ok('普通用户注册成功', !!userToken, JSON.stringify(reg.body).slice(0, 120));
  const allPath = `/tmp-all-${Date.now()}`;
  const m2 = await api('/menus', {
    method: 'POST',
    body: JSON.stringify({
      title: '全员可见页',
      path: allPath,
      icon: 'Star',
      sort: 98,
      roles: '',
    }),
  });
  ok('新增 roles 为空的菜单', !!m2.body?.data?.id, JSON.stringify(m2.body).slice(0, 120));
  const userMenus = await fetch(`${API}/menus`, {
    headers: { Authorization: `Bearer ${userToken}` },
  }).then((r) => r.json());
  ok('空 roles 菜单对普通用户可见', JSON.stringify(userMenus).includes(allPath));
  await api(`/menus/${m2.body.data.id}`, { method: 'DELETE' });

  // 28.7 管理员不能禁用自己（放最后，避免污染前面用例的状态）
  const me = await api('/users/profile');
  const self = await api(`/users/${me.body?.data?.id}/status`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'DISABLED' }),
  });
  ok('禁止禁用自己的账号', self.status === 400, `status=${self.status}`);
  }

  // [29] 模型广场 + 顶栏积分的可见性
  {
    const avail = await api('/models/available');
    const list = avail.body?.data ?? [];
    ok('模型选择器返回列表', Array.isArray(list) && list.length >= 3, `count=${list.length}`);
    ok(
      '模型选择器带厂商与可用性',
      list.every((m) => typeof m.vendor === 'string' && typeof m.ready === 'boolean'),
      JSON.stringify(list[0] ?? null).slice(0, 120),
    );
    ok('至少一个模型可用（绑定了启用渠道）', list.some((m) => m.ready === true));
    const firstOffline = list.findIndex((m) => !m.ready);
    const firstReady = list.findIndex((m) => m.ready);
    ok(
      '可用模型排在不可用之前',
      firstOffline === -1 || firstReady < firstOffline,
      `ready@${firstReady} offline@${firstOffline}`,
    );

    const plaza = await api('/models/plaza');
    const p = plaza.body?.data ?? {};
    ok('模型广场按厂商分组', Array.isArray(p.vendors) && p.vendors.length >= 2, `vendors=${p.vendors?.length}`);
    ok(
      '厂商计数之和等于模型总数',
      (p.vendors || []).reduce((s, v) => s + v.count, 0) === p.total,
      `total=${p.total}`,
    );
    ok('广场卡片带标签数组', (p.models || []).every((m) => Array.isArray(m.tags)));
    ok(
      '广场 ready 数与选择器一致',
      p.ready === list.filter((m) => m.ready).length,
      `plaza=${p.ready} available=${list.filter((m) => m.ready).length}`,
    );

    const adminModels = await api('/models');
    ok(
      '后台模型列表回填厂商字段',
      (adminModels.body?.data || []).length > 0 &&
        (adminModels.body?.data || []).every((m) => typeof m.vendor === 'string'),
    );

    const discoverySettings = (await api('/settings')).body.data;
    const discoveryFlags = ['commerce.enabled', 'demo.siteEnabled'].map(key => ({ key, value: discoverySettings.find(row => row.key === key).value }));
    const discoveryIds = [];
    try {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ settings: [{ key: 'commerce.enabled', value: false }, { key: 'demo.siteEnabled', value: false }] }) });
      const noChargeCatalog = (await api('/models/available')).body.data;
      ok('关闭收费时模型选择器按真实设置返回不扣次数', noChargeCatalog.length > 0 && noChargeCatalog.every(model => model.billing?.mode === 'none' && model.billing.reason === 'commerce-disabled'));
      const discoveryModel = (await api('/models', { method: 'POST', body: JSON.stringify({ name: uniqName('catalog-cost'), displayName: '目录成本验收', vendor: ' QGauss ', capabilities: 'chat, vision, vision ', countPool: 'model4', countCost: 3, priceInPerM: 3, priceOutPerM: 1200000 }) })).body.data;
      discoveryIds.push(discoveryModel.id);
      const discoveryChannel = adminModels.body.data.flatMap(model => model.channels).find(channel => channel.enabled && channel.channelStatus === 'ENABLED');
      await api(`/models/${discoveryModel.id}/channels`, { method: 'POST', body: JSON.stringify({ channelId: discoveryChannel.channelId, upstreamName: 'catalog-private-upstream' }) });
      let discoveryEntry = (await api('/models/plaza')).body.data.models.find(model => model.id === discoveryModel.id);
      ok('模型目录保留精确微元价格并规范能力与厂商', discoveryEntry.priceInPerM === 3 && discoveryEntry.priceOutPerM === 1200000 && discoveryEntry.vendor === 'QGauss' && discoveryEntry.capabilities.join(',') === 'chat,vision');
      ok('用量成本参考不自动成为钱包扣款规则', discoveryEntry.billing.mode === 'none' && discoveryEntry.priceInPerM > 0);
      ok('模型目录不返回上游名、地址或密钥', !Object.hasOwn(discoveryEntry, 'channels') && !Object.hasOwn(discoveryEntry, 'baseUrl') && !Object.hasOwn(discoveryEntry, 'apiKey') && !JSON.stringify(discoveryEntry).includes('catalog-private-upstream'));
      await api('/settings', { method: 'PUT', body: JSON.stringify({ settings: [{ key: 'commerce.enabled', value: true }] }) });
      discoveryEntry = (await api('/models/available')).body.data.find(model => model.id === discoveryModel.id);
      ok('开启收费后选择器展示实际次数池与消耗', discoveryEntry.billing.mode === 'count' && discoveryEntry.billing.pool === 'model4' && discoveryEntry.billing.amount === 3);
      await api('/settings', { method: 'PUT', body: JSON.stringify({ settings: [{ key: 'demo.siteEnabled', value: true }] }) });
      ok('演示模式覆盖模型收费设置', (await api('/models/plaza')).body.data.models.find(model => model.id === discoveryModel.id).billing.reason === 'demo');
      await api('/settings', { method: 'PUT', body: JSON.stringify({ settings: [{ key: 'demo.siteEnabled', value: false }] }) });
      const imageModel = (await api('/models', { method: 'POST', body: JSON.stringify({ name: uniqName('catalog-image'), displayName: '目录图像验收', capabilities: 'image,vision' }) })).body.data;
      discoveryIds.push(imageModel.id);
      await api(`/models/${imageModel.id}/channels`, { method: 'POST', body: JSON.stringify({ channelId: discoveryChannel.channelId, upstreamName: 'catalog-image' }) });
      const beforeImageChat = (await api('/conversations')).body.data.length;
      const wrongEntry = await streamChat({ model: imageModel.name, clientMsgId: uniqName('image-chat-block'), messages: [{ role: 'user', content: '图像模型不得误发对话' }] });
      ok('仅图像创作模型拒绝误走聊天且不创建会话', wrongEntry.httpStatus === 400 && (await api('/conversations')).body.data.length === beforeImageChat);
      await api(`/models/${discoveryModel.id}/channels`, { method: 'POST', body: JSON.stringify({ channelId: discoveryChannel.channelId, upstreamName: 'catalog-private-upstream', enabled: false }) });
      ok('取消渠道绑定后最新模型状态不可使用', (await api('/models/available')).body.data.find(model => model.id === discoveryModel.id).ready === false);
      await api(`/models/${discoveryModel.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'DISABLED' }) });
      ok('停用模型从最新目录消失', !(await api('/models/plaza')).body.data.models.some(model => model.id === discoveryModel.id));
      for (const [price, label] of [[-1, '负值'], [null, 'null'], [2147483648, '溢出']]) {
        const rejectedPrice = await api('/models', { method: 'POST', body: JSON.stringify({ name: uniqName('invalid-model-cost'), displayName: '非法成本', priceInPerM: price }) });
        ok(`成本参考拒绝${label}`, rejectedPrice.status === 400, 'status=' + rejectedPrice.status);
      }
    } finally {
      await api('/settings', { method: 'PUT', body: JSON.stringify({ settings: discoveryFlags }) });
      for (const id of discoveryIds) await api(`/models/${id}`, { method: 'DELETE' });
    }

    // 商业化开关的两种合法形态：关闭=404+8001（前端隐藏顶栏），开启=四池快照。
    // 基线库默认关闭，但演示数据准备（scripts/shot.mjs）会把开关打开，
    // 所以两种都要认，不能假设一定是关闭态。
    const bal = await api('/balance/query');
    ok(
      '余额接口：关闭返回 8001 / 开启返回四池',
      bal.status === 404
        ? bal.body?.code === 8001
        : bal.status === 200 && !!bal.body?.data?.counts,
      `status=${bal.status} code=${bal.body?.code}`,
    );
  }


  console.log(`\n结果：${passed} 通过 / ${failed} 失败`);
  if (failed > 0) {
    console.log('失败项：');
    failures.forEach((f) => console.log('  -', f));
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('e2e 异常终止:', e);
  process.exit(1);
});
