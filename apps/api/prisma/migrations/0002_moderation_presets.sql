-- 0002 · 敏感词与预设
-- 对应 schema.prisma 中的 SensitiveWord / ModerationHit / PresetGroup / Preset

PRAGMA foreign_keys = ON;

CREATE TABLE "sensitive_words" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "word"      TEXT NOT NULL,
  "category"  TEXT NOT NULL DEFAULT 'general',
  "action"    TEXT NOT NULL DEFAULT 'block',
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME
);
CREATE UNIQUE INDEX "sensitive_words_word_key" ON "sensitive_words"("word");
CREATE INDEX "sensitive_words_enabled_idx" ON "sensitive_words"("enabled");

CREATE TABLE "moderation_hits" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "userId"         TEXT NOT NULL,
  "word"           TEXT NOT NULL,
  "source"         TEXT NOT NULL DEFAULT 'chat',
  "excerpt"        TEXT,
  "conversationId" TEXT,
  "createdAt"      DATETIME NOT NULL
);
CREATE INDEX "moderation_hits_userId_createdAt_idx" ON "moderation_hits"("userId", "createdAt");
CREATE INDEX "moderation_hits_createdAt_idx" ON "moderation_hits"("createdAt");

CREATE TABLE "preset_groups" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "name"      TEXT NOT NULL,
  "sort"      INTEGER NOT NULL DEFAULT 0,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "preset_groups_name_key" ON "preset_groups"("name");

CREATE TABLE "presets" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "groupId"   TEXT,
  "title"     TEXT NOT NULL,
  "prompt"    TEXT NOT NULL,
  "icon"      TEXT,
  "sort"      INTEGER NOT NULL DEFAULT 0,
  "enabled"   BOOLEAN NOT NULL DEFAULT true,
  "createdAt" DATETIME NOT NULL,
  "updatedAt" DATETIME NOT NULL,
  "deletedAt" DATETIME,
  CONSTRAINT "presets_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "preset_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "presets_groupId_sort_idx" ON "presets"("groupId", "sort");
