CREATE TABLE IF NOT EXISTS `editing_staff` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `name` text NOT NULL,
  `role` text NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
ALTER TABLE `reservations` ADD `editing_requests` text DEFAULT '[]' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD `assigned_editing_staff` text DEFAULT '[]' NOT NULL;
