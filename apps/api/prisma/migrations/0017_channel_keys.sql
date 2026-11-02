-- 0017 · 渠道 Key 池（ChannelKey）
--
-- 一个渠道除了自身的「主 Key」（channels.apiKeyEnc）外，可以挂多把额外 Key：
--   - 按权重轮询分摊上游限流；
--   - 单把 Key 401/403 只禁用这把，429 只冷却这把，不再把整个渠道熔断 10 分钟；
--   - keyHash 去重，批量粘贴导入时重复的直接跳过。
-- 不建外键：渠道是软删，Key 跟随渠道一起过滤即可。

CREATE TABLE "channel_keys" (
  "id"            TEXT PRIMARY KEY NOT NULL,
  "channelId"     TEXT NOT NULL,
  "keyEnc"        TEXT NOT NULL,
  "keyHash"       TEXT NOT NULL,
  "last4"         TEXT NOT NULL DEFAULT '',
  "weight"        INTEGER NOT NULL DEFAULT 1,
  "status"        TEXT NOT NULL DEFAULT 'ENABLED',
  "failCount"     INTEGER NOT NULL DEFAULT 0,
  "lastError"     TEXT,
  "lastUsedAt"    DATETIME,
  "disabledAt"    DATETIME,
  "createdAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "channel_keys_channelId_keyHash_key" ON "channel_keys"("channelId", "keyHash");
CREATE INDEX "channel_keys_channelId_status_index" ON "channel_keys"("channelId", "status");
