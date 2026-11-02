// A separate SQLite transaction gives cooperative processes an OS-released lease.
// It survives neither SIGKILL nor a machine restart, unlike PID sentinel files.
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync, lstatSync, realpathSync, chmodSync } = require('node:fs');
const { resolve, dirname, basename } = require('node:path');

function sqliteFileFromUrl(url = process.env.DATABASE_URL, base = __dirname) {
  if (typeof url !== 'string' || !url.startsWith('file:')) return null;
  const value = url.slice(5);
  if (!value || /[?#\0]/.test(value) || value === ':memory:') throw Error('SQLite 数据路径必须指向本地持久文件，不接受查询参数');
  return resolve(base, value);
}

function acquireDataLease(database) {
  const absolute = resolve(database), parent = dirname(absolute);
  mkdirSync(parent, { recursive: true });
  const canonical = resolve(realpathSync(parent), basename(absolute));
  try {
    const stat = lstatSync(canonical);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('数据库必须是独立的普通文件');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const file = canonical + '.qgauss-lock.sqlite';
  try {
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw Error('数据互斥文件不可信，请由部署负责人检查');
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  let db;
  try {
    db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    db.exec('PRAGMA busy_timeout=0; BEGIN EXCLUSIVE;');
  } catch {
    try { db?.close(); } catch {}
    throw Error('数据已被本项目服务或维护操作占用，请先停止服务并等待当前操作结束');
  }
  let closed = false;
  return { database: canonical, close() { if (closed) return; closed = true; try { db.exec('ROLLBACK'); } finally { db.close(); } } };
}
module.exports = { sqliteFileFromUrl, acquireDataLease };
