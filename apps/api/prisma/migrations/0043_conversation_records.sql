CREATE INDEX IF NOT EXISTS "messages_createdAt_id_idx" ON "messages" ("createdAt", "id");
CREATE INDEX IF NOT EXISTS "messages_conversationId_parentId_createdAt_id_idx" ON "messages" ("conversationId", "parentId", "createdAt", "id");
