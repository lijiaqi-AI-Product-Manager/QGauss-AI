import { test } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { parseImageInputs, prepareImageInputs } from '../dist/modules/image/image-inputs.js';
const source = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#2679b7' } }).png().toBuffer();
const maskData = Buffer.alloc(4 * 3 * 4, 255); maskData[3] = 0;
const selection = await sharp(maskData, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
function storage(overrides = {}) { const files = { a: source, b: source, mask: selection, ...overrides }, reads = []; return { reads, async read(id, user, role) { reads.push({ id, user, role }); if (!files[id]) throw Error('not owned'); return { buffer: files[id], mime: 'image/png' }; } }; }
test('多图顺序、源文件摘要与透明选区保存在持久快照，调用前统一方向与 PNG', async () => {
  const input = storage(), accepted = await prepareImageInputs(input, 'owner', ['b', 'a'], 'mask');
  assert.deepEqual(accepted.snapshot.references.map(x => x.id), ['b', 'a']); assert.equal(accepted.snapshot.mask.width, 4);
  assert.deepEqual(input.reads.map(x => [x.user, x.role]), [['owner', 'USER'], ['owner', 'USER'], ['owner', 'USER']]);
  const resumed = await prepareImageInputs(input, 'owner', ['b', 'a'], 'mask', parseImageInputs(JSON.stringify(accepted.snapshot)), true);
  assert.equal(resumed.images.length, 2); assert.equal(resumed.maskImage.mime, 'image/png');
  assert.equal((await sharp(resumed.images[0].buffer).metadata()).width, 4);
});
test('重复图片、空数组、超过八张、参考图同时用作选区都会拒绝', async () => {
  for (const [ids, mask] of [[[], undefined], [['a', 'a'], undefined], [Array.from({ length: 9 }, (_, i) => String(i)), undefined], [['a'], 'a']]) await assert.rejects(prepareImageInputs(storage(), 'owner', ids, mask));
});
test('别人的或已删除的参考图和选区不能通过归属检查', async () => {
  await assert.rejects(prepareImageInputs(storage(), 'other', ['missing']), /参考图不存在/);
  await assert.rejects(prepareImageInputs(storage(), 'other', ['a'], 'missing'), /选区不存在/);
});
test('损坏、伪装、过大图片在预留次数前被完整解码检查拒绝', async () => {
  for (const buffer of [Buffer.from('<svg></svg>'), source.subarray(0, 34), Buffer.alloc(10 * 1024 * 1024 + 1)]) await assert.rejects(prepareImageInputs(storage({ a: buffer }), 'owner', ['a']));
});
test('像素炸弹超过单图上限时不进入像素处理', async () => {
  const big = await sharp({ create: { width: 4096, height: 4096, channels: 3, background: '#fff' } }).png().toBuffer();
  await assert.rejects(prepareImageInputs(storage({ a: big }), 'owner', ['a']), /800 万像素/);
});
test('选区必须与主图同尺寸、有透明通道，且保留和替换区域均存在', async () => {
  const opaque = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#fff' } }).png().toBuffer();
  const transparent = await sharp({ create: { width: 4, height: 3, channels: 4, background: '#0000' } }).png().toBuffer();
  const noAlpha = await sharp(source).removeAlpha().png().toBuffer();
  const wrongSize = await sharp(selection).resize(2, 2).png().toBuffer();
  for (const mask of [opaque, transparent, noAlpha, wrongSize]) await assert.rejects(prepareImageInputs(storage({ mask }), 'owner', ['a'], 'mask'));
});
test('排队后的源字节或选区发生变化时不会使用新内容', async () => {
  const accepted = await prepareImageInputs(storage(), 'owner', ['a'], 'mask');
  const changed = await sharp(source).negate().png().toBuffer();
  await assert.rejects(prepareImageInputs(storage({ a: changed }), 'owner', ['a'], 'mask', accepted.snapshot, true), /参考图内容已变化/);
  await assert.rejects(prepareImageInputs(storage({ mask: changed }), 'owner', ['a'], 'mask', accepted.snapshot, true), /选区已变化/);
});
test('EXIF 旋转后的主图尺寸与浏览器画布对应，发送前移除方向标记', async () => {
  const jpeg = await sharp(source).jpeg().withMetadata({ orientation: 6 }).toBuffer();
  const rotatedMask = await sharp(selection).rotate(90).png().toBuffer();
  const result = await prepareImageInputs(storage({ a: jpeg, mask: rotatedMask }), 'owner', ['a'], 'mask', undefined, true);
  assert.equal(result.snapshot.references[0].width, 3); assert.equal(result.snapshot.references[0].height, 4);
  assert.equal((await sharp(result.images[0].buffer).metadata()).orientation, undefined);
});
test('损坏输入快照显式失败，旧任务保持可用', () => {
  assert.equal(parseImageInputs(null), null);
  for (const raw of ['{', '{}', '{"version":1,"references":[]}']) assert.throws(() => parseImageInputs(raw));
});
