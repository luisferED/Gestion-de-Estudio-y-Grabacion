ALTER TABLE `reservations` ADD COLUMN `approval_by` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `approval_at` text;
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `denial_reason` text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `sound_set_people` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `sound_microphones` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `sound_instrument_lines` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `reservations` ADD COLUMN `sound_own_system` integer DEFAULT false NOT NULL;
