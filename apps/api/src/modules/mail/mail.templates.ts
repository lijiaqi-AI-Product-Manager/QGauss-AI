/**
 * 邮件模板（代码内注册表，和配置注册表同一思路：类型与文案都在代码里，数据库只存发件记录）
 */

export type MailTemplateName = 'welcome' | 'resetPassword' | 'deliveryProbe' | 'emailVerification';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

function html(value: unknown): string {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function headerText(value: unknown): string {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
}

function resetLink(value: string): string {
  const invalid = () => new Error('重置密码链接必须使用 HTTP(S) 绝对地址');
  let url: URL;
  try { url = new URL(value); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw invalid();
  return url.href;
}

function layout(siteName: string, title: string, body: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>${html(title)}</title></head>
<body style="margin:0;padding:24px;background:#f0eef9;font-family:-apple-system,'Segoe UI','PingFang SC',sans-serif;color:#29273e">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e6e0f5;border-radius:24px;overflow:hidden">
    <div style="padding:24px 28px;background:#4c3cbd;background:linear-gradient(120deg,#4c3cbd,#7873ef,#b190e6);color:#fff;font-size:15px;letter-spacing:2px">QGauss AI <span style="float:right">✦</span></div>
    <div style="padding:28px"><h2 style="margin:0 0 16px;font-size:22px">${html(title)}</h2>
    <div style="font-size:14px;line-height:1.8">${body}</div>
    <hr style="border:none;border-top:1px solid #eee;margin:24px 0">
    <p style="font-size:12px;color:#8a919f;margin:0">此邮件由 ${html(siteName)} 自动发送，请勿直接回复。</p>
    </div></div>
</body></html>`;
}

export function renderMail(
  name: MailTemplateName,
  data: Record<string, string>,
): RenderedMail {
  const siteName = headerText(data.siteName) || 'QGauss AI';
  if(name==='emailVerification'){
    if(!/^\d{6}$/.test(data.code))throw new Error('邮箱验证码必须是六位数字');
    const purpose=data.purpose==='创建账户'?'创建账户':'确认注册邮箱',title='给你的空间，一份确认。';
    return{subject:`${siteName} · 邮箱验证码`,html:layout(siteName,title,`<p>你正在${purpose}。</p><p style="font-size:32px;letter-spacing:8px;font-weight:700;padding:20px;background:#f0eef9;border-radius:16px">${html(data.code)}</p><p>验证码十分钟内有效，只能使用一次。新验证码会替换旧验证码。</p><p>如果不是你本人操作，请忽略这封邮件。</p>`),text:`${siteName}：${purpose}的邮箱验证码为 ${data.code}。十分钟内有效，只能使用一次；如果不是你本人操作，请忽略。`};
  }

  if (name === 'deliveryProbe') {
    const title = '一声你好，已经抵达。';
    const text = `你好，${data.username || '朋友'}：这是一封由你主动发起的 QGauss AI 体验信。请回到邮件中心，点击“我已在邮箱收到这封信”，为这次投递留下确认。此邮件不含登录或密码重置链接。`;
    return { subject: 'QGauss AI · 一声你好', html: layout(siteName, title, `<p>你好，${html(data.username || '朋友')}：</p><p>这是你刚刚主动寄给自己的一封体验信。愿下一次灵感，也能顺利抵达。</p><p>请回到 <strong>QGauss AI 邮件中心</strong>，点击“我已在邮箱收到这封信”，为这次投递留下确认。</p><p style="color:#77718a">这封信不含登录或密码重置链接。若不是你本人发起，请忽略。</p>`), text };
  }

  if (name === 'welcome') {
    const title = `欢迎加入 ${siteName}`;
    const body = `
      <p>你好，${html(data.username || '朋友')}：</p>
      <p>你的账号已创建成功，可以开始使用了。</p>
      <p>如果这不是你本人的操作，请忽略本邮件。</p>`;
    return {
      subject: title,
      html: layout(siteName, title, body),
      text: `你好，${data.username || '朋友'}：你的 ${siteName} 账号已创建成功。`,
    };
  }

  if (name === 'resetPassword') {
    const title = '重置密码';
    const url = resetLink(data.resetUrl);
    const body = `
      <p>你好，${html(data.username || '朋友')}：</p>
      <p>我们收到了重置密码的请求。点击下面的链接设置新密码（30 分钟内有效）：</p>
      <p><a href="${html(url)}" style="color:#2f6bff">${html(url)}</a></p>
      <p>如果这不是你本人的操作，请忽略本邮件，你的密码不会改变。</p>`;
    return {
      subject: `${siteName} · ${title}`,
      html: layout(siteName, title, body),
      text: `重置密码链接：${url}（30 分钟内有效）`,
    };
  }

  throw new Error(`未注册的邮件模板: ${name}`);
}
