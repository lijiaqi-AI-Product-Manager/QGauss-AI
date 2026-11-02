import { isIP } from 'node:net';
import { isEmail } from 'class-validator';

type Environment = Record<string, string | undefined>;

/** Reads operator-owned environment only. Never return the private options object from an API. */
export function mailTransportConfiguration(env: Environment) {
  const issues: string[] = [];
  const host = env.MAIL_SMTP_HOST?.trim() || '';
  const hostValue = host.replace(/^\[|\]$/g, '');
  const hostValid = !!host && (isIP(hostValue) !== 0 || /^[a-z\d](?:[a-z\d.-]*[a-z\d])?$/i.test(hostValue));
  const number = (key: string, fallback: number, min: number, max: number) => {
    if (env[key] === undefined || env[key] === '') return fallback;
    const value = Number(env[key]);
    if (!/^\d+$/.test(env[key]!) || !Number.isSafeInteger(value) || value < min || value > max) { issues.push(key); return fallback; }
    return value;
  };
  const boolean = (key: string, fallback: boolean) => {
    if (env[key] === undefined) return fallback;
    if (!['true', 'false'].includes(env[key]!)) { issues.push(key); return fallback; }
    return env[key] === 'true';
  };
  const secure = boolean('MAIL_SMTP_SECURE', true);
  const requireTLS = boolean('MAIL_SMTP_REQUIRE_TLS', env.NODE_ENV === 'production');
  const port = number('MAIL_SMTP_PORT', secure ? 465 : 587, 1, 65535);
  const user = env.MAIL_SMTP_USER || '', password = env.MAIL_SMTP_PASS || '';
  const sender = env.MAIL_FROM || user;
  let senderValid = false;
  if (sender && sender.length <= 320 && !/[\r\n]/.test(sender)) {
    // Nodemailer already supplies the parser used by the actual SMTP envelope.
    const parsed = require('nodemailer/lib/addressparser')(sender) as Array<{ address?: string }>;
    senderValid = parsed.length === 1 && !!parsed[0].address && isEmail(parsed[0].address);
  }
  if (host && !hostValid) issues.push('MAIL_SMTP_HOST');
  if (host && !senderValid) issues.push('MAIL_FROM');
  if (!!user !== !!password) issues.push('MAIL_SMTP_AUTH');
  if (host && env.NODE_ENV === 'production' && !secure && !requireTLS) issues.push('MAIL_SMTP_TLS_REQUIRED');
  const options = {
    host: hostValue, port, secure, requireTLS,
    disableFileAccess: true, disableUrlAccess: true,
    connectionTimeout: number('MAIL_CONNECTION_TIMEOUT_MS', 20_000, 1000, 60_000),
    greetingTimeout: number('MAIL_GREETING_TIMEOUT_MS', 10_000, 1000, 60_000),
    socketTimeout: number('MAIL_SOCKET_TIMEOUT_MS', 30_000, 1000, 60_000),
    auth: user && password ? { user, pass: password } : undefined,
  };
  const retryIntervalMs = number('MAIL_RETRY_INTERVAL_MS', 300_000, 0, 86_400_000);
  return { options, sender, retryIntervalMs, hostConfigured: !!host, senderConfigured: senderValid, secure, requireTLS, authenticated: !!user && !!password, ready: hostValid && senderValid && issues.length === 0, issues };
}
