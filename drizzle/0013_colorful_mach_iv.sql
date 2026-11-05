ALTER TABLE `reservations` ADD `usage_category` text DEFAULT 'grabación' NOT NULL;--> statement-breakpoint
ALTER TABLE `schedule_blocks` ADD `assigned_staff` text DEFAULT '[]' NOT NULL;