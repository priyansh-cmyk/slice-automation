CREATE TABLE `prompt_generation_tasks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `video_project_id` integer NOT NULL REFERENCES `video_projects`(`id`),
  `video_screen_id` integer REFERENCES `video_screens`(`id`),
  `task_type` text NOT NULL DEFAULT 'generate_prompt',
  `status` text NOT NULL DEFAULT 'pending',
  `error_message` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
