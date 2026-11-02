-- 0005 · 会话分组 / 邮件发件箱 / 密码重置
-- 对应 schema.prisma: ConversationFolder, MailOutbox, PasswordReset

PRAGMA foreign_keys = ON;

CREATE TABLE "conversation_folders" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "userId"    TEXT NOT NULL,
  "name"      TEXT NOT NULL,
  "sort"      INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "conversation_folders_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "conversation_folders_userId_sort_idx" ON "conversation_folders"("userId", "sort");

ALTER TABLE "conversations" ADD COLUMN "folderId" TEXT;

CREATE TABLE "mail_outbox" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "to"        TEXT NOT NULL,
  "subject"   TEXT NOT NULL,
  "template"  TEXT NOT NULL,
  "payload"   TEXT,
  "body"      TEXT,
  "status"    TEXT NOT NULL DEFAULT 'queued',
  "error"     TEXT,
  "createdAt" DATETIME NOT NULL,
  "sentAt"    DATETIME
);
CREATE INDEX "mail_outbox_createdAt_idx" ON "mail_outbox"("createdAt");
CREATE INDEX "mail_outbox_status_idx" ON "mail_outbox"("status");

CREATE TABLE "password_resets" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "userId"    TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL,
  "usedAt"    DATETIME,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "password_resets_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "password_resets_tokenHash_key" ON "password_resets"("tokenHash");
CREATE INDEX "password_resets_userId_idx" ON "password_resets"("userId");
