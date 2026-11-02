-- 0013 · 卡密核销记录（CramiUse）
--
-- 为什么需要这张表：
--   1. cramiType=2 的语义是「同一张卡每个用户只能核销一次」，只靠
--      Crami.status/useId 无法表达（useId 只能记最后一个人）。
--   2. 「先查再写」在并发下会双发次数；这里用 (cramiId,userId) 唯一索引
--      做闸门，冲突即视为重复核销，不依赖事务隔离级别。
--   3. 用户侧的「我的卡密记录」直接查这张表，不需要解析 AccountLog。

PRAGMA foreign_keys = ON;

CREATE TABLE "crami_uses" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "cramiId"      TEXT NOT NULL,
  "cramiCode"    TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "packageId"    TEXT NOT NULL DEFAULT '',
  "cramiType"    INTEGER NOT NULL DEFAULT 1,
  "days"         INTEGER NOT NULL DEFAULT 0,
  "model3Count"  INTEGER NOT NULL DEFAULT 0,
  "model4Count"  INTEGER NOT NULL DEFAULT 0,
  "drawMjCount"  INTEGER NOT NULL DEFAULT 0,
  "agentCount"   INTEGER NOT NULL DEFAULT 0,
  "accountLogId" TEXT NOT NULL DEFAULT '',
  "createdAt"    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "crami_uses_cramiId_userId_key" ON "crami_uses"("cramiId", "userId");
CREATE INDEX "crami_uses_userId_createdAt_index" ON "crami_uses"("userId", "createdAt");
