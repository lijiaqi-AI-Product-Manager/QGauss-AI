-- QGauss: freeze accepted image prices and reserve counts before upstream work.
ALTER TABLE "image_tasks" ADD COLUMN "billingUnitCost" INTEGER;
ALTER TABLE "image_tasks" ADD COLUMN "billingState" TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE "image_tasks" ADD COLUMN "reservedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "image_tasks" ADD COLUMN "chargedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "image_tasks" ADD COLUMN "returnedAmount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "image_tasks" ADD COLUMN "expiredAmount" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "count_reservations" (
  "refId" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "pool" TEXT NOT NULL,
  "amount" INTEGER NOT NULL,
  "memberAmount" INTEGER NOT NULL,
  "paidAmount" INTEGER NOT NULL,
  "memberDay" TEXT NOT NULL,
  "memberExpiresAt" DATETIME,
  "memberLogId" TEXT,
  "paidLogId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'HELD',
  "settledAmount" INTEGER NOT NULL DEFAULT 0,
  "returnedAmount" INTEGER NOT NULL DEFAULT 0,
  "expiredAmount" INTEGER NOT NULL DEFAULT 0,
  "bizType" TEXT NOT NULL,
  "model" TEXT NOT NULL DEFAULT '',
  "modelName" TEXT NOT NULL DEFAULT '',
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" DATETIME,
  CONSTRAINT "count_reservations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "count_reservations_amounts_check" CHECK (
    "amount" > 0 AND "memberAmount" >= 0 AND "paidAmount" >= 0
    AND "amount" = "memberAmount" + "paidAmount"
    AND "settledAmount" >= 0 AND "returnedAmount" >= 0 AND "expiredAmount" >= 0
    AND "settledAmount" + "returnedAmount" + "expiredAmount" <= "amount"
  )
);
CREATE INDEX "count_reservations_userId_status_idx" ON "count_reservations"("userId", "status");
