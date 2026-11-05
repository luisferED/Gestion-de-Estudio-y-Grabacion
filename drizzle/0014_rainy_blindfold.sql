CREATE TABLE `smtp_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`host` text DEFAULT '' NOT NULL,
	`port` integer DEFAULT 587 NOT NULL,
	`security` text DEFAULT 'starttls' NOT NULL,
	`auth_mode` text DEFAULT 'none' NOT NULL,
	`username` text DEFAULT '' NOT NULL,
	`password` text DEFAULT '' NOT NULL,
	`from_name` text DEFAULT 'Gestión de Grabaciones ED' NOT NULL,
	`from_email` text DEFAULT '' NOT NULL,
	`recipients` text DEFAULT '' NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
