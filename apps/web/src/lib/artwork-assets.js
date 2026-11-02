import { reactive } from 'vue';
import { fetchBlob } from '../api/client.js';

/** One bounded cache per workspace. A stale fetch never recreates a released object URL. */
export function createArtworkAssets(isCurrent) {
  const entries = new Map();
  const urls = reactive(new Map());
  const errors = reactive(new Map());
  let closed = false;
  function release(path, entry) {
    entry.controller.abort();
    if (entry.url) URL.revokeObjectURL(entry.url);
    entries.delete(path); urls.delete(path); errors.delete(path);
  }
  function retain(paths) {
    for (const [path, entry] of entries) if (!paths.has(path)) release(path, entry);
  }
  function load(result, retry = false) {
    const path = result?.url;
    if (!path || !path.startsWith('/api/') || closed || !isCurrent()) return Promise.resolve(null);
    const existing = entries.get(path);
    if (existing && (!retry || !errors.has(path))) return existing.promise;
    if (existing) release(path, existing);
    const entry = { controller: new AbortController(), url: null, blob: null, promise: null };
    entries.set(path, entry);
    entry.promise = (async () => {
      try {
        const blob = await fetchBlob(path, { signal: entry.controller.signal });
        if (closed || !isCurrent() || entry.controller.signal.aborted || entries.get(path) !== entry) return null;
        if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(blob.type.split(';')[0])) throw new Error('图片格式不可用');
        entry.blob = blob;
        entry.url = URL.createObjectURL(blob);
        urls.set(path, entry.url); errors.delete(path);
        return entry;
      } catch (error) {
        if (!closed && isCurrent() && !entry.controller.signal.aborted && entries.get(path) === entry) errors.set(path, error.message || '图片暂时未能加载');
        return null;
      }
    })();
    return entry.promise;
  }
  function close() { closed = true; for (const [path, entry] of entries) release(path, entry); }
  return { urls, errors, load, retain, close };
}
