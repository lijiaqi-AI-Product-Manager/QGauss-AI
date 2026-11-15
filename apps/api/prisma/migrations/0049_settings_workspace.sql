ALTER TABLE global_configs ADD COLUMN version INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER global_config_version_after_update
AFTER UPDATE OF value, updatedBy ON global_configs
BEGIN
  UPDATE global_configs SET version = OLD.version + 1 WHERE key = NEW.key;
END;

CREATE TABLE settings_operations (
  id TEXT NOT NULL PRIMARY KEY,
  ownerId TEXT NOT NULL,
  familyId TEXT NOT NULL,
  tokenVersion INTEGER NOT NULL,
  inputHash TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  reason TEXT NOT NULL DEFAULT '',
  conflicts TEXT NOT NULL DEFAULT '[]',
  payloadEnc TEXT,
  appliedAt DATETIME,
  closedAt DATETIME,
  createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX settings_operations_ownerId_createdAt_idx ON settings_operations(ownerId, createdAt);
