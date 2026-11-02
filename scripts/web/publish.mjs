import * as fs from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { setTimeout as wait } from 'node:timers/promises';

function inside(root, target) {
  const local = relative(root, target);
  if (!local || local === '..' || local.startsWith('..' + sep) || resolve(root, local) !== target) {
    throw new Error('QGauss build path escaped its output directory');
  }
}

function regularTree(root, io) {
  if (!io.lstatSync(root).isDirectory() || io.lstatSync(root).isSymbolicLink()) throw new Error('Build directory must be a real directory');
  const files = [];
  function visit(directory) {
    for (const name of io.readdirSync(directory).sort()) {
      const file = join(directory, name);
      inside(root, file);
      const stat = io.lstatSync(file);
      if (stat.isSymbolicLink()) throw new Error('Build publication does not follow symbolic links');
      if (stat.isDirectory()) visit(file);
      else if (stat.isFile()) files.push(relative(root, file).split(sep).join('/'));
      else throw new Error('Unsupported build output file');
    }
  }
  visit(root);
  return files;
}

function checkDestination(root, file, io) {
  inside(root, file);
  let current = root;
  const directories = relative(root, dirname(file)).split(sep).filter(Boolean);
  for (const part of ['', ...directories]) {
    if (part) current = join(current, part);
    if (!io.existsSync(current)) continue;
    const stat = io.lstatSync(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Build destination contains a link or non-directory');
  }
  if (io.existsSync(file)) {
    const stat = io.lstatSync(file);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Build destination is not a regular file');
  }
}

function immutableAsset(file) {
  return file.startsWith('assets/') && /-[A-Za-z0-9_-]{8,}\.(?:js|css|woff2?|ttf|otf|png|jpe?g|webp|svg)$/.test(file);
}

/** Publish complete files first, then atomically replace the entry. Never erase old assets. */
export async function publishWebBuild(stageDirectory, liveDirectory, io = fs) {
  const stage = resolve(stageDirectory), live = resolve(liveDirectory);
  if (stage === live || relative(stage, live).split(sep)[0] !== '..' || relative(live, stage).split(sep)[0] !== '..') {
    throw new Error('Staged and live builds must be separate directories');
  }
  const files = regularTree(stage, io), names = new Set(files);
  if (!names.has('index.html')) throw new Error('Complete build entry is missing');
  const html = io.readFileSync(join(stage, 'index.html'), 'utf8');
  if (!/<script\b[^>]*type=["']module["'][^>]*src=["']\/assets\//.test(html) || html.includes('<!-- qg:')) {
    throw new Error('Build entry is incomplete');
  }
  for (const match of html.matchAll(/(?:src|href)=["'](\/assets\/[^"'?#]+)(?:[?#][^"']*)?["']/g)) {
    if (!names.has(match[1].slice(1))) throw new Error('Build entry references a missing resource: ' + match[1]);
  }

  // Inspect every collision before any published file is changed.
  const plan = files.map(file => {
    const source = join(stage, ...file.split('/')), target = join(live, ...file.split('/'));
    checkDestination(live, target, io);
    const same = io.existsSync(target) && io.readFileSync(source).equals(io.readFileSync(target));
    if (!same && io.existsSync(target) && immutableAsset(file)) throw new Error('Hashed resource already has different bytes: ' + file);
    return { file, source, target, same };
  });
  let copied = 0;
  async function publish(item) {
    if (item.same) return;
    checkDestination(live, item.target, io);
    io.mkdirSync(dirname(item.target), { recursive: true });
    const temporary = join(dirname(item.target), '.' + basename(item.target) + '.qgauss-' + randomUUID() + '.tmp');
    inside(live, temporary);
    try {
      io.copyFileSync(item.source, temporary, fs.constants.COPYFILE_EXCL);
      for (let attempt = 0; ; attempt++) {
        try { io.renameSync(temporary, item.target); break; }
        catch (error) {
          if (!['EPERM', 'EACCES', 'EBUSY'].includes(error.code) || attempt >= 5) throw error;
          await wait(50 * (attempt + 1));
        }
      }
      copied++;
    } finally {
      if (io.existsSync(temporary)) io.unlinkSync(temporary);
    }
  }
  for (const item of plan) if (item.file !== 'index.html') await publish(item);
  await publish(plan.find(item => item.file === 'index.html'));
  return { files: files.length, copied, unchanged: files.length - copied, entrySha256: createHash('sha256').update(html).digest('hex'), oldAssetsRetained: true };
}

/** Exclusive workspace lease. An interrupted owner is reported, never guessed away. */
export function acquireBuildLock(webDirectory) {
  const web = fs.realpathSync(webDirectory), file = join(web, '.qgauss-build.lock');
  const owner = { pid: process.pid, token: randomUUID(), startedAt: new Date().toISOString() };
  try { fs.writeFileSync(file, JSON.stringify(owner) + '\n', { flag: 'wx', mode: 0o600 }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    let previous;
    try { previous = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* An unknown lease cannot be removed safely. */ }
    const busy = new Error('已有构建或监听任务持有工作区锁' + (Number.isSafeInteger(previous?.pid) ? '（PID ' + previous.pid + '）' : '') + '。请先停止原任务；若原任务已结束，核对后移除 ' + file + ' 再重试。当前发布版本保持不变。');
    busy.code = 'QGAUSS_BUILD_BUSY';
    busy.ownerPid = previous?.pid;
    throw busy;
  }
  return {
    file, owner,
    release() {
      if (!fs.existsSync(file)) return;
      const current = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (current.token !== owner.token || current.pid !== owner.pid) throw new Error('Build lease ownership changed; refusing to remove it');
      fs.unlinkSync(file);
    },
  };
}

export function createBuildStage(webDirectory) {
  return fs.mkdtempSync(join(fs.realpathSync(webDirectory), '.qgauss-build-'));
}

export function removeBuildStage(webDirectory, stageDirectory) {
  const web = fs.realpathSync(webDirectory), stage = resolve(stageDirectory);
  if (dirname(stage) !== web || !basename(stage).startsWith('.qgauss-build-')) throw new Error('Refusing to remove an unowned build directory');
  if (!fs.existsSync(stage)) return;
  const stat = fs.lstatSync(stage);
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Refusing to recursively remove a linked build directory');
  fs.rmSync(stage, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
