ALTER TABLE `reservations` ADD `cancellation_reason` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `cancellation_detail` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `reschedule_reason` text;--> statement-breakpoint
ALTER TABLE `reservations` ADD `reschedule_detail` text;