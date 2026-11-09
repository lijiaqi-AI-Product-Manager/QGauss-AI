ALTER TABLE "conversations" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "conversation_folders" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "conversations_userId_deletedAt_pinnedAt_lastMessageAt_id_idx" ON "conversations"("userId","deletedAt","pinnedAt","lastMessageAt","id");
