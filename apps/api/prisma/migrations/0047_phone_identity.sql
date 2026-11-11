-- qgauss:foreign-key-rebuild
-- Preserve account identifiers and dependent rows while allowing phone-only contacts.
CREATE TABLE "new_users" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "email" TEXT,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "displayName" TEXT,
  "avatar" TEXT,
  "signature" TEXT NOT NULL DEFAULT '',
  "role" TEXT NOT NULL DEFAULT 'USER',
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "tokenVersion" INTEGER NOT NULL DEFAULT 0,
  "inviteCode" TEXT,
  "invitedBy" TEXT NOT NULL DEFAULT '',
  "isDistribution" BOOLEAN NOT NULL DEFAULT false,
  "adminNote" TEXT NOT NULL DEFAULT '',
  "emailVerifiedAt" DATETIME,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME
);
INSERT INTO "new_users" ("id","email","username","passwordHash","displayName","avatar","signature","role","status","tokenVersion","inviteCode","invitedBy","isDistribution","adminNote","emailVerifiedAt","createdAt","updatedAt","deletedAt")
SELECT "id","email","username","passwordHash","displayName","avatar","signature","role","status","tokenVersion","inviteCode","invitedBy","isDistribution","adminNote","emailVerifiedAt","createdAt","updatedAt","deletedAt" FROM "users";
DROP TABLE "users";
ALTER TABLE "new_users" RENAME TO "users";
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");
CREATE UNIQUE INDEX "users_inviteCode_key" ON "users"("inviteCode");

CREATE TABLE "user_phone_identities" (
  "userId" TEXT PRIMARY KEY NOT NULL,
  "phone" TEXT NOT NULL,
  "verifiedAt" DATETIME NOT NULL,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "user_phone_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_phone_identities_phone_key" ON "user_phone_identities"("phone");

CREATE TABLE "phone_verification_requests" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "owner" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "phone" TEXT,
  "inputHash" TEXT,
  "codeHash" TEXT,
  "codeEnc" TEXT,
  "ipHash" TEXT NOT NULL DEFAULT '',
  "eligible" BOOLEAN NOT NULL DEFAULT false,
  "targetUserId" TEXT,
  "tokenVersion" INTEGER,
  "familyId" TEXT,
  "accessExpiresAt" DATETIME,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "state" TEXT NOT NULL DEFAULT 'QUEUED',
  "version" INTEGER NOT NULL DEFAULT 1,
  "providerMessageId" TEXT,
  "expiresAt" DATETIME,
  "cooldownUntil" DATETIME,
  "startedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "phone_verification_requests_phone_createdAt_idx" ON "phone_verification_requests"("phone","createdAt");
CREATE INDEX "phone_verification_requests_ipHash_createdAt_idx" ON "phone_verification_requests"("ipHash","createdAt");
CREATE INDEX "phone_verification_requests_owner_purpose_createdAt_idx" ON "phone_verification_requests"("owner","purpose","createdAt");
CREATE INDEX "phone_verification_requests_state_createdAt_idx" ON "phone_verification_requests"("state","createdAt");

CREATE TABLE "phone_account_actions" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "owner" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "inputHash" TEXT,
  "status" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "subjectId" TEXT,
  "phoneMasked" TEXT,
  "appliedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL
);
CREATE INDEX "phone_account_actions_owner_purpose_createdAt_idx" ON "phone_account_actions"("owner","purpose","createdAt");
