ALTER TABLE "users" ADD COLUMN "adminNote" TEXT NOT NULL DEFAULT '';

CREATE TABLE "user_account_operations" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "actorId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "requestKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "resultJson" TEXT NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "user_account_operations_actorId_requestKey_key" ON "user_account_operations"("actorId", "requestKey");
CREATE INDEX "user_account_operations_userId_createdAt_id_idx" ON "user_account_operations"("userId", "createdAt", "id");
