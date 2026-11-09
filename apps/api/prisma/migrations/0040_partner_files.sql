ALTER TABLE "upload_files" ADD COLUMN "trashedAt" DATETIME;
ALTER TABLE "upload_files" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "agent_artifact_saves" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "messageId" TEXT NOT NULL,
 "artifactKey" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'QUEUED', "sourceUrl" TEXT NOT NULL, "title" TEXT NOT NULL,
 "stageJson" TEXT, "fileId" TEXT, "errorCode" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "agent_artifact_saves_userId_messageId_artifactKey_key" ON "agent_artifact_saves"("userId","messageId","artifactKey");
CREATE INDEX "agent_artifact_saves_status_createdAt_idx" ON "agent_artifact_saves"("status","createdAt");
CREATE INDEX "agent_artifact_saves_userId_status_idx" ON "agent_artifact_saves"("userId","status");
