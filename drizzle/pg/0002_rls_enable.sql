-- Migration 0002: Enable Row Level Security on all tables
-- After this migration, no row can be read/written without a matching policy
-- (or the service role key, which bypasses RLS entirely).

ALTER TABLE projects              ENABLE ROW LEVEL SECURITY;
ALTER TABLE screens               ENABLE ROW LEVEL SECURITY;
ALTER TABLE script_segments       ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_prompts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_projects        ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_screens         ENABLE ROW LEVEL SECURITY;
ALTER TABLE screen_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE video_generations     ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompt_generation_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE claude_conversations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE worker_lock           ENABLE ROW LEVEL SECURITY;
