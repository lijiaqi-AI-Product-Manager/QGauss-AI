-- 0010 · 图像统一记录
-- 在 image_tasks 上补三个字段，让它同时承载「文生图 / 图生图 / 多供应商」：
--   provider  供应商标识（mock / gptImage / nanoBanana）
--   editOf    参考图对应的文件 id（图生图时非空）
--   metaJson  供应商返回的附加信息（如 revised_prompt）

ALTER TABLE "image_tasks" ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'mock';
ALTER TABLE "image_tasks" ADD COLUMN "editOf" TEXT;
ALTER TABLE "image_tasks" ADD COLUMN "metaJson" TEXT;

CREATE INDEX "image_tasks_provider_createdAt_idx" ON "image_tasks"("provider", "createdAt");
