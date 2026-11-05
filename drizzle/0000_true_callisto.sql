CREATE TABLE `reservations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`program` text NOT NULL,
	`location_type` text NOT NULL,
	`location_detail` text DEFAULT '' NOT NULL,
	`date` text NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`requester` text NOT NULL,
	`requester_email` text NOT NULL,
	`requester_phone` text DEFAULT '' NOT NULL,
	`crew` integer DEFAULT 1 NOT NULL,
	`requirements` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`color` text DEFAULT '#4976BA' NOT NULL,
	`status` text DEFAULT 'confirmada' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
