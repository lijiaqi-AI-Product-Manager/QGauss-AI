-- 0006 · 本地应用（智能体）
-- 对应 schema.prisma: AppCategory / App / AppFavorite
-- 说明：这是"预设型智能体"（systemPrompt + 默认模型），Coze 外部对接后续单独做。

PRAGMA foreign_keys = ON;

CREATE TABLE "app_categories" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "name"      TEXT NOT NULL,
  "sort"      INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "app_categories_name_key" ON "app_categories"("name");

CREATE TABLE "apps" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "categoryId"   TEXT,
  "name"         TEXT NOT NULL,
  "description"  TEXT,
  "icon"         TEXT,
  "systemPrompt" TEXT NOT NULL,
  "defaultModel" TEXT,
  "greeting"     TEXT,
  "published"    BOOLEAN NOT NULL DEFAULT true,
  "sort"         INTEGER NOT NULL DEFAULT 0,
  "createdBy"    TEXT,
  "createdAt"    DATETIME NOT NULL,
  "updatedAt"    DATETIME NOT NULL,
  "deletedAt"    DATETIME,
  CONSTRAINT "apps_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "app_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "apps_categoryId_sort_idx" ON "apps"("categoryId", "sort");
CREATE INDEX "apps_published_idx" ON "apps"("published");

CREATE TABLE "app_favorites" (
  "userId"    TEXT NOT NULL,
  "appId"     TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL,
  PRIMARY KEY ("userId", "appId"),
  CONSTRAINT "app_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "app_favorites_userId_idx" ON "app_favorites"("userId");
