-- 0011 · 商业化内核（账本 / 卡密 / 订单 / 支付 / 分销 / 签到）
--
-- QGauss 的 balance / user_balances / balance_consume_log /
-- account_log / crami / crami_package / order / sales_* / signin。
--
-- 金额单位：整数「分」。次数单位：整数「次」。

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- 用户表补字段：邀请码 / 邀请人 / 分销资格
-- ---------------------------------------------------------------------------
ALTER TABLE "users" ADD COLUMN "inviteCode" TEXT;
ALTER TABLE "users" ADD COLUMN "invitedBy" TEXT NOT NULL DEFAULT '';
ALTER TABLE "users" ADD COLUMN "isDistribution" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "users_inviteCode_key" ON "users"("inviteCode");

-- ---------------------------------------------------------------------------
-- 模型表补字段：次数计费池
-- ---------------------------------------------------------------------------
ALTER TABLE "models" ADD COLUMN "countPool" TEXT NOT NULL DEFAULT '';
ALTER TABLE "models" ADD COLUMN "countCost" INTEGER NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 次数余额
-- ---------------------------------------------------------------------------
CREATE TABLE "user_balances" (
  "id"                TEXT PRIMARY KEY NOT NULL,
  "userId"            TEXT NOT NULL,
  "model3Count"       INTEGER NOT NULL DEFAULT 0,
  "model4Count"       INTEGER NOT NULL DEFAULT 0,
  "drawMjCount"       INTEGER NOT NULL DEFAULT 0,
  "agentCount"        INTEGER NOT NULL DEFAULT 0,
  "memberModel3Count" INTEGER NOT NULL DEFAULT 0,
  "memberModel4Count" INTEGER NOT NULL DEFAULT 0,
  "memberDrawMjCount" INTEGER NOT NULL DEFAULT 0,
  "memberAgentCount"  INTEGER NOT NULL DEFAULT 0,
  "useModel3Count"    INTEGER NOT NULL DEFAULT 0,
  "useModel4Count"    INTEGER NOT NULL DEFAULT 0,
  "useModel3Token"    INTEGER NOT NULL DEFAULT 0,
  "useModel4Token"    INTEGER NOT NULL DEFAULT 0,
  "useDrawMjToken"    INTEGER NOT NULL DEFAULT 0,
  "useAgentCount"     INTEGER NOT NULL DEFAULT 0,
  "packageId"         TEXT NOT NULL DEFAULT '',
  "extent"            TEXT NOT NULL DEFAULT '',
  "expirationTime"    DATETIME,
  "memberResetOn"     TEXT NOT NULL DEFAULT '',
  "createdAt"         DATETIME NOT NULL,
  "updatedAt"         DATETIME NOT NULL,
  CONSTRAINT "user_balances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "user_balances_userId_key" ON "user_balances"("userId");

-- ---------------------------------------------------------------------------
-- 账户余额
-- ---------------------------------------------------------------------------
CREATE TABLE "balances" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "userId"       TEXT NOT NULL,
  "balanceCents" INTEGER NOT NULL DEFAULT 0,
  "usesLeft"     INTEGER NOT NULL DEFAULT 0,
  "paintCount"   INTEGER NOT NULL DEFAULT 0,
  "useTokens"    INTEGER NOT NULL DEFAULT 0,
  "useChats"     INTEGER NOT NULL DEFAULT 0,
  "usePaints"    INTEGER NOT NULL DEFAULT 0,
  "agentBalance" INTEGER NOT NULL DEFAULT 0,
  "createdAt"    DATETIME NOT NULL,
  "updatedAt"    DATETIME NOT NULL,
  CONSTRAINT "balances_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "balances_userId_key" ON "balances"("userId");

-- ---------------------------------------------------------------------------
-- 消费流水
-- ---------------------------------------------------------------------------
CREATE TABLE "balance_consume_logs" (
  "id"             TEXT PRIMARY KEY NOT NULL,
  "userId"         TEXT NOT NULL,
  "direction"      INTEGER NOT NULL DEFAULT 1,
  "deductionType"  TEXT NOT NULL,
  "amount"         INTEGER NOT NULL,
  "balanceKey"     TEXT NOT NULL,
  "bizType"        TEXT NOT NULL DEFAULT 'other',
  "model"          TEXT NOT NULL DEFAULT '',
  "modelName"      TEXT NOT NULL DEFAULT '',
  "useAmount"      INTEGER NOT NULL DEFAULT 0,
  "refId"          TEXT NOT NULL DEFAULT '',
  "sourceLogId"    TEXT,
  "refunded"       BOOLEAN NOT NULL DEFAULT false,
  "upstreamStatus" INTEGER,
  "remark"         TEXT NOT NULL DEFAULT '',
  "uid"            TEXT NOT NULL,
  "createdAt"      DATETIME NOT NULL
);
CREATE UNIQUE INDEX "balance_consume_logs_uid_key" ON "balance_consume_logs"("uid");
CREATE INDEX "balance_consume_logs_userId_createdAt_idx" ON "balance_consume_logs"("userId", "createdAt");
CREATE INDEX "balance_consume_logs_refId_idx" ON "balance_consume_logs"("refId");
CREATE INDEX "balance_consume_logs_deductionType_createdAt_idx" ON "balance_consume_logs"("deductionType", "createdAt");

-- ---------------------------------------------------------------------------
-- 充值流水
-- ---------------------------------------------------------------------------
CREATE TABLE "account_logs" (
  "id"           TEXT PRIMARY KEY NOT NULL,
  "userId"       TEXT NOT NULL,
  "pkgName"      TEXT NOT NULL DEFAULT '',
  "packageId"    TEXT NOT NULL DEFAULT '',
  "memberDays"   INTEGER NOT NULL DEFAULT 0,
  "rechargeType" TEXT NOT NULL DEFAULT 'admin',
  "model3Count"  INTEGER NOT NULL DEFAULT 0,
  "model4Count"  INTEGER NOT NULL DEFAULT 0,
  "drawMjCount"  INTEGER NOT NULL DEFAULT 0,
  "agentCount"   INTEGER NOT NULL DEFAULT 0,
  "days"         INTEGER NOT NULL DEFAULT 0,
  "amountCents"  INTEGER NOT NULL DEFAULT 0,
  "rebateUserId" TEXT NOT NULL DEFAULT '',
  "uid"          TEXT NOT NULL,
  "extent"       TEXT NOT NULL DEFAULT '',
  "remark"       TEXT NOT NULL DEFAULT '',
  "createdAt"    DATETIME NOT NULL
);
CREATE UNIQUE INDEX "account_logs_uid_key" ON "account_logs"("uid");
CREATE INDEX "account_logs_userId_createdAt_idx" ON "account_logs"("userId", "createdAt");
CREATE INDEX "account_logs_rechargeType_createdAt_idx" ON "account_logs"("rechargeType", "createdAt");

-- ---------------------------------------------------------------------------
-- 套餐与卡密
-- ---------------------------------------------------------------------------
CREATE TABLE "crami_packages" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "name"        TEXT NOT NULL,
  "nameEn"      TEXT NOT NULL DEFAULT '',
  "nameTw"      TEXT NOT NULL DEFAULT '',
  "des"         TEXT NOT NULL DEFAULT '',
  "desEn"       TEXT NOT NULL DEFAULT '',
  "desTw"       TEXT NOT NULL DEFAULT '',
  "coverImg"    TEXT NOT NULL DEFAULT '',
  "priceCents"  INTEGER NOT NULL DEFAULT 0,
  "sort"        INTEGER NOT NULL DEFAULT 100,
  "status"      INTEGER NOT NULL DEFAULT 1,
  "weight"      INTEGER NOT NULL DEFAULT 0,
  "days"        INTEGER NOT NULL DEFAULT 0,
  "model3Count" INTEGER NOT NULL DEFAULT 0,
  "model4Count" INTEGER NOT NULL DEFAULT 0,
  "drawMjCount" INTEGER NOT NULL DEFAULT 0,
  "agentCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"   DATETIME NOT NULL,
  "updatedAt"   DATETIME NOT NULL,
  "deletedAt"   DATETIME
);
CREATE INDEX "crami_packages_status_sort_idx" ON "crami_packages"("status", "sort");

CREATE TABLE "cramis" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "code"        TEXT NOT NULL,
  "cramiType"   INTEGER NOT NULL DEFAULT 1,
  "packageId"   TEXT NOT NULL,
  "status"      INTEGER NOT NULL DEFAULT 0,
  "useId"       TEXT NOT NULL DEFAULT '',
  "days"        INTEGER NOT NULL DEFAULT 0,
  "model3Count" INTEGER NOT NULL DEFAULT 0,
  "model4Count" INTEGER NOT NULL DEFAULT 0,
  "drawMjCount" INTEGER NOT NULL DEFAULT 0,
  "agentCount"  INTEGER NOT NULL DEFAULT 0,
  "createdAt"   DATETIME NOT NULL,
  "usedAt"      DATETIME
);
CREATE UNIQUE INDEX "cramis_code_key" ON "cramis"("code");
CREATE INDEX "cramis_status_createdAt_idx" ON "cramis"("status", "createdAt");
CREATE INDEX "cramis_packageId_idx" ON "cramis"("packageId");

-- ---------------------------------------------------------------------------
-- 订单与支付回调
-- ---------------------------------------------------------------------------
CREATE TABLE "orders" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "orderId"     TEXT NOT NULL,
  "tradeId"     TEXT NOT NULL DEFAULT '',
  "payPlatform" TEXT NOT NULL DEFAULT '',
  "userId"      TEXT NOT NULL,
  "goodsId"     TEXT NOT NULL,
  "goodsType"   TEXT NOT NULL DEFAULT 'package',
  "goodsName"   TEXT NOT NULL DEFAULT '',
  "count"       INTEGER NOT NULL DEFAULT 1,
  "priceCents"  INTEGER NOT NULL,
  "totalCents"  INTEGER NOT NULL,
  "status"      INTEGER NOT NULL DEFAULT 0,
  "paydAt"      DATETIME,
  "channel"     TEXT NOT NULL DEFAULT '',
  "createdAt"   DATETIME NOT NULL,
  "updatedAt"   DATETIME NOT NULL
);
CREATE UNIQUE INDEX "orders_orderId_key" ON "orders"("orderId");
CREATE INDEX "orders_userId_createdAt_idx" ON "orders"("userId", "createdAt");
CREATE INDEX "orders_status_createdAt_idx" ON "orders"("status", "createdAt");
CREATE INDEX "orders_tradeId_idx" ON "orders"("tradeId");

CREATE TABLE "pay_notifies" (
  "id"          TEXT PRIMARY KEY NOT NULL,
  "provider"    TEXT NOT NULL,
  "orderId"     TEXT NOT NULL DEFAULT '',
  "tradeId"     TEXT NOT NULL DEFAULT '',
  "verified"    BOOLEAN NOT NULL DEFAULT false,
  "handled"     BOOLEAN NOT NULL DEFAULT false,
  "amountCents" INTEGER NOT NULL DEFAULT 0,
  "error"       TEXT NOT NULL DEFAULT '',
  "ip"          TEXT NOT NULL DEFAULT '',
  "raw"         TEXT NOT NULL DEFAULT '',
  "createdAt"   DATETIME NOT NULL
);
CREATE INDEX "pay_notifies_orderId_idx" ON "pay_notifies"("orderId");
CREATE INDEX "pay_notifies_createdAt_idx" ON "pay_notifies"("createdAt");

-- ---------------------------------------------------------------------------
-- 分销
-- ---------------------------------------------------------------------------
CREATE TABLE "sales_users" (
  "id"                TEXT PRIMARY KEY NOT NULL,
  "userId"            TEXT NOT NULL,
  "performanceBps"    INTEGER NOT NULL DEFAULT 0,
  "salesOutletName"   TEXT NOT NULL DEFAULT '',
  "salesOutletNameEn" TEXT NOT NULL DEFAULT '',
  "salesOutletNameTw" TEXT NOT NULL DEFAULT '',
  "totalCents"        INTEGER NOT NULL DEFAULT 0,
  "withdrawalCents"   INTEGER NOT NULL DEFAULT 0,
  "distributionCents" INTEGER NOT NULL DEFAULT 0,
  "drawMoneyInCents"  INTEGER NOT NULL DEFAULT 0,
  "orderCount"        INTEGER NOT NULL DEFAULT 0,
  "enabled"           BOOLEAN NOT NULL DEFAULT true,
  "createdAt"         DATETIME NOT NULL,
  "updatedAt"         DATETIME NOT NULL
);
CREATE UNIQUE INDEX "sales_users_userId_key" ON "sales_users"("userId");

CREATE TABLE "sales_records" (
  "id"              TEXT PRIMARY KEY NOT NULL,
  "inviterUserId"   TEXT NOT NULL,
  "inviteeUserId"   TEXT NOT NULL,
  "orderId"         TEXT NOT NULL,
  "orderCents"      INTEGER NOT NULL,
  "commissionCents" INTEGER NOT NULL,
  "commissionBps"   INTEGER NOT NULL,
  "settled"         BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       DATETIME NOT NULL
);
CREATE INDEX "sales_records_inviterUserId_createdAt_idx" ON "sales_records"("inviterUserId", "createdAt");
CREATE INDEX "sales_records_orderId_idx" ON "sales_records"("orderId");

CREATE TABLE "sales_orders" (
  "id"            TEXT PRIMARY KEY NOT NULL,
  "userId"        TEXT NOT NULL,
  "amountCents"   INTEGER NOT NULL,
  "orderStatus"   INTEGER NOT NULL DEFAULT 0,
  "auditStatus"   INTEGER NOT NULL DEFAULT 0,
  "auditUserId"   TEXT NOT NULL DEFAULT '',
  "paymentStatus" INTEGER NOT NULL DEFAULT 0,
  "channels"      INTEGER NOT NULL DEFAULT 1,
  "contact"       TEXT NOT NULL DEFAULT '',
  "remark"        TEXT NOT NULL DEFAULT '',
  "createdAt"     DATETIME NOT NULL,
  "auditedAt"     DATETIME
);
CREATE INDEX "sales_orders_userId_createdAt_idx" ON "sales_orders"("userId", "createdAt");
CREATE INDEX "sales_orders_orderStatus_idx" ON "sales_orders"("orderStatus");

-- ---------------------------------------------------------------------------
-- 签到
-- ---------------------------------------------------------------------------
CREATE TABLE "signins" (
  "id"         TEXT PRIMARY KEY NOT NULL,
  "userId"     TEXT NOT NULL,
  "signInDate" TEXT NOT NULL,
  "signInTime" DATETIME NOT NULL,
  "reward"     INTEGER NOT NULL DEFAULT 0,
  "createdAt"  DATETIME NOT NULL
);
CREATE UNIQUE INDEX "signins_userId_signInDate_key" ON "signins"("userId", "signInDate");
CREATE INDEX "signins_userId_createdAt_idx" ON "signins"("userId", "createdAt");
