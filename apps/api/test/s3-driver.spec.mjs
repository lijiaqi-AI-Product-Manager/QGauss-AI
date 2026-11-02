/**
 * S3 驱动端到端测试：对本地 fake S3 跑 PUT / GET / HEAD / DELETE / 重试 / 配置校验。
 *
 * 关键设计：fake 服务端**独立重算一遍签名**（不 import 被测的 signS3Request），
 * 只有两次计算一致才放行。这样能抓住「头没签全、canonical 顺序错、编码不一致」
 * 这类光看结构看不出来的问题。
 * 实际服务的凭据和网络另行验证，见 docs/TESTING.md。
 */
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { S3StorageDriver, createStorageDriver } from '../dist/common/storage/s3.driver.js';

const SECRET = 'test-secret-key';
const AK = 'test-access-key';
const REGION = 'us-east-1';
const BUCKET = 'demo-bucket';

const store = new Map();
let lastAuth = null;
let failNextPut = 0;
let rangeMode = '', rangeClosed;

let pass = 0;
let fail = 0;

/** 断言计数器；异步断言必须 await，否则失败会变成 unhandledRejection 而假绿 */
async function ok(name, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`\u2714 ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`\u2718 ${name}\n  ${e.message}`);
  }
}

function sha256(s) {
  return createHash('sha256').update(s).digest('hex');
}

/** 独立实现的 SigV4 校验（不依赖被测代码） */
function verify(req, rawBody) {
  const auth = req.headers.authorization ?? '';
  const re =
    /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request, SignedHeaders=([^,]+), Signature=([0-9a-f]{64})$/;
  const m = re.exec(auth);
  if (!m) return { ok: false, why: 'bad auth header' };
  const [, ak, dateStamp, region, signedHeaders, signature] = m;
  if (ak !== AK) return { ok: false, why: 'bad access key' };
  if (region !== REGION) return { ok: false, why: 'bad region' };

  const payloadHash = req.headers['x-amz-content-sha256'] ?? '';
  if (payloadHash !== sha256(rawBody)) return { ok: false, why: 'payload hash mismatch' };

  const canonicalHeaders = signedHeaders
    .split(';')
    .map((h) => `${h}:${h === 'host' ? req.headers.host : (req.headers[h] ?? '')}\n`)
    .join('');
  const canonicalRequest = [
    req.method,
    req.url.split('?')[0],
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');
  const scope = `${dateStamp}/${region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    req.headers['x-amz-date'],
    scope,
    sha256(canonicalRequest),
  ].join('\n');
  const kDate = createHmac('sha256', `AWS4${SECRET}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update('s3').digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  const expect = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
  return expect === signature ? { ok: true } : { ok: false, why: 'signature mismatch' };
}

const server = createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const rawBody = Buffer.concat(chunks);
    lastAuth = req.headers.authorization;
    const v = verify(req, rawBody);
    if (!v.ok) {
      res.writeHead(403, { 'content-type': 'text/plain' });
      res.end(`Forbidden: ${v.why}`);
      return;
    }

    const path = decodeURIComponent(req.url.split('?')[0]);
    const prefix = `/${BUCKET}/`;
    if (!path.startsWith(prefix)) {
      res.writeHead(400).end('wrong bucket prefix');
      return;
    }
    const key = path.slice(prefix.length);

    if (req.method === 'PUT') {
      if (failNextPut > 0) {
        failNextPut -= 1;
        res.writeHead(503).end('slow down');
        return;
      }
      store.set(key, rawBody);
      res.writeHead(200).end();
      return;
    }
    if (req.method === 'GET') {
      if (!store.has(key)) {
        res.writeHead(404).end('not found');
        return;
      }
      if (req.headers.range && rangeMode !== 'ignore') {
        const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range), bytes = store.get(key), start = Number(match?.[1]), end = Number(match?.[2]);
        if (!match || !req.headers.authorization.includes('host;range;')) { res.writeHead(400).end('range must be signed'); return; }
        res.writeHead(206, { 'content-type': 'application/octet-stream', 'content-range': `bytes ${start}-${end}/${rangeMode === 'wrong-total' ? bytes.length + 1 : bytes.length}`, 'content-length': end - start + 1 });
        if (rangeMode === 'stall') { res.on('close', () => rangeClosed?.()); res.write(bytes.subarray(start, start + 1)); return; }
        res.end(bytes.subarray(start, end + 1)); return;
      }
      res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(store.get(key));
      return;
    }
    if (req.method === 'HEAD') {
      res.writeHead(store.has(key) ? 200 : 404).end();
      return;
    }
    if (req.method === 'DELETE') {
      store.delete(key);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(405).end();
  });
});

const KEY = '2024/07/0123456789abcdef0123456789abcdef.png';
const MISSING = '2024/07/ffffffffffffffffffffffffffffffff.bin';

async function main() {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const endpoint = `http://127.0.0.1:${port}`;
  const base = {
    endpoint,
    region: REGION,
    bucket: BUCKET,
    accessKey: AK,
    secretKey: SECRET,
    forcePathStyle: true,
    timeoutMs: 5000,
  };

  const driver = new S3StorageDriver({ ...base, retries: 0 });

  await ok('PUT 通过独立签名校验并落库', async () => {
    await driver.put(KEY, Buffer.from('hello-s3'));
    assert.equal(store.get(KEY)?.toString(), 'hello-s3');
    assert.match(lastAuth, /^AWS4-HMAC-SHA256 Credential=/);
  });

  await ok('GET 取回一致字节', async () => {
    const got = await driver.get(KEY);
    assert.equal(got.toString(), 'hello-s3');
  });

  await ok('分段播放使用独立校验的签名 Range，只读取要求的原始字节', async () => {
    const chunks = []; for await (const part of await driver.openRange(KEY, 2, 5, 8)) chunks.push(part);
    assert.equal(Buffer.concat(chunks).toString(), 'llo-'); assert.match(lastAuth, /SignedHeaders=host;range;/);
  });
  await ok('存储服务忽略范围或返回不同文件大小时拒绝静默整片传输', async () => {
    try { for (const mode of ['ignore', 'wrong-total']) { rangeMode = mode; await assert.rejects(driver.openRange(KEY, 0, 3, 8), /范围读取/); } }
    finally { rangeMode = ''; }
  });
  await ok('关闭播放器会终止未读完的远程成片流', async () => {
    rangeMode = 'stall';
    try {
      const stream = await driver.openRange(KEY, 0, 7, 8); await new Promise(done => stream.once('data', done));
      await new Promise((done, reject) => { const timer = setTimeout(() => reject(Error('range fetch not aborted')), 3000); rangeClosed = () => { clearTimeout(timer); done(); }; stream.destroy(); });
    } finally { rangeMode = ''; rangeClosed = null; }
  });

  await ok('exists 对存在/不存在分别返回 true/false', async () => {
    assert.equal(await driver.exists(KEY), true);
    assert.equal(await driver.exists(MISSING), false);
  });

  await ok('GET 不存在时抛出可读错误', async () => {
    await assert.rejects(() => driver.get(MISSING), /对象不存在/);
  });

  await ok('DELETE 后对象消失，且删除不存在的对象不抛', async () => {
    await driver.remove(KEY);
    assert.equal(await driver.exists(KEY), false);
    await driver.remove(KEY);
  });

  await ok('5xx 会重试并最终成功', async () => {
    const retryDriver = new S3StorageDriver({ ...base, retries: 2 });
    failNextPut = 1;
    await retryDriver.put(KEY, Buffer.from('after-retry'));
    assert.equal(store.get(KEY)?.toString(), 'after-retry');
  });

  await ok('错误密钥被拒（403）——证明签名真的参与校验', async () => {
    const badDriver = new S3StorageDriver({ ...base, secretKey: 'wrong-secret', retries: 0 });
    await assert.rejects(() => badDriver.put(KEY, Buffer.from('x')), /403/);
  });

  await new Promise((r) => server.close(r));
}

await main();

await ok('配置校验：缺环境变量时抛出可读错误', () => {
  const saved = { ...process.env };
  try {
    process.env.STORAGE_DRIVER = 's3';
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY;
    delete process.env.S3_SECRET_KEY;
    assert.throws(() => createStorageDriver(), /缺少环境变量/);
    process.env.STORAGE_DRIVER = 'cos';
    assert.throws(() => createStorageDriver(), /未知的 STORAGE_DRIVER/);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

await ok('默认驱动是 local', () => {
  const saved = process.env.STORAGE_DRIVER;
  try {
    delete process.env.STORAGE_DRIVER;
    assert.equal(createStorageDriver().name, 'local');
  } finally {
    if (saved !== undefined) process.env.STORAGE_DRIVER = saved;
  }
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
