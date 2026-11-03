CREATE TABLE "voice_requests" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "taskId" TEXT, "state" TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK ("state" IN ('ACCEPTED','ENDED')),
 "sourceKind" TEXT NOT NULL DEFAULT 'unknown', "title" TEXT NOT NULL DEFAULT '', "text" TEXT NOT NULL DEFAULT '',
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("taskId") REFERENCES "voice_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "voice_requests_userId_requestKey_key" ON "voice_requests"("userId","requestKey");
CREATE UNIQUE INDEX "voice_requests_taskId_key" ON "voice_requests"("taskId");
CREATE INDEX "voice_requests_userId_createdAt_idx" ON "voice_requests"("userId","createdAt");
