-- Migration 0003: Row Level Security policies
--
-- Design rules:
--   1. Legacy tables (projects/screens/script_segments/screen_prompts) — no user policies;
--      accessible only via service role (worker/admin routes).
--   2. video_projects — direct user_id column.
--   3. video_screens, prompt_generation_tasks, claude_conversations — 1-hop via video_project_id.
--   4. screen_prompt_versions, video_generations — 2-hop via video_screen_id.
--   5. generation_feedback — user_id direct AND video_generation_id must resolve to caller's generation.
--   6. analytics_events — user_id direct AND video_project_id (when non-null) must resolve to caller's project.
--   7. admin_settings, video_compilations — added in later migrations; policies in those files.
--   8. worker_lock — no user policies; service role only.

-- ── video_projects ────────────────────────────────────────────────────────────
CREATE POLICY "owner_access" ON video_projects
  FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ── video_screens (1 hop) ────────────────────────────────────────────────────
CREATE POLICY "owner_access" ON video_screens
  FOR ALL
  USING (
    video_project_id IN (
      SELECT id FROM video_projects WHERE user_id = auth.uid()
    )
  );

-- ── screen_prompt_versions (2 hops: video_screen_id → video_screens → video_projects) ──
CREATE POLICY "owner_access" ON screen_prompt_versions
  FOR ALL
  USING (
    video_screen_id IN (
      SELECT vs.id FROM video_screens vs
      JOIN video_projects vp ON vp.id = vs.video_project_id
      WHERE vp.user_id = auth.uid()
    )
  );

-- ── video_generations (2 hops: same chain) ───────────────────────────────────
CREATE POLICY "owner_access" ON video_generations
  FOR ALL
  USING (
    video_screen_id IN (
      SELECT vs.id FROM video_screens vs
      JOIN video_projects vp ON vp.id = vs.video_project_id
      WHERE vp.user_id = auth.uid()
    )
  );

-- ── prompt_generation_tasks (1 hop) ──────────────────────────────────────────
CREATE POLICY "owner_access" ON prompt_generation_tasks
  FOR ALL
  USING (
    video_project_id IN (
      SELECT id FROM video_projects WHERE user_id = auth.uid()
    )
  );

-- ── claude_conversations (1 hop) ─────────────────────────────────────────────
CREATE POLICY "owner_access" ON claude_conversations
  FOR ALL
  USING (
    video_project_id IN (
      SELECT id FROM video_projects WHERE user_id = auth.uid()
    )
  );

-- ── worker_lock: no user policies — service role only ────────────────────────
-- (RLS enabled with no policies = no user JWT can touch this table)
