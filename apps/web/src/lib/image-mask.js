/** Strokes use image-relative coordinates so resizing never shifts the selected region. */
export function maskPoint(event, rect) {
  if (!(rect.width > 0 && rect.height > 0)) return null;
  return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) };
}

export function paintMask(context, width, height, strokes, overlay = false) {
  context.clearRect(0, 0, width, height);
  if (!overlay) { context.fillStyle = '#fff'; context.fillRect(0, 0, width, height); }
  for (const stroke of strokes) {
    context.globalCompositeOperation = overlay ? (stroke.erase ? 'destination-out' : 'source-over') : (stroke.erase ? 'source-over' : 'destination-out');
    context.strokeStyle = context.fillStyle = overlay ? '#e84fb4' : '#fff';
    context.lineWidth = stroke.size * Math.min(width, height);
    context.lineCap = context.lineJoin = 'round';
    context.beginPath();
    stroke.points.forEach((p, i) => i ? context.lineTo(p.x * width, p.y * height) : context.moveTo(p.x * width, p.y * height));
    context.stroke();
    if (stroke.points.length === 1) { const p = stroke.points[0]; context.beginPath(); context.arc(p.x * width, p.y * height, context.lineWidth / 2, 0, Math.PI * 2); context.fill(); }
  }
  context.globalCompositeOperation = 'source-over';
}

export function maskBlob(canvas) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('选区未能保存，请重试')), 'image/png'));
}
