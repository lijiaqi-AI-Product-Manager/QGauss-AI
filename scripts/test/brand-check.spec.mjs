import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp, mkdir, readFile, writeFile, stat, utimes, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createBrandMatcher, scanBrandFiles} from '../brand/scan.mjs';

const hash = text => createHash('sha256').update(text).digest('hex');
const marker = text => ({length: text.length, firstCodePoint: text.charCodeAt(0), lastCodePoint: text.charCodeAt(text.length - 1), sha256: hash(text)});
const words = ['legacyword', 'olderword', 'lateral', 'look', 'lock', 'écho'];
const markers = words.map(marker);
function baseline(text, rules = markers) {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/[-_\s\u200b-\u200d\ufeff]/g, '');
  for (const row of rules) for (let offset = 0; offset <= normalized.length - row.length; offset++) {
    if (normalized.charCodeAt(offset) === row.firstCodePoint && normalized.charCodeAt(offset + row.length - 1) === row.lastCodePoint &&
        hash(normalized.slice(offset, offset + row.length)) === row.sha256) return true;
  }
  return false;
}

test('摘要匹配保留大小写、全角、组合字符与分隔符规则，端点相同的候选仍核对完整摘要', () => {
  const matches = createBrandMatcher(markers);
  for (const text of ['LEGACY_WORD', 'legacy-word', 'legacy word', 'ｌｅｇａｃｙｗｏｒｄ', 'le\u200bgacy\u200cword', 'e\u0301cho', 'prefix olderword suffix', 'look', 'lock', 'lxxk', 'legacxword', 'QGauss AI', '\0Q\0', '']) {
    assert.equal(matches(text), baseline(text), JSON.stringify(text));
  }
  assert.equal(matches('lxxk'), false);
  assert.equal(matches('legacxword'), false);
  assert.equal(createBrandMatcher([marker('q')])('Q'), true);
});

test('优化前后在可复现的混合 Unicode 文本与重叠规则中保持相同结果', () => {
  let state = 482617;
  const random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0);
  const alphabet = ['a', 'l', 'e', 'k', 'q', 's', 'd', 'x', '_', '-', '\n', '\u200d', '\ufeff', 'é', '漢', 'Ｌ', 'Ｅ', '🙂', '\0', '\ud800'];
  const rules = [...markers, marker('lo'), marker('loo'), marker('look'), marker('looklook')], matches = createBrandMatcher(rules);
  for (let iteration = 0; iteration < 1200; iteration++) {
    let value = '';
    for (let index = random() % 100; index > 0; index--) value += alphabet[random() % alphabet.length];
    if (iteration % 3 === 0) {
      const word = words[random() % words.length], position = random() % (value.length + 1);
      value = value.slice(0, position) + word.toUpperCase().split('').join(iteration % 2 ? '_' : '\u200b') + value.slice(position);
    }
    assert.equal(matches(value), baseline(value, rules), `case ${iteration}`);
  }
});

test('无效或缺失的规则立即失败，检查开始后不受原规则对象修改影响', () => {
  for (const rules of [[], undefined, [null], [{...marker('look'), length: 0}], [{...marker('look'), firstCodePoint: -1}], [{...marker('look'), lastCodePoint: 65536}], [{...marker('look'), sha256: 'invalid'}]]) {
    assert.throws(() => createBrandMatcher(rules), TypeError);
  }
  const original = marker('look'), matches = createBrandMatcher([original]);
  original.sha256 = hash('lock');
  assert.equal(matches('look'), true);
  assert.equal(matches('lock'), false);
});

test('无扩展名文件、二进制末尾元信息与违规路径都完整读取，结果按路径稳定排序', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qgauss-brand-'));
  try {
    await mkdir(join(root, 'nested'));
    const contents = new Map([
      ['plain', Buffer.from('QGauss AI')],
      ['nested/large.bin', Buffer.concat([Buffer.alloc(260000), Buffer.from([255, 0, 128]), Buffer.from(' LEGACY_WORD ')])],
      ['legacy-word.txt', Buffer.from('olderword')],
      ['safe.txt', Buffer.from('look')],
    ]);
    for (const [path, bytes] of contents) await writeFile(join(root, path), bytes);
    const readPaths = [], result = await scanBrandFiles((function* () {yield* [...contents.keys()].reverse(); yield 'plain';})(), {
      root, matches: createBrandMatcher(markers), concurrency: 3,
      read: async path => {readPaths.push(path); return readFile(path);},
    });
    assert.equal(result.checked, contents.size);
    assert.equal(result.bytesRead, [...contents.values()].reduce((sum, bytes) => sum + bytes.length, 0));
    assert.equal(result.missing, 0);
    assert.equal(new Set(readPaths).size, contents.size);
    assert.ok(readPaths.includes(join(root, 'legacy-word.txt')));
    assert.deepEqual(result.failures, ['legacy-word.txt（路径与内容）', 'nested/large.bin', 'safe.txt']);
  } finally {await rm(root, {recursive: true, force: true});}
});

test('文件读取有界并行，未读取的内容不能通过；读取错误不会转成通过结果', async () => {
  let active = 0, maximum = 0, readCount = 0, release, firstBatch;
  const bothStarted = new Promise(done => firstBatch = done), batch = new Promise(done => release = done);
  const run = scanBrandFiles(['c', 'b', 'a', 'd'], {root: tmpdir(), matches: createBrandMatcher(markers), concurrency: 2, read: async () => {
    active++; maximum = Math.max(maximum, active); readCount++; if (readCount === 2) firstBatch();
    await batch; active--; return Buffer.from('QGauss AI');
  }});
  await bothStarted;
  assert.equal(readCount, 2);
  release();
  assert.equal((await run).checked, 4);
  assert.equal(maximum, 2);
  await assert.rejects(scanBrandFiles(['a'], {root: tmpdir(), matches: createBrandMatcher(markers), read: async () => {throw Object.assign(new Error('unreadable'), {code: 'EACCES'});}}), /unreadable/);
  await assert.rejects(scanBrandFiles(['a'], {root: tmpdir(), matches: createBrandMatcher(markers), read: async () => 'partial text'}), /complete bytes/);
  await assert.rejects(scanBrandFiles(['../outside'], {root: tmpdir(), matches: createBrandMatcher(markers), read: async () => {throw new Error('must not read');}}), /outside the project/);
  await assert.rejects(scanBrandFiles(['a'], {root: tmpdir(), matches: createBrandMatcher(markers), concurrency: 9}), RangeError);
});

test('已移除的文件不冒充已读取，仍检查索引中的受限路径', async () => {
  const missing = async () => {throw Object.assign(new Error('missing'), {code: 'ENOENT'});};
  const result = await scanBrandFiles(['removed', 'legacy-word.txt'], {root: tmpdir(), matches: createBrandMatcher(markers), read: missing});
  assert.equal(result.checked, 0);
  assert.equal(result.bytesRead, 0);
  assert.equal(result.missing, 2);
  assert.deepEqual(result.failures, ['legacy-word.txt（路径）']);
});

test('命令入口使用同一规则，完整检查源码与发布目录并返回可靠退出状态', async () => {
  const root = await mkdtemp(join(tmpdir(), 'qgauss-brand-cli-'));
  try {
    await mkdir(join(root, 'scripts/brand'), {recursive: true});
    await mkdir(join(root, 'apps/web/dist'), {recursive: true});
    await writeFile(join(root, 'scripts/brand-check.mjs'), await readFile(new URL('../brand-check.mjs', import.meta.url)));
    await writeFile(join(root, 'scripts/brand/scan.mjs'), await readFile(new URL('../brand/scan.mjs', import.meta.url)));
    await writeFile(join(root, '.qgauss-brand.json'), JSON.stringify({deniedProductTokens: [marker('retiredword')]}));
    await writeFile(join(root, 'plain'), 'QGauss AI');
    await writeFile(join(root, '.gitignore'), 'apps/web/dist\n');
    function git(args) {const result = spawnSync('git', args, {cwd: root, windowsHide: true, encoding: 'utf8'}); assert.equal(result.status, 0, result.stderr);}
    git(['init', '--quiet']); git(['add', '.']);
    const check = (...args) => spawnSync(process.execPath, ['scripts/brand-check.mjs', ...args], {cwd: root, windowsHide: true, encoding: 'utf8'});
    assert.equal(check().status, 0);
    const asset = join(root, 'apps/web/dist/late.bin');
    await writeFile(asset, Buffer.concat([Buffer.alloc(50000), Buffer.from('RETIRED_WORD')]));
    assert.equal(check().status, 0);
    const failed = check('--dist');
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /apps\/web\/dist\/late\.bin/);
    await writeFile(asset, Buffer.from('QGAUSS_WORKS'));
    const clean = check('--dist', '--json');
    assert.equal(clean.status, 0);
    const receipt = JSON.parse(clean.stdout);
    assert.equal(receipt.status, 'passed');
    assert.equal(receipt.files, 6);
    assert.equal(receipt.missing, 0);
    assert.ok(receipt.bytesRead > 12);
    assert.ok(receipt.elapsedMs >= 0);
    const previous = await stat(asset);
    await writeFile(asset, Buffer.from('RETIRED_WORD'));
    assert.equal((await stat(asset)).size, previous.size);
    await utimes(asset, previous.atime, previous.mtime);
    const rejected = check('--dist', '--json');
    assert.equal(rejected.status, 1);
    assert.deepEqual(JSON.parse(rejected.stdout).failures, ['apps/web/dist/late.bin']);
  } finally {await rm(root, {recursive: true, force: true});}
});
