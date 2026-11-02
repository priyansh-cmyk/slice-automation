ALTER TABLE `video_projects` ADD `creator_description` text;
--> statement-breakpoint
UPDATE `video_projects`
SET `creator_description` = json_extract(`creative_brief`, '$.creatorDescription')
WHERE `creative_brief` IS NOT NULL
  AND json_extract(`creative_brief`, '$.creatorDescription') IS NOT NULL;
--> statement-breakpoint
UPDATE `video_projects`
SET `creative_brief` = json_remove(`creative_brief`, '$.creatorDescription')
WHERE `creative_brief` IS NOT NULL
  AND json_extract(`creative_brief`, '$.creatorDescription') IS NOT NULL;