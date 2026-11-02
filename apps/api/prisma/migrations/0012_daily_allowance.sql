-- 0012 · 会员每日额度上限（UserBalance.daily*Count）
--
-- 0011 只建了 member*Count（当日剩余），没有记录「上限」，
-- 无法在跨天时把额度重置回正确值。补四个上限字段。
--
-- 语义：每日 0 点（Asia/Shanghai）把 member*Count 重置为 daily*Count；
--       daily*Count = 0 表示该池没有会员每日额度。

ALTER TABLE "user_balances" ADD COLUMN "dailyModel3Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_balances" ADD COLUMN "dailyModel4Count" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_balances" ADD COLUMN "dailyDrawMjCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "user_balances" ADD COLUMN "dailyAgentCount"  INTEGER NOT NULL DEFAULT 0;
