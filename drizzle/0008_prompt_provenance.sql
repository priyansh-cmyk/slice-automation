-- Provenance tracking for screen prompt versions (Scenes 2+)
-- Stores which Screen 1 prompt version and creative brief were active at generation time
ALTER TABLE screen_prompt_versions ADD COLUMN screen1_prompt_version_id INTEGER;
ALTER TABLE screen_prompt_versions ADD COLUMN creative_brief_snapshot TEXT;
