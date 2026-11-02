-- Migration 0005: Admin settings table

CREATE TABLE admin_settings (
  id INTEGER PRIMARY KEY DEFAULT 1,
  scene1_hook_instruction TEXT,
  compilation_crf INTEGER NOT NULL DEFAULT 23,
  updated_at BIGINT NOT NULL
);

ALTER TABLE admin_settings ENABLE ROW LEVEL SECURITY;

-- Only users with app_metadata.role = 'admin' may access this table.
-- app_metadata is written only by the service role (cannot be forged by users).
CREATE POLICY "admin_only" ON admin_settings
  FOR ALL
  USING (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  )
  WITH CHECK (
    (auth.jwt() -> 'app_metadata' ->> 'role') = 'admin'
  );

-- Seed the single row with empty defaults
INSERT INTO admin_settings (id, scene1_hook_instruction, compilation_crf, updated_at)
VALUES (1, NULL, 23, EXTRACT(EPOCH FROM NOW())::BIGINT * 1000)
ON CONFLICT (id) DO NOTHING;
