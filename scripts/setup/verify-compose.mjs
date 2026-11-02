/** Read-only deployment configuration checks. Requires the Docker CLI, never contacts an engine. */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = mkdtempSync(join(tmpdir(), 'qgauss-compose-config-'));
const envFile = join(folder, 'empty.env'); writeFileSync(envFile, '\n');
const ensure = (condition, message) => { if (!condition) throw Error(message); };
try {
  const common = { ...process.env, JWT_SECRET: randomBytes(48).toString('base64url'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), TRUST_PROXY: 'false', CORS_ORIGINS: '', SEED_ADMIN_EMAIL: 'synthetic@qgauss.test', SEED_ADMIN_USERNAME: 'synthetic_owner' };
  delete common.QGAUSS_SETUP_TOKEN; delete common.SEED_ADMIN_PASSWORD;
  for (const key of Object.keys(common)) if (key.startsWith('MAIL_')) delete common[key];
  for (const scenario of [{ name: 'fresh', setup: randomBytes(32).toString('base64url') }, { name: 'installed' }, { name: 'explicit-seed', seed: 'SyntheticComposeAdmin-851' }, { name: 'mail-enabled', mail: true }]) {
    const mail = scenario.mail ? { MAIL_SMTP_HOST:'smtp.qgauss.test', MAIL_SMTP_PORT:'587', MAIL_SMTP_SECURE:'false', MAIL_SMTP_REQUIRE_TLS:'true', MAIL_SMTP_USER:'synthetic@qgauss.test', MAIL_SMTP_PASS:'synthetic-only', MAIL_FROM:'QGauss AI <synthetic@qgauss.test>', MAIL_RETRY_INTERVAL_MS:'300000' } : {};
    const env = { ...common, ...mail, ...(scenario.setup ? { QGAUSS_SETUP_TOKEN: scenario.setup } : {}), ...(scenario.seed ? { SEED_ADMIN_PASSWORD: scenario.seed } : {}) };
    const result = spawnSync('docker', ['compose', '--env-file', envFile, '-f', join(root, 'docker-compose.deploy.yml'), 'config', '--format', 'json'], { cwd: root, env, windowsHide: true, encoding: 'utf8', timeout: 30_000 });
    ensure(!result.error && result.status === 0, 'Compose 配置校验无法完成，请确认 Docker CLI 可用');
    const actual = JSON.parse(result.stdout).services.api.environment;
    ensure(actual.JWT_SECRET === common.JWT_SECRET && actual.APP_ENCRYPTION_KEY === common.APP_ENCRYPTION_KEY, 'Compose 未传入独立运行密钥');
    ensure(scenario.setup ? actual.QGAUSS_SETUP_TOKEN === scenario.setup : actual.QGAUSS_SETUP_TOKEN == null, '可选安装凭证被丢失或注入为空字符串');
    ensure(scenario.seed ? actual.SEED_ADMIN_PASSWORD === scenario.seed : actual.SEED_ADMIN_PASSWORD == null, '可选 seed 密码被丢失或注入为空字符串');
    ensure(!Object.keys(actual).some(key => key.startsWith('MAIL_') && actual[key] != null && actual[key] !== mail[key]), '未配置邮件时不应注入任何发件参数');
    ensure(Object.entries(mail).every(([key,value])=>actual[key]===value), '已配置邮件参数未正确传递到容器');
    console.log('✔ Compose ' + scenario.name + ' 配置正确（凭据不输出）');
  }

  // Follow actual relative imports from seed.ts and verify every source is present in the runner.
  const dockerfile = readFileSync(join(root, 'Dockerfile'), 'utf8');
  const copies = [...dockerfile.matchAll(/^COPY --from=builder \/app\/(\S+) \.\/(\S+)$/gm)].map(match => ({ source: resolve(root, match[1]), target: resolve(root, match[2]) }));
  const available = file => copies.some(copy => copy.source === copy.target && (file === copy.target || statSync(copy.source).isDirectory() && file.startsWith(copy.target + sep)));
  const visited = new Set();
  function inspect(file) {
    if (visited.has(file)) return;
    ensure(available(file), 'Docker runner 缺少 seed 依赖：' + relative(root, file)); visited.add(file);
    for (const match of readFileSync(file, 'utf8').matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const imported = resolve(dirname(file), match[1]);
      const target = [imported, imported + '.ts', join(imported, 'index.ts')].find(candidate => existsSync(candidate) && statSync(candidate).isFile());
      ensure(target, 'seed 相对依赖无法解析'); inspect(target);
    }
  }
  inspect(join(root, 'apps/api/prisma/seed.ts'));
  console.log('✔ Docker runner seed 相对依赖完整：' + visited.size + ' 个源文件');
  for (const file of ['apps/api/prisma/data-lease.cjs','apps/api/scripts/operations/cli.mjs','apps/api/scripts/operations/operations.mjs','apps/api/scripts/operations/archive.mjs']) ensure(available(resolve(root,file)), 'Docker runner 缺少维护工具：'+file);
  console.log('✔ Docker runner 数据互斥及备份 / 恢复工具完整');
  console.log('部署静态检查：6 项通过；未构建镜像或启动容器。');
} finally {
  const absolute = resolve(folder);
  if (!absolute.startsWith(resolve(tmpdir()) + sep + 'qgauss-compose-config-')) throw Error('temporary cleanup escaped');
  rmSync(absolute, { recursive: true, force: true });
}
