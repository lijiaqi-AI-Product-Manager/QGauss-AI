export function installationProblem(form) {
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(form.ownerToken || '')) return '请填写部署时生成的安装凭证。';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email?.trim() || '')) return '请填写有效的管理员邮箱。';
  if (!/^[A-Za-z0-9_\-]{3,20}$/.test(form.username || '')) return '账户名需为 3–20 位英文字母、数字、下划线或短横线。';
  const password = form.password || '';
  if ([...password].length < 12 || [...password].length > 32 || !/[a-z]/i.test(password) || !/\d/.test(password)) return '管理员密码需为 12–32 个字符，包含英文字母和数字。';
  if (new TextEncoder().encode(password).length > 72) return '密码中的多字节字符过多，请减少表情或特殊字符。';
  if (/change[-_ ]?(me|this)|please[-_ ]?change|replace[-_ ]?(me|this)|insecure/i.test(password) || password.toLowerCase() === 'admin123456') return '请设置独立的管理员密码，不要使用示例密码。';
  if (password !== form.confirm) return '两次填写的新密码不一致。';
  if ([...(form.displayName || '')].length > 32) return '昵称请控制在 32 个字符以内。';
  try {
    const url = new URL(form.siteBaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== form.siteBaseUrl) throw new Error();
  } catch { return '站点地址只需填写协议、主机和可选端口，不包含路径。'; }
  return '';
}
