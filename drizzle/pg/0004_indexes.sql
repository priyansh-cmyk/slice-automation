-- Migration 0004: Performance indexes

-- video_projects: user lookup (most common query pattern)
CREATE INDEX idx_video_projects_user_id ON video_projects(user_id);

-- video_screens: FK + ordering
CREATE INDEX idx_video_screens_project_id ON video_screens(video_project_id);

-- screen_prompt_versions: FK
CREATE INDEX idx_spv_screen_id ON screen_prompt_versions(video_screen_id);

-- video_generations: FK + status polling
CREATE INDEX idx_vg_screen_id ON video_generations(video_screen_id);
CREATE INDEX idx_vg_status ON video_generations(status);
CREATE INDEX idx_vg_updated_at ON video_generations(updated_at);

-- prompt_generation_tasks: worker polling (status + claimed_at for recovery)
CREATE INDEX idx_pgt_project_id ON prompt_generation_tasks(video_project_id);
CREATE INDEX idx_pgt_status ON prompt_generation_tasks(status);
CREATE INDEX idx_pgt_claimed_at ON prompt_generation_tasks(claimed_at);

-- claude_conversations: FK lookup
CREATE INDEX idx_cc_project_id ON claude_conversations(video_project_id);
CREATE INDEX idx_cc_screen_id ON claude_conversations(video_screen_id);
