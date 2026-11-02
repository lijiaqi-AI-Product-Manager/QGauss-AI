CREATE TABLE "video_presets" (
 "id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "profile" TEXT NOT NULL,
 "channelId" TEXT NOT NULL DEFAULT '', "upstreamModel" TEXT NOT NULL DEFAULT '', "enabled" BOOLEAN NOT NULL DEFAULT false,
 "baseCost" INTEGER NOT NULL DEFAULT 0, "perSecondCost" INTEGER NOT NULL DEFAULT 0, "pool" TEXT NOT NULL DEFAULT 'drawMj',
 "maxWaitMinutes" INTEGER NOT NULL DEFAULT 30, "publicBaseUrl" TEXT NOT NULL DEFAULT '', "version" INTEGER NOT NULL DEFAULT 1,
 "deletedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "video_tasks" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "intentHash" TEXT NOT NULL,
 "presetId" TEXT NOT NULL, "presetName" TEXT NOT NULL, "profile" TEXT NOT NULL, "presetJson" TEXT NOT NULL, "intentJson" TEXT NOT NULL,
 "inputJson" TEXT, "status" TEXT NOT NULL DEFAULT 'QUEUED', "progress" INTEGER NOT NULL DEFAULT 0,
 "upstreamId" TEXT, "upstreamStatus" TEXT, "routeJson" TEXT, "outputJson" TEXT, "resultJson" TEXT,
 "message" TEXT, "errorCode" TEXT, "nextCheckAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "attempts" INTEGER NOT NULL DEFAULT 0,
 "deadlineAt" DATETIME NOT NULL, "pool" TEXT NOT NULL, "totalCost" INTEGER NOT NULL, "billingState" TEXT NOT NULL DEFAULT 'FREE',
 "reservedAmount" INTEGER NOT NULL DEFAULT 0, "chargedAmount" INTEGER NOT NULL DEFAULT 0, "returnedAmount" INTEGER NOT NULL DEFAULT 0, "expiredAmount" INTEGER NOT NULL DEFAULT 0,
 "remoteCancelState" TEXT NOT NULL DEFAULT 'NONE', "published" BOOLEAN NOT NULL DEFAULT false, "deletedAt" DATETIME,
 "startedAt" DATETIME, "finishedAt" DATETIME, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "video_tasks_userId_requestKey_key" ON "video_tasks"("userId", "requestKey");
CREATE INDEX "video_tasks_status_nextCheckAt_idx" ON "video_tasks"("status", "nextCheckAt");
CREATE INDEX "video_tasks_userId_createdAt_idx" ON "video_tasks"("userId", "createdAt");
CREATE INDEX "video_tasks_published_createdAt_idx" ON "video_tasks"("published", "createdAt");
CREATE TABLE "video_task_events" (
 "id" TEXT NOT NULL PRIMARY KEY, "taskId" TEXT NOT NULL, "status" TEXT NOT NULL, "message" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "video_task_events_taskId_createdAt_idx" ON "video_task_events"("taskId", "createdAt");
