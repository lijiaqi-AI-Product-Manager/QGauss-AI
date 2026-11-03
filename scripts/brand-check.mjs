#!/usr/bin/env node
/** 项目品牌门禁：规则存摘要，交付源码本身也不携带旧产品字样。 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {createBrandMatcher, scanBrandFiles} from './brand/scan.mjs';

const started = performance.now();
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(await readFile(join(repo, '.qgauss-brand.json'), 'utf8'));
const digest = (text) => createHash('sha256').update(text).digest('hex');
const forbidden = createBrandMatcher(policy.deniedProductTokens);
// 规则样例使用中性测试词，不把被禁产品标识重新写回测试源码。
const testMarker = { length: 10, firstCodePoint: 108, lastCodePoint: 100, sha256: digest('legacyword') };
const sample = createBrandMatcher([testMarker]);
assert.equal(sample('LEGACY_WORD'), true);
assert.equal(sample('legacy-word'), true);
assert.equal(sample('legacy word'), true);
assert.equal(sample('QGauss AI'), false);

const files = new Set(execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: repo, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean));
async function addDirectory(directory) {
  for (const item of await readdir(join(repo, directory), { withFileTypes: true })) {
    const path = `${directory}/${item.name}`;
    if (item.isDirectory()) await addDirectory(path); else files.add(path);
  }
}
if (process.argv.includes('--dist')) await addDirectory('apps/web/dist');
// 所有文件完整读取，包括无扩展名配置和二进制中的可读元信息。
const {checked, bytesRead, missing, failures} = await scanBrandFiles(files, {root: repo, matches: forbidden});
const result = {status: failures.length ? 'failed' : 'passed', files: checked, bytesRead, missing, elapsedMs: Math.round(performance.now() - started), failures};
if (process.argv.includes('--json')) console.log(JSON.stringify(result));
else if (failures.length) console.error(`品牌检查失败：${failures.length} 个文件残留受限表述\n${failures.join('\n')}`);
else console.log(`QGauss 品牌检查通过：${checked} 个文本文件，产品名称与发布内容符合规则`);
if (failures.length) process.exitCode = 1;
