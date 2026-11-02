-- 0007 · 图像生成任务
-- 对应 schema.prisma: ImageTask / ImageTaskEvent

PRAGMA foreign_keys = ON;

CREATE TABLE "image_tasks" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "userId"         TEXT NOT NULL,
  "prompt"         TEXT NOT NULL,
  "negativePrompt" TEXT,
  "model"          TEXT NOT NULL DEFAULT 'mock-image',
  "size"           TEXT NOT NULL DEFAULT '512x512',
  "n"              INTEGER NOT NULL DEFAULT 1,
  "status"         TEXT NOT NULL DEFAULT 'QUEUED',
  "progress"       INTEGER NOT NULL DEFAULT 0,
  "resultJson"     TEXT,
  "errorCode"      TEXT,
  "errorMessage"   TEXT,
  "channelId"      TEXT,
  "startedAt"      DATETIME,
  "finishedAt"     DATETIME,
  "createdAt"      DATETIME NOT NULL,
  "updatedAt"      DATETIME NOT NULL,
  CONSTRAINT "image_tasks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "image_tasks_userId_createdAt_idx" ON "image_tasks"("userId", "createdAt");
CREATE INDEX "image_tasks_status_updatedAt_idx" ON "image_tasks"("status", "updatedAt");

CREATE TABLE "image_task_events" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "taskId"    TEXT NOT NULL,
  "status"    TEXT NOT NULL,
  "message"   TEXT,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "image_task_events_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "image_tasks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "image_task_events_taskId_createdAt_idx" ON "image_task_events"("taskId", "createdAt");
