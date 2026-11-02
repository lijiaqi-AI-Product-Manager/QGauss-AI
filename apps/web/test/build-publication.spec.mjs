import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { buildWeb, watchWeb } from '../../../scripts/web/build.mjs';
import { publishWebBuild, acquireBuildLock, createBuildStage, removeBuildStage } from '../../../scripts/web/publish.mjs';
import directConfig from '../rollup.config.mjs';

function fixture() {
  const root = fs.mkdtempSync(join(tmpdir(), 'qgauss-web-publication-'));
  return { root, clean() {
    const absolute = resolve(root);
    assert.equal(dirname(absolute), fs.realpathSync(tmpdir()));
    assert.ok(absolute.split(/[\\/]/).at(-1).startsWith('qgauss-web-publication-'));
    fs.rmSync(absolute, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  } };
}
function write(root, file, contents) {
  const target = join(root, file);
  fs.mkdirSync(dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
}
function snapshot(root) {
  const result = {};
  function visit(dir, prefix = '') {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort()) {
      const file = join(dir, name), local = prefix + name;
      if (fs.lstatSync(file).isDirectory()) visit(file, local + '/');
      else result[local] = fs.readFileSync(file).toString('base64');
    }
  }
  visit(root);
  return result;
}
function staged(root, name, label = name) {
  const stage = join(root, name);
  write(stage, 'assets/main-' + label + '12345678.js', 'window.qgauss=' + JSON.stringify(label) + ';');
  write(stage, 'assets/theme-' + label + '12345678.css', 'body{color:green}');
  write(stage, 'public-note.txt', label);
  write(stage, 'index.html', '<!doctype html><link rel="stylesheet" href="/assets/theme-' + label + '12345678.css"><script type="module" src="/assets/main-' + label + '12345678.js"></script>');
  return stage;
}
function project(root, version = 1) {
  write(root, 'index.html', '<!doctype html><html><head><!-- qg:head --></head><body><!-- qg:entry --></body></html>');
  write(root, 'src/main.js', "import './theme.css'; export const later=()=>import('./later.js'); window.qgauss=" + JSON.stringify({ version, payload: Array.from({ length: 250 }, (_, i) => 'qgauss-' + i + '-creative-space').join('|') }) + ';');
  write(root, 'src/later.js', 'export const version=' + version + ';');
  write(root, 'src/theme.css', '.qgauss-' + version + '{color:green}');
  write(root, 'public/brand/mark.svg', '<svg xmlns="http://www.w3.org/2000/svg"><title>QGauss</title></svg>');
}
function entryResources(root) {
  const html = fs.readFileSync(join(root, 'index.html'), 'utf8');
  return [...html.matchAll(/(?:src|href)="\/(assets\/[^"?#]+)"/g)].map(x => x[1]);
}

test('真实构建先完成全部资源，再发布入口；下一版仍保留旧页的资源与压缩件', async () => {
  const f = fixture();
  try {
    project(f.root, 1);
    const first = await buildWeb({ root: f.root }), live = join(f.root, 'dist'), before = snapshot(live);
    const firstResources = entryResources(live);
    assert.equal(first.oldAssetsRetained, true);
    assert.ok(firstResources.length >= 2);
    const script = firstResources.find(x => x.endsWith('.js'));
    const js = fs.readFileSync(join(live, script));
    assert.ok(js.length > 1024);
    assert.deepEqual(brotliDecompressSync(fs.readFileSync(join(live, script + '.br'))), js);
    assert.deepEqual(gunzipSync(fs.readFileSync(join(live, script + '.gz'))), js);
    project(f.root, 2);
    await buildWeb({ root: f.root });
    assert.notEqual(fs.readFileSync(join(live, 'index.html')).toString('base64'), before['index.html']);
    for (const [file, bytes] of Object.entries(before)) if (file.startsWith('assets/') && !file.endsWith('.map')) assert.equal(fs.readFileSync(join(live, file)).toString('base64'), bytes, file);
    for (const file of entryResources(live)) assert.ok(fs.existsSync(join(live, file)), file);
    assert.ok(fs.readdirSync(join(live, 'assets/chunks')).some(x => /later-.+\.js$/.test(x)));
    assert.deepEqual(fs.readdirSync(f.root).filter(x => x.startsWith('.qgauss-build')), []);
  } finally { f.clean(); }
});

test('真实 Rollup 语法失败不会删除或改写已发布版本，且释放锁与暂存目录', async () => {
  const f = fixture();
  try {
    project(f.root);
    await buildWeb({ root: f.root });
    const before = snapshot(join(f.root, 'dist'));
    write(f.root, 'src/main.js', 'export const broken = ;');
    await assert.rejects(buildWeb({ root: f.root }), /Expression|Unexpected|expression/);
    assert.deepEqual(snapshot(join(f.root, 'dist')), before);
    assert.deepEqual(fs.readdirSync(f.root).filter(x => x.startsWith('.qgauss-build')), []);
  } finally { f.clean(); }
});

test('公共目录覆盖生成资源时，实际字节核对拒绝发布并保留上一版', async () => {
  const f = fixture();
  try {
    project(f.root);
    await buildWeb({ root: f.root });
    const live = join(f.root, 'dist'), before = snapshot(live);
    const script = entryResources(live).find(x => x.endsWith('.js'));
    write(f.root, 'public/' + script, 'window.qgauss="overwritten";');
    await assert.rejects(buildWeb({ root: f.root }), /资源字节不完整/);
    assert.deepEqual(snapshot(live), before);
    assert.deepEqual(fs.readdirSync(f.root).filter(x => x.startsWith('.qgauss-build')), []);
  } finally { f.clean(); }
});

test('入口已发布后的清理异常单独报告，不把新版本误判为发布失败或删除新所有者', async () => {
  const f = fixture();
  try {
    project(f.root);
    const result = await buildWeb({ root: f.root, publish: async (stage, live) => {
      const published = await publishWebBuild(stage, live);
      fs.writeFileSync(join(f.root, '.qgauss-build.lock'), JSON.stringify({ pid: process.pid, token: 'a-later-owner' }));
      return published;
    } });
    assert.ok(result.entrySha256);
    assert.match(result.cleanupWarnings.join(' '), /ownership changed/);
    assert.equal(JSON.parse(fs.readFileSync(join(f.root, '.qgauss-build.lock'))).token, 'a-later-owner');
    assert.ok(entryResources(join(f.root, 'dist')).every(file => fs.existsSync(join(f.root, 'dist', file))));
  } finally { f.clean(); }
});

test('入口最后一次原子替换前，所有新资源已完成，旧入口仍可完整读取', async () => {
  const f = fixture();
  try {
    const live = join(f.root, 'dist');
    await publishWebBuild(staged(f.root, 'old'), live);
    const oldEntry = fs.readFileSync(join(live, 'index.html')), stage = staged(f.root, 'new');
    let observed = false;
    await publishWebBuild(stage, live, { ...fs, renameSync(from, to) {
      if (to === join(live, 'index.html')) {
        observed = true;
        assert.deepEqual(fs.readFileSync(to), oldEntry);
        for (const file of entryResources(stage)) assert.deepEqual(fs.readFileSync(join(live, file)), fs.readFileSync(join(stage, file)));
      }
      fs.renameSync(from, to);
    } });
    assert.ok(observed);
    assert.deepEqual(fs.readFileSync(join(live, 'index.html')), fs.readFileSync(join(stage, 'index.html')));
  } finally { f.clean(); }
});

test('入口替换被系统拒绝时，保留旧入口和旧哈希资源，不留下临时写入文件', async () => {
  const f = fixture();
  try {
    const live = join(f.root, 'dist');
    await publishWebBuild(staged(f.root, 'old'), live);
    const before = snapshot(live);
    await assert.rejects(() => publishWebBuild(staged(f.root, 'new'), live, { ...fs, renameSync(from, to) {
      if (to === join(live, 'index.html')) throw Object.assign(new Error('Controlled filesystem refusal'), { code: 'EPERM' });
      fs.renameSync(from, to);
    } }), /Controlled filesystem refusal/);
    assert.equal(fs.readFileSync(join(live, 'index.html')).toString('base64'), before['index.html']);
    for (const [file, bytes] of Object.entries(before)) if (file.startsWith('assets/')) assert.equal(fs.readFileSync(join(live, file)).toString('base64'), bytes);
    assert.ok(!Object.keys(snapshot(live)).some(x => x.endsWith('.tmp')));
  } finally { f.clean(); }
});

test('相同哈希路径字节冲突在发布前拒绝，不改入口或公共文件', async () => {
  const f = fixture();
  try {
    const live = join(f.root, 'dist');
    await publishWebBuild(staged(f.root, 'old', 'same'), live);
    const before = snapshot(live), stage = staged(f.root, 'new', 'same');
    write(stage, 'assets/main-same12345678.js', 'window.qgauss="collision";');
    write(stage, 'public-note.txt', 'changed');
    await assert.rejects(() => publishWebBuild(stage, live), /different bytes/);
    assert.deepEqual(snapshot(live), before);
  } finally { f.clean(); }
});

test('缺少入口引用资源时拒绝发布，首次安装也不留下半个站点', async () => {
  const f = fixture();
  try {
    const stage = staged(f.root, 'new'), live = join(f.root, 'dist');
    fs.unlinkSync(join(stage, 'assets/main-new12345678.js'));
    await assert.rejects(() => publishWebBuild(stage, live), /missing resource/);
    assert.equal(fs.existsSync(live), false);
  } finally { f.clean(); }
});

test('完整版本重复发布不改写相同文件，已经打开的文件句柄仍能读完原入口', async () => {
  const f = fixture();
  try {
    const live = join(f.root, 'dist'), stage = staged(f.root, 'old');
    await publishWebBuild(stage, live);
    assert.equal((await publishWebBuild(stage, live)).copied, 0);
    const file = fs.openSync(join(live, 'index.html'), 'r'), old = fs.readFileSync(join(live, 'index.html'));
    let closed=false;
    const readerFinished=new Promise((done,fail)=>setTimeout(()=>{try{assert.deepEqual(fs.readFileSync(file),old);done();}catch(error){fail(error);}finally{fs.closeSync(file);closed=true;}},80));
    try {
      await Promise.all([publishWebBuild(staged(f.root, 'new'), live),readerFinished]);
      assert.notDeepEqual(fs.readFileSync(join(live,'index.html')),old);
    } finally { if(!closed)fs.closeSync(file); }
  } finally { f.clean(); }
});

test('目标目录中的目录链接被拒绝，链接外的文件保持不变', async () => {
  const f = fixture();
  try {
    const live = join(f.root, 'dist'), outside = join(f.root, 'outside');
    write(outside, 'keep.txt', 'keep');
    fs.mkdirSync(live);
    fs.symlinkSync(outside, join(live, 'assets'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => publishWebBuild(staged(f.root, 'new'), live), /link/);
    assert.deepEqual(fs.readdirSync(outside), ['keep.txt']);
  } finally { f.clean(); }
});

test('暂存目录中的目录链接被拒绝，不跟随到目录外发布内容', async () => {
  const f = fixture();
  try {
    const stage = staged(f.root, 'new'), outside = join(f.root, 'outside');
    write(outside, 'keep.txt', 'keep');
    fs.symlinkSync(outside, join(stage, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(() => publishWebBuild(stage, join(f.root, 'dist')), /symbolic links/);
    assert.equal(fs.existsSync(join(f.root, 'dist')), false);
  } finally { f.clean(); }
});

test('同一工作区的第二个构建被明确拒绝，原锁保持到持有人释放', async () => {
  const f = fixture();
  try {
    const first = acquireBuildLock(f.root), before = fs.readFileSync(first.file);
    assert.throws(() => acquireBuildLock(f.root), error => error.code === 'QGAUSS_BUILD_BUSY' && error.ownerPid === process.pid);
    assert.deepEqual(fs.readFileSync(first.file), before);
    first.release();
    const second = acquireBuildLock(f.root);
    assert.notEqual(second.owner.token, first.owner.token);
    second.release();
  } finally { f.clean(); }
});

test('旧锁或未知锁不会被自动删除，释放函数也不能删除后来更换的所有者', async () => {
  const f = fixture();
  try {
    const lease = acquireBuildLock(f.root);
    fs.writeFileSync(lease.file, JSON.stringify({ pid: process.pid, token: 'different-owner' }));
    assert.throws(() => lease.release(), /ownership changed/);
    assert.equal(JSON.parse(fs.readFileSync(lease.file)).token, 'different-owner');
    fs.writeFileSync(lease.file, 'not valid JSON');
    assert.throws(() => acquireBuildLock(f.root), { code: 'QGAUSS_BUILD_BUSY' });
    assert.equal(fs.readFileSync(lease.file, 'utf8'), 'not valid JSON');
  } finally { f.clean(); }
});

test('暂存清理只接受本工作区直接创建的构建目录，拒绝根目录与其他目录', async () => {
  const f = fixture();
  try {
    const stage = createBuildStage(f.root);
    write(stage, 'temporary.txt', 'temporary');
    write(f.root, 'keep/keep.txt', 'keep');
    assert.throws(() => removeBuildStage(f.root, f.root), /Refusing/);
    assert.throws(() => removeBuildStage(f.root, join(f.root, 'keep')), /Refusing/);
    removeBuildStage(f.root, stage);
    assert.equal(fs.existsSync(stage), false);
    assert.equal(fs.readFileSync(join(f.root, 'keep/keep.txt'), 'utf8'), 'keep');
  } finally { f.clean(); }
});

test('绕过隔离入口的原始配置命令在写入前明确失败', () => {
  assert.throws(() => directConfig(), /npm run build/);
});

test('真实监听构建失败保留上一版，修正后发布新版本，关闭后清理锁', { timeout: 30000 }, async () => {
  const f = fixture(), events = [];
  let active;
  function waitEvent(from, code) {
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { clearInterval(poll); fail(new Error('Watch event timeout: ' + JSON.stringify(events))); }, 10000);
      const poll = setInterval(() => { const found = events.slice(from).find(x => x.code === code); if (found) { clearInterval(poll); clearTimeout(timer); done(found); } }, 20);
    });
  }
  try {
    project(f.root);
    active = watchWeb({ root: f.root, report: event => events.push(event) });
    await waitEvent(0, 'PUBLISHED');
    const before = snapshot(join(f.root, 'dist')), firstCount = events.length;
    write(f.root, 'src/main.js', 'export const broken = ;');
    await waitEvent(firstCount, 'ERROR');
    assert.deepEqual(snapshot(join(f.root, 'dist')), before);
    const errorCount = events.length;
    project(f.root, 2);
    await waitEvent(errorCount, 'PUBLISHED');
    assert.notEqual(fs.readFileSync(join(f.root, 'dist/index.html')).toString('base64'), before['index.html']);
    assert.ok(entryResources(join(f.root, 'dist')).every(file => /-[A-Za-z0-9_-]{8,}\./.test(file)));
    assert.throws(() => acquireBuildLock(f.root), { code: 'QGAUSS_BUILD_BUSY' });
    await active.close(); active = null;
    assert.deepEqual(fs.readdirSync(f.root).filter(x => x.startsWith('.qgauss-build')), []);
  } finally { if (active) await active.close(); f.clean(); }
});
