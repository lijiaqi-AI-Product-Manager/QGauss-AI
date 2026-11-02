-- 0004 · 可配置导航
-- 对应 schema.prisma 中的 Menu。
-- 注意：菜单是"导航配置"，不是权限系统；权限仍由 role 枚举 + RolesGuard 决定。

PRAGMA foreign_keys = ON;

CREATE TABLE "menus" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "parentId"  TEXT,
  "title"     TEXT NOT NULL,
  "path"      TEXT NOT NULL,
  "icon"      TEXT,
  "sort"      INTEGER NOT NULL DEFAULT 0,
  "visible"   BOOLEAN NOT NULL DEFAULT true,
  "roles"     TEXT NOT NULL DEFAULT 'ADMIN',
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "menus_parentId_sort_idx" ON "menus"("parentId", "sort");
