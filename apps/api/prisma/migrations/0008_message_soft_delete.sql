-- 0008 · 消息软删除
-- 单条消息删除用软删，保留审计与分支结构；"清空会话"仍是硬删。

ALTER TABLE "messages" ADD COLUMN "deletedAt" DATETIME;
CREATE INDEX "messages_conversationId_deletedAt_idx" ON "messages"("conversationId", "deletedAt");
