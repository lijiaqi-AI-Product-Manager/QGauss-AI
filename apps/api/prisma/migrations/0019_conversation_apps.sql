-- QGauss AI：持久保留会话所属应用，区分普通历史与应用历史。
ALTER TABLE "conversations" ADD COLUMN "appId" TEXT REFERENCES "apps"("id") ON DELETE SET NULL;
CREATE INDEX "conversations_userId_appId_lastMessageAt_idx" ON "conversations"("userId", "appId", "lastMessageAt");
