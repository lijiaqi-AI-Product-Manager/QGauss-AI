/** bcrypt retains at most 72 UTF-8 bytes. Apply to new secrets, never truncate legacy login input. */
export function passwordProblem(password: unknown, administrator = false): string {
  const min = administrator ? 12 : 8;
  if (typeof password !== 'string' || [...password].length < min || [...password].length > 32) return `新密码需 ${min}–32 个字符`;
  if (Buffer.byteLength(password, 'utf8') > 72) return '密码中的多字节字符过多，请减少表情或特殊字符';
  if (administrator && (!/[a-z]/i.test(password) || !/\d/.test(password)
    || /change[-_ ]?(me|this)|dev[-_ ]?secret|please[-_ ]?change|your[-_ ].*(secret|key)|replace[-_ ]?(me|this)|insecure/i.test(password)
    || password.toLowerCase() === 'admin123456')) return '管理员密码需包含英文字母和数字，不能使用默认或示例密码';
  return '';
}
