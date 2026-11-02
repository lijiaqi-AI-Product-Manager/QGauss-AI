ALTER TABLE "users" ADD COLUMN "emailVerifiedAt" DATETIME;
CREATE TABLE "email_verifications" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "email" TEXT NOT NULL,
  "purpose" TEXT NOT NULL CHECK ("purpose" IN ('REGISTER', 'ACCOUNT')),
  "userId" TEXT,
  "tokenVersion" INTEGER,
  "codeHash" TEXT NOT NULL,
  "ipHash" TEXT NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0 CHECK ("attempts" >= 0 AND "attempts" <= 5),
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" DATETIME NOT NULL,
  "usedAt" DATETIME,
  CONSTRAINT "email_verifications_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "email_verifications_email_purpose_createdAt_idx" ON "email_verifications"("email", "purpose", "createdAt");
CREATE INDEX "email_verifications_ipHash_createdAt_idx" ON "email_verifications"("ipHash", "createdAt");
