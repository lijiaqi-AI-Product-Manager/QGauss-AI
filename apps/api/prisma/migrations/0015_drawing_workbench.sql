-- 0015_drawing_workbench.sql
-- 专业绘画工作台：任务参数细化（比例/分辨率/画质/种子/版本）+ 作品发布到广场 + 风格分类
-- 依据：QGauss 参考手册 p004–p006 / p032–p039 / p059（比例-场景网格、4K 分辨率、画质四档、
--       作品详情「创意参数」串、绘画广场 + 我的绘画 双 Tab、作品风格分类）
-- 注意：本项目 Prisma 未使用 @map 重命名列，列名一律与字段同名（camelCase）。

ALTER TABLE image_tasks ADD COLUMN mode TEXT NOT NULL DEFAULT 'text2img';
ALTER TABLE image_tasks ADD COLUMN ratio TEXT NOT NULL DEFAULT '1:1';
ALTER TABLE image_tasks ADD COLUMN resolution TEXT NOT NULL DEFAULT '1K';
ALTER TABLE image_tasks ADD COLUMN quality TEXT NOT NULL DEFAULT 'auto';
ALTER TABLE image_tasks ADD COLUMN seed INTEGER;
ALTER TABLE image_tasks ADD COLUMN versionName TEXT;
ALTER TABLE image_tasks ADD COLUMN catId TEXT;
ALTER TABLE image_tasks ADD COLUMN published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE image_tasks ADD COLUMN recommended INTEGER NOT NULL DEFAULT 0;
ALTER TABLE image_tasks ADD COLUMN deletedAt DATETIME;
ALTER TABLE image_tasks ADD COLUMN parentId TEXT;
ALTER TABLE image_tasks ADD COLUMN action TEXT;

CREATE INDEX IF NOT EXISTS image_tasks_pub_idx ON image_tasks(published, createdAt);
CREATE INDEX IF NOT EXISTS image_tasks_user_del_idx ON image_tasks(userId, deletedAt);

CREATE TABLE IF NOT EXISTS creation_cats (
  id        TEXT PRIMARY KEY,
  name      TEXT NOT NULL UNIQUE,
  sort      INTEGER NOT NULL DEFAULT 0,
  status    INTEGER NOT NULL DEFAULT 1,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO creation_cats (id, name, sort, status) VALUES
  ('cat-write',   '写实摄影', 10, 1),
  ('cat-ecom',    '电商设计', 20, 1),
  ('cat-anime',   '动漫游戏', 30, 1),
  ('cat-illus',   '插图设计', 40, 1),
  ('cat-poster',  '海报设计', 50, 1),
  ('cat-arch',    '建筑空间', 60, 1),
  ('cat-guofeng', '国风',     70, 1),
  ('cat-other',   '其他',     80, 1);
