ALTER TABLE `reservations` ADD `same_day_cancellation` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `delay_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `reservations` ADD `delay_reason` text;