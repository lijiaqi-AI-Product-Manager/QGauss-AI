#!/usr/bin/env node
/**
 * 一键 e2e：自己拉起 fake-upstream 与 API，跑完 test/e2e.mjs 后把子进程收干净。
 *
 * 之前 test/e2e.mjs 需要手工起两个服务，很容易踩两个坑：
 *   1. 忘了起服务 → 只看到 `fetch failed / ECONNREFUSED`，不知道是环境问题还是代码问题；
 *   2. 上一个会话遗留的旧进程还占着端口 → 新进程 EADDRINUSE 退出，e2e 却打到了**旧代码**上。
 * 这个脚本先做端口预检，再按顺序拉起、健康检查、执行、清理。
 *
 * 用法（先 npm run build）：
 *   npm run e2e:auto
 *   E2E_PORT=9600 FAKE_PORT=9900 npm run e2e:auto
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { DatabaseSync, backup } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { upgradeIsolatedDatabase } from './isolated-migrations.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const apiPort = Number(process.env.E2E_PORT ?? 9520);
const fakePort = Number(process.env.FAKE_PORT ?? 9899);
const apiBase = `http://127.0.0.1:${apiPort}/api`;

/**
 * 测试库隔离：复制一份 dev.db 再跑。
 *
 * 之前的做法是直接写 dev.db，结果每跑一轮 e2e 就往演示库里塞几十个
 * bill-model-xxx / fake-xxx 模型和渠道，模型广场和后台列表全是测试残留，
 * 而「干净基线」也做不到——上一轮的配置开关、限流计数会串到下一轮。
 * 使用 SQLite backup 取得包括 WAL 已提交内容的一致性快照，跑完删除测试副本。
 */
const devDb = join(root, 'prisma', 'dev.db');
const e2eDb = join(root, 'prisma', 'e2e.db');
const testStorage = mkdtempSync(join(tmpdir(), 'qgauss-e2e-storage-'));

function removeTestStorage() {
  const absolute = resolve(testStorage);
  if (!absolute.startsWith(resolve(tmpdir()) + sep + 'qgauss-e2e-storage-')) throw new Error('测试存储目录越界，停止清理');
  rmSync(absolute, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

function removeTestDb() {
  // Windows 下 API 刚被 SIGTERM 时文件句柄可能还没释放，rm 会抛 EPERM。
  // 重试几次就够；删不掉也只是留个文件，下次运行开头会覆盖，不该让 e2e 变红。
  for (let i = 0; i < 10; i += 1) {
    try {
      rmSync(e2eDb, { force: true });
      for (const suffix of ['.qgauss-lock.sqlite','.qgauss-lock.sqlite-journal']) rmSync(e2eDb+suffix,{force:true});
      return;
    } catch (err) {
      if (err?.code !== 'EPERM' && err?.code !== 'EBUSY') return;
      const until = Date.now() + 200;
      while (Date.now() < until) {
        /* 同步小睡，等句柄释放 */
      }
    }
  }
  console.warn('[e2e] e2e.db 暂时删不掉（句柄未释放），下次运行会自动覆盖');
}

const children = [];

function cleanup() {
  for (const { name, child } of children) {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill('SIGTERM');
      } catch {
        console.error(`[${name}] 结束失败，请手工检查进程`);
      }
    }
  }
}

process.on('exit', () => { cleanup(); try { removeTestStorage(); } catch { console.warn('[e2e] 临时存储清理失败：' + testStorage); } });
process.on('SIGINT', () => {
  cleanup();
  process.exit(130);
});

/** 端口预检：避免把请求打到上次遗留的旧服务上 */
function assertPortFree(port, label) {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once('error', () => {
      console.error(
        `端口 ${port}（${label}）已被占用。先停掉遗留进程再跑：\n` +
          `  netstat -ano | findstr :${port}\n` +
          `  taskkill /PID <pid> /F`,
      );
      process.exit(1);
    });
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

function start(name, script, env = {}) {
  const child = spawn(process.execPath, [...(name === 'api' ? ['--require', join(here, 'startup-probe.cjs')] : []), script], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, ...env },
  });
  child.on('exit', (code, signal) => {
    if (code && code !== 0 && signal !== 'SIGTERM') {
      console.error(`[${name}] 异常退出，exit=${code}`);
    }
  });
  children.push({ name, child });
  return child;
}

async function waitHealthy(timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${apiBase}/health`);
      if (res.ok) return true;
    } catch {
      /* 还在启动 */
    }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function main() {
  if (!existsSync(join(root, 'dist', 'main.js'))) {
    console.error('缺少 dist/main.js，请先运行 npm run build');
    process.exit(1);
  }

  await assertPortFree(fakePort, 'fake-upstream');
  await assertPortFree(apiPort, 'api');

  if (!existsSync(devDb)) {
    console.error('[e2e] 找不到 prisma/dev.db，先跑 npm run db:init && npm run seed');
    process.exit(1);
  }
  removeTestDb();
  const source = new DatabaseSync(devDb,{readOnly:true});
  try { await backup(source,e2eDb); } finally { source.close(); }
  await upgradeIsolatedDatabase(e2eDb);
  const databaseUrl = 'file:./e2e.db';
  console.log(`[e2e] 测试库: prisma/e2e.db（dev.db 的副本，跑完删除）`);

  console.log(`[e2e] 拉起 fake-upstream:${fakePort} 与 API:${apiPort}`);
  start('fake-upstream', join(here, 'fake-upstream.mjs'), {
    FAKE_UPSTREAM_PORT: String(fakePort),
  });
  start('api', join(root, 'dist', 'main.js'), {
    PORT: String(apiPort),
    DATABASE_URL: databaseUrl,
    NODE_ENV: 'test',
    // The copied database may contain real recipients. This child must never use host SMTP.
    MAIL_SMTP_HOST: '',
    STORAGE_DRIVER: 'local',
    STORAGE_DIR: testStorage,
    TRUST_PROXY: 'false',
    CORS_ORIGINS: 'https://ui.qgauss.test',
    // 让 API 知道上游是本地 http 端口（.env 里一般也有，这里兜底）
    ALLOW_HTTP_UPSTREAM: process.env.ALLOW_HTTP_UPSTREAM ?? '1',
    // 只放行假上游这一个端口/地址；不依赖开发者 .env，新克隆也能直接跑
    UPSTREAM_PORT_ALLOWLIST: process.env.UPSTREAM_PORT_ALLOWLIST ?? `443,80,11434,${fakePort}`,
    UPSTREAM_PRIVATE_ALLOWLIST: process.env.UPSTREAM_PRIVATE_ALLOWLIST ?? `127.0.0.1:${fakePort}`,
    UPSTREAM_HOST_ALLOWLIST: '127.0.0.1',
  });

  if (!(await waitHealthy())) {
    console.error(`[e2e] API 45s 内未就绪，检查端口占用与 dist 是否最新`);
    cleanup();
    process.exit(1);
  }

  const env = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    E2E_API: apiBase,
    E2E_FAKE: `http://127.0.0.1:${fakePort}/v1`,
    E2E_DATABASE_FILE: e2eDb,
  };

  // Fixed order: core, commerce, admin, chat runs, painting, image recovery, chat recovery, security.
  // 安全套件临时修改限流配置并在 finally 中恢复；所有套件均使用同一个测试库副本。
  const suites = [
    { name: '主题套件 e2e.mjs', script: join(here, 'e2e.mjs') },
    { name: '商业套件 commerce.e2e.mjs', script: join(here, 'commerce.e2e.mjs') },
    { name: '后台契约 admin-contract.mjs', script: join(root, '..', 'web', 'test', 'admin-contract.mjs') },
    { name: '自建应用 app-creator.e2e.mjs', script: join(here, 'app-creator.e2e.mjs') },
    { name: '生成任务 chat-runs.e2e.mjs', script: join(here, 'chat-runs.e2e.mjs') },
    { name: '绘画工作台 image-workspace.e2e.mjs', script: join(here, 'image-workspace.e2e.mjs') },
    { name: '多图与局部重绘 image-edit.e2e.mjs', script: join(here, 'image-edit.e2e.mjs') },
    { name: 'MJ 进阶创作 mj.e2e.mjs', script: join(here, 'mj.e2e.mjs') },
    { name: 'MJ 进程恢复 mj-recovery.e2e.mjs', script: join(here, 'mj-recovery.e2e.mjs') },
    { name: '原生视频 video.e2e.mjs', script: join(here, 'video.e2e.mjs') },
    { name: '视频素材与精修 video-tools.e2e.mjs', script: join(here, 'video-tools.e2e.mjs') },
    { name: '视频进程恢复 video-recovery.e2e.mjs', script: join(here, 'video-recovery.e2e.mjs') },
    { name: '绘画进程恢复 image-recovery.e2e.mjs', script: join(here, 'image-recovery.e2e.mjs') },
    { name: '对话进程恢复 chat-recovery.e2e.mjs', script: join(here, 'chat-recovery.e2e.mjs') },
    { name: '原生协议 chat-protocol.e2e.mjs', script: join(here, 'chat-protocol.e2e.mjs') },
    { name: '联网检索 web-search.e2e.mjs', script: join(here, 'web-search.e2e.mjs') },
    { name: '智能体协作 agents.e2e.mjs', script: join(here, 'agents.e2e.mjs') },
    { name: '智能体进程恢复 agents-recovery.e2e.mjs', script: join(here, 'agents-recovery.e2e.mjs') },
    { name: '原生语音 voice.e2e.mjs', script: join(here, 'voice.e2e.mjs') },
    { name: '声音收藏室 voice-library.e2e.mjs', script: join(here, 'voice-library.e2e.mjs') },
    { name: '语音进程恢复 voice-recovery.e2e.mjs', script: join(here, 'voice-recovery.e2e.mjs') },
    { name: '账户与密码 account-security.e2e.mjs', script: join(here, 'account-security.e2e.mjs') },
    { name: '注册与邮箱验证 email-verification.e2e.mjs', script: join(here, 'email-verification.e2e.mjs') },
    { name: '首次安装与启航 installation.e2e.mjs', script: join(here, 'installation.e2e.mjs') },
    { name: '安全边界 security.e2e.mjs', script: join(here, 'security.e2e.mjs') },
  ];

  // Optional targeted debugging still uses the same isolated DB, storage and provider process.
  const requestedSuites = process.env.E2E_SUITES?.split(',').map(value => value.trim()).filter(Boolean);
  const selectedSuites = requestedSuites ? suites.filter(suite => requestedSuites.includes(suite.script.split(/[\\/]/).at(-1))) : suites;
  if (requestedSuites && (selectedSuites.length !== new Set(requestedSuites).size || !selectedSuites.length)) throw new Error('E2E_SUITES 必须使用现有套件文件名');
  // E2E_REPEAT=2 会把所有套件各跑两遍。
  // 这不是为了「多跑一遍更放心」，而是专门用来抓状态泄漏：
  // 有些用例第一次能过、第二次因为残留数据/残留配置而红，只跑一次永远看不见。
  const repeat = Math.max(1, Math.min(5, Number(process.env.E2E_REPEAT ?? 1) || 1));
  if (repeat > 1) console.log(`[e2e] 重复运行 ${repeat} 轮`);

  const results = [];
  for (let round = 1; round <= repeat; round += 1) {
    for (const suite of selectedSuites) {
      const label = repeat > 1 ? `${suite.name} [${round}/${repeat}]` : suite.name;
      console.log(`\n[e2e] ===== ${label} =====`);
      const code = await new Promise((resolve) => {
        const runner = spawn(process.execPath, [suite.script], { cwd: root, stdio: 'inherit', env });
        runner.on('exit', (c) => resolve(c ?? 1));
      });
      results.push({ ...suite, name: label, code });
    }
  }

  cleanup();
  await Promise.all(children.map(({ child }) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise(done => {
    const timer = setTimeout(() => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); done(); }, 5000);
    child.once('exit', () => { clearTimeout(timer); done(); });
  })));
  removeTestDb();
  removeTestStorage();

  console.log('\n[e2e] 汇总');
  for (const r of results) {
    console.log(`  ${r.code === 0 ? '\u2714' : '\u2718'} ${r.name}（exit ${r.code}）`);
  }
  if (repeat > 1) console.log(`[e2e] 共 ${results.length} 次执行（${repeat} 轮 × ${selectedSuites.length} 套）`);
  const failed = results.filter((r) => r.code !== 0);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('[e2e] 编排失败:', e);
  cleanup();
  removeTestDb();
  process.exit(1);
});
