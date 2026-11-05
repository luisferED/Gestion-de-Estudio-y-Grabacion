CREATE TABLE `operator_shifts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`staff_name` text NOT NULL,
	`role` text NOT NULL,
	`resource` text NOT NULL,
	`label` text DEFAULT 'Turno operativo' NOT NULL,
	`weekdays` text DEFAULT '1,2,3,4,5' NOT NULL,
	`start_time` text NOT NULL,
	`end_time` text NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
