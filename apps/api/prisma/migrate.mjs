/**
 * 极简迁移系统（环境无法运行 prisma migrate —— schema-engine 是子进程，被沙箱限制）
 *
 * 纪律等价：
 *   - prisma/migrations/*.sql 按文件名顺序执行，只执行一次
 *   - _migrations 表记录已执行版本
 *   - 每个文件在事务里执行，失败整体回滚
 *
 * 正常环境（有 Docker / 无沙箱）可以继续用 `prisma migrate dev`，
 * 但请不要两边混用同一套迁移历史。
 */
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import leases from './data-lease.cjs';

const here = dirname(fileURLToPath(import.meta.url));

/** 优先 DATABASE_FILE，其次解析 DATABASE_URL=file:...（相对路径按 prisma 目录解析） */
function resolveDbPath() {
  if (process.env.DATABASE_FILE) return process.env.DATABASE_FILE;
  const url = process.env.DATABASE_URL;
  if (url && url.startsWith('file:')) {
    const p = url.slice('file:'.length);
    return isAbsolute(p) ? p : join(here, p);
  }
  return join(here, 'dev.db');
}

const dbPath = resolveDbPath();
mkdirSync(dirname(dbPath), { recursive: true });
const migrationsDir = join(here, 'migrations');

const fresh = !existsSync(dbPath);
const lease = leases.acquireDataLease(dbPath);
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON;');
db.exec(`
  CREATE TABLE IF NOT EXISTS "_migrations" (
    "name" TEXT PRIMARY KEY NOT NULL,
    "appliedAt" DATETIME NOT NULL
  );
`);

const applied = new Set(
  db.prepare('SELECT name FROM "_migrations"').all().map((r) => r.name),
);

const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

let count = 0;
for (const file of files) {
  if (applied.has(file)) continue;
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  db.exec('BEGIN');
  try {
    db.exec(sql);
    db.prepare('INSERT INTO "_migrations" ("name","appliedAt") VALUES (?, ?)').run(
      file,
      new Date().toISOString(),
    );
    db.exec('COMMIT');
    console.log(`  ✔ applied ${file}`);
    count += 1;
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(`  ✘ failed ${file}\n${err.message}`);
    process.exit(1);
  }
}

const tables = db
  .prepare(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> '_migrations' ORDER BY name`,
  )
  .all();

console.log(`${fresh ? 'created' : 'opened'} ${dbPath}`);
console.log(`migrations applied: ${count} (total ${files.length})`);
console.log(`tables (${tables.length}): ${tables.map((t) => t.name).join(', ')}`);
db.close();
lease.close();
