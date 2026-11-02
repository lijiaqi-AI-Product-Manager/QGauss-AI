/**
 * SSE 解析器（纯函数，可单测）
 *
 * 服务端事件格式：
 *   event: delta
 *   data: {"v":"..."}
 *   <空行>
 */

export function createSseParser(onEvent) {
  let buffer = '';

  function emitBlock(block) {
    let event = 'message';
    let id = null;
    const dataLines = [];

    for (const rawLine of block.split('\n')) {
      const line = rawLine.replace(/\r$/, '');
      if (!line) continue;
      if (line.startsWith(':')) continue; // 心跳/注释
      if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      } else if (line.startsWith('id:')) {
        const value = line.slice(3).replace(/^ /, '');
        if (!value.includes('\0')) id = value;
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).replace(/^ /, ''));
      }
    }

    if (dataLines.length === 0) return;
    const raw = dataLines.join('\n');
    let data = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* 保留原始字符串 */
    }
    onEvent(event, data, id);
  }

  return {
    push(chunk) {
      buffer += chunk;
      // 用正则切分，同时兼容 \n\n 与 \r\n\r\n
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = blocks.pop() ?? '';
      for (const block of blocks) {
        if (block.trim()) emitBlock(block);
      }
    },
    flush() {
      if (buffer.trim()) emitBlock(buffer);
      buffer = '';
    },
  };
}
