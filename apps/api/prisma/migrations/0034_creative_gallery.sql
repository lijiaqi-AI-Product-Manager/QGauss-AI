CREATE TABLE "gallery_favorites" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "taskId" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "gallery_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "gallery_favorites_kind_check" CHECK ("kind" IN ('image','mj','video'))
);
CREATE UNIQUE INDEX "gallery_favorites_userId_kind_taskId_key" ON "gallery_favorites"("userId","kind","taskId");
CREATE INDEX "gallery_favorites_kind_taskId_idx" ON "gallery_favorites"("kind","taskId");
CREATE INDEX "gallery_favorites_userId_createdAt_idx" ON "gallery_favorites"("userId","createdAt");

ALTER TABLE "image_tasks" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "mj_tasks" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "mj_tasks" ADD COLUMN "catId" TEXT;
ALTER TABLE "mj_tasks" ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "video_tasks" ADD COLUMN "publishedAt" DATETIME;
ALTER TABLE "video_tasks" ADD COLUMN "catId" TEXT;
ALTER TABLE "video_tasks" ADD COLUMN "recommended" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "image_tasks_gallery_idx" ON "image_tasks"("published","deletedAt","status","catId","createdAt");
CREATE INDEX "mj_tasks_gallery_idx" ON "mj_tasks"("published","deletedAt","status","catId","createdAt");
CREATE INDEX "video_tasks_gallery_idx" ON "video_tasks"("published","deletedAt","status","catId","createdAt");
