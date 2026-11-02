-- Migration 0007: Tester evaluation feedback (7 dimensions)
-- This is evaluation feedback (ratings) — entirely separate from iteration feedback
-- (nl_feedback in screen_prompt_versions, which goes to Claude).

CREATE TABLE generation_feedback (
  id SERIAL PRIMARY KEY,
  video_generation_id INTEGER NOT NULL REFERENCES video_generations(id),
  user_id UUID NOT NULL,                            -- tester's auth uid
  hook_quality INTEGER CHECK (hook_quality BETWEEN 1 AND 5),
  voice_delivery INTEGER CHECK (voice_delivery BETWEEN 1 AND 5),
  speaking_pace INTEGER CHECK (speaking_pace BETWEEN 1 AND 5),
  energy_expressions INTEGER CHECK (energy_expressions BETWEEN 1 AND 5),
  gestures_actions INTEGER CHECK (gestures_actions BETWEEN 1 AND 5),
  visual_consistency INTEGER CHECK (visual_consistency BETWEEN 1 AND 5),
  overall_quality INTEGER CHECK (overall_quality BETWEEN 1 AND 5),
  notes TEXT,
  created_at BIGINT NOT NULL,
  updated_at BIGINT NOT NULL
);

ALTER TABLE generation_feedback ENABLE ROW LEVEL SECURITY;

-- Tester can only read/write their own feedback rows,
-- AND the referenced video_generation must belong to their own project.
CREATE POLICY "owner_access" ON generation_feedback
  FOR ALL
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND video_generation_id IN (
      SELECT vg.id FROM video_generations vg
      JOIN video_screens vs ON vs.id = vg.video_screen_id
      JOIN video_projects vp ON vp.id = vs.video_project_id
      WHERE vp.user_id = auth.uid()
    )
  );

CREATE INDEX idx_gf_generation_id ON generation_feedback(video_generation_id);
CREATE INDEX idx_gf_user_id ON generation_feedback(user_id);
