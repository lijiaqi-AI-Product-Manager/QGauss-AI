import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as wait } from 'node:timers/promises';
import { createHash } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const base = new URL(process.env.QGAUSS_LIVE_BASE ?? 'http://127.0.0.1:9520');
if (base.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
  throw new Error('Live publication verification only accepts a local HTTP site root without credentials');
}
const directory = join(root, 'artifacts/live-publication');
await mkdir(directory, { recursive: true });
const result = { startedAt: new Date().toISOString(), base: base.origin, requests: 0, samples: 0, statuses: {}, failures: [], versions: [], oldResources: [], childExitCode: null };
async function request(path, method = 'GET') {
  const response = await fetch(new URL(path, base), { method, signal: AbortSignal.timeout(3000), headers: { 'cache-control': 'no-cache' } });
  result.requests++;
  result.statuses[response.status] = (result.statuses[response.status] ?? 0) + 1;
  if (response.status !== 200) { await response.body?.cancel(); throw new Error(method + ' ' + path + ' returned ' + response.status); }
  return response;
}
function resources(html) {
  return [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(x => x[1]);
}
await (await request('/api/health')).arrayBuffer();
const firstHtml = await (await request('/chat')).text();
const firstResources = resources(firstHtml);
if (!firstResources.length) throw new Error('The current local frontend is not built');
for (const asset of firstResources.filter(x => x.endsWith('.js'))) {
  const source = await (await request(asset)).text();
  for (const match of source.matchAll(/import\(['"]\.\/(chunks\/(?:Account|ResetPassword|Chat)-[^'"]+\.js)['"]\)/g)) result.oldResources.push('/assets/' + match[1]);
}
result.oldResources = [...new Set([...firstResources, ...result.oldResources])].sort();
async function sample() {
  result.samples++;
  try {
    const html = await (await request('/chat')).text();
    const sha256 = createHash('sha256').update(html).digest('hex');
    if (!result.versions.some(x => x.sha256 === sha256)) result.versions.push({ sha256, observedAt: new Date().toISOString(), resources: resources(html) });
    const current = resources(html);
    if (!current.length) throw new Error('Observed an incomplete frontend entry');
    await Promise.all([...new Set([...current, ...result.oldResources])].map(async path => {
      const response = await request(path, 'HEAD');
      if (!/javascript|text\/css/.test(response.headers.get('content-type') ?? '')) throw new Error('Wrong resource content type: ' + path);
    }));
    if (result.samples % 10 === 0) await (await request('/api/health')).arrayBuffer();
  } catch (error) { result.failures.push({ sample: result.samples, at: new Date().toISOString(), message: error.message }); }
}

const log = createWriteStream(join(root, '.qgauss-publication-verify.log'));
const executable = process.platform === 'win32' ? process.env.ComSpec ?? 'cmd.exe' : 'npm';
const args = process.platform === 'win32' ? ['/d', '/s', '/c', 'npm run verify'] : ['run', 'verify'];
const child = spawn(executable, args, { cwd: root, shell: false, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
child.stdout.pipe(log, { end: false });
child.stderr.pipe(log, { end: false });
let done = false;
const exited = new Promise(resolveExit => {
  child.once('error', error => { result.failures.push({ message: error.message }); done = true; resolveExit(1); });
  child.once('close', code => { done = true; resolveExit(code ?? 1); });
});
while (!done) { await sample(); await Promise.race([wait(750), exited]); }
result.childExitCode = await exited;
await sample();
result.finishedAt = new Date().toISOString();
result.passed = result.childExitCode === 0 && result.failures.length === 0;
await new Promise(doneWriting => log.end(doneWriting));
await writeFile(join(directory, 'live-availability.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ passed: result.passed, childExitCode: result.childExitCode, requests: result.requests, samples: result.samples, failures: result.failures, versions: result.versions.length, oldResources: result.oldResources.length }));
process.exitCode = result.passed ? 0 : 1;
