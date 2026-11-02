-- Historical messages have no verified search provenance; never infer it from their text.
ALTER TABLE messages ADD COLUMN searchJson TEXT;
