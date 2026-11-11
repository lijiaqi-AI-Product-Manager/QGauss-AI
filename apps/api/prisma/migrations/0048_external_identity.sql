ALTER TABLE "users" ADD COLUMN "passwordConfigured" INTEGER NOT NULL DEFAULT 1;

CREATE TABLE "external_identities" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "userId" TEXT NOT NULL,
 "provider" TEXT NOT NULL,
 "appId" TEXT NOT NULL,
 "subjectHash" TEXT NOT NULL,
 "verifiedAt" DATETIME NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL,
 CONSTRAINT "external_identities_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "external_identities_provider_appId_subjectHash_key" ON "external_identities"("provider","appId","subjectHash");
CREATE UNIQUE INDEX "external_identities_userId_provider_appId_key" ON "external_identities"("userId","provider","appId");

CREATE TABLE "external_auth_requests" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "owner" TEXT NOT NULL,
 "purpose" TEXT NOT NULL,
 "method" TEXT NOT NULL,
 "proofHash" TEXT NOT NULL,
 "inputHash" TEXT,
 "providerAppId" TEXT NOT NULL DEFAULT '',
 "sceneKey" TEXT,
 "state" TEXT NOT NULL DEFAULT 'PREPARING',
 "version" INTEGER NOT NULL DEFAULT 1,
 "ipHash" TEXT NOT NULL DEFAULT '',
 "inviteCode" TEXT NOT NULL DEFAULT '',
 "agreedAt" DATETIME,
 "familyId" TEXT,
 "tokenVersion" INTEGER,
 "accessExpiresAt" DATETIME,
 "qrImage" TEXT,
 "providerTicketHash" TEXT,
 "subjectHash" TEXT,
 "subjectUserId" TEXT,
 "failureCode" TEXT,
 "prepareStartedAt" DATETIME,
 "oauthCodeHash" TEXT,
 "oauthLeaseUntil" DATETIME,
 "exchangeEnc" TEXT,
 "exchangeExpiresAt" DATETIME,
 "exchangeFamilyId" TEXT,
 "exchangeTokenVersion" INTEGER,
 "exchangeRefreshId" TEXT,
 "acceptedAt" DATETIME,
 "appliedAt" DATETIME,
 "expiresAt" DATETIME NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "external_auth_requests_sceneKey_key" ON "external_auth_requests"("sceneKey");
CREATE INDEX "external_auth_requests_owner_purpose_createdAt_idx" ON "external_auth_requests"("owner","purpose","createdAt");
CREATE INDEX "external_auth_requests_ipHash_createdAt_idx" ON "external_auth_requests"("ipHash","createdAt");
CREATE INDEX "external_auth_requests_state_expiresAt_idx" ON "external_auth_requests"("state","expiresAt");

CREATE TABLE "external_auth_events" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "requestId" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "payloadHash" TEXT NOT NULL,
 "expiresAt" DATETIME NOT NULL,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "external_auth_events_expiresAt_idx" ON "external_auth_events"("expiresAt");

CREATE TABLE "external_provider_states" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "credentialHash" TEXT NOT NULL,
 "tokenEnc" TEXT,
 "tokenExpiresAt" DATETIME,
 "leaseOwner" TEXT,
 "leaseUntil" DATETIME,
 "version" INTEGER NOT NULL DEFAULT 1,
 "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "updatedAt" DATETIME NOT NULL
);
