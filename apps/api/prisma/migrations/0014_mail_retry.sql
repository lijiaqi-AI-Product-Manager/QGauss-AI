-- 0014 · 邮件重试
--
-- mail_outbox 之前只记录 sent / failed / skipped，但没有"试过几次"，
-- 导致失败邮件既不会被重投，也无法区分"刚失败一次"和"已经失败了十次"。
-- 补两个字段，配合 MailService.retryFailed() 的重试循环。

ALTER TABLE "mail_outbox" ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "mail_outbox" ADD COLUMN "lastTriedAt" DATETIME;
