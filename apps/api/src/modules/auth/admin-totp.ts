import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;

export function authenticatorSecret() {
  let remainder = 0;
  let bits = 0;
  let result = '';
  for (const byte of randomBytes(20)) {
    remainder = (remainder << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += BASE32[(remainder >>> bits) & 31];
    }
  }
  return result;
}

function decodeSecret(secret: string) {
  if (!/^[A-Z2-7]{32}$/.test(secret)) throw new Error('Invalid authenticator secret');
  let remainder = 0;
  let bits = 0;
  const bytes: number[] = [];
  for (const letter of secret) {
    remainder = (remainder << 5) | BASE32.indexOf(letter);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((remainder >>> bits) & 255);
    }
  }
  return Buffer.from(bytes);
}

function timeCode(key: Buffer, counter: number) {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', key).update(message).digest();
  const offset = digest[digest.length - 1] & 15;
  const number = (digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return Buffer.from(String(number).padStart(6, '0'));
}

export function acceptedAuthenticatorCounter(secret: string, code: string, now: number, after: number) {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / (TOTP_STEP_SECONDS * 1000));
  const key = decodeSecret(secret);
  const received = Buffer.from(code);
  for (const counter of [current, current - 1, current + 1]) {
    if (counter >= 0 && counter > after && timingSafeEqual(timeCode(key, counter), received)) return counter;
  }
  return null;
}

export function newRecoveryCodes() {
  const codes = new Set<string>();
  while (codes.size < 8) {
    const value = randomBytes(10).toString('hex').toUpperCase();
    codes.add([value.slice(0, 5), value.slice(5, 10), value.slice(10, 15), value.slice(15)].join('-'));
  }
  return [...codes];
}

export function recoveryCodeHash(userId: string, code: string) {
  const digits = code.replace(/[ -]/g, '').toUpperCase();
  if (!/^[A-F0-9]{20}$/.test(digits)) return null;
  return createHash('sha256').update('QGauss admin recovery\0' + userId + '\0' + digits).digest('hex');
}
