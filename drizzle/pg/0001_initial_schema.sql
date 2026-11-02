-- Migration 0001: Initial PostgreSQL schema
-- All Unix millisecond timestamps use BIGINT (64-bit). Never use INTEGER for epoch_ms.

-- Legacy tables (no user FK; only accessible via service role after RLS is enabled)
CREATE TABLE projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE screens (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  screen_number INTEGER NOT NULL,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (project_id, screen_number)
);

CREATE TABLE script_segments (
  id SERIAL PRIMARY KEY,
  screen_id INTEGER NOT NULL REFERENCES screens(id),
  origin TEXT NOT NULL DEFAULT 'human',
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL
);

CREATE TABLE screen_prompts (
  id SERIAL PRIMARY KEY,
  screen_id INTEGER NOT NULL REFERENCES screens(id),
  prompt_text TEXT NOT NULL,
  model TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Core video workflow tables
CREATE TABLE video_projects (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,                                    -- Supabase Auth uid (auth.uid())
  name TEXT NOT NULL,
  base_image_path TEXT NOT NULL,                            -- Supabase Storage path (never a signed URL)
  base_image_media_id TEXT,
  original_script TEXT NOT NULL,
  approved_script TEXT,
  skill_version TEXT NOT NULL DEFAULT 'v1',
  breakdown_approved_at BIGINT,
  creator_description TEXT,
  creative_brief TEXT,
  scene1_hook_snapshot TEXT,                                -- snapshot of default hook at project start time
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE video_screens (
  id SERIAL PRIMARY KEY,
  video_project_id INTEGER NOT NULL REFERENCES video_projects(id),
  screen_number INTEGER NOT NULL,
  dialogue TEXT NOT NULL,
  position INTEGER NOT NULL,
  approved_generation_id INTEGER,                           -- FK to video_generations.id; set later to avoid circular
  duration_seconds INTEGER,
  duration_note TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL,
  UNIQUE (video_project_id, screen_number)
);

CREATE TABLE screen_prompt_versions (
  id SERIAL PRIMARY KEY,
  video_screen_id INTEGER NOT NULL REFERENCES video_screens(id),
  version INTEGER NOT NULL,
  prompt_text TEXT NOT NULL,
  source TEXT NOT NULL,                                     -- 'claude' | 'manual'
  nl_feedback TEXT,
  feedback_scope TEXT,                                      -- 'project' | 'scene' | NULL
  screen1_prompt_version_id INTEGER,                        -- self-ref added as FK after table creation
  creative_brief_snapshot TEXT,
  created_at BIGINT NOT NULL
);

-- Self-referential FK for screen1_prompt_version_id
ALTER TABLE screen_prompt_versions
  ADD CONSTRAINT screen_prompt_versions_screen1_fk
  FOREIGN KEY (screen1_prompt_version_id) REFERENCES screen_prompt_versions(id);

CREATE TABLE video_generations (
  id SERIAL PRIMARY KEY,
  video_screen_id INTEGER NOT NULL REFERENCES video_screens(id),
  prompt_version_id INTEGER NOT NULL REFERENCES screen_prompt_versions(id),
  job_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending',                   -- pending | processing | completed | failed
  video_storage_path TEXT,                                  -- Supabase Storage path
  duration_seconds INTEGER,
  error_message TEXT,
  creator_feedback TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

-- Now add the deferred FK for approved_generation_id
ALTER TABLE video_screens
  ADD CONSTRAINT video_screens_approved_gen_fk
  FOREIGN KEY (approved_generation_id) REFERENCES video_generations(id);

CREATE TABLE prompt_generation_tasks (
  id SERIAL PRIMARY KEY,
  video_project_id INTEGER NOT NULL REFERENCES video_projects(id),
  video_screen_id INTEGER REFERENCES video_screens(id),     -- NULL for extract_brief tasks
  task_type TEXT NOT NULL DEFAULT 'generate_prompt',        -- 'extract_brief' | 'generate_prompt'
  status TEXT NOT NULL DEFAULT 'pending',                   -- pending | processing | completed | failed
  claimed_at BIGINT,                                        -- lease timestamp; NULL = unclaimed
  error_message TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

CREATE TABLE claude_conversations (
  id SERIAL PRIMARY KEY,
  video_project_id INTEGER NOT NULL REFERENCES video_projects(id),
  video_screen_id INTEGER REFERENCES video_screens(id),     -- NULL = project-level thread
  messages_json TEXT NOT NULL DEFAULT '[]',
  updated_at BIGINT NOT NULL
);

CREATE TABLE worker_lock (
  id INTEGER PRIMARY KEY,
  owner_token TEXT NOT NULL,
  acquired_at BIGINT NOT NULL,
  heartbeat_at BIGINT NOT NULL
);
