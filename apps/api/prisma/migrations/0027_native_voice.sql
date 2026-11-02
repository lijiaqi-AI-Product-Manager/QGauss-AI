CREATE TABLE "voice_config" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'site', "enabled" BOOLEAN NOT NULL DEFAULT false,
  "speechChannelId" TEXT NOT NULL DEFAULT '', "transcriptionChannelId" TEXT NOT NULL DEFAULT '',
  "speechModel" TEXT NOT NULL DEFAULT 'tts-1', "transcriptionModel" TEXT NOT NULL DEFAULT 'whisper-1',
  "speechCost" INTEGER NOT NULL DEFAULT 0, "transcriptionCost" INTEGER NOT NULL DEFAULT 0,
  "pool" TEXT NOT NULL DEFAULT 'model3', "maxSpeechChars" INTEGER NOT NULL DEFAULT 16000,
  "version" INTEGER NOT NULL DEFAULT 1, "updatedAt" DATETIME NOT NULL
);
CREATE TABLE "voice_tasks" (
  "id" TEXT NOT NULL PRIMARY KEY, "userId" TEXT NOT NULL, "requestKey" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "kind" TEXT NOT NULL, "messageId" TEXT, "inputFileId" TEXT, "sample" BOOLEAN NOT NULL DEFAULT false,
  "voice" TEXT NOT NULL DEFAULT 'fable', "model" TEXT NOT NULL, "channelId" TEXT NOT NULL, "configVersion" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'QUEUED', "progress" INTEGER NOT NULL DEFAULT 0,
  "inputChars" INTEGER NOT NULL DEFAULT 0, "inputSeconds" REAL NOT NULL DEFAULT 0,
  "segmentCount" INTEGER NOT NULL DEFAULT 1, "completedSegments" INTEGER NOT NULL DEFAULT 0, "attemptedSegments" INTEGER NOT NULL DEFAULT 0,
  "transcript" TEXT NOT NULL DEFAULT '', "resultJson" TEXT NOT NULL DEFAULT '[]',
  "pool" TEXT NOT NULL DEFAULT 'model3', "reservedAmount" INTEGER NOT NULL DEFAULT 0,
  "chargedAmount" INTEGER NOT NULL DEFAULT 0, "returnedAmount" INTEGER NOT NULL DEFAULT 0, "expiredAmount" INTEGER NOT NULL DEFAULT 0,
  "billingState" TEXT NOT NULL DEFAULT 'FREE', "errorCode" TEXT, "errorMessage" TEXT,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" DATETIME,
  FOREIGN KEY("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "voice_tasks_userId_requestKey_key" ON "voice_tasks"("userId","requestKey");
CREATE INDEX "voice_tasks_userId_createdAt_idx" ON "voice_tasks"("userId","createdAt");
CREATE INDEX "voice_tasks_status_createdAt_idx" ON "voice_tasks"("status","createdAt");
