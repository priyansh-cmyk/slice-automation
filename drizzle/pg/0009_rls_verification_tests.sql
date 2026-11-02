-- Migration 0009: RLS verification test scaffold (not applied to production)
-- Run manually in Supabase SQL editor using two test JWT tokens to verify isolation.
--
-- STEPS:
--   1. Create tester_a@example.com and tester_b@example.com via admin API.
--   2. Sign in as tester_a; create one project. Record:
--        project_id_a, screen_id_a, generation_id_a
--   3. Sign in as tester_b; create one project. Record:
--        project_id_b
--   4. Using tester_b's JWT, run all SELECT queries below — all must return 0 rows.
--   5. Using tester_b's JWT, run all INSERT/UPDATE queries below — all must fail with RLS error.
--   6. Using tester_b's JWT, confirm their own project returns 200.
--   7. Delete both test accounts after verification.

-- ── READ isolation (using tester_b JWT) ──────────────────────────────────────

-- Each should return 0 rows:
-- SELECT * FROM video_projects WHERE id = :project_id_a;
-- SELECT * FROM video_screens WHERE video_project_id = :project_id_a;
-- SELECT * FROM screen_prompt_versions WHERE video_screen_id = :screen_id_a;
-- SELECT * FROM video_generations WHERE video_screen_id = :screen_id_a;
-- SELECT * FROM prompt_generation_tasks WHERE video_project_id = :project_id_a;
-- SELECT * FROM claude_conversations WHERE video_project_id = :project_id_a;
-- SELECT * FROM video_compilations WHERE video_project_id = :project_id_a;
-- SELECT * FROM generation_feedback WHERE video_generation_id = :generation_id_a;
-- SELECT * FROM analytics_events WHERE video_project_id = :project_id_a;

-- ── WRITE isolation (using tester_b JWT) — all must be rejected ──────────────

-- INSERT into video_projects with tester_a's user_id:
-- INSERT INTO video_projects (user_id, name, base_image_path, original_script, created_at, updated_at)
-- VALUES (:tester_a_uid, 'attack', '', '', 0, 0);
-- → Must fail: WITH CHECK (auth.uid() = user_id) rejects because auth.uid() = tester_b

-- INSERT feedback referencing tester_a's generation with tester_b's user_id:
-- INSERT INTO generation_feedback (video_generation_id, user_id, overall_quality, created_at, updated_at)
-- VALUES (:generation_id_a, :tester_b_uid, 5, 0, 0);
-- → Must fail: WITH CHECK requires video_generation_id to resolve to tester_b's own generation

-- INSERT analytics event referencing tester_a's project:
-- INSERT INTO analytics_events (user_id, video_project_id, event_type, created_at)
-- VALUES (:tester_b_uid, :project_id_a, 'test', 0);
-- → Must fail: WITH CHECK requires video_project_id to resolve to tester_b's own project

-- ── Positive test (using tester_b JWT) ───────────────────────────────────────

-- SELECT * FROM video_projects WHERE id = :project_id_b;
-- → Must return 1 row (tester_b's own project)

-- ── API endpoint cross-access tests ──────────────────────────────────────────

-- GET  /api/v1/video-projects/:project_id_a         → 404
-- GET  /api/v1/video-projects/:project_id_a/screens → 404
-- POST /api/v1/video-projects/:project_id_a/generate-all-prompts → 404
-- GET  /api/v1/video-projects/:project_id_b         → 200
