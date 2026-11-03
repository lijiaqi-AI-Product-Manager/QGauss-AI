import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {isAbsolute, relative, resolve} from 'node:path';

const digest = text => createHash('sha256').update(text).digest('hex');

/** Compile digest rules once. Offsets retain the policy's UTF-16 code-unit semantics. */
export function createBrandMatcher(markers) {
  if (!Array.isArray(markers) || !markers.length) throw new TypeError('Brand rules are required');
  const starts = new Map();
  for (const marker of markers) {
    if (!marker || !Number.isSafeInteger(marker.length) || marker.length < 1 ||
        ![marker.firstCodePoint, marker.lastCodePoint].every(value => Number.isInteger(value) && value >= 0 && value <= 65535) ||
        typeof marker.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(marker.sha256)) {
      throw new TypeError('Invalid brand rule');
    }
    const first = String.fromCharCode(marker.firstCodePoint);
    let groups = starts.get(first);
    if (!groups) starts.set(first, groups = new Map());
    const key = `${marker.length}:${marker.lastCodePoint}`;
    let group = groups.get(key);
    if (!group) groups.set(key, group = {length: marker.length, last: marker.lastCodePoint, hashes: new Set()});
    group.hashes.add(marker.sha256);
  }
  const rules = [...starts].map(([first, groups]) => ({first, groups: [...groups.values()]}));
  return text => {
    const normalized = text.normalize('NFKC').toLowerCase().replace(/[-_\s\u200b-\u200d\ufeff]/g, '');
    for (const {first, groups} of rules) {
      for (let offset = normalized.indexOf(first); offset !== -1; offset = normalized.indexOf(first, offset + 1)) {
        for (const group of groups) {
          const end = offset + group.length;
          if (end <= normalized.length && normalized.charCodeAt(end - 1) === group.last &&
              group.hashes.has(digest(normalized.slice(offset, end)))) return true;
        }
      }
    }
    return false;
  };
}

/** Read every byte with bounded overlap, then return findings in stable path order. */
export async function scanBrandFiles(paths, {root, matches, concurrency = 4, read = readFile}) {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new RangeError('Invalid scan concurrency');
  if (typeof matches !== 'function') throw new TypeError('A brand matcher is required');
  const list = [...paths];
  if (!list.every(path => typeof path === 'string')) throw new TypeError('Invalid scan path');
  const ordered = [...new Set(list)].sort(), directory = resolve(root), findings = new Array(ordered.length);
  let cursor = 0, checked = 0, bytesRead = 0, missing = 0;
  async function worker() {
    while (cursor < ordered.length) {
      const index = cursor++, path = ordered[index], absolute = resolve(directory, path), within = relative(directory, absolute);
      if (isAbsolute(path) || within === '..' || within.startsWith('../') || within.startsWith('..\\') || isAbsolute(within)) {
        throw new Error('Scan path is outside the project');
      }
      const pathMatch = matches(path);
      let bytes;
      try { bytes = await read(absolute); }
      catch (error) { if (error.code === 'ENOENT') { missing++; if (pathMatch) findings[index] = path + '（路径）'; continue; } throw error; }
      if (!Buffer.isBuffer(bytes)) throw new TypeError('File reads must return complete bytes');
      checked++;
      bytesRead += bytes.length;
      const contentMatch = matches(bytes.toString('utf8'));
      if (pathMatch || contentMatch) findings[index] = path + (pathMatch ? contentMatch ? '（路径与内容）' : '（路径）' : '');
    }
  }
  const workers = await Promise.allSettled(Array.from({length: Math.min(concurrency, ordered.length)}, worker));
  const failed = workers.find(result => result.status === 'rejected');
  if (failed) throw failed.reason;
  return {checked, bytesRead, missing, failures: findings.filter(Boolean)};
}
