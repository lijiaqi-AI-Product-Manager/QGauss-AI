/** Points use the original displayed frame; page scale and surrounding gutters never enter the request. */
export function speakerPoint(clientX, clientY, rect, width, height) {
  if (![clientX, clientY, rect?.left, rect?.top, rect?.width, rect?.height, width, height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0 || width < 1 || height < 1) return null;
  const scale = Math.min(rect.width / width, rect.height / height), w = width * scale, h = height * scale;
  const x = clientX - rect.left - (rect.width - w) / 2, y = clientY - rect.top - (rect.height - h) / 2;
  if (x < 0 || y < 0 || x > w || y > h) return null;
  return { x: Math.min(width - 1, Math.round(x / scale)), y: Math.min(height - 1, Math.round(y / scale)) };
}

export function validSpeaker(selection, material, frameCount = Infinity) {
  return !!selection && !!material && selection.videoId === material.id &&
    [selection.frameNumber, selection.x, selection.y].every(Number.isSafeInteger) &&
    selection.frameNumber >= 0 && selection.frameNumber < frameCount &&
    selection.x >= 0 && selection.y >= 0 && selection.x < material.width && selection.y < material.height;
}

export function speakerTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '00:00.00';
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${(seconds % 60).toFixed(2).padStart(5, '0')}`;
}

export function speakerCaption(selection, material) {
  if (!selection) return '沿用服务的默认人物选择';
  const position = material?.width && material?.height ? ` · 横向 ${Math.round(100 * selection.x / material.width)}% · 纵向 ${Math.round(100 * selection.y / material.height)}%` : '';
  return `已指定人物 · 第 ${selection.frameNumber + 1} 帧${position}`;
}
