CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `screen_prompts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`screen_id` integer NOT NULL,
	`prompt_text` text NOT NULL,
	`model` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`screen_id`) REFERENCES `screens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `screens` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`screen_number` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `screens_project_id_screen_number_unique` ON `screens` (`project_id`,`screen_number`);--> statement-breakpoint
CREATE TABLE `script_segments` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`screen_id` integer NOT NULL,
	`origin` text DEFAULT 'human' NOT NULL,
	`content` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`screen_id`) REFERENCES `screens`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `worker_lock` (
	`id` integer PRIMARY KEY NOT NULL,
	`owner_token` text NOT NULL,
	`acquired_at` integer NOT NULL,
	`heartbeat_at` integer NOT NULL
);
