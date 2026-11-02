-- 0018 · 上传文件的文本提取缓存
--
-- 对话附件里的 PDF / Word / Excel / 文本在首次引用时解析成纯文本并缓存，
-- 同一个文件在后续轮次、重新生成时不再重复解析。
--   extractedText  解析结果（已按上限截断）；NULL = 尚未解析
--   extractError   解析失败原因（文件损坏、加密 PDF 等），避免每轮重试

ALTER TABLE "upload_files" ADD COLUMN "extractedText" TEXT;
ALTER TABLE "upload_files" ADD COLUMN "extractError" TEXT;
