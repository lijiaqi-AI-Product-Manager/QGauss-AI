import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskPoint, paintMask } from '../src/lib/image-mask.js';
test('画布缩放后指针仍对应同一图像区域，越界坐标被约束', () => {
  assert.deepEqual(maskPoint({ clientX: 150, clientY: 80 }, { left: 100, top: 30, width: 200, height: 100 }), { x: .25, y: .5 });
  assert.deepEqual(maskPoint({ clientX: 200, clientY: 130 }, { left: 100, top: 30, width: 400, height: 200 }), { x: .25, y: .5 });
  assert.deepEqual(maskPoint({ clientX: -100, clientY: 500 }, { left: 0, top: 0, width: 200, height: 100 }), { x: 0, y: 1 });
  assert.equal(maskPoint({}, { width: 0, height: 0 }), null);
});
test('生成选区与显示覆盖层使用相反透明合成，擦除重新保留原区域', () => {
  function context() { const calls = []; return { calls, clearRect() {}, fillRect() {}, beginPath() {}, moveTo(x, y) { calls.push(['start', x, y]); }, lineTo() {}, stroke() { calls.push(['stroke', this.globalCompositeOperation, this.lineWidth]); }, arc() {}, fill() {} }; }
  const strokes = [{ size: .1, erase: false, points: [{ x: .25, y: .5 }] }, { size: .2, erase: true, points: [{ x: .5, y: .5 }] }];
  const mask = context(), overlay = context(); paintMask(mask, 800, 400, strokes); paintMask(overlay, 800, 400, strokes, true);
  assert.deepEqual(mask.calls, [['start', 200, 200], ['stroke', 'destination-out', 40], ['start', 400, 200], ['stroke', 'source-over', 80]]);
  assert.deepEqual(overlay.calls.filter(x => x[0] === 'stroke').map(x => x[1]), ['source-over', 'destination-out']);
  assert.equal(mask.globalCompositeOperation, 'source-over');
});
