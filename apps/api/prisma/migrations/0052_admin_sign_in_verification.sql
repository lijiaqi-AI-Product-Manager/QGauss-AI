ALTER TABLE "refresh_tokens" ADD COLUMN "adminVerifiedAt" DATETIME;

CREATE TABLE "admin_authenticators" (
  "userId" TEXT NOT NULL PRIMARY KEY,
  "secretEnc" TEXT,
  "enabledAt" DATETIME,
  "lastCounter" INTEGER NOT NULL DEFAULT -1,
  "recoveryHashes" TEXT NOT NULL DEFAULT '[]',
  "enrollmentId" TEXT,
  "enrollmentEnc" TEXT,
  "enrollmentFamilyId" TEXT,
  "enrollmentExpiresAt" DATETIME,
  CONSTRAINT "admin_authenticators_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
