CREATE TABLE `inventory_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'Pañol' NOT NULL,
	`stock` integer,
	`unit` text DEFAULT 'unidad' NOT NULL,
	`active` integer DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `inventory_items_name_unique` ON `inventory_items` (`name`);