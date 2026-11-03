ALTER TABLE "apps" ADD COLUMN "shareViewCount" INTEGER NOT NULL DEFAULT 0
 CHECK ("shareViewCount" >= 0 AND "shareViewCount" <= 2147483647);

CREATE TABLE "app_share_visits" (
 "appId" TEXT NOT NULL,
 "requestKey" TEXT NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("appId","requestKey"),
 FOREIGN KEY ("appId") REFERENCES "apps"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "app_share_visits_createdAt_idx" ON "app_share_visits"("createdAt");
