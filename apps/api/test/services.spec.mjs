import { test } from 'node:test';
import assert from 'node:assert/strict';

import { RateLimitService } from '../dist/common/ratelimit/rate-limit.service.js';
import { ModerationService } from '../dist/modules/moderation/moderation.service.js';
import { QuotaService } from '../dist/modules/chat/quota.service.js';
import { ModelsService } from '../dist/modules/models/models.service.js';

/* ------------------------------------------------------------------ *
 * RateLimitService（令牌桶）
 * ------------------------------------------------------------------ */

test('限流：达到上限后拒绝', () => {
  const rl = new RateLimitService();
  assert.equal(rl.tryConsume('k', 3), true);
  assert.equal(rl.tryConsume('k', 3), true);
  assert.equal(rl.tryConsume('k', 3), true);
  assert.equal(rl.tryConsume('k', 3), false);
});

test('限流：不同 key 互不影响', () => {
  const rl = new RateLimitService();
  assert.equal(rl.tryConsume('a', 1), true);
  assert.equal(rl.tryConsume('a', 1), false);
  assert.equal(rl.tryConsume('b', 1), true);
});

test('限流：limit<=0 表示不限', () => {
  const rl = new RateLimitService();
  for (let i = 0; i < 100; i += 1) assert.equal(rl.tryConsume('k', 0), true);
});

test('限流：改配置立即生效（不沿用旧上限）', () => {
  const rl = new RateLimitService();
  assert.equal(rl.tryConsume('k', 5), true);
  assert.equal(rl.tryConsume('k', 5), true); // 旧桶剩 3
  // 上限改成 2：应重建桶，而不是继续用剩 3 的旧桶
  assert.equal(rl.tryConsume('k', 2), true);
  assert.equal(rl.tryConsume('k', 2), true);
  assert.equal(rl.tryConsume('k', 2), false);
});

test('限流：窗口过期后重新放行（windowMs=0）', () => {
  const rl = new RateLimitService();
  assert.equal(rl.tryConsume('k', 1, 0), true);
  // resetAt 已过期，下一次会重建
  assert.equal(rl.tryConsume('k', 1, 0), true);
});

/* ------------------------------------------------------------------ *
 * ModerationService（敏感词）
 * ------------------------------------------------------------------ */

function makeModeration(words = []) {
  const calls = { findMany: 0, hits: [] };
  const prisma = {
    sensitiveWord: {
      findMany: async () => {
        calls.findMany += 1;
        return words.map((w) => ({ word: w.word, action: w.action ?? 'block' }));
      },
    },
    moderationHit: {
      create: async ({ data }) => {
        calls.hits.push(data);
        return data;
      },
    },
  };
  return { service: new ModerationService(prisma), calls };
}

test('敏感词：命中返回词与动作', async () => {
  const { service } = makeModeration([{ word: '坏词' }]);
  const hit = await service.check('这里有一个坏词');
  assert.equal(hit.word, '坏词');
  assert.equal(hit.action, 'block');
});

test('敏感词：未命中返回 null', async () => {
  const { service } = makeModeration([{ word: '坏词' }]);
  assert.equal(await service.check('干净内容'), null);
  assert.equal(await service.check(''), null);
});

test('敏感词：长词优先（避免短词先命中）', async () => {
  const { service } = makeModeration([{ word: '坏' }, { word: '坏词组合' }]);
  const hit = await service.check('这是坏词组合');
  assert.equal(hit.word, '坏词组合');
});

test('敏感词：大小写不敏感', async () => {
  const { service } = makeModeration([{ word: 'BadWord' }]);
  const hit = await service.check('contains badword here');
  assert.equal(hit.word, 'BadWord');
});

test('敏感词：缓存生效，第二次不查库', async () => {
  const { service, calls } = makeModeration([{ word: 'x' }]);
  await service.check('x');
  await service.check('x');
  assert.equal(calls.findMany, 1);
});

test('敏感词：invalidate 后重新加载', async () => {
  const { service, calls } = makeModeration([{ word: 'x' }]);
  await service.check('x');
  service.invalidate();
  await service.check('x');
  assert.equal(calls.findMany, 2);
});

test('敏感词：review 动作原样返回', async () => {
  const { service } = makeModeration([{ word: '待审词', action: 'review' }]);
  const hit = await service.check('包含待审词');
  assert.equal(hit.action, 'review');
});

test('敏感词：recordHit 落库并截断摘录', async () => {
  const { service, calls } = makeModeration([]);
  await service.recordHit({ userId: 'u1', word: 'w', excerpt: 'x'.repeat(500) });
  assert.equal(calls.hits.length, 1);
  assert.equal(calls.hits[0].excerpt.length, 200);
  assert.equal(calls.hits[0].source, 'chat');
});

/* ------------------------------------------------------------------ *
 * QuotaService（每日额度）
 * ------------------------------------------------------------------ */

function makeQuota({ limit = 1000, prompt = 0, completion = 0 } = {}) {
  const prisma = {
    usageRecord: {
      aggregate: async () => ({
        _sum: { promptTokens: prompt, completionTokens: completion },
      }),
    },
  };
  const settings = { get: async () => limit };
  return new QuotaService(prisma, settings);
}

test('配额：未超限放行', async () => {
  const q = makeQuota({ limit: 100, prompt: 10, completion: 20 });
  await assert.doesNotReject(() => q.assertWithinQuota('u1'));
});

test('配额：达到上限抛 429', async () => {
  const q = makeQuota({ limit: 100, prompt: 60, completion: 40 });
  await assert.rejects(
    () => q.assertWithinQuota('u1'),
    (e) => {
      assert.equal(e.getStatus(), 429);
      assert.match(e.message, /额度/);
      return true;
    },
  );
});

test('配额：limit=0 表示不限', async () => {
  const q = makeQuota({ limit: 0, prompt: 999999, completion: 999999 });
  await assert.doesNotReject(() => q.assertWithinQuota('u1'));
});

test('配额：summary 计算剩余与重置时间', async () => {
  const q = makeQuota({ limit: 1000, prompt: 100, completion: 50 });
  const s = await q.summary('u1');
  assert.equal(s.limit, 1000);
  assert.equal(s.used, 150);
  assert.equal(s.remaining, 850);
  assert.ok(new Date(s.resetsAt).getTime() > Date.now());
});

/* ------------------------------------------------------------------ *
 * ModelsService.resolveRoute（渠道路由）
 * ------------------------------------------------------------------ */

function makeModels(model) {
  const prisma = {
    aiModel: { findUnique: async () => model },
    channel: {},
  };
  const box = { decrypt: (v) => (v ? `plain:${v}` : '') };
  return new ModelsService(prisma, box);
}

function modelWith(channels) {
  return {
    id: 'm1',
    name: 'gpt-x',
    status: 'ENABLED',
    deletedAt: null,
    maxContext: 8192,
    maxOutput: 1024,
    channels: channels.map((c) => ({
      channelId: c.id,
      enabled: true,
      weight: c.weight ?? 1,
      upstreamName: c.upstreamName ?? 'up',
      channel: {
        id: c.id,
        name: c.name ?? c.id,
        type: c.type ?? 'OPENAI',
        baseUrl: c.baseUrl ?? 'https://api.example.com/v1',
        apiKeyEnc: c.apiKeyEnc ?? '',
        timeoutMs: c.timeoutMs ?? 60000,
        priority: c.priority ?? 0,
        status: c.status ?? 'ENABLED',
        deletedAt: c.deletedAt ?? null,
      },
    })),
  };
}

test('路由：按 priority 升序、weight 降序排列', async () => {
  const svc = makeModels(
    modelWith([
      { id: 'c-low', priority: 20, weight: 9 },
      { id: 'c-high', priority: 1, weight: 1 },
      { id: 'c-mid', priority: 10, weight: 5 },
    ]),
  );
  const { channels } = await svc.resolveRoute('gpt-x');
  assert.deepEqual(channels.map((c) => c.id), ['c-high', 'c-mid', 'c-low']);
});

test('路由：停用/软删的渠道被过滤', async () => {
  const svc = makeModels(
    modelWith([
      { id: 'ok' },
      { id: 'disabled', status: 'DISABLED' },
      { id: 'deleted', deletedAt: new Date() },
    ]),
  );
  const { channels } = await svc.resolveRoute('gpt-x');
  assert.deepEqual(channels.map((c) => c.id), ['ok']);
});

test('路由：模型不存在抛 404', async () => {
  const svc = makeModels(null);
  await assert.rejects(
    () => svc.resolveRoute('nope'),
    (e) => {
      assert.equal(e.getStatus(), 404);
      return true;
    },
  );
});

test('路由：模型停用抛错', async () => {
  const model = modelWith([{ id: 'c1' }]);
  model.status = 'DISABLED';
  const svc = makeModels(model);
  await assert.rejects(() => svc.resolveRoute('gpt-x'), /已停用/);
});

test('路由：没有可用渠道时抛 CHANNEL_UNAVAILABLE', async () => {
  const svc = makeModels(modelWith([{ id: 'c1', status: 'DISABLED' }]));
  await assert.rejects(
    () => svc.resolveRoute('gpt-x'),
    (e) => {
      assert.match(e.message, /暂无可用渠道/);
      return true;
    },
  );
});

test('路由：密钥解密失败不阻塞，返回空串', async () => {
  const prisma = { aiModel: { findUnique: async () => modelWith([{ id: 'c1', apiKeyEnc: 'v1:bad' }]) } };
  const box = {
    decrypt: () => {
      throw new Error('bad key');
    },
  };
  const svc = new ModelsService(prisma, box);
  const { channels } = await svc.resolveRoute('gpt-x');
  assert.equal(channels[0].apiKey, '');
});
