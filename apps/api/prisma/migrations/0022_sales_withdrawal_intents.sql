-- QGauss: retries of an accepted withdrawal freeze the commission balance once.
ALTER TABLE "sales_orders" ADD COLUMN "requestKey" TEXT;
ALTER TABLE "sales_orders" ADD COLUMN "requestHash" TEXT NOT NULL DEFAULT '';
CREATE UNIQUE INDEX "sales_orders_userId_requestKey_key" ON "sales_orders"("userId", "requestKey");
