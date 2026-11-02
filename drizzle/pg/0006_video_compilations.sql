-- Migration 0006: Video compilations table

CREATE TABLE video_compilations (
  id SERIAL PRIMARY KEY,
  video_project_id INTEGER NOT NULL REFERENCES video_projects(id),
  status TEXT NOT NULL DEFAULT 'pending',           -- pending | processing | completed | failed
  claimed_at BIGINT,                                -- lease timestamp; NULL = unclaimed
  output_storage_path TEXT,                         -- Supabase Storage path of compiled video
  error_message TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

ALTER TABLE video_compilations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "owner_access" ON video_compilations
  FOR ALL
  USING (
    video_project_id IN (
      SELECT id FROM video_projects WHERE user_id = auth.uid()
    )
  );

CREATE INDEX idx_vc_project_id ON video_compilations(video_project_id);
CREATE INDEX idx_vc_status ON video_compilations(status);
CREATE INDEX idx_vc_claimed_at ON video_compilations(claimed_at);
