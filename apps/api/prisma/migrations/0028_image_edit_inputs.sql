-- Owned immutable input hashes and ordered reference IDs; never store source bytes in task rows.
ALTER TABLE "image_tasks" ADD COLUMN "inputJson" TEXT;
