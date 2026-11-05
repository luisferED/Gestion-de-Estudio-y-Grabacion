CREATE TABLE `technical_staff` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`studios` text DEFAULT 'radio,estudio,exteriores' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
