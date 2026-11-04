CREATE TABLE "video_requests" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "taskId" TEXT, "state" TEXT NOT NULL DEFAULT 'ACCEPTED' CHECK ("state" IN ('ACCEPTED','ENDED')),
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("taskId") REFERENCES "video_tasks"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "video_requests_userId_requestKey_key" ON "video_requests"("userId","requestKey");
CREATE UNIQUE INDEX "video_requests_taskId_key" ON "video_requests"("taskId");
CREATE INDEX "video_requests_userId_createdAt_idx" ON "video_requests"("userId","createdAt");
INSERT INTO "video_requests" ("id","userId","requestKey","taskId","state","createdAt","updatedAt")
 SELECT 'video-request-' || t."id",t."userId",t."requestKey",t."id",'ACCEPTED',t."createdAt",t."updatedAt"
 FROM "video_tasks" t WHERE EXISTS (SELECT 1 FROM "users" u WHERE u."id"=t."userId");
