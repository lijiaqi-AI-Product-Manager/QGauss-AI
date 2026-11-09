CREATE TABLE "upload_receipts" (
 "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL,
 "inputHash" TEXT NOT NULL, "version" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'STORING', "stageJson" TEXT NOT NULL,
 "fileId" TEXT, "errorCode" TEXT,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" DATETIME NOT NULL,
 FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "upload_receipts_userId_requestKey_key" ON "upload_receipts"("userId","requestKey");
CREATE INDEX "upload_receipts_status_updatedAt_idx" ON "upload_receipts"("status","updatedAt");
