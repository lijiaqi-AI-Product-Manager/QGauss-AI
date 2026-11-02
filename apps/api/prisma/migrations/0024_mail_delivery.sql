-- Preserve every existing receipt. Old queued/failed rows cannot prove whether SMTP accepted DATA.
ALTER TABLE mail_outbox ADD COLUMN requestedById TEXT;
ALTER TABLE mail_outbox ADD COLUMN requestKey TEXT;
ALTER TABLE mail_outbox ADD COLUMN dispatchToken TEXT;
ALTER TABLE mail_outbox ADD COLUMN confirmedAt DATETIME;
CREATE INDEX mail_outbox_requestedById_createdAt_idx ON mail_outbox(requestedById, createdAt);
CREATE UNIQUE INDEX mail_outbox_requestedById_requestKey_key ON mail_outbox(requestedById, requestKey);
UPDATE mail_outbox SET status = 'unknown', error = 'LEGACY_UNCERTAIN'
WHERE status IN ('queued', 'failed');
