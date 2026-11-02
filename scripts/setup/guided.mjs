import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join } from 'node:path';
import { createRequire } from 'node:module';

export async function prepareGuidedEnvironment(apiRoot) {
  const template = await readFile(join(apiRoot, '.env.example'), 'utf8');
  const values = { NODE_ENV: 'production', JWT_SECRET: randomBytes(48).toString('base64url'), APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), QGAUSS_SETUP_TOKEN: randomBytes(32).toString('base64url') };
  let source = template.replace(/^SEED_ADMIN_[^\r\n]*\r?\n?/gm, '');
  for (const [key, value] of Object.entries(values)) {
    const assignment = new RegExp('^' + key + '=.*$', 'm');
    source = assignment.test(source) ? source.replace(assignment, key + '=' + value) : source + '\n' + key + '=' + value + '\n';
  }
  // wx is intentional: even an existing empty environment file belongs to the operator.
  try { await writeFile(join(apiRoot, '.env'), source, { flag: 'wx', mode: 0o600 }); }
  catch (error) { if (error.code === 'EEXIST') throw new Error('apps/api/.env 已存在，未作修改。请参照部署说明手动配置安装凭证并执行迁移。'); throw error; }
  return parseEnv(source);
}

async function main() {
  const root = fileURLToPath(new URL('../../', import.meta.url)), apiRoot = join(root, 'apps/api');
  const generated = await prepareGuidedEnvironment(apiRoot);
  const env = { ...generated, ...process.env };
  const require = createRequire(pathToFileURL(join(root, 'package.json')));
  for (const args of [[require.resolve('prisma/build/index.js'), 'generate'], [join(apiRoot, 'prisma/migrate.mjs')]]) {
    const result = spawnSync(process.execPath, args, { cwd: apiRoot, env, stdio: 'inherit', windowsHide: true });
    if (result.error || result.status !== 0) throw new Error('安装准备未完成；已生成的环境文件保留，请按命令提示检查后继续。');
  }
  console.log('安装准备完成，未创建任何账户或演示内容。');
  console.log('请打开 apps/api/.env 保管安装凭证，核对站点部署配置。启动后在 /setup 页面明确创建首位管理员。');
  console.log('安装凭证和管理员密码不会输出到此日志。请使用 HTTPS 或本机地址完成安装。');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
