import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buffer } from 'node:stream/consumers';
import { VideoMediaService } from '../dist/modules/video/video-media.service.js';
import { SecretBox } from '../dist/common/crypto/secret-box.js';
import { LocalStorageDriver } from '../dist/common/storage/storage.driver.js';

function fixture() {
  const actor = { id: 'owner', tokenVersion: 2 }, task = { id: 'film-1', userId: 'owner', status: 'SUCCESS', resultJson: JSON.stringify({ videoFileId: 'movie-1' }), published: false, deletedAt: null };
  const file = { id: 'movie-1', mime: 'video/mp4', scope: 'video', size: 100 }, box = new SecretBox(randomBytes(32).toString('base64'));
  const media = new VideoMediaService({ user: { findFirst: async () => actor }, videoTask: { findUnique: async () => task } }, { detail: async () => file }, box, { tryConsume: () => true });
  return { actor, task, file, box, media };
}
const missing = error => error.getStatus() === 404;
const ticket = url => new URL(url, 'https://qgauss.test').searchParams.get('ticket');
test('播放凭证绑定账户版本、文件和用途，密码重置、撤回或回收后立即停止新读取', async () => {
  const f = fixture(), link = await f.media.playback('owner', f.task), raw = ticket(link.videoUrl);
  const first = await f.media.access('film-1', 'video', raw, 'playback', 'local'); assert.equal(first.fileId, 'movie-1');
  assert.equal(raw.includes('movie-1'), false);
  await assert.rejects(f.media.access('film-1', 'video', raw, 'input', 'local'), missing);
  await assert.rejects(f.media.access('other-film', 'video', raw, 'playback', 'local'), missing);
  f.actor.tokenVersion++; await assert.rejects(f.media.access('film-1', 'video', raw, 'playback', 'local'), missing); f.actor.tokenVersion--;
  f.task.deletedAt = new Date(); await assert.rejects(f.media.access('film-1', 'video', raw, 'playback', 'local'), missing); f.task.deletedAt = null;
  f.file.scope = 'attachment'; await assert.rejects(f.media.access('film-1', 'video', raw, 'playback', 'local'), missing);
});
test('过期、过长有效期和密文篡改的播放凭证均拒绝', async () => {
  const f = fixture(), raw = ticket((await f.media.playback('owner', f.task)).videoUrl), value = JSON.parse(f.box.decrypt(raw));
  for (const expires of [Date.now() - 1, Date.now() + 123 * 60000]) await assert.rejects(f.media.access('film-1', 'video', f.box.encrypt(JSON.stringify({ ...value, expires })), 'playback', 'local'), missing);
  await assert.rejects(f.media.access('film-1', 'video', raw.slice(0, -8) + 'aaaaaaaa', 'playback', 'local'), missing);
  f.task.published = true; f.actor.id = 'viewer'; const publicLink = await f.media.playback('viewer', f.task);
  assert.equal((await f.media.access('film-1', 'video', ticket(publicLink.videoUrl), 'playback', 'local')).owner, 'owner');
  f.task.published = false; await assert.rejects(f.media.access('film-1', 'video', ticket(publicLink.videoUrl), 'playback', 'local'), missing);
});
test('本地成片按真实字节流读取，大小变化和越界读取不静默返回损坏成片', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qgauss-video-range-')), storage = new LocalStorageDriver(dir), key = '2026/11/01234567-film.mp4';
  try { await storage.put(key, Buffer.from('QGauss-motion')); assert.equal((await buffer(await storage.openRange(key, 2, 5, 13))).toString(), 'auss'); await assert.rejects(storage.openRange(key, 0, 20, 13)); await assert.rejects(storage.openRange(key, 0, 5, 12)); await assert.rejects(storage.openRange('../escape.mp4', 0, 5, 13)); }
  finally { await rm(dir, { recursive: true, force: true }); }
});
