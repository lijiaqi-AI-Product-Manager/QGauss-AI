-- 0001_init · 初始结构
-- 环境没有 Prisma schema-engine（子进程受限），因此用这套自建迁移系统。
-- 与 prisma/schema.prisma 一一对应；正常环境也可直接用 prisma migrate。

PRAGMA foreign_keys = ON;

CREATE TABLE "users" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "email"        TEXT NOT NULL,
  "username"     TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName"  TEXT,
  "avatar"       TEXT,
  "role"         TEXT NOT NULL DEFAULT 'USER',
  "status"       TEXT NOT NULL DEFAULT 'ACTIVE',
  "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    DATETIME NOT NULL,
  "updatedAt"    DATETIME NOT NULL,
  "deletedAt"    DATETIME
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

CREATE TABLE "refresh_tokens" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "userId"       TEXT NOT NULL,
  "familyId"     TEXT NOT NULL,
  "tokenHash"    TEXT NOT NULL,
  "replacedById" TEXT,
  "usedAt"       DATETIME,
  "revokedAt"    DATETIME,
  "expiresAt"    DATETIME NOT NULL,
  "ip"           TEXT,
  "userAgent"    TEXT,
  "createdAt"    DATETIME NOT NULL,
  CONSTRAINT "refresh_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");
CREATE INDEX "refresh_tokens_userId_idx" ON "refresh_tokens"("userId");
CREATE INDEX "refresh_tokens_familyId_idx" ON "refresh_tokens"("familyId");

CREATE TABLE "channels" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "name"        TEXT NOT NULL,
  "type"        TEXT NOT NULL DEFAULT 'CUSTOM',
  "baseUrl"     TEXT NOT NULL,
  "apiKeyEnc"   TEXT NOT NULL DEFAULT '',
  "apiKeyLast4" TEXT NOT NULL DEFAULT '',
  "priority"    INTEGER NOT NULL DEFAULT 0,
  "weight"      INTEGER NOT NULL DEFAULT 1,
  "status"      TEXT NOT NULL DEFAULT 'ENABLED',
  "timeoutMs"   INTEGER NOT NULL DEFAULT 60000,
  "extra"       TEXT,
  "createdAt"   DATETIME NOT NULL,
  "updatedAt"   DATETIME NOT NULL,
  "deletedAt"   DATETIME
);
CREATE UNIQUE INDEX "channels_name_key" ON "channels"("name");

CREATE TABLE "models" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "name"         TEXT NOT NULL,
  "displayName"  TEXT NOT NULL,
  "maxContext"   INTEGER NOT NULL DEFAULT 8192,
  "maxOutput"    INTEGER NOT NULL DEFAULT 2048,
  "capabilities" TEXT NOT NULL DEFAULT 'chat',
  "priceInPerM"  INTEGER NOT NULL DEFAULT 0,
  "priceOutPerM" INTEGER NOT NULL DEFAULT 0,
  "status"       TEXT NOT NULL DEFAULT 'ENABLED',
  "sort"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"    DATETIME NOT NULL,
  "updatedAt"    DATETIME NOT NULL,
  "deletedAt"    DATETIME
);
CREATE UNIQUE INDEX "models_name_key" ON "models"("name");

CREATE TABLE "model_channels" (
  "modelId"      TEXT NOT NULL,
  "channelId"    TEXT NOT NULL,
  "upstreamName" TEXT NOT NULL,
  "weight"       INTEGER NOT NULL DEFAULT 1,
  "enabled"      BOOLEAN NOT NULL DEFAULT true,
  PRIMARY KEY ("modelId", "channelId"),
  CONSTRAINT "model_channels_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "model_channels_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "channels"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "model_channels_channelId_idx" ON "model_channels"("channelId");

CREATE TABLE "conversations" (
  "id"            TEXT PRIMARY KEY NOT NULL,
  "userId"        TEXT NOT NULL,
  "modelId"       TEXT,
  "title"         TEXT NOT NULL DEFAULT '新对话',
  "systemPrompt"  TEXT,
  "params"        TEXT,
  "pinnedAt"      DATETIME,
  "lastMessageAt" DATETIME NOT NULL,
  "createdAt"     DATETIME NOT NULL,
  "updatedAt"     DATETIME NOT NULL,
  "deletedAt"     DATETIME,
  CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "conversations_modelId_fkey" FOREIGN KEY ("modelId") REFERENCES "models"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "conversations_userId_lastMessageAt_idx" ON "conversations"("userId", "lastMessageAt");

CREATE TABLE "messages" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "conversationId"   TEXT NOT NULL,
  "parentId"         TEXT,
  "clientMsgId"      TEXT,
  "role"             TEXT NOT NULL,
  "status"           TEXT NOT NULL DEFAULT 'COMPLETED',
  "content"          TEXT NOT NULL DEFAULT '',
  "reasoning"        TEXT,
  "parts"            TEXT,
  "modelName"        TEXT,
  "modelId"          TEXT,
  "channelId"        TEXT,
  "promptTokens"     INTEGER,
  "completionTokens" INTEGER,
  "usageEstimated"   BOOLEAN NOT NULL DEFAULT false,
  "finishReason"     TEXT,
  "errorCode"        TEXT,
  "ttfbMs"           INTEGER,
  "durationMs"       INTEGER,
  "createdAt"        DATETIME NOT NULL,
  "updatedAt"        DATETIME NOT NULL,
  CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "messages_conversationId_clientMsgId_key" ON "messages"("conversationId", "clientMsgId");
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");
CREATE INDEX "messages_status_updatedAt_idx" ON "messages"("status", "updatedAt");

CREATE TABLE "usage_records" (
  "id"               TEXT PRIMARY KEY NOT NULL,
  "userId"           TEXT NOT NULL,
  "messageId"        TEXT,
  "kind"             TEXT NOT NULL DEFAULT 'chat',
  "modelName"        TEXT NOT NULL,
  "channelId"        TEXT,
  "promptTokens"     INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "priceInPerM"      INTEGER NOT NULL DEFAULT 0,
  "priceOutPerM"     INTEGER NOT NULL DEFAULT 0,
  "costMicros"       INTEGER NOT NULL DEFAULT 0,
  "estimated"        BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        DATETIME NOT NULL,
  CONSTRAINT "usage_records_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "usage_records_messageId_key" ON "usage_records"("messageId");
CREATE INDEX "usage_records_userId_createdAt_idx" ON "usage_records"("userId", "createdAt");
CREATE INDEX "usage_records_createdAt_idx" ON "usage_records"("createdAt");

CREATE TABLE "chat_attempts" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "messageId"  TEXT NOT NULL,
  "attemptNo"  INTEGER NOT NULL,
  "channelId"  TEXT NOT NULL,
  "outcome"    TEXT NOT NULL,
  "httpStatus" INTEGER,
  "errorCode"  TEXT,
  "ttfbMs"     INTEGER,
  "createdAt"  DATETIME NOT NULL
);
CREATE INDEX "chat_attempts_messageId_idx" ON "chat_attempts"("messageId");
CREATE INDEX "chat_attempts_channelId_createdAt_idx" ON "chat_attempts"("channelId", "createdAt");

CREATE TABLE "global_configs" (
  "key"       TEXT PRIMARY KEY NOT NULL,
  "value"     TEXT NOT NULL DEFAULT '{}',
  "updatedAt" DATETIME NOT NULL,
  "updatedBy" TEXT
);
