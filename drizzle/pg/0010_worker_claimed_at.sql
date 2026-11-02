-- Migration 0010: Add claimed_at lease columns for worker task recovery
-- These columns are already included in the initial schema (0001) for a fresh deploy.
-- This migration exists for environments that applied 0001 before claimed_at was designed.
-- Safe to run on an empty database (ALTER TABLE ... ADD COLUMN IF NOT EXISTS).

ALTER TABLE prompt_generation_tasks
  ADD COLUMN IF NOT EXISTS claimed_at BIGINT;

ALTER TABLE video_compilations
  ADD COLUMN IF NOT EXISTS claimed_at BIGINT;

-- Add index if not already present (idempotent)
CREATE INDEX IF NOT EXISTS idx_pgt_claimed_at ON prompt_generation_tasks(claimed_at);
CREATE INDEX IF NOT EXISTS idx_vc_claimed_at ON video_compilations(claimed_at);
