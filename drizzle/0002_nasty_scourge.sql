ALTER TABLE `claude_conversations` ADD `video_screen_id` integer REFERENCES video_screens(id);--> statement-breakpoint
ALTER TABLE `screen_prompt_versions` ADD `feedback_scope` text;--> statement-breakpoint
ALTER TABLE `video_generations` ADD `creator_feedback` text;--> statement-breakpoint
ALTER TABLE `video_projects` ADD `creative_brief` text;--> statement-breakpoint
ALTER TABLE `video_screens` ADD `duration_seconds` integer;