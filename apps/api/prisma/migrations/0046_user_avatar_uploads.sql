CREATE TABLE "user_avatar_uploads" (
 "id" TEXT PRIMARY KEY NOT NULL,
 "userId" TEXT NOT NULL REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "requestKey" TEXT NOT NULL,
 "inputHash" TEXT,
 "version" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'PROCESSING',
 "stageJson" TEXT,
 "fileId" TEXT,
 "errorCode" TEXT,
 "acceptedDay" TEXT NOT NULL,
 "familyId" TEXT NOT NULL,
 "tokenVersion" INTEGER NOT NULL,
 "accessExpiresAt" DATETIME,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "user_avatar_uploads_userId_requestKey_key" ON "user_avatar_uploads"("userId","requestKey");
CREATE INDEX "user_avatar_uploads_userId_acceptedDay_idx" ON "user_avatar_uploads"("userId","acceptedDay");
CREATE INDEX "user_avatar_uploads_status_updatedAt_idx" ON "user_avatar_uploads"("status","updatedAt");
