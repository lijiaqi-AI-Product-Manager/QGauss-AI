CREATE TABLE "agent_connections" (
  "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL,
  "provider" TEXT NOT NULL DEFAULT 'COZE', "baseUrl" TEXT NOT NULL,
  "authMode" TEXT NOT NULL DEFAULT 'JWT', "appId" TEXT, "publicKeyId" TEXT,
  "secretEnc" TEXT NOT NULL DEFAULT '', "spaceId" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT true, "version" INTEGER NOT NULL DEFAULT 1,
  "timeoutMs" INTEGER NOT NULL DEFAULT 60000, "lastProbeAt" DATETIME, "lastProbeOk" BOOLEAN,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME
);
CREATE INDEX "agent_connections_enabled_deletedAt_idx" ON "agent_connections"("enabled","deletedAt");
CREATE TABLE "agents" (
  "id" TEXT NOT NULL PRIMARY KEY, "connectionId" TEXT NOT NULL, "botId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '', "greeting" TEXT NOT NULL DEFAULT '',
  "tagsJson" TEXT NOT NULL DEFAULT '[]', "questionsJson" TEXT NOT NULL DEFAULT '[]', "metadataJson" TEXT NOT NULL DEFAULT '{}',
  "countCost" INTEGER NOT NULL DEFAULT 1, "published" BOOLEAN NOT NULL DEFAULT false,
  "sort" INTEGER NOT NULL DEFAULT 0, "lastSyncAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL, "deletedAt" DATETIME,
  FOREIGN KEY("connectionId") REFERENCES "agent_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agents_connectionId_botId_key" ON "agents"("connectionId","botId");
CREATE INDEX "agents_published_deletedAt_sort_idx" ON "agents"("published","deletedAt","sort");
ALTER TABLE "conversations" ADD COLUMN "agentId" TEXT REFERENCES "agents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "conversations_userId_agentId_lastMessageAt_idx" ON "conversations"("userId","agentId","lastMessageAt");
ALTER TABLE "messages" ADD COLUMN "agentJson" TEXT;
CREATE TABLE "agent_favorites" (
  "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY("userId","agentId"),
  FOREIGN KEY("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "agent_favorites_userId_createdAt_idx" ON "agent_favorites"("userId","createdAt");
CREATE TABLE "agent_file_mappings" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
  "connectionVersion" INTEGER NOT NULL, "uploadId" TEXT NOT NULL, "remoteFileId" TEXT NOT NULL,
  "expiresAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY("connectionId") REFERENCES "agent_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("uploadId") REFERENCES "upload_files"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_file_mappings_userId_connectionId_connectionVersion_uploadId_key" ON "agent_file_mappings"("userId","connectionId","connectionVersion","uploadId");
CREATE INDEX "agent_file_mappings_expiresAt_idx" ON "agent_file_mappings"("expiresAt");
CREATE TABLE "agent_runs" (
  "id" TEXT NOT NULL PRIMARY KEY, "messageId" TEXT NOT NULL, "userId" TEXT NOT NULL, "agentId" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL, "connectionVersion" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'prepared', "contextUser" TEXT NOT NULL, "contextHash" TEXT,
  "contextMode" TEXT NOT NULL DEFAULT 'fresh', "remoteConversationId" TEXT, "remoteChatId" TEXT,
  "cancelState" TEXT NOT NULL DEFAULT 'none', "cancelToken" TEXT, "cancelAttempts" INTEGER NOT NULL DEFAULT 0,
  "cancelTriedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY("agentId") REFERENCES "agents"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY("connectionId") REFERENCES "agent_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_runs_messageId_key" ON "agent_runs"("messageId");
CREATE INDEX "agent_runs_cancelState_cancelTriedAt_idx" ON "agent_runs"("cancelState","cancelTriedAt");
CREATE INDEX "agent_runs_userId_createdAt_idx" ON "agent_runs"("userId","createdAt");
CREATE INDEX "agent_runs_remoteConversationId_createdAt_idx" ON "agent_runs"("remoteConversationId","createdAt");
