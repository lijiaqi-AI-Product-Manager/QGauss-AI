import {createHash} from 'node:crypto';

export const APP_IMAGE_SCOPE = 'app-icon';
export const APP_IMAGE_PREFIX = 'qgauss:app-icon:';
export const APP_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const APP_IMAGE_MAX_PIXELS = 16 * 1024 * 1024;
export const APP_IMAGE_ICONS = ['🪐', '🎨', '🧠', '📝', '🧭', '💻'];
export function appImageId(icon: unknown): string | null {
  return typeof icon === 'string' && /^qgauss:app-icon:ai_[a-f\d]{48}$/.test(icon) ? icon.slice(APP_IMAGE_PREFIX.length) : null;
}
export function appImageRequestId(userId: string, requestKey: unknown): string | null {
  if (typeof requestKey !== 'string' || !/^[a-f\d]{8}-[a-f\d]{4}-4[a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(requestKey)) return null;
  return 'ai_' + createHash('sha256').update(userId + ':' + requestKey.toLowerCase()).digest('hex').slice(0, 48);
}
