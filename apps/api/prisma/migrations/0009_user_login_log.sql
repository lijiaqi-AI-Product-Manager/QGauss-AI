-- 0009 · 登录日志

PRAGMA foreign_keys = ON;

CREATE TABLE "user_login_logs" (
  "id"        TEXT PRIMARY KEY NOT NULL,
  "userId"    TEXT,
  "account"   TEXT NOT NULL,
  "success"   BOOLEAN NOT NULL DEFAULT false,
  "reason"    TEXT,
  "ip"        TEXT,
  "userAgent" TEXT,
  "createdAt" DATETIME NOT NULL,
  CONSTRAINT "user_login_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "user_login_logs_userId_createdAt_idx" ON "user_login_logs"("userId", "createdAt");
CREATE INDEX "user_login_logs_createdAt_idx" ON "user_login_logs"("createdAt");
