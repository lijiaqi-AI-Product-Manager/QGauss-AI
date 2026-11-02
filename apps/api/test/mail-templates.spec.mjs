import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMail } from '../dist/modules/mail/mail.templates.js';

test('邮件模板转义所有 HTML 变量并保留纯文本内容', () => {
  const mail = renderMail('welcome', { siteName: 'QGauss <img src=x onerror="x"> & AI', username: '<b>小高</b> \' " &' });
  assert.doesNotMatch(mail.html, /<img|<b>小高/);
  assert.match(mail.html, /&lt;img src=x onerror=&quot;x&quot;&gt; &amp; AI/);
  assert.match(mail.html, /&lt;b&gt;小高&lt;\/b&gt; &#39; &quot; &amp;/);
  assert.match(mail.text, /<b>小高<\/b>/);
});

test('主题清理控制字符，空站名使用 QGauss AI', () => {
  const mail = renderMail('welcome', { siteName: 'QGauss\r\nBcc: injected@qgauss.test\0', username: 'qg' });
  assert.doesNotMatch(mail.subject, /[\u0000-\u001f\u007f]/);
  assert.equal(renderMail('welcome', { siteName: ' \r\n' }).subject, '欢迎加入 QGauss AI');
});

test('重置链接在 HTML 中转义，纯文本保留完整令牌', () => {
  const url = 'https://qgauss.test/reset-password?token=test-token&next=%2Fchat';
  const mail = renderMail('resetPassword', { siteName: 'QGauss AI', username: 'qg', resetUrl: url });
  assert.ok(mail.html.includes('href="https://qgauss.test/reset-password?token=test-token&amp;next=%2Fchat"'));
  assert.ok(mail.text.includes(url));
  assert.ok(renderMail('resetPassword', { resetUrl: 'http://localhost:9520/reset-password?token=local' }).text.includes('http://localhost:9520'));
});

test('重置链接只允许不含凭据的 HTTP(S) 绝对地址，错误不泄露令牌', () => {
  for (const resetUrl of [undefined, '', '/relative?token=private', 'javascript:private', 'data:text/html,private', 'file:///private', 'https://user:private@qgauss.test/']) {
    assert.throws(() => renderMail('resetPassword', { resetUrl }), error => {
      assert.equal(error.message, '重置密码链接必须使用 HTTP(S) 绝对地址');
      return true;
    });
  }
});
