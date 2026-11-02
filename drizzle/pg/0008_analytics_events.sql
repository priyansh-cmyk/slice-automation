-- Migration 0008: Analytics events

CREATE TABLE analytics_events (
  id SERIAL PRIMARY KEY,
  user_id UUID NOT NULL,
  video_project_id INTEGER REFERENCES video_projects(id),
  event_type TEXT NOT NULL,
  payload JSONB,
  created_at BIGINT NOT NULL
);

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

-- Tester can only read/write their own events,
-- AND if video_project_id is set it must belong to them.
CREATE POLICY "own_events" ON analytics_events
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (
      video_project_id IS NULL
      OR video_project_id IN (
        SELECT id FROM video_projects WHERE user_id = auth.uid()
      )
    )
  );

CREATE INDEX idx_ae_user_id ON analytics_events(user_id);
CREATE INDEX idx_ae_project_id ON analytics_events(video_project_id);
CREATE INDEX idx_ae_event_type ON analytics_events(event_type);
CREATE INDEX idx_ae_created_at ON analytics_events(created_at);
