-- 0003 · 文件上传
-- 对应 schema.prisma 中的 UploadFile

PRAGMA foreign_keys = ON;

CREATE TABLE "upload_files" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "userId"     TEXT NOT NULL,
  "scope"      TEXT NOT NULL DEFAULT 'chat',
  "filename"   TEXT NOT NULL,
  "storedKey"  TEXT NOT NULL,
  "mime"       TEXT NOT NULL,
  "size"       INTEGER NOT NULL,
  "sha256"     TEXT NOT NULL,
  "backend"    TEXT NOT NULL DEFAULT 'local',
  "createdAt"  DATETIME NOT NULL,
  "deletedAt"  DATETIME,
  CONSTRAINT "upload_files_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "upload_files_storedKey_key" ON "upload_files"("storedKey");
CREATE INDEX "upload_files_userId_createdAt_idx" ON "upload_files"("userId", "createdAt");
CREATE INDEX "upload_files_sha256_idx" ON "upload_files"("sha256");
