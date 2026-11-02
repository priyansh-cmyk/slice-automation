CREATE TABLE `claude_conversations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_project_id` integer NOT NULL,
	`messages_json` text DEFAULT '[]' NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`video_project_id`) REFERENCES `video_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `screen_prompt_versions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_screen_id` integer NOT NULL,
	`version` integer NOT NULL,
	`prompt_text` text NOT NULL,
	`source` text NOT NULL,
	`nl_feedback` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`video_screen_id`) REFERENCES `video_screens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `video_generations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_screen_id` integer NOT NULL,
	`prompt_version_id` integer NOT NULL,
	`job_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`video_local_path` text,
	`error_message` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`video_screen_id`) REFERENCES `video_screens`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`prompt_version_id`) REFERENCES `screen_prompt_versions`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `video_projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_image_path` text NOT NULL,
	`base_image_media_id` text,
	`original_script` text NOT NULL,
	`skill_version` text DEFAULT 'v1' NOT NULL,
	`breakdown_approved_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `video_screens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`video_project_id` integer NOT NULL,
	`screen_number` integer NOT NULL,
	`dialogue` text NOT NULL,
	`position` integer NOT NULL,
	`approved_generation_id` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`video_project_id`) REFERENCES `video_projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `video_screens_video_project_id_screen_number_unique` ON `video_screens` (`video_project_id`,`screen_number`);