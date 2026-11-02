#!/usr/bin/env node
/** 项目品牌门禁：规则存摘要，交付源码本身也不携带旧产品字样。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(await readFile(join(repo, '.qgauss-brand.json'), 'utf8'));
const digest = (text) => createHash('sha256').update(text).digest('hex');
function forbidden(text, markers = policy.deniedProductTokens) {
  const normalized = text.normalize('NFKC').toLowerCase().replace(/[-_\s\u200b-\u200d\ufeff]/g, '');
  for (const marker of markers) {
    for (let offset = 0; offset <= normalized.length - marker.length; offset += 1) {
      if (normalized.charCodeAt(offset) !== marker.firstCodePoint || normalized.charCodeAt(offset + marker.length - 1) !== marker.lastCodePoint) continue;
      if (digest(normalized.slice(offset, offset + marker.length)) === marker.sha256) return true;
    }
  }
  return false;
}
// 规则样例使用中性测试词，不把被禁产品标识重新写回测试源码。
const testMarker = { length: 10, firstCodePoint: 108, lastCodePoint: 100, sha256: digest('legacyword') };
assert.equal(forbidden('LEGACY_WORD', [testMarker]), true);
assert.equal(forbidden('legacy-word', [testMarker]), true);
assert.equal(forbidden('legacy word', [testMarker]), true);
assert.equal(forbidden('QGauss AI', [testMarker]), false);

const files = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean));
async function addDirectory(directory) {
  for (const item of await readdir(join(repo, directory), { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) await addDirectory(path); else files.add(path);
  }
}
if (process.argv.includes('--dist')) await addDirectory('apps/web/dist');
const failures = [];
let checked = 0;
for (const path of [...files].sort()) {
  if (forbidden(path)) { failures.push(`${path}（路径）`); continue; }
  let bytes; try { bytes = await readFile(join(repo, path)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
  // 不依赖扩展名白名单，后续新增脚本和无扩展名配置也会受检。
  // 字体、压缩包、位图等含 NUL 的二进制不作为文本；路径仍一律检查。
  // 二进制附带的可读元信息也纳入检查。

  const text = bytes.toString('utf8');
  checked += 1;
  if (forbidden(text)) failures.push(path);
}
if (failures.length) { console.error(`品牌检查失败：${failures.length} 个文件残留受限表述\n${failures.join('\n')}`); process.exitCode = 1; }
else console.log(`QGauss 品牌检查通过：${checked} 个文本文件，产品名称与发布内容符合规则`);
