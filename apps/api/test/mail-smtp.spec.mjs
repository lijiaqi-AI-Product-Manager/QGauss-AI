/** Real Nodemailer transport, loopback SMTP only; no external recipients or credentials. */
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { createServer as createHttpServer } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { mailFixtures, mailSettles } from './mail-fixture.mjs';
import {JwtService} from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import {AuthService} from '../dist/modules/auth/auth.service.js';
import {RateLimitService} from '../dist/common/ratelimit/rate-limit.service.js';
const fixtures = mailFixtures(); after(() => fixtures.close());

async function smtpFixture() {
  const sockets = new Set();
  const messages = [], auth = [];
  let rejectRecipient = false;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.setEncoding('utf8');
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    let pending = '', dataMode = false, lines = [], envelope = {};
    socket.write('220 qgauss.test ESMTP fixture\r\n');
    socket.on('data', chunk => {
      pending += chunk;
      let end;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (dataMode) {
          if (line !== '.') { lines.push(line.replace(/^\.\./, '.')); continue; }
          messages.push({ ...envelope, raw: lines.join('\r\n') });
          dataMode = false;
          lines = [];
          socket.write('250 2.0.0 queued\r\n');
        } else if (/^EHLO /i.test(line)) socket.write('250-qgauss.test\r\n250 AUTH PLAIN\r\n');
        else if (/^AUTH PLAIN /i.test(line)) {
          auth.push(Buffer.from(line.slice(11), 'base64').toString('utf8'));
          socket.write('235 2.7.0 authenticated\r\n');
        } else if (/^MAIL FROM:/i.test(line)) { envelope = { from: line.slice(10).trim() }; socket.write('250 sender ok\r\n'); }
        else if (/^RCPT TO:/i.test(line)) {
          envelope.to = line.slice(8).trim();
          socket.write(rejectRecipient ? '451 4.1.1 fixture temporary rejection\r\n' : '250 recipient ok\r\n');
        } else if (line === 'DATA') { dataMode = true; socket.write('354 end with dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    port: server.address().port, messages, auth,
    reject(value) { rejectRecipient = value; },
    async close() { for (const socket of sockets) socket.destroy(); await new Promise(resolve => server.close(resolve)); },
  };
}

function realService(port, f) {
  const values = { NODE_ENV: 'development', MAIL_SMTP_HOST: '127.0.0.1', MAIL_SMTP_PORT: String(port), MAIL_SMTP_SECURE: 'false', MAIL_SMTP_REQUIRE_TLS: 'false', MAIL_SMTP_USER: 'sender@qgauss.test', MAIL_SMTP_PASS: 'fixture-only', MAIL_FROM: 'QGauss AI <sender@qgauss.test>' };
  const service = fixtures.createService(f.prisma, f.settings, values);
  return { service, close() { service.onModuleDestroy(); } };
}

function mimePart(raw, type) {
  const marker = `Content-Type: ${type};`;
  const start = raw.indexOf(marker);
  assert.ok(start >= 0, `missing ${type} MIME part`);
  const headerEnd = raw.indexOf('\r\n\r\n', start);
  const headers = raw.slice(start, headerEnd);
  const tail = raw.slice(headerEnd + 4);
  const content = tail.slice(0, tail.indexOf('\r\n--'));
  if (/Content-Transfer-Encoding: base64/i.test(headers)) return Buffer.from(content.replace(/\s/g, ''), 'base64').toString('utf8');
  if (/Content-Transfer-Encoding: quoted-printable/i.test(headers)) {
    return Buffer.from(content.replace(/=\r\n/g, '').replace(/=([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))), 'binary').toString('utf8');
  }
  return content;
}

test('password recovery commits a usable link, delivers it through SMTP and resets the account', {timeout:15000}, async t=>{
  const smtp=await smtpFixture();t.after(()=>smtp.close());const f=await fixtures.fixture(),{service,close}=realService(smtp.port,f);t.after(close);
  const auth=new AuthService(f.prisma,new JwtService({secret:randomBytes(48).toString('hex')}),{get:()=>undefined},{verify:()=>true},f.settings,service,new RateLimitService());
  assert.deepEqual(await auth.forgotPassword(f.user.email,{ip:'127.0.0.1'}),{ok:true});
  const queued=await f.prisma.mailOutbox.findFirstOrThrow({where:{to:f.user.email,template:'resetPassword'}});await mailSettles(f.prisma,queued.id,['sent']);assert.equal(smtp.messages.length,1);
  const html=mimePart(smtp.messages[0].raw,'text/html'),match=/reset-password\?token=([a-f0-9]{48})/.exec(html);assert.ok(match);const token=match[1],reset=await f.prisma.passwordReset.findFirstOrThrow({where:{userId:f.user.id}});assert.equal(reset.tokenHash,createHash('sha256').update(token).digest('hex'));
  await auth.resetPassword(token,'QgaussRecovery-728',{ip:'127.0.0.1'});const user=await f.prisma.user.findUniqueOrThrow({where:{id:f.user.id}});assert.equal(await bcrypt.compare('QgaussRecovery-728',user.passwordHash),true);assert.ok((await f.prisma.passwordReset.findUniqueOrThrow({where:{id:reset.id}})).usedAt);await assert.rejects(()=>auth.resetPassword(token,'QgaussRecovery-729',{ip:'127.0.0.1'}));
});

test('SMTP 真实适配器完成认证、信封和双格式欢迎邮件', { timeout: 10000 }, async t => {
  const smtp = await smtpFixture();
  t.after(() => smtp.close());
  const f = await fixtures.fixture(), prisma = f.prisma;
  const { service, close } = realService(smtp.port, f);
  t.after(close);
  const intent = await service.send('welcome', f.user.email, { username: '小高' });
  assert.equal(intent.status, 'queued');
  const row = await mailSettles(prisma, intent.id, ['sent']);
  assert.equal(smtp.messages.length, 1);
  assert.deepEqual(smtp.auth, ['\0sender@qgauss.test\0fixture-only']);
  assert.equal(smtp.messages[0].from, '<sender@qgauss.test>');
  assert.equal(smtp.messages[0].to, '<recipient@qgauss.test>');
  assert.match(mimePart(smtp.messages[0].raw, 'text/plain'), /小高.*QGauss AI/);
  assert.match(mimePart(smtp.messages[0].raw, 'text/html'), /欢迎加入 QGauss AI/);
  assert.equal(row.status, 'sent');
  assert.equal(row.attempts, 1);
  assert.ok(row.sentAt instanceof Date);
});

test('SMTP 451 后从模板有限重试，HTML 与纯文本都保留有效重置令牌', { timeout: 10000 }, async t => {
  const smtp = await smtpFixture();
  t.after(() => smtp.close());
  const f = await fixtures.fixture(), prisma = f.prisma;
  const { service, close } = realService(smtp.port, f);
  t.after(close);
  smtp.reject(true);
  const token = randomBytes(24).toString('hex'), resetUrl = 'https://qgauss.test/reset-password?token=' + token + '&source=retry';
  await prisma.passwordReset.create({ data: { userId: f.user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 60000) } });
  const intent = await service.send('resetPassword', f.user.email, { username: '小高', resetUrl });
  const failed = await mailSettles(prisma, intent.id, ['failed']);
  assert.equal(failed.attempts, 1);
  assert.equal(failed.error, 'SMTP_TEMPORARY');
  await prisma.mailOutbox.update({ where: { id: intent.id }, data: { body: '<script>obsolete cached body</script>', lastTriedAt: new Date(0) } });
  smtp.reject(false);
  assert.deepEqual(await service.retryFailed(), { tried: 1, sent: 1, failed: 0 });
  assert.equal(smtp.messages.length, 1);
  assert.ok(mimePart(smtp.messages[0].raw, 'text/plain').includes(resetUrl));
  const html = mimePart(smtp.messages[0].raw, 'text/html');
  assert.ok(html.includes('token=' + token + '&amp;source=retry'));
  assert.doesNotMatch(html, /obsolete cached body/);
  const saved = await prisma.mailOutbox.findUniqueOrThrow({ where: { id: intent.id } });
  assert.equal(saved.status, 'sent');
  assert.equal(saved.attempts, 2);
  assert.equal(saved.error, null);
});

test('生产传输器拒绝文件和 URL 附件，不读取本机资源', { timeout: 10000 }, async t => {
  const smtp = await smtpFixture();
  t.after(() => smtp.close());
  const { service, close } = realService(smtp.port, await fixtures.fixture());
  t.after(close);
  let requests = 0;
  const http = createHttpServer((_req, res) => { requests += 1; res.end('QGAUSS_PRIVATE_SENTINEL'); });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  t.after(() => new Promise(resolve => http.close(resolve)));
  const dir = await mkdtemp(join(tmpdir(), 'qgauss-mail-policy-'));
  const file = join(dir, 'sentinel.txt');
  await writeFile(file, 'QGAUSS_PRIVATE_SENTINEL');
  t.after(async () => { await unlink(file); await rmdir(dir); });
  for (const path of [file, `http://127.0.0.1:${http.address().port}/sentinel`]) {
    await assert.rejects(service.transporter.sendMail({ from: 'sender@qgauss.test', to: 'recipient@qgauss.test', subject: 'QGauss fixture', text: 'test', attachments: [{ filename: 'fixture.txt', path }] }), /access rejected/i);
  }
  assert.equal(requests, 0);
  assert.ok(smtp.messages.every(message => !message.raw.includes('QGAUSS_PRIVATE_SENTINEL')));
});
