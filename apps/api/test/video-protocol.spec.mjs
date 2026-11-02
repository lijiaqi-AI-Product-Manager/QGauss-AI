import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { inspectMp4, VideoFormatError, readVideoBody, videoByteRange, videoEndpoint, videoJobId, videoResultUrl } from '../dist/modules/video/video-protocol.js';
const film = await readFile(new URL('./fixtures/qgauss-video.mp4', import.meta.url));

test('视频容器校验读取真实六秒 MP4，截断和伪装的成片不会通过', () => {
  assert.deepEqual(inspectMp4(film), { bytes: film.length, mime: 'video/mp4', duration: 6 });
  for (const bytes of [Buffer.from('video/mp4'), film.subarray(0, 100), film.subarray(0, film.length - 20)]) assert.throws(() => inspectMp4(bytes), VideoFormatError);
  const changed = Buffer.from(film); changed.writeUInt32BE(0xffffffff, 0); assert.throws(() => inspectMp4(changed), VideoFormatError);
  const quicktime = Buffer.from(film); quicktime.write('qt  ', 8); assert.throws(() => inspectMp4(quicktime), VideoFormatError);
});

test('播放范围支持整片、后缀、开区间和尾部裁剪，拒绝非法或多段读取', () => {
  assert.deepEqual(videoByteRange(undefined, 20), { start: 0, end: 19, partial: false });
  assert.deepEqual(videoByteRange('bytes=3-', 20), { start: 3, end: 19, partial: true });
  assert.deepEqual(videoByteRange('bytes=-4', 20), { start: 16, end: 19, partial: true });
  assert.deepEqual(videoByteRange('bytes=17-9000', 20), { start: 17, end: 19, partial: true });
  for (const range of ['bytes=-0', 'bytes=-', 'bytes=20-', 'bytes=7-2', 'bytes=0-1,5-7', 'items=1-2', 'bytes=NaN-8']) assert.equal(videoByteRange(range, 20), null);
  assert.equal(videoByteRange(undefined, 0), null);
});

test('异步任务端点沿用兼容或原生接口，外部编号不能注入路径', () => {
  assert.equal(videoEndpoint('https://qgauss.test/v3/', 'ARK_2_5', 'submit'), 'https://qgauss.test/v3/contents/generations/tasks');
  assert.equal(videoEndpoint('https://qgauss.test/v3/contents/generations/tasks', 'ARK_2_5', 'poll', 'task-1'), 'https://qgauss.test/v3/contents/generations/tasks/task-1');
  assert.equal(videoEndpoint('https://qgauss.test/web/generate', 'PIKA_1', 'extend'), 'https://qgauss.test/web/extend');
  assert.equal(videoJobId('job_123-abc'), 'job_123-abc');
  for (const id of ['../private', 'id?token=abc', '', 42]) assert.throws(() => videoJobId(id));
  for (const url of ['https://a:b@qgauss.test', 'file:///movie.mp4', 'https://qgauss.test?a=1']) assert.throws(() => videoEndpoint(url, 'ARK_2_5', 'submit'));
  for (const url of ['data:video/mp4;base64,AA', 'https://key@qgauss.test/movie', '/relative']) assert.equal(videoResultUrl(url), null);
});

test('成片读取同时限制声明大小、实际流量和整段读取时间', async () => {
  await assert.rejects(readVideoBody(new Response('abc', { headers: { 'content-length': '10000' } }), 10, new AbortController().signal), /超过限制/);
  await assert.rejects(readVideoBody(new Response('12345678901'), 10, new AbortController().signal), /超过限制/);
  const controller = new AbortController(); let canceled = false;
  const held = new ReadableStream({ start(stream) { stream.enqueue(new Uint8Array([1])); }, cancel() { canceled = true; } });
  const pending = readVideoBody(new Response(held), 10, controller.signal); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' }); assert.equal(canceled, true);
  assert.deepEqual(await readVideoBody(new Response('QGauss'), 10, new AbortController().signal), Buffer.from('QGauss'));
});
