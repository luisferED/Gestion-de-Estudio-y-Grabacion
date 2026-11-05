CREATE TABLE IF NOT EXISTS `duty_assignments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `date` text NOT NULL,
  `staff_name` text NOT NULL,
  `role` text NOT NULL,
  `resource` text NOT NULL,
  `label` text NOT NULL,
  `start_time` text NOT NULL,
  `end_time` text NOT NULL,
  `day_type` text DEFAULT 'ordinario' NOT NULL,
  `holiday_name` text DEFAULT '' NOT NULL,
  `multiplier_x100` integer DEFAULT 100 NOT NULL,
  `notes` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT true NOT NULL,
  `created_by` text DEFAULT '' NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `cancelled_by` text DEFAULT '' NOT NULL,
  `cancelled_at` text
);
