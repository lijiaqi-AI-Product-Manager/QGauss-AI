-- 0016 · 模型广场展示元数据
--
-- QGauss 参考规格的模型广场是分组卡片（厂商 / 介绍 / 标签 / 角标），
-- 而 models 表原本只有 name/displayName/价格/上下文，
-- 前台只能做成一个下拉框，132 个模型的「高级池」卖不动。
--
-- 说明：
--   vendor      厂商名（OpenAI / Anthropic / DeepSeek / Google …），空串归入「其他」
--   description 一句话介绍
--   tags        逗号分隔标签（视觉 / 推理 / 工具 / 长上下文 …）
--   badge       卡片角标（HOT / NEW / 推荐），空串不展示

ALTER TABLE "models" ADD COLUMN "vendor"      TEXT NOT NULL DEFAULT '';
ALTER TABLE "models" ADD COLUMN "description" TEXT NOT NULL DEFAULT '';
ALTER TABLE "models" ADD COLUMN "tags"        TEXT NOT NULL DEFAULT '';
ALTER TABLE "models" ADD COLUMN "badge"       TEXT NOT NULL DEFAULT '';
