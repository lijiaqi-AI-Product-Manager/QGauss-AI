CREATE TABLE "extensions" (
 "id" TEXT NOT NULL PRIMARY KEY, "title" TEXT NOT NULL, "description" TEXT NOT NULL DEFAULT '',
 "entryUrl" TEXT NOT NULL, "icon" TEXT NOT NULL DEFAULT 'apps', "tone" TEXT NOT NULL DEFAULT 'violet',
 "sort" INTEGER NOT NULL DEFAULT 0, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "roles" TEXT NOT NULL DEFAULT 'USER,ADMIN', "chatEnabled" BOOLEAN NOT NULL DEFAULT false,
 "legacyBridge" BOOLEAN NOT NULL DEFAULT false, "modelId" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" BETWEEN 1 AND 2147483647),
 "lastRequestKey" TEXT, "lastRequestHash" TEXT, "deletedAt" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "extensions_deletedAt_enabled_sort_idx" ON "extensions"("deletedAt","enabled","sort");
CREATE TABLE "extension_requests" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "extensionId" TEXT, "extensionVersion" INTEGER NOT NULL,
 "extensionTitle" TEXT NOT NULL, "entryUrl" TEXT NOT NULL, "conversationId" TEXT,
 "messageId" TEXT, "prompt" TEXT NOT NULL, "payloadHash" TEXT NOT NULL, "quoteRevision" TEXT NOT NULL,
 "modelId" TEXT NOT NULL, "modelName" TEXT NOT NULL,
 "state" TEXT NOT NULL DEFAULT 'READY' CHECK ("state" IN ('READY','ENDED')),
 "expiresAt" DATETIME NOT NULL, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("extensionId") REFERENCES "extensions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "extension_requests_conversationId_key" ON "extension_requests"("conversationId");
CREATE UNIQUE INDEX "extension_requests_userId_requestKey_key" ON "extension_requests"("userId","requestKey");
CREATE INDEX "extension_requests_userId_createdAt_idx" ON "extension_requests"("userId","createdAt");

CREATE UNIQUE INDEX "extension_requests_messageId_key" ON "extension_requests"("messageId");
