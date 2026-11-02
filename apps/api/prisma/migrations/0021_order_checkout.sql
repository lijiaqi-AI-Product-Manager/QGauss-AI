-- QGauss: accepted offer snapshot, retry-safe checkout intent and fixed deadline.
ALTER TABLE "orders" ADD COLUMN "requestKey" TEXT;
ALTER TABLE "orders" ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '';
ALTER TABLE "orders" ADD COLUMN "goodsSnapshot" TEXT NOT NULL DEFAULT '';
ALTER TABLE "orders" ADD COLUMN "expiresAt" DATETIME;
CREATE UNIQUE INDEX "orders_userId_requestKey_key" ON "orders"("userId", "requestKey");
