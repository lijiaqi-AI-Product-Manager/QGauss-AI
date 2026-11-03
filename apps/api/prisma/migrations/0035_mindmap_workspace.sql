CREATE TABLE "mindmap_documents" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "outline" TEXT NOT NULL,
  "nodeCount" INTEGER NOT NULL CHECK ("nodeCount" BETWEEN 1 AND 1000),
  "version" INTEGER NOT NULL DEFAULT 1 CHECK ("version" BETWEEN 1 AND 2147483647),
  "archivedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "mindmap_documents_userId_archivedAt_updatedAt_idx" ON "mindmap_documents"("userId","archivedAt","updatedAt");

CREATE TABLE "mindmap_operations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL CHECK ("kind" IN ('create','edit','archive','restore','generation')),
  "payloadHash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'APPLIED' CHECK ("state" IN ('APPLIED','ENDED')),
  "documentId" TEXT,
  "documentVersion" INTEGER,
  "generationId" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mindmap_operations_userId_requestKey_key" ON "mindmap_operations"("userId","requestKey");

CREATE TABLE "mindmap_generations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "modelId" TEXT NOT NULL,
  "modelName" TEXT NOT NULL,
  "modelDisplayName" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "routeRevision" TEXT NOT NULL,
  "prompt" TEXT NOT NULL,
  "context" TEXT NOT NULL DEFAULT '',
  "title" TEXT NOT NULL,
  "maxOutput" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED' CHECK ("status" IN ('QUEUED','RUNNING','SETTLING','COMPLETED','FAILED','CANCELED')),
  "outline" TEXT NOT NULL DEFAULT '',
  "promptTokens" INTEGER NOT NULL DEFAULT 0,
  "completionTokens" INTEGER NOT NULL DEFAULT 0,
  "priceInPerM" INTEGER NOT NULL DEFAULT 0,
  "priceOutPerM" INTEGER NOT NULL DEFAULT 0,
  "costMicros" INTEGER NOT NULL DEFAULT 0,
  "estimated" BOOLEAN NOT NULL DEFAULT false,
  "usageId" TEXT,
  "pool" TEXT NOT NULL DEFAULT 'model3',
  "reservedAmount" INTEGER NOT NULL DEFAULT 0,
  "chargedAmount" INTEGER NOT NULL DEFAULT 0,
  "returnedAmount" INTEGER NOT NULL DEFAULT 0,
  "expiredAmount" INTEGER NOT NULL DEFAULT 0,
  "billingState" TEXT NOT NULL DEFAULT 'FREE',
  "errorCode" TEXT,
  "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  "startedAt" DATETIME,
  "finishedAt" DATETIME,
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "mindmap_generations_userId_requestKey_key" ON "mindmap_generations"("userId","requestKey");
CREATE UNIQUE INDEX "mindmap_generations_usageId_key" ON "mindmap_generations"("usageId");
CREATE INDEX "mindmap_generations_userId_createdAt_idx" ON "mindmap_generations"("userId","createdAt");
CREATE INDEX "mindmap_generations_status_updatedAt_idx" ON "mindmap_generations"("status","updatedAt");
