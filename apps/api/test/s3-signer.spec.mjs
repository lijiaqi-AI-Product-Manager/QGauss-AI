/**
 * SigV4 签名单元测试 —— 纯函数层面，锁死算法结构。
 *
 * 运行前提：先 npm run build（从 dist 导入）。
 *
 * 说明：这里校验的是「结构正确」（canonical request 的分行、编码、头部集合、
 * 载荷哈希），不是「AWS 真的认这个签名」——后者需要真实凭据与网络。
 * 与真实服务的一致性由 s3-driver.spec.mjs 里那份独立实现交叉验证来逼近。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  amzDate,
  scopeOf,
  sha256Hex,
  signingKey,
  signS3Request,
  uriEncode,
} from '../dist/common/storage/s3.driver.js';

const EMPTY = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
let pass = 0;
let fail = 0;
function ok(name, fn) {
  try {
    fn();
    pass += 1;
    console.log(`\u2714 ${name}`);
  } catch (e) {
    fail += 1;
    console.error(`\u2718 ${name}\n  ${e.message}`);
  }
}

ok('sha256：空串等于公认值', () => {
  assert.equal(sha256Hex(''), EMPTY);
});

ok('amzDate：ISO → YYYYMMDDTHHMMSSZ', () => {
  assert.equal(amzDate(new Date('2024-01-02T03:04:05.678Z')), '20240102T030405Z');
});

ok('scope：日期/区域/服务/终止符', () => {
  assert.equal(scopeOf('20240102T030405Z', 'us-east-1'), '20240102/us-east-1/s3/aws4_request');
});

ok('uriEncode：空格与中文按 RFC3986', () => {
  assert.equal(uriEncode('a b'), 'a%20b');
  assert.equal(uriEncode('中文'), '%E4%B8%AD%E6%96%87');
  assert.equal(uriEncode('a*b'), 'a%2Ab');
});

ok('uriEncode：斜杠可保留（路径）也可编码（片段）', () => {
  assert.equal(uriEncode('a/b', true), 'a/b');
  assert.equal(uriEncode('a/b'), 'a%2Fb');
});

ok('signingKey：确定性且随日期/区域变化', () => {
  const a = signingKey('SECRET', '20240102', 'us-east-1').toString('hex');
  const b = signingKey('SECRET', '20240102', 'us-east-1').toString('hex');
  const c = signingKey('SECRET', '20240103', 'us-east-1').toString('hex');
  const d = signingKey('SECRET', '20240102', 'eu-west-1').toString('hex');
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.notEqual(a, d);
  assert.equal(a.length, 64);
});

const at = new Date('2024-01-02T03:04:05.000Z');
const cfg = { region: 'us-east-1', accessKey: 'AKIDEXAMPLE', secretKey: 'SECRETEXAMPLE' };
const url = 'https://s3.us-east-1.amazonaws.com/bucket-1/2024/07/abc.png';
const body = Buffer.from('hello');

ok('canonical request：分行为 method/uri/空 query/排序头/空行/签名头/载荷哈希', () => {
  const signed = signS3Request({ method: 'PUT', url, body, cfg, at });
  const lines = signed.canonicalRequest.split('\n');
  assert.equal(lines[0], 'PUT');
  assert.equal(lines[1], '/bucket-1/2024/07/abc.png');
  assert.equal(lines[2], '');
  assert.equal(lines[3], 'host:s3.us-east-1.amazonaws.com');
  assert.equal(lines[4], `x-amz-content-sha256:${sha256Hex(body)}`);
  assert.equal(lines[5], 'x-amz-date:20240102T030405Z');
  assert.equal(lines[6], '');
  assert.equal(lines[7], 'host;x-amz-content-sha256;x-amz-date');
  assert.equal(lines[8], sha256Hex(body));
  assert.equal(lines.length, 9);
});

ok('stringToSign：算法/时间/作用域/摘要 四行', () => {
  const signed = signS3Request({ method: 'PUT', url, body, cfg, at });
  const lines = signed.stringToSign.split('\n');
  assert.equal(lines[0], 'AWS4-HMAC-SHA256');
  assert.equal(lines[1], '20240102T030405Z');
  assert.equal(lines[2], '20240102/us-east-1/s3/aws4_request');
  assert.equal(
    lines[3],
    createHash('sha256').update(signed.canonicalRequest).digest('hex'),
  );
});

ok('Authorization 头格式符合规范', () => {
  const signed = signS3Request({ method: 'PUT', url, body, cfg, at });
  assert.match(
    signed.headers.authorization,
    /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20240102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
  );
  assert.equal(signed.headers.host, 's3.us-east-1.amazonaws.com');
  assert.equal(signed.headers['x-amz-content-sha256'], sha256Hex(body));
});

ok('GET 用空载荷哈希', () => {
  const signed = signS3Request({ method: 'GET', url, cfg, at });
  assert.equal(signed.headers['x-amz-content-sha256'], EMPTY);
});

ok('签名对 body / method / 时间敏感，对相同输入稳定', () => {
  const s1 = signS3Request({ method: 'PUT', url, body, cfg, at }).signature;
  const s2 = signS3Request({ method: 'PUT', url, body, cfg, at }).signature;
  const s3 = signS3Request({ method: 'PUT', url, body: Buffer.from('hellp'), cfg, at }).signature;
  const s4 = signS3Request({ method: 'DELETE', url, cfg, at }).signature;
  const s5 = signS3Request({
    method: 'PUT',
    url,
    body,
    cfg,
    at: new Date(at.getTime() + 1000),
  }).signature;
  assert.equal(s1, s2);
  assert.notEqual(s1, s3);
  assert.notEqual(s1, s4);
  assert.notEqual(s1, s5);
});

console.log(`\n结果：${pass} 通过 / ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
